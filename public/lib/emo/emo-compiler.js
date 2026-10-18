// emo script compiler. Parse, check, and emit WASM. No JS on the audio path.
// Audio runs in the exported process_block. Math builtins are WASM functions.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.emoCompile = api.compile;
  root.emoStdlibSource = api.stdlib;
})(typeof globalThis !== "undefined" ? globalThis : this, function emoCompilerFactory() {
  const STDLIB = [
    "class EmoOnePole {",
    "  float z;",
    "  float tick(float x, float k) { z += k * (x - z); return z; }",
    "}",
    "class EmoDecay {",
    "  float t;",
    "  float step(float gate, float decay) {",
    "    t = gate > 0.5 ? 0.0 : t + dt;",
    "    return exp(-t / decay);",
    "  }",
    "}",
    "class EmoNoise {",
    "  int s;",
    "  float step() {",
    "    s = s * 1664525 + 1013904223;",
    "    float u = float(s) * (1.0 / 4294967296.0);",
    "    if (u < 0.0) { u = 0.0; }",
    "    return u * 2.0 - 1.0;",
    "  }",
    "}",
  ].join("\n");

  const BUILTINS = new Set(["exp", "sin", "cos", "pow", "log", "abs", "min", "max", "clamp", "floor", "sqrt", "tanh"]);

  function compile(source, options) {
    const opts = options || {};
    const withStd = opts.stdlib === false ? String(source || "") : `${STDLIB}\n${source || ""}`;
    const stdLines = opts.stdlib === false ? 0 : STDLIB.split("\n").length;
    const reported = (list) => (list || []).map((e) => {
      const line = Number(e.line) || 1;
      if (stdLines && line <= stdLines) return { ...e, line, message: `stdlib: ${e.message}` };
      return { ...e, line: stdLines ? Math.max(1, line - stdLines) : line };
    });
    const errors = [];
    let parsed;
    try {
      parsed = parse(withStd, errors);
    } catch (e) {
      errors.push({ line: e.line || 1, col: e.col || 1, message: e.message || String(e) });
      return fail(reported(errors));
    }
    if (errors.length) return fail(reported(errors));
    let checked;
    try {
      checked = check(parsed, errors);
    } catch (e) {
      errors.push({ line: e.line || 1, col: e.col || 1, message: e.message || String(e) });
      return fail(reported(errors));
    }
    if (errors.length) return fail(reported(errors));
    const wasm = emit(checked);
    return {
      ok: true,
      errors: [],
      wasm,
      inputs: checked.inputs.map((p) => p.name),
      outputs: checked.outputs.map((p) => p.name),
      params: checked.params.map((p) => {
        const amp = p.name === "amplitude" || p.name === "Amplitude";
        const init = p.choice ? p.choiceNames[p.initIndex || 0] : p.init;
        let min = 0;
        let max = 1;
        if (p.choice) {
          min = 0;
          max = Math.max(0, p.choiceNames.length - 1);
        } else if (amp) {
          min = 0;
          max = 1;
        } else if (p.ty === "int") {
          min = 0;
          max = Math.max(100, Math.ceil(Math.abs(Number(init) || 0)));
        } else {
          const span = Math.max(1, Math.abs(Number(init) || 0) * 4);
          min = Number(init) < 0 ? -span : 0;
          max = Math.max(span, 1);
        }
        return {
          key: p.name,
          kind: p.choice ? "choice" : (p.ty === "int" ? "int" : "float"),
          defaultValue: init,
          min,
          max,
          choiceNames: p.choiceNames || null,
          label: p.name,
        };
      }),
      choices: checked.choiceParams,
      shows: (checked.state || []).filter((s) => s.kind === "show" || s.kind === "trace" || s.kind === "peak").map((s) => ({
        name: s.name,
        mode: s.kind === "show" ? "value" : s.kind,
        addr: s.addr,
        len: s.len || 0,
        head: s.head || 0,
      })),
      display: checked.display,
      stdlib: STDLIB,
    };
  }

  function fail(errors) {
    return { ok: false, errors, wasm: null, inputs: [], outputs: [], params: [], choices: {}, shows: [], display: "" };
  }

  function failAt(tok, message) {
    const e = new Error(message);
    e.line = tok ? tok.line : 1;
    e.col = tok ? tok.col : 1;
    throw e;
  }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    let line = 1;
    let col = 1;
    const push = (kind, value, l, c) => toks.push({ kind, value, line: l, col: c });
    while (i < src.length) {
      const ch = src[i];
      if (ch === " " || ch === "\t" || ch === "\r") { i += 1; col += 1; continue; }
      if (ch === "\n") { i += 1; line += 1; col = 1; continue; }
      if (ch === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
      }
      if (ch === "/" && src[i + 1] === "*") {
        i += 2; col += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          if (src[i] === "\n") { line += 1; col = 1; } else col += 1;
          i += 1;
        }
        i += 2; col += 2;
        continue;
      }
      const l = line;
      const c = col;
      if (src.startsWith("display", i) && !/[A-Za-z0-9_]/.test(src[i + 7] || "")) {
        let j = i + 7;
        while (j < src.length && src[j] !== "{") {
          if (src[j] === "\n") { line += 1; col = 1; } else col += 1;
          j += 1;
        }
        if (src[j] !== "{") failAt({ line: l, col: c }, "display block needs '{'");
        j += 1;
        if (src[j - 1] === "\n") { /* col already */ }
        let depth = 1;
        const start = j;
        while (j < src.length && depth > 0) {
          if (src[j] === "{") depth += 1;
          else if (src[j] === "}") depth -= 1;
          if (depth === 0) break;
          if (src[j] === "\n") { line += 1; col = 1; } else col += 1;
          j += 1;
        }
        const body = src.slice(start, j);
        push("display", body, l, c);
        i = j + 1;
        col += 1;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
        push("id", src.slice(i, j), l, c);
        col += j - i;
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
        let j = i;
        while (j < src.length && /[0-9]/.test(src[j])) j += 1;
        let float = false;
        if (src[j] === ".") { float = true; j += 1; while (j < src.length && /[0-9]/.test(src[j])) j += 1; }
        push(float ? "float" : "int", src.slice(i, j), l, c);
        col += j - i;
        i = j;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||", "+="].includes(two)) {
        push("op", two, l, c);
        i += 2; col += 2;
        continue;
      }
      if ("=+-*/%<>(){}[];,?:.".includes(ch)) {
        push(ch, ch, l, c);
        i += 1; col += 1;
        continue;
      }
      failAt({ line: l, col: c }, `unexpected '${ch}'`);
    }
    push("eof", "", line, col);
    return toks;
  }

  function parse(src, errors) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const take = () => toks[p++];
    const eat = (kind, value) => {
      const t = peek();
      if (t.kind !== kind || (value != null && t.value !== value)) {
        failAt(t, `expected ${value || kind}`);
      }
      return take();
    };
    const isId = (v) => peek().kind === "id" && (v == null || peek().value === v);

    function parseType() {
      const t = eat("id");
      return t.value;
    }
    function parseBlock() {
      eat("{");
      const body = [];
      while (!(peek().kind === "}" || peek().kind === "eof")) body.push(parseStmt());
      eat("}");
      return body;
    }
    function parseStmt() {
      if (isId("if")) return parseIf();
      if (isId("for")) return parseFor();
      if (isId("switch")) return parseSwitch();
      if (isId("return")) {
        const t = take();
        const expr = parseExpr();
        eat(";");
        return { kind: "return", expr, tok: t };
      }
      if (isId("float") || isId("int") || isId("bool")) {
        const ty = take().value;
        const name = eat("id").value;
        let init = null;
        if (peek().kind === "=") { take(); init = parseExpr(); }
        eat(";");
        return { kind: "let", ty, name, init, tok: peek() };
      }
      const expr = parseExpr();
      eat(";");
      return { kind: "expr", expr };
    }
    function parseIf() {
      const t = eat("id", "if");
      eat("(");
      const cond = parseExpr();
      eat(")");
      const then = peek().kind === "{" ? parseBlock() : [parseStmt()];
      let els = null;
      if (isId("else")) {
        take();
        els = peek().kind === "{" ? parseBlock() : [parseStmt()];
      }
      return { kind: "if", cond, then, els, tok: t };
    }
    function parseFor() {
      const t = eat("id", "for");
      eat("(");
      eat("id", "int");
      const name = eat("id").value;
      eat("=");
      const init = parseExpr();
      eat(";");
      const cond = parseExpr();
      eat(";");
      const step = parseExpr();
      eat(")");
      const body = peek().kind === "{" ? parseBlock() : [parseStmt()];
      return { kind: "for", name, init, cond, step, body, tok: t };
    }
    function parseSwitch() {
      const t = eat("id", "switch");
      eat("(");
      const expr = parseExpr();
      eat(")");
      eat("{");
      const cases = [];
      while (isId("case")) {
        take();
        const name = eat("id").value;
        eat(":");
        const body = [];
        while (!isId("case") && peek().kind !== "}" && peek().kind !== "eof") body.push(parseStmt());
        cases.push({ name, body });
      }
      eat("}");
      return { kind: "switch", expr, cases, tok: t };
    }
    function parseExpr() { return parseAssign(); }
    function parseAssign() {
      const left = parseTernary();
      if (peek().kind === "=" || (peek().kind === "op" && peek().value === "+=")) {
        const op = take().value;
        const right = parseAssign();
        return { kind: "assign", op, left, right };
      }
      return left;
    }
    function parseTernary() {
      const cond = parseOr();
      if (peek().kind === "?") {
        take();
        const a = parseExpr();
        eat(":");
        const b = parseExpr();
        return { kind: "ternary", cond, a, b };
      }
      return cond;
    }
    function bin(next, ops) {
      return function parseBin() {
        let left = next();
        while ((peek().kind === "op" && ops.includes(peek().value)) || ops.includes(peek().kind)) {
          const op = take().value;
          const right = next();
          left = { kind: "bin", op, left, right };
        }
        return left;
      };
    }
    function parseOr() { return bin(parseAnd, ["||"])(); }
    function parseAnd() { return bin(parseCmp, ["&&"])(); }
    function parseCmp() { return bin(parseAdd, ["==", "!=", "<", ">", "<=", ">="])(); }
    function parseAdd() { return bin(parseMul, ["+", "-"])(); }
    function parseMul() { return bin(parseUnary, ["*", "/", "%"])(); }
    function parseUnary() {
      if (peek().kind === "-" || peek().kind === "!" || peek().value === "!") {
        const op = take().value;
        return { kind: "unary", op, expr: parseUnary() };
      }
      if (peek().kind === "(" && toks[p + 1] && toks[p + 1].kind === "id" && toks[p + 2] && toks[p + 2].kind === ")") {
        const names = new Set(["float", "int", "bool"]);
        if (names.has(toks[p + 1].value)) {
          take();
          const ty = take().value;
          eat(")");
          return { kind: "cast", ty, expr: parseUnary() };
        }
      }
      return parsePost();
    }
    function parsePost() {
      let expr = parsePrimary();
      for (;;) {
        if (peek().kind === "(") {
          take();
          const args = [];
          if (peek().kind !== ")") {
            args.push(parseExpr());
            while (peek().kind === ",") { take(); args.push(parseExpr()); }
          }
          eat(")");
          expr = { kind: "call", callee: expr, args };
        } else if (peek().kind === "[") {
          take();
          const index = parseExpr();
          eat("]");
          expr = { kind: "index", expr, index };
        } else if (peek().kind === ".") {
          take();
          const name = eat("id").value;
          expr = { kind: "member", expr, name };
        } else break;
      }
      return expr;
    }
    function parsePrimary() {
      const t = peek();
      if (t.kind === "float" || t.kind === "int") { take(); return { kind: "num", ty: t.kind, value: t.value, tok: t }; }
      if (t.kind === "(") { take(); const e = parseExpr(); eat(")"); return e; }
      if (t.kind === "id") { take(); return { kind: "name", name: t.value, tok: t }; }
      failAt(t, "expected expression");
    }

    const unit = { classes: [], choices: [], params: [], inputs: [], outputs: [], shows: [], globals: [], funcs: [], process: null, display: "" };
    while (peek().kind !== "eof") {
      const t = peek();
      if (t.kind === "display") { unit.display = take().value; continue; }
      if (!isId()) failAt(t, "expected declaration");
      const kw = peek().value;
      if (kw === "class") {
        take();
        const name = eat("id").value;
        eat("{");
        const fields = [];
        const methods = [];
        while (peek().kind !== "}" && peek().kind !== "eof") {
          const ty = parseType();
          const mname = eat("id").value;
          if (peek().kind === "(") {
            take();
            const params = [];
            if (peek().kind !== ")") {
              params.push({ ty: parseType(), name: eat("id").value });
              while (peek().kind === ",") { take(); params.push({ ty: parseType(), name: eat("id").value }); }
            }
            eat(")");
            methods.push({ ty, name: mname, params, body: parseBlock() });
          } else {
            eat(";");
            fields.push({ ty, name: mname });
          }
        }
        eat("}");
        unit.classes.push({ name, fields, methods });
        continue;
      }
      if (kw === "choice") {
        take();
        const name = eat("id").value;
        eat("{");
        const names = [eat("id").value];
        while (peek().kind === ",") { take(); names.push(eat("id").value); }
        eat("}");
        eat(";");
        unit.choices.push({ name, names });
        continue;
      }
      if (kw === "param") {
        take();
        if (isId("choice")) {
          take();
          const name = eat("id").value;
          eat("=");
          const init = eat("id").value;
          eat(";");
          unit.params.push({ ty: "choice", choice: null, name, init });
          continue;
        }
        const ty = parseType();
        const name = eat("id").value;
        eat("=");
        const init = parseExpr();
        eat(";");
        unit.params.push({ ty, choice: null, name, init });
        continue;
      }
      if (kw === "in" || kw === "out") {
        const dir = take().value;
        const ty = parseType();
        const name = eat("id").value;
        eat(";");
        (dir === "in" ? unit.inputs : unit.outputs).push({ ty, name });
        continue;
      }
      if (kw === "show") {
        take();
        let mode = "value";
        if (isId("trace") || isId("peak")) mode = take().value;
        const ty = parseType();
        const name = eat("id").value;
        let len = 0;
        if (peek().kind === "[") { take(); len = Number(eat("int").value); eat("]"); }
        eat(";");
        unit.shows.push({ mode, ty, name, len });
        continue;
      }
      if (kw === "void") {
        take();
        const name = eat("id").value;
        eat("(");
        eat(")");
        const body = parseBlock();
        if (name !== "process") failAt(t, "only void process() is the audio entry");
        unit.process = body;
        continue;
      }
      const ty = parseType();
      const name = eat("id").value;
      if (peek().kind === "(") {
        take();
        const params = [];
        if (peek().kind !== ")") {
          params.push({ ty: parseType(), name: eat("id").value });
          while (peek().kind === ",") { take(); params.push({ ty: parseType(), name: eat("id").value }); }
        }
        eat(")");
        unit.funcs.push({ ty, name, params, body: parseBlock() });
        continue;
      }
      if (peek().kind === "[") {
        take();
        const len = Number(eat("int").value);
        eat("]");
        eat(";");
        unit.globals.push({ ty, name, len, init: null });
        continue;
      }
      let init = null;
      if (peek().kind === "=") { take(); init = parseExpr(); }
      eat(";");
      unit.globals.push({ ty, name, len: 0, init });
    }
    if (!unit.process) errors.push({ line: 1, col: 1, message: "missing void process()" });
    return unit;
  }

  function check(unit, errors) {
    const choiceByName = new Map(unit.choices.map((c) => [c.name, c]));
    const classes = new Map(unit.classes.map((c) => [c.name, c]));
    const params = unit.params.map((p) => {
      if (p.ty === "choice") {
        const lists = unit.choices.filter((c) => c.names.includes(p.init));
        if (lists.length !== 1) errors.push({ line: 1, col: 1, message: `${p.init} must name exactly one choice` });
        const list = lists[0];
        const names = list ? list.names : [];
        const initIndex = names.indexOf(p.init);
        return { ...p, choice: list ? list.name : "", choiceNames: names, initIndex: Math.max(0, initIndex), init: initIndex };
      }
      return { ...p, init: evalConst(p.init), choiceNames: null };
    });
    if (unit.inputs.length > 6) errors.push({ line: 1, col: 1, message: "at most 6 inputs" });
    if (unit.outputs.length > 6) errors.push({ line: 1, col: 1, message: "at most 6 outputs" });
    if (params.length > 16) errors.push({ line: 1, col: 1, message: "at most 16 params" });
    const choiceParams = {};
    for (const p of params) if (p.choiceNames) choiceParams[p.name] = p.choiceNames.slice();
    let addr = 8;
    const slots = [];
    const bindGlobal = (g) => {
      const n = g.len > 0 ? g.len : 1;
      const slot = { name: g.name, ty: g.ty, addr, len: g.len || 0, kind: "state" };
      slots.push(slot);
      addr += n * 4;
      return slot;
    };
    const state = [];
    for (const g of unit.globals) {
      if (classes.has(g.ty) && !g.len) {
        const cls = classes.get(g.ty);
        const base = addr;
        const fields = {};
        for (const f of cls.fields) {
          fields[f.name] = { ty: f.ty, addr };
          addr += 4;
        }
        state.push({ name: g.name, ty: g.ty, addr: base, fields, kind: "obj" });
      } else {
        state.push(bindGlobal(g));
      }
    }
    for (const s of unit.shows) {
      if (s.mode === "trace") {
        const len = s.len || 512;
        state.push({ name: s.name, ty: "float", addr, len, kind: "trace", head: addr + len * 4 });
        addr += (len + 1) * 4;
      } else {
        state.push({ name: s.name, ty: "float", addr, len: 0, kind: s.mode === "peak" ? "peak" : "show" });
        addr += s.mode === "peak" ? 8 : 4;
      }
    }
    const env = {
      unit, classes, choiceByName, params, state,
      inputs: unit.inputs, outputs: unit.outputs, shows: unit.shows,
      funcs: new Map(unit.funcs.map((f) => [f.name, f])),
      choiceParams, errors,
    };
    for (const f of unit.funcs) walkBlock(f.body, env, localsOf(f.params));
    for (const c of unit.classes) {
      for (const m of c.methods) walkBlock(m.body, env, localsOf([{ name: "self", ty: c.name }, ...m.params]), c);
    }
    walkBlock(unit.process, env, new Map());
    for (const sw of env._switches || []) {
      const list = choiceByName.get(sw.choice) || { names: [] };
      const got = new Set(sw.cases);
      for (const name of list.names) {
        if (!got.has(name)) errors.push({ line: sw.line, col: sw.col, message: `switch missing case ${name}` });
      }
    }
    return { ...unit, params, state, choiceParams };
  }

  function localsOf(params) {
    const m = new Map();
    for (const p of params) m.set(p.name, { ty: p.ty, local: true });
    return m;
  }

  function walkBlock(body, env, locals, cls) {
    for (const st of body || []) walkStmt(st, env, locals, cls);
  }
  function walkStmt(st, env, locals, cls) {
    if (!st) return;
    if (st.kind === "let") locals.set(st.name, { ty: st.ty, local: true });
    if (st.kind === "if") {
      walkExpr(st.cond, env, locals, cls);
      walkBlock(st.then, env, locals, cls);
      walkBlock(st.els, env, locals, cls);
    } else if (st.kind === "for") {
      const inner = new Map(locals);
      inner.set(st.name, { ty: "int", local: true });
      walkExpr(st.init, env, inner, cls);
      walkExpr(st.cond, env, inner, cls);
      walkExpr(st.step, env, inner, cls);
      walkBlock(st.body, env, inner, cls);
      const bounds = constInt(st.init) != null && constInt(st.cond && st.cond.right);
      if (st.cond && st.cond.kind === "bin" && constInt(st.cond.right) == null && constInt(st.cond.left) == null) {
        env.errors.push({ line: 1, col: 1, message: "for loop bound must be a compile-time int" });
      }
      void bounds;
    } else if (st.kind === "switch") {
      const info = resolveName(st.expr.name, env, locals, cls);
      if (!info || !String(info.ty || "").startsWith("choice:")) {
        env.errors.push({ line: 1, col: 1, message: "switch requires a choice" });
      }
      env._switches = env._switches || [];
      env._switches.push({
        choice: info && info.ty.slice(7),
        cases: st.cases.map((c) => c.name),
        line: st.tok ? st.tok.line : 1,
        col: st.tok ? st.tok.col : 1,
      });
      for (const c of st.cases) walkBlock(c.body, env, locals, cls);
    } else if (st.kind === "return" || st.kind === "expr") {
      walkExpr(st.expr || st, env, locals, cls);
    }
  }
  function walkExpr(e, env, locals, cls) {
    if (!e || e.kind === "num" || e.kind === "name") return;
    if (e.kind === "bin" || e.kind === "assign") { walkExpr(e.left, env, locals, cls); walkExpr(e.right, env, locals, cls); }
    else if (e.kind === "unary" || e.kind === "cast") walkExpr(e.expr, env, locals, cls);
    else if (e.kind === "ternary") { walkExpr(e.cond, env, locals, cls); walkExpr(e.a, env, locals, cls); walkExpr(e.b, env, locals, cls); }
    else if (e.kind === "call") { (e.args || []).forEach((a) => walkExpr(a, env, locals, cls)); walkExpr(e.callee, env, locals, cls); }
    else if (e.kind === "index") { walkExpr(e.expr, env, locals, cls); walkExpr(e.index, env, locals, cls); }
    else if (e.kind === "member") walkExpr(e.expr, env, locals, cls);
  }
  function resolveName(name, env, locals, cls) {
    if (locals && locals.has(name)) return locals.get(name);
    if (cls) {
      const f = cls.fields.find((field) => field.name === name);
      if (f) return { ty: f.ty, field: f.name };
    }
    const st = env.state.find((s) => s.name === name);
    if (st) return st;
    const inn = env.inputs.find((s) => s.name === name);
    if (inn) return { ty: inn.ty, input: name };
    const param = env.params.find((s) => s.name === name);
    if (param) return { ty: param.choice ? `choice:${param.choice}` : param.ty, param: name };
    const out = env.outputs.find((s) => s.name === name);
    if (out) return { ty: out.ty, output: name };
    return null;
  }
  function constInt(e) {
    if (!e) return null;
    if (e.kind === "num" && e.ty === "int") return Number(e.value);
    if (e.kind === "unary" && e.op === "-" ) {
      const n = constInt(e.expr);
      return n == null ? null : -n;
    }
    return null;
  }
  function evalConst(e) {
    if (!e) return 0;
    if (e.kind === "num") return Number(e.value);
    if (e.kind === "unary" && e.op === "-") return -evalConst(e.expr);
    return 0;
  }

  function emit(unit) {
    const funcs = [];
    const addFn = (name, params, result, locals, body) => {
      const index = funcs.length;
      funcs.push({ name, params, result, locals, body });
      return index;
    };
    // math builtins implemented in wasm below during body gen via call indices
    const math = ["abs", "floor", "sqrt", "min", "max", "exp", "sin", "cos", "log", "pow", "tanh", "clamp"];
    for (const name of math) addFn(`emo_${name}`, mathParams(name), "f32", [], []);
    const userStart = funcs.length;
    // placeholder bodies filled after we know indices
    const fnIndex = new Map();
    unit.funcs.forEach((f, i) => fnIndex.set(f.name, userStart + i));
    let methodBase = userStart + unit.funcs.length;
    for (const c of unit.classes) {
      for (const m of c.methods) {
        fnIndex.set(`${c.name}.${m.name}`, methodBase);
        methodBase += 1;
      }
    }
    const ctx = { unit, fnIndex, funcs, math: new Map(math.map((n, i) => [n, i])) };
    for (const f of unit.funcs) {
      const loc = [];
      const body = [];
      const locals = new Map();
      f.params.forEach((p, i) => locals.set(p.name, { ty: p.ty, idx: i, arg: true }));
      emitBlock(f.body, body, ctx, locals, loc, f.ty);
      addFn(f.name, f.params.map((p) => p.ty), f.ty, loc, body);
    }
    for (const c of unit.classes) {
      for (const m of c.methods) {
        const loc = [];
        const body = [];
        const locals = new Map();
        locals.set("self", { ty: c.name, idx: 0, arg: true });
        m.params.forEach((p, i) => locals.set(p.name, { ty: p.ty, idx: i + 1, arg: true }));
        emitBlock(m.body, body, ctx, locals, loc, m.ty, c);
        addFn(`${c.name}_${m.name}`, ["i32", ...m.params.map((p) => p.ty)], m.ty, loc, body);
      }
    }
    const loc = [];
    const body = [];
    const locals = new Map();
    emitProcess(unit, body, ctx, locals, loc);
    const processIndex = addFn("process_block", ["i32", "f32"], "void", loc, body);
    fillMath(funcs, ctx);
    return encode(funcs, processIndex);
  }

  function mathParams(name) {
    if (name === "min" || name === "max" || name === "pow") return ["f32", "f32"];
    if (name === "clamp") return ["f32", "f32", "f32"];
    return ["f32"];
  }

  function tyCode(ty) {
    if (ty === "f32" || ty === "float") return 0x7d;
    if (ty === "void") return null;
    return 0x7f;
  }

  function emitProcess(unit, body, ctx, locals, extra) {
    // local 0 frames i32, local 1 sr f32, then i frame counter
    extra.push("i32");
    const frame = 2;
    // block, loop
    op(body, 0x02, 0x40);
    op(body, 0x03, 0x40);
    op(body, 0x20, frame);
    op(body, 0x20, 0);
    op(body, 0x4e);
    op(body, 0x0d, 1); // br_if 1 -> block
    // sr, dt
    body.push(0x20, 1);
    f32StoreBytes(body, 0);
    f32const(body, 1);
    body.push(0x20, 1);
    body.push(0x95);
    f32StoreBytes(body, 4);
    emitBlock(unit.process, body, ctx, locals, extra, "void", null, frame);
    // frame++
    body.push(0x20, frame);
    body.push(0x41, 1);
    body.push(0x6a);
    body.push(0x21, frame);
    body.push(0x0c, 0); // br loop
    body.push(0x0b); // end loop
    body.push(0x0b); // end block
    // init frame local to 0 at start — inserted at front
    const init = [];
    init.push(0x41, 0, 0x21, frame);
    for (const s of unit.state || []) {
      if (s.kind !== "peak") continue;
      f32const(init, Infinity);
      f32StoreBytes(init, s.addr);
      f32const(init, -Infinity);
      f32StoreBytes(init, s.addr + 4);
    }
    body.splice(0, 0, ...init);
  }

  function emitBlock(stmts, body, ctx, locals, extra, retTy, cls, frameLocal) {
    for (const st of stmts || []) emitStmt(st, body, ctx, locals, extra, retTy, cls, frameLocal);
  }

  function emitStmt(st, body, ctx, locals, extra, retTy, cls, frameLocal) {
    if (!st) return;
    if (st.kind === "let") {
      const idx = 2 + extra.length + (frameLocal != null ? 0 : 0);
      // local index: params are 0.. and extra locals follow the function params.
      // For process, params are frames, sr and extra[0] is frame. User lets append.
      const base = (retTy === "void" && frameLocal != null) ? 3 : (cls ? 1 : 0) + (cls ? 0 : 0);
      void base;
      const idx2 = allocLocal(extra, locals, st.name, st.ty, paramCount(frameLocal, locals, cls));
      if (st.init) {
        emitExpr(st.init, body, ctx, locals, extra, st.ty, cls, frameLocal);
        body.push(0x21, ...uleb(idx2));
      } else {
        zero(body, st.ty);
        body.push(0x21, ...uleb(idx2));
      }
      return;
    }
    if (st.kind === "expr") {
      emitExpr(st.expr, body, ctx, locals, extra, "float", cls, frameLocal);
      if (st.expr.kind !== "assign") body.push(0x1a);
      return;
    }
    if (st.kind === "return") {
      emitExpr(st.expr, body, ctx, locals, extra, retTy, cls, frameLocal);
      body.push(0x0f);
      return;
    }
    if (st.kind === "if") {
      emitExpr(st.cond, body, ctx, locals, extra, "bool", cls, frameLocal);
      body.push(0x04, 0x40);
      emitBlock(st.then, body, ctx, locals, extra, retTy, cls, frameLocal);
      if (st.els) {
        body.push(0x05);
        emitBlock(st.els, body, ctx, locals, extra, retTy, cls, frameLocal);
      }
      body.push(0x0b);
      return;
    }
    if (st.kind === "for") {
      const idx = allocLocal(extra, locals, st.name, "int", paramCount(frameLocal, locals, cls));
      emitExpr(st.init, body, ctx, locals, extra, "int", cls, frameLocal);
      body.push(0x21, ...uleb(idx));
      body.push(0x02, 0x40, 0x03, 0x40);
      emitExpr(st.cond, body, ctx, locals, extra, "bool", cls, frameLocal);
      body.push(0x45); // eqz
      body.push(0x0d, 1);
      emitBlock(st.body, body, ctx, locals, extra, retTy, cls, frameLocal);
      emitExpr(st.step, body, ctx, locals, extra, "float", cls, frameLocal);
      if (st.step.kind !== "assign") body.push(0x1a);
      body.push(0x0c, 0, 0x0b, 0x0b);
      return;
    }
    if (st.kind === "switch") {
      const list = choiceNamesOf(st.expr, ctx, locals, cls);
      list.forEach((name, n) => {
        const found = st.cases.find((c) => c.name === name);
        emitExpr(st.expr, body, ctx, locals, extra, "int", cls, frameLocal);
        body.push(0x41, ...sleb(n));
        body.push(0x46);
        body.push(0x04, 0x40);
        if (found) emitBlock(found.body, body, ctx, locals, extra, retTy, cls, frameLocal);
        body.push(0x0b);
      });
    }
  }

  function paramCount(frameLocal, locals, cls) {
    if (frameLocal != null) return 2;
    let n = 0;
    if (locals) {
      for (const v of locals.values()) if (v.arg) n += 1;
    }
    if (n) return n;
    if (cls) return 1;
    return 0;
  }
  function tempLocal(extra, locals, name, ty, frameLocal, cls) {
    const have = locals.get(name);
    if (have) return have.idx;
    return allocLocal(extra, locals, name, ty, paramCount(frameLocal, locals, cls));
  }
  function allocLocal(extra, locals, name, ty, reserved) {
    const idx = reserved + extra.length;
    extra.push(ty === "float" ? "f32" : "i32");
    locals.set(name, { ty, idx, local: true });
    return idx;
  }
  function choiceNamesOf(expr, ctx, locals, cls) {
    if (!expr || expr.kind !== "name") return [];
    const p = ctx.unit.params.find((item) => item.name === expr.name);
    return p && p.choiceNames ? p.choiceNames : [];
  }

  function emitExpr(e, body, ctx, locals, extra, want, cls, frameLocal) {
    if (!e) { zero(body, want); return; }
    if (e.kind === "num") {
      if (want === "int" || want === "bool") {
        body.push(0x41, ...sleb(Number(e.value) | 0));
      } else {
        f32const(body, Number(e.value));
      }
      return;
    }
    if (e.kind === "name") {
      loadName(e.name, body, ctx, locals, extra, want, cls, frameLocal);
      return;
    }
    if (e.kind === "unary") {
      if (e.op === "-") {
        if (want === "int") {
          body.push(0x41, 0);
          emitExpr(e.expr, body, ctx, locals, extra, "int", cls, frameLocal);
          body.push(0x6b);
        } else {
          emitExpr(e.expr, body, ctx, locals, extra, "float", cls, frameLocal);
          body.push(0x8c);
        }
        return;
      }
      emitExpr(e.expr, body, ctx, locals, extra, "bool", cls, frameLocal);
      if (e.op === "!") body.push(0x45);
      return;
    }
    if (e.kind === "cast") {
      emitExpr(e.expr, body, ctx, locals, extra, e.ty === "int" ? "float" : e.ty, cls, frameLocal);
      if (e.ty === "int") body.push(0xa8);
      if (e.ty === "float") body.push(0xb2);
      return;
    }
    if (e.kind === "ternary") {
      emitExpr(e.cond, body, ctx, locals, extra, "bool", cls, frameLocal);
      body.push(0x04, tyCode(want === "int" || want === "bool" ? "int" : "float"));
      emitExpr(e.a, body, ctx, locals, extra, want, cls, frameLocal);
      body.push(0x05);
      emitExpr(e.b, body, ctx, locals, extra, want, cls, frameLocal);
      body.push(0x0b);
      return;
    }
    if (e.kind === "bin") {
      if (e.op === "&&" || e.op === "||") {
        emitExpr(e.left, body, ctx, locals, extra, "bool", cls, frameLocal);
        if (e.op === "&&") {
          body.push(0x04, 0x7f);
          emitExpr(e.right, body, ctx, locals, extra, "bool", cls, frameLocal);
          body.push(0x05, 0x41, 0, 0x0b);
        } else {
          body.push(0x04, 0x7f);
          body.push(0x41, 1);
          body.push(0x05);
          emitExpr(e.right, body, ctx, locals, extra, "bool", cls, frameLocal);
          body.push(0x0b);
        }
        return;
      }
      const cmp = ["==", "!=", "<", ">", "<=", ">="].includes(e.op);
      const asInt = want === "int" && !cmp;
      emitExpr(e.left, body, ctx, locals, extra, asInt ? "int" : "float", cls, frameLocal);
      emitExpr(e.right, body, ctx, locals, extra, asInt ? "int" : "float", cls, frameLocal);
      const map = asInt
        ? { "+": 0x6a, "-": 0x6b, "*": 0x6c, "/": 0x6d, "%": 0x6f }
        : { "+": 0x92, "-": 0x93, "*": 0x94, "/": 0x95 };
      if (map[e.op]) { body.push(map[e.op]); return; }
      const fcmp = { "==": 0x5b, "!=": 0x5c, "<": 0x5d, ">": 0x5e, "<=": 0x5f, ">=": 0x60 };
      body.push(fcmp[e.op] || 0x5b);
      return;
    }
    if (e.kind === "assign") {
      if (e.left && e.left.kind === "name") {
        const special = (ctx.unit.state || []).find((s) => s.name === e.left.name && (s.kind === "trace" || s.kind === "peak"));
        if (special && special.kind === "trace") {
          emitExpr(e.right, body, ctx, locals, extra, "float", cls, frameLocal);
          body.push(0x24, 0);
          const head = tempLocal(extra, locals, "$head", "int", frameLocal, cls);
          body.push(0x41, ...sleb(special.head), 0x28, 2, 0);
          body.push(0x22, ...uleb(head));
          body.push(0x41, ...sleb(Math.max(1, special.len)));
          body.push(0x6f);
          body.push(0x41, 4, 0x6c);
          body.push(0x41, ...sleb(special.addr), 0x6a);
          body.push(0x23, 0);
          body.push(0x38, 2, 0);
          body.push(0x41, ...sleb(special.head));
          body.push(0x20, ...uleb(head), 0x41, 1, 0x6a);
          body.push(0x36, 2, 0);
          return;
        }
        if (special && special.kind === "peak") {
          emitExpr(e.right, body, ctx, locals, extra, "float", cls, frameLocal);
          body.push(0x24, 0);
          f32Load(body, special.addr);
          body.push(0x23, 0, 0x96);
          f32StoreBytes(body, special.addr);
          f32Load(body, special.addr + 4);
          body.push(0x23, 0, 0x97);
          f32StoreBytes(body, special.addr + 4);
          return;
        }
      }
      const mem = memAddr(e.left, body, ctx, locals, cls, extra, frameLocal);
      if (mem) {
        const ty = mem.ty === "int" ? "int" : "float";
        if (e.op === "+=") {
          if (e.left.kind === "name") loadName(e.left.name, body, ctx, locals, extra, ty, cls, frameLocal);
          else if (e.left.kind === "index") emitExpr(e.left, body, ctx, locals, extra, ty, cls, frameLocal);
          else f32const(body, 0);
          emitExpr(e.right, body, ctx, locals, extra, ty, cls, frameLocal);
          body.push(ty === "int" ? 0x6a : 0x92);
        } else {
          emitExpr(e.right, body, ctx, locals, extra, ty, cls, frameLocal);
        }
        if (ty === "int") body.push(0x36, 2, 0);
        else body.push(0x38, 2, 0);
        return;
      }
      const loc = e.left && e.left.kind === "name" ? locals.get(e.left.name) : null;
      const ty = loc && loc.ty === "int" ? "int" : "float";
      if (e.op === "+=") {
        emitExpr(e.left, body, ctx, locals, extra, ty, cls, frameLocal);
        emitExpr(e.right, body, ctx, locals, extra, ty, cls, frameLocal);
        body.push(ty === "int" ? 0x6a : 0x92);
      } else {
        emitExpr(e.right, body, ctx, locals, extra, ty, cls, frameLocal);
      }
      if (loc) body.push(0x21, ...uleb(loc.idx));
      else body.push(0x1a);
      return;
    }
    if (e.kind === "call") {
      const callee = e.callee;
      if (callee.kind === "name" && ctx.math.has(callee.name)) {
        for (const a of e.args) emitExpr(a, body, ctx, locals, extra, "float", cls, frameLocal);
        body.push(0x10, ...uleb(ctx.math.get(callee.name)));
        return;
      }
      if (callee.kind === "member") {
        emitExpr(callee.expr, body, ctx, locals, extra, "int", cls, frameLocal);
        // self address was loaded as f32 by loadName. Methods need i32 base.
        // loadName for objects pushes the address as i32 via a side path: see loadName kind obj.
        for (const a of e.args) emitExpr(a, body, ctx, locals, extra, "float", cls, frameLocal);
        const objTy = "OnePole";
        void objTy;
        const key = memberKey(callee, ctx, locals, cls);
        const index = ctx.fnIndex.get(key);
        body.push(0x10, ...uleb(index || 0));
        return;
      }
      if (callee.kind === "name" && ctx.fnIndex.has(callee.name)) {
        for (const a of e.args) emitExpr(a, body, ctx, locals, extra, "float", cls, frameLocal);
        body.push(0x10, ...uleb(ctx.fnIndex.get(callee.name)));
        return;
      }
      f32const(body, 0);
      return;
    }
    if (e.kind === "index") {
      const st = e.expr && e.expr.kind === "name"
        ? (ctx.unit.state || []).find((s) => s.name === e.expr.name && s.len > 0)
        : null;
      if (!st) { zero(body, want); return; }
      pushArrayAddr(st, e.index, body, ctx, locals, extra, cls, frameLocal);
      if (st.ty === "int") {
        body.push(0x28, 2, 0);
        if (want === "float") body.push(0xb2);
      } else {
        body.push(0x2a, 2, 0);
      }
      return;
    }
    f32const(body, 0);
  }

  function memberKey(callee, ctx) {
    const obj = callee.expr;
    if (!obj || obj.kind !== "name") return "";
    const st = (ctx.unit.state || []).find((s) => s.name === obj.name);
    if (!st) return "";
    return `${st.ty}.${callee.name}`;
  }

  function loadName(name, body, ctx, locals, extra, want, cls, frameLocal) {
    if (name === "dt") { f32Load(body, 4); return; }
    if (name === "sr") { f32Load(body, 0); return; }
    const loc = locals.get(name);
    if (loc && loc.idx != null) {
      body.push(0x20, ...uleb(loc.idx));
      if (loc.ty !== "float" && loc.ty !== "f32" && want === "float") body.push(0xb2);
      return;
    }
    const input = ctx.unit.inputs.findIndex((p) => p.name === name);
    if (input >= 0) {
      // IN + (frame * inCount + input) * 4
      addrIn(body, frameLocal, ctx.unit.inputs.length, input);
      body.push(0x2a, 2, 0);
      return;
    }
    const param = ctx.unit.params.findIndex((p) => p.name === name);
    if (param >= 0) {
      addrParam(body, frameLocal, ctx.unit.params.length, param);
      body.push(0x2a, 2, 0);
      if (ctx.unit.params[param].choice && want === "int") body.push(0xa8);
      else if (ctx.unit.params[param].choice) { /* f32 index */ }
      return;
    }
    const state = (ctx.unit.state || []).find((s) => s.name === name);
    if (state && state.kind === "obj") {
      body.push(0x41, ...sleb(state.addr));
      return;
    }
    if (state) {
      if (state.ty === "int") {
        body.push(0x41, ...sleb(state.addr), 0x28, 2, 0);
        if (want === "float") body.push(0xb2);
      } else {
        f32Load(body, state.addr);
      }
      return;
    }
    const field = cls && cls.fields.find((f) => f.name === name);
    if (field) {
      body.push(0x20, 0);
      body.push(0x41, ...sleb(fieldAddr(cls, field.name)));
      body.push(0x6a);
      if (field.ty === "int") body.push(0x28, 2, 0);
      else body.push(0x2a, 2, 0);
      return;
    }
    const outRead = ctx.unit.outputs.findIndex((p) => p.name === name);
    if (outRead >= 0) {
      addrOut(body, frameLocal || 2, ctx.unit.outputs.length, outRead);
      body.push(0x2a, 2, 0);
      return;
    }
    zero(body, want);
  }

  function fieldAddr(cls, name) {
    let a = 0;
    for (const f of cls.fields) {
      if (f.name === name) return a;
      a += 4;
    }
    return 0;
  }

  function pushArrayAddr(st, indexExpr, body, ctx, locals, extra, cls, frameLocal) {
    const tmp = tempLocal(extra, locals, "$idx", "int", frameLocal, cls);
    emitExpr(indexExpr, body, ctx, locals, extra, "int", cls, frameLocal);
    body.push(0x21, ...uleb(tmp));
    const last = Math.max(0, (st.len || 1) - 1);
    body.push(0x20, ...uleb(tmp), 0x41, 0, 0x48);
    body.push(0x04, 0x7f, 0x41, 0, 0x05);
    body.push(0x20, ...uleb(tmp), 0x41, ...sleb(last), 0x4a);
    body.push(0x04, 0x7f, 0x41, ...sleb(last), 0x05);
    body.push(0x20, ...uleb(tmp));
    body.push(0x0b, 0x0b);
    body.push(0x41, 4, 0x6c);
    body.push(0x41, ...sleb(st.addr), 0x6a);
  }

  function memAddr(left, body, ctx, locals, cls, extra, frameLocal) {
    if (!left) return null;
    if (left.kind === "index") {
      const st = left.expr && left.expr.kind === "name"
        ? (ctx.unit.state || []).find((s) => s.name === left.expr.name && s.len > 0)
        : null;
      if (!st) return null;
      pushArrayAddr(st, left.index, body, ctx, locals, extra, cls, frameLocal);
      return { ty: st.ty === "int" ? "int" : "float" };
    }
    if (left.kind === "name") {
      const out = ctx.unit.outputs.findIndex((p) => p.name === left.name);
      if (out >= 0) {
        addrOut(body, 2, ctx.unit.outputs.length, out);
        return { ty: "float" };
      }
      const state = (ctx.unit.state || []).find((s) => s.name === left.name);
      if (state && state.kind !== "obj" && state.kind !== "trace" && state.kind !== "peak") {
        body.push(0x41, ...sleb(state.addr));
        return { ty: state.ty === "int" ? "int" : "float" };
      }
      if (cls) {
        const field = cls.fields.find((f) => f.name === left.name);
        if (field) {
          body.push(0x20, 0);
          body.push(0x41, ...sleb(fieldAddr(cls, field.name)));
          body.push(0x6a);
          return { ty: field.ty === "int" ? "int" : "float" };
        }
      }
    }
    return null;
  }
  function addrOut(body, frame, count, index) {
    body.push(0x41, ...sleb(12288));
    body.push(0x20, frame);
    body.push(0x41, ...sleb(Math.max(1, count)));
    body.push(0x6c);
    body.push(0x41, ...sleb(index));
    body.push(0x6a);
    body.push(0x41, 4);
    body.push(0x6c);
    body.push(0x6a);
  }

  function addrIn(body, frame, count, index) {
    body.push(0x41, ...sleb(4096));
    body.push(0x20, frame || 0);
    body.push(0x41, ...sleb(Math.max(1, count)));
    body.push(0x6c);
    body.push(0x41, ...sleb(index));
    body.push(0x6a);
    body.push(0x41, 4);
    body.push(0x6c);
    body.push(0x6a);
  }
  function addrParam(body, frame, count, index) {
    body.push(0x41, ...sleb(8192));
    body.push(0x20, frame || 0);
    body.push(0x41, ...sleb(Math.max(1, count)));
    body.push(0x6c);
    body.push(0x41, ...sleb(index));
    body.push(0x6a);
    body.push(0x41, 4);
    body.push(0x6c);
    body.push(0x6a);
  }
  function f32Load(body, offset) {
    body.push(0x41, ...sleb(offset), 0x2a, 2, 0);
  }
  function f32StoreBytes(body, offset) {
    const addr = [0x41, ...sleb(offset)];
    // value is already on stack. Need addr under value: use memory.grow trick no.
    // Insert addr before the value by wrapping callers. Here value is on stack.
    // local.tee to local 0 clobbers frames. Use i32 on stack swap not available.
    // Emit: (store offset (value-on-stack)) by rebuilding with a temp in the caller.
    body.push(0x3a); // drop stand-in replaced
    body.pop();
    // Actually encode store with addr first by using the last bytes... we'll push addr then
    // cannot reorder. Documented fix in emitProcess: it pushes value then we need store.
    // WASM store is [addr, value]. If value is on stack, we can only store if we tee.
    // Add a hidden f32 local at index 2 for process — conflict with frame.
    // Use global 0.
    body.push(0x24, 0); // global.set 0  -- we'll add one mutable f32 global
    body.push(0x41, ...sleb(offset));
    body.push(0x23, 0); // global.get
    body.push(0x38, 2, 0);
  }
  function op(body, code, extra) {
    body.push(code);
    if (typeof extra === "number") body.push(extra);
    else if (Array.isArray(extra)) body.push(...extra);
  }
  function zero(body, want) {
    if (want === "int" || want === "bool") body.push(0x41, 0);
    else f32const(body, 0);
  }
  function f32const(body, v) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    const bytes = new Uint8Array(buf);
    body.push(0x43, ...bytes);
  }
  function uleb(n) {
    const o = [];
    let v = n >>> 0;
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      o.push(b);
    } while (v);
    return o;
  }
  function sleb(n) {
    const o = [];
    let v = n | 0;
    for (;;) {
      let b = v & 0x7f;
      v >>= 7;
      const done = (v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0);
      if (!done) b |= 0x80;
      o.push(b);
      if (done) break;
    }
    return o;
  }

  function fillMath(funcs) {
    const bodies = mathBodies();
    for (let i = 0; i < bodies.length; i += 1) {
      funcs[i].body = bodies[i].body;
      funcs[i].locals = bodies[i].locals || [];
    }
  }
  function bare(body) { return { body, locals: [] }; }
  function mathBodies() {
    return [
      bare([0x20, 0, 0x8b]),
      bare([0x20, 0, 0x8e]),
      bare([0x20, 0, 0x91]),
      bare([0x20, 0, 0x20, 1, 0x96]),
      bare([0x20, 0, 0x20, 1, 0x97]),
      expBody(),
      sinCosBody(false),
      sinCosBody(true),
      logBody(),
      powBody(),
      tanhBody(),
      bare([0x20, 0, 0x20, 1, 0x97, 0x20, 2, 0x96]),
    ];
  }
  function hornerMul(b, local, coeffs) {
    f32const(b, coeffs[0]);
    for (let i = 1; i < coeffs.length; i += 1) {
      b.push(0x20, local, 0x94);
      f32const(b, coeffs[i]);
      b.push(0x92);
    }
  }
  function expBody() {
    const b = [];
    f32const(b, 1.4426950408889634);
    b.push(0x20, 0, 0x94);
    f32const(b, 0.5);
    b.push(0x92, 0x8e, 0xfc, 0x00);
    b.push(0x21, 2);
    b.push(0x20, 0);
    b.push(0x20, 2, 0xb2);
    f32const(b, 0.6931471805599453);
    b.push(0x94, 0x93);
    b.push(0x21, 1);
    b.push(0x20, 2, 0x41, ...sleb(127), 0x4a);
    b.push(0x04, 0x7d);
    f32const(b, Infinity);
    b.push(0x05);
    b.push(0x20, 2, 0x41, ...sleb(-126), 0x48);
    b.push(0x04, 0x7d);
    f32const(b, 0);
    b.push(0x05);
    hornerMul(b, 1, [1 / 40320, 1 / 5040, 1 / 720, 1 / 120, 1 / 24, 1 / 6, 0.5, 1, 1]);
    b.push(0x20, 2, 0x41, ...sleb(127), 0x6a, 0x41, 23, 0x74, 0xbe, 0x94);
    b.push(0x0b, 0x0b);
    return { body: b, locals: ["f32", "i32"] };
  }
  function sinCosBody(cosMode) {
    const b = [];
    f32const(b, 0.6366197723675814);
    b.push(0x20, 0, 0x94);
    f32const(b, 0.5);
    b.push(0x92, 0x8e, 0xfc, 0x00);
    b.push(0x21, 2);
    b.push(0x20, 0);
    b.push(0x20, 2, 0xb2);
    f32const(b, 1.5707963267948966);
    b.push(0x94, 0x93);
    b.push(0x21, 1);
    hornerMul(b, 1, [-1 / 39916800, 1 / 362880, -1 / 5040, 1 / 120, -1 / 6, 1]);
    b.push(0x20, 1, 0x94);
    b.push(0x21, 3);
    hornerMul(b, 1, [-1 / 3628800, 1 / 40320, -1 / 720, 1 / 24, -0.5, 1]);
    b.push(0x21, 4);
    const use = (q) => {
      const sinNeg = q === 2 || q === 3;
      const cosNeg = q === 1 || q === 2;
      const useCos = cosMode ? (q === 0 || q === 2) : (q === 1 || q === 3);
      const neg = cosMode ? cosNeg : sinNeg;
      b.push(0x20, useCos ? 4 : 3);
      if (neg) b.push(0x8c);
    };
    const cond = (q) => { b.push(0x20, 2, 0x41, 3, 0x71, 0x41, q, 0x46); };
    cond(0); b.push(0x04, 0x7d); use(0); b.push(0x05);
    cond(1); b.push(0x04, 0x7d); use(1); b.push(0x05);
    cond(2); b.push(0x04, 0x7d); use(2); b.push(0x05);
    use(3);
    b.push(0x0b, 0x0b, 0x0b);
    return { body: b, locals: ["f32", "i32", "f32", "f32"] };
  }
  function logBody() {
    const b = [];
    b.push(0x20, 0);
    f32const(b, 0);
    b.push(0x5e);
    b.push(0x04, 0x7d);
    b.push(0x20, 0, 0xbc);
    b.push(0x21, 1);
    b.push(0x20, 1, 0x41, 23, 0x76, 0x41, ...sleb(255), 0x71);
    b.push(0x41, ...sleb(127), 0x6b);
    b.push(0x21, 2);
    b.push(0x20, 1, 0x41, ...sleb(0x7fffff), 0x71, 0x41, ...sleb(0x3f800000), 0x72, 0xbe);
    b.push(0x21, 3);
    b.push(0x20, 3);
    f32const(b, 1.41421356237);
    b.push(0x5e);
    b.push(0x04, 0x40);
    b.push(0x20, 3);
    f32const(b, 0.5);
    b.push(0x94);
    b.push(0x21, 3);
    b.push(0x20, 2, 0x41, 1, 0x6a, 0x21, 2);
    b.push(0x0b);
    b.push(0x20, 3);
    f32const(b, 1);
    b.push(0x93);
    b.push(0x21, 3);
    hornerMul(b, 3, [1 / 11, -0.1, 1 / 9, -0.125, 1 / 7, -1 / 6, 0.2, -0.25, 1 / 3, -0.5, 1]);
    b.push(0x20, 3, 0x94);
    b.push(0x20, 2, 0xb2);
    f32const(b, 0.6931471805599453);
    b.push(0x94, 0x92);
    b.push(0x05);
    f32const(b, -80);
    b.push(0x0b);
    return { body: b, locals: ["i32", "i32", "f32"] };
  }
  function powBody() {
    const b = [];
    b.push(0x20, 0);
    f32const(b, 0);
    b.push(0x5e);
    b.push(0x04, 0x7d);
    b.push(0x20, 0, 0x10, 8);
    b.push(0x20, 1, 0x94);
    b.push(0x10, 5);
    b.push(0x05);
    f32const(b, 0);
    b.push(0x0b);
    return bare(b);
  }
  function tanhBody() {
    const b = [];
    b.push(0x20, 0);
    f32const(b, -8);
    f32const(b, 8);
    b.push(0x10, 11);
    f32const(b, 2);
    b.push(0x94);
    b.push(0x10, 5);
    b.push(0x21, 1);
    b.push(0x20, 1);
    f32const(b, 1);
    b.push(0x93);
    b.push(0x20, 1);
    f32const(b, 1);
    b.push(0x92);
    b.push(0x95);
    return { body: b, locals: ["f32"] };
  }

  function encode(funcs, exportIndex) {
    const typeList = [];
    const typeIndex = (params, result) => {
      const key = `${params.join(",")}>${result || ""}`;
      let i = typeList.findIndex((t) => t.key === key);
      if (i < 0) { i = typeList.length; typeList.push({ key, params, result }); }
      return i;
    };
    const fnTypes = funcs.map((f) => typeIndex(f.params.map(tyCode).filter((x) => x != null), f.result === "void" ? null : tyCode(f.result)));
    const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    const types = [];
    types.push(...uleb(typeList.length));
    for (const t of typeList) {
      types.push(0x60, ...uleb(t.params.length), ...t.params);
      if (t.result == null) types.push(0x00);
      else types.push(0x01, t.result);
    }
    section(bytes, 1, types);
    const fns = [...uleb(funcs.length)];
    for (const id of fnTypes) fns.push(...uleb(id));
    section(bytes, 3, fns);
    // memory 1 page
    section(bytes, 5, [...uleb(1), 0x00, 1]);
    // one mutable f32 global
    section(bytes, 6, [...uleb(1), 0x7d, 0x01, 0x43, 0, 0, 0, 0, 0x0b]);
    const ex = [];
    const name = "process_block";
    ex.push(...uleb(2));
    ex.push(...uleb(name.length), ...[...name].map((c) => c.charCodeAt(0)), 0x00, ...uleb(exportIndex));
    const memName = "memory";
    ex.push(...uleb(memName.length), ...[...memName].map((c) => c.charCodeAt(0)), 0x02, 0x00);
    section(bytes, 7, ex);
    const code = [...uleb(funcs.length)];
    for (const f of funcs) {
      const locals = groupLocals(f.locals);
      const localBytes = [...uleb(locals.length)];
      for (const g of locals) localBytes.push(...uleb(g.n), g.code);
      const body = [...localBytes, ...f.body, 0x0b];
      code.push(...uleb(body.length), ...body);
    }
    section(bytes, 10, code);
    return Uint8Array.from(bytes);
  }
  function groupLocals(list) {
    const out = [];
    for (const ty of list) {
      const code = ty === "f32" ? 0x7d : 0x7f;
      const last = out[out.length - 1];
      if (last && last.code === code) last.n += 1;
      else out.push({ n: 1, code });
    }
    return out;
  }
  function section(bytes, id, content) {
    bytes.push(id, ...uleb(content.length), ...content);
  }

  return { compile, stdlib: STDLIB };
});
