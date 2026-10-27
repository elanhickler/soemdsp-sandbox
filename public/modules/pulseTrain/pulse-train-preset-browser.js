// Pulse Train preset explorer (Sabrina-style attachable browser).
// Factory rows are example data. DSP is unchanged: this writes existing knobs.
// Audition replaces live knobs so MIDI / Trigger in plays the previewed patch.
// Click and Arrow Up/Down poke Trigger so patches play like samples.
// Load keeps the audition. Cancel restores the snapshot taken before preview.
// Isolated IIFE: do not clobber Sabrina Reverb's sabrinaPreset* globals.

(function pulseTrainPresetBrowserModule() {
  const PT_PRESET_TYPE = "pulseTrain";
  const PT_PRESET_LS = "soemdsp.pulseTrain.userPresets.v1";
  const PT_PRESET_BAR_H = 26;
  const PT_PRESET_EPS = 1e-6;
  const PT_PRESET_MAX_STOPS = 64;
  const PT_PRESET_ROOT = "Uncategorized";

  const PT_PRESET_PARAMS = Object.freeze([
    { key: "count" }, // continuous (pulse_train v37): Preset Morph glides Count
    { key: "frequency", step: 0 },
    { key: "stretch", step: 0 },
    { key: "curve", step: 0 },
    { key: "ampStart", step: 0 },
    { key: "ampEnd", step: 0 },
    { key: "ampCurve", step: 0 },
    { key: "pulseMode", step: 0 },
    { key: "curvePolarity", step: 1 },
    { key: "mode", step: 1 },
    { key: "recalculateOnTrigger", step: 1 },
    { key: "wave", step: 1 },
    { key: "morph", step: 0 },
    { key: "amplitude", step: 0 },
    { key: "antialiasing", step: 1 },
    { key: "spacing", step: 1 },
    { key: "seed", step: 1 },
  ]);

  const PT_PRESET_FACTORY = Object.freeze({
    Classic: [
      ["Init", { count: 12, frequency: 1, stretch: -0.293, curve: 3, wave: 2, mode: 1 }],
      ["Click Train", { count: 32, frequency: 8, stretch: -0.553, curve: 0, wave: 0, amplitude: 1 }],
      ["Saw Grains", { count: 12, frequency: 2, stretch: -0.163, curve: 3, wave: 2, morph: 0.5 }],
    ],
    Example: [
      ["Slow Bounce", { count: 24, frequency: 0.5, stretch: -0.078, curve: 4, ampStart: 1, ampEnd: 0.1, mode: 1, wave: 5 }],
      ["Dense Trigger", { count: 64, frequency: 16, stretch: -0.368, curve: -2, wave: 0, antialiasing: 2, seed: 17 }],
      ["Fwd-Rev Saw", { count: 8, frequency: 4, pulseMode: 0.5, wave: 2, morph: 0.5 }],
      ["One Shot Click", { count: 12, frequency: 6, stretch: -0.225, curve: 2, wave: 0, mode: 0, amplitude: 1 }],
    ],
  });

  const PT_PRESET_FOLDERS = Object.freeze(Object.keys(PT_PRESET_FACTORY));

  function ptPresetUid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function ptPresetCleanFolder(f) {
    return String(f || "").replace(/[\\/]/g, "-").trim();
  }

  function ptPresetDefaults() {
    const out = {};
    const defs = nodeGraphModuleDefinitions?.[PT_PRESET_TYPE]?.parameters || [];
    for (const p of PT_PRESET_PARAMS) {
      const meta = defs.find((d) => d.key === p.key);
      const n = Number(meta?.defaultValue);
      out[p.key] = Number.isFinite(n) ? n : 0;
    }
    return out;
  }

  function ptPresetFill(partial) {
    const out = Object.assign(ptPresetDefaults(), partial && typeof partial === "object" ? partial : {});
    const defs = nodeGraphModuleDefinitions?.[PT_PRESET_TYPE]?.parameters || [];
    for (const p of PT_PRESET_PARAMS) {
      const meta = defs.find((d) => d.key === p.key);
      let n = Number(out[p.key]);
      if (!Number.isFinite(n)) n = 0;
      if (p.step) n = Math.round(n);
      const lo = Number(meta?.min);
      const hi = Number(meta?.max);
      if (Number.isFinite(lo)) n = Math.max(lo, n);
      if (Number.isFinite(hi)) n = Math.min(hi, n);
      out[p.key] = n;
    }
    return out;
  }

  function ptPresetLoadUser() {
    try {
      const raw = JSON.parse(localStorage.getItem(PT_PRESET_LS) || "null");
      if (raw && Array.isArray(raw.presets)) {
        return {
          folders: (raw.folders || []).map(ptPresetCleanFolder).filter(Boolean),
          presets: raw.presets.map((x) => ({
            uid: x.uid || ptPresetUid(),
            name: String(x.name || "User"),
            folder: ptPresetCleanFolder(x.folder),
            values: ptPresetFill(x.values),
          })),
        };
      }
    } catch (_err) { /* ignore */ }
    return { folders: [], presets: [] };
  }

  function ptPresetSaveUser(user) {
    try { localStorage.setItem(PT_PRESET_LS, JSON.stringify(user)); } catch (_err) { /* blocked */ }
  }

  function ptPresetAll(user) {
    const out = [];
    const us = user.presets.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const u of us) {
      out.push({
        id: `u:${u.uid}`,
        uid: u.uid,
        name: u.name,
        cat: u.folder || PT_PRESET_ROOT,
        folder: u.folder,
        path: `User/${u.folder ? `${u.folder}/` : ""}${u.name}`,
        values: ptPresetFill(u.values),
        user: true,
      });
    }
    for (const folder of PT_PRESET_FOLDERS) {
      for (const [name, values] of PT_PRESET_FACTORY[folder]) {
        out.push({
          id: `f:${folder}/${name}`,
          name,
          cat: folder,
          path: `Factory/${folder}/${name}`,
          values: ptPresetFill(values),
          example: true,
        });
      }
    }
    return out;
  }

  function normalizeNodeGraphPulseTrainPreset(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const stops = Array.isArray(src.stops) ? src.stops : [];
    return {
      stops: stops.filter((x) => x && x.values).slice(0, PT_PRESET_MAX_STOPS).map((x) => ({
        id: String(x.id || ptPresetUid()),
        pos: Math.max(0, Math.min(1, Number(x.pos) || 0)),
        name: String(x.name || "Stop"),
        values: ptPresetFill(x.values),
      })),
      currentId: src.currentId ? String(src.currentId) : "",
      currentName: String(src.currentName || "Init"),
    };
  }

  function ptPresetRead(node) {
    return normalizeNodeGraphPulseTrainPreset(node?.pulseTrainPreset);
  }

  function ptPresetWrite(node, state) {
    if (!node) return;
    node.pulseTrainPreset = normalizeNodeGraphPulseTrainPreset(state);
  }

  function ptPresetSlider(article, key) {
    return article?.querySelector(`.node-parameter-row[data-param="${CSS.escape(key)}"] input[type="range"]`) || null;
  }

  function ptPresetReadValue(article, key) {
    const input = ptPresetSlider(article, key);
    const sent = Number(input?.dataset?.sentDomainValue);
    if (Number.isFinite(sent)) return sent;
    const domain = Number(input?.dataset?.domainValue);
    if (Number.isFinite(domain)) return domain;
    return Number(input?.value) || 0;
  }

  function ptPresetSnapshot(article) {
    const values = {};
    for (const p of PT_PRESET_PARAMS) values[p.key] = ptPresetReadValue(article, p.key);
    return values;
  }

  function ptPresetParamModulated(article, key) {
    return Boolean(article?.querySelector(
      `.node-parameter-row[data-param="${CSS.escape(key)}"] .node-param-port.modulation-input.rail-patched`,
    ));
  }

  function ptPresetNear(a, b, step) {
    if (step) return Math.round(a) === Math.round(b);
    return Math.abs(a - b) <= PT_PRESET_EPS;
  }

  /** Write only knobs that must move. Skip identical endpoints, already-at-target, and CV-patched params. */
  function ptPresetSmartApply(article, target, from, to, drag) {
    if (!article || !target) return 0;
    let wrote = 0;
    article._pulseTrainPresetApplying = true;
    try {
      for (const p of PT_PRESET_PARAMS) {
        if (ptPresetParamModulated(article, p.key)) continue;
        if (from && to && from !== to && ptPresetNear(from[p.key], to[p.key], p.step)) continue;
        const input = ptPresetSlider(article, p.key);
        if (!input || typeof setNodeSliderValue !== "function") continue;
        let next = p.step ? Math.round(Number(target[p.key]) || 0) : Number(target[p.key]);
        if (!Number.isFinite(next)) continue;
        const lo = Number(input.min);
        const hi = Number(input.max);
        if (Number.isFinite(lo)) next = Math.max(lo, next);
        if (Number.isFinite(hi)) next = Math.min(hi, next);
        const cur = ptPresetReadValue(article, p.key);
        if (ptPresetNear(cur, next, p.step)) continue;
        setNodeSliderValue(input, next, drag ? { interaction: "drag" } : {});
        if (!drag && typeof commitNodeSliderDragValue === "function") {
          commitNodeSliderDragValue(input, "parameter changed");
        }
        wrote += 1;
      }
    } finally {
      article._pulseTrainPresetApplying = false;
    }
    if (wrote && typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
    return wrote;
  }

  function ptPresetLerp(a, b, t, step) {
    if (step) return t < 0.5 ? a : b;
    return a + (b - a) * t;
  }

  function ptPresetMorphValues(stops, t) {
    const st = stops.slice().sort((a, b) => a.pos - b.pos);
    if (!st.length) return null;
    const u = Math.max(0, Math.min(1, Number(t) || 0));
    if (u <= st[0].pos) return { values: st[0].values, from: st[0].values, to: st[0].values };
    if (u >= st[st.length - 1].pos) {
      const last = st[st.length - 1];
      return { values: last.values, from: last.values, to: last.values };
    }
    let k = 0;
    while (k + 1 < st.length && st[k + 1].pos <= u) k += 1;
    const A = st[k];
    const B = st[k + 1];
    const span = B.pos - A.pos;
    const local = span > 1e-9 ? (u - A.pos) / span : 0;
    const values = {};
    for (const p of PT_PRESET_PARAMS) {
      values[p.key] = ptPresetLerp(A.values[p.key], B.values[p.key], local, p.step);
    }
    return { values, from: A.values, to: B.values };
  }

  function ptPresetEsc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function ptPresetTypingField(target) {
    const el = target instanceof Element ? target : target?.parentElement;
    if (!el) return false;
    const field = el.closest?.("input, textarea, select, [contenteditable='true']");
    if (!field) return false;
    if (field.tagName === "TEXTAREA" || field.tagName === "SELECT") return true;
    if (field.isContentEditable) return true;
    if (field.tagName !== "INPUT") return false;
    const type = String(field.type || "text").toLowerCase();
    return ["text", "search", "email", "url", "password", "tel", "number"].includes(type);
  }

  function mountPulseTrainPresetBrowser(article, type) {
    if (!(typeof NODE_GRAPH_MODULE_PRESETS_ENABLED !== "undefined" && NODE_GRAPH_MODULE_PRESETS_ENABLED === true)) return;
    if (type !== PT_PRESET_TYPE || !article || article.querySelector(".sabrina-preset-shell")) return;
    const nodeId = article.dataset.node;
    const body = article.querySelector(":scope > .dsp-node-body");
    if (!body || !nodeId) return;

    const user = ptPresetLoadUser();
    const shell = document.createElement("div");
    shell.className = "sabrina-preset-shell";
    shell.innerHTML = `
    <div class="sabrina-preset-bar">
      <button type="button" data-spb="prev" aria-label="Previous preset">&#9664;</button>
      <button type="button" data-spb="name" class="sabrina-preset-name">Init</button>
      <button type="button" data-spb="next" aria-label="Next preset">&#9654;</button>
      <button type="button" data-spb="toggle" aria-expanded="false">Presets</button>
    </div>
    <div class="sabrina-preset-panel" hidden>
      <div class="sabrina-preset-head">
        <input type="search" data-spb="search" placeholder="Search presets" autocomplete="off" />
        <label class="sabrina-preset-aud"><input type="checkbox" data-spb="audition" checked /> Audition</label>
      </div>
      <div class="sabrina-preset-body">
        <div class="sabrina-preset-cats" data-spb="cats"></div>
        <ul class="sabrina-preset-list" data-spb="list" tabindex="0"></ul>
      </div>
      <div class="sabrina-preset-audbar" data-spb="audbar" hidden>
        <span data-spb="audname"></span>
        <button type="button" data-spb="load">Load</button>
        <button type="button" data-spb="cancel">Cancel</button>
      </div>
      <div class="sabrina-preset-foot">
        <input type="text" data-spb="save-name" placeholder="Save as…" autocomplete="off" />
        <input type="text" data-spb="save-folder" placeholder="Folder" autocomplete="off" />
        <button type="button" data-spb="save">Save</button>
        <button type="button" data-spb="rename" disabled>Rename</button>
        <button type="button" data-spb="delete" disabled>Delete</button>
      </div>
      <div class="sabrina-preset-lane" data-spb="lane" tabindex="0">
        <div class="sabrina-preset-stops" data-spb="stops"></div>
        <div class="sabrina-preset-playhead" data-spb="playhead"></div>
      </div>
      <div class="sabrina-preset-lane-actions">
        <button type="button" data-spb="add-current">Add current</button>
        <button type="button" data-spb="add-preset">Add preset</button>
        <button type="button" data-spb="del-stop" disabled>Delete stop</button>
      </div>
    </div>`;
    body.append(shell);
    shell.addEventListener("pointerdown", (event) => event.stopPropagation());
    shell.addEventListener("mousedown", (event) => event.stopPropagation());
    shell.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    shell.addEventListener("contextmenu", (event) => event.stopPropagation());

    const $ = (key) => shell.querySelector(`[data-spb="${key}"]`);
    let cat = "All";
    let query = "";
    let listSel = null;
    let auditionId = null;
    let committed = ptPresetSnapshot(article);
    let lastPicked = null;
    let selStop = null;
    let dragStop = null;

    const node = () => (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null);

    function state() {
      return ptPresetRead(node());
    }

    function persist(next, record) {
      ptPresetWrite(node(), next);
      if (record && typeof scheduleNodeGraphChromeHistoryAndAutosave === "function") {
        scheduleNodeGraphChromeHistoryAndAutosave();
      }
    }

    function all() { return ptPresetAll(user); }
    function inCat(x, c) { return c === "All" || (c === "User" ? !!x.user : x.cat === c); }
    function filtered() {
      const q = query.trim().toLowerCase();
      return all().filter((x) => inCat(x, cat) && (!q || x.name.toLowerCase().includes(q) || x.path.toLowerCase().includes(q)));
    }
    function byId(id) { return all().find((x) => x.id === id) || null; }

    function panelOpen() {
      const panel = shell.querySelector(".sabrina-preset-panel");
      return Boolean(panel && !panel.hidden);
    }

    function setName(text, auditioning) {
      const el = $("name");
      el.textContent = text;
      el.classList.toggle("is-audition", !!auditioning);
    }

    function refresh() {
      const st = state();
      const pr = auditionId && byId(auditionId);
      setName(pr ? pr.name : (st.currentName || "Init"), !!pr);
      $("audbar").hidden = !pr;
      $("audname").textContent = pr ? `Auditioning ${pr.name}` : "";
      const sel = byId(listSel) || pr || byId(st.currentId);
      $("rename").disabled = $("delete").disabled = !(sel && sel.user);
      const extra = [...new Set([...user.folders, ...user.presets.map((x) => x.folder).filter(Boolean)])]
        .filter((f) => !PT_PRESET_FOLDERS.includes(f))
        .sort((a, b) => a.localeCompare(b));
      const hasRoot = user.presets.some((x) => !x.folder);
      const cats = ["All", ...PT_PRESET_FOLDERS, ...extra, ...(hasRoot ? [PT_PRESET_ROOT] : []), "User"];
      $("cats").innerHTML = cats.map((c) => `<button type="button" data-cat="${ptPresetEsc(c)}" class="${c === cat ? "is-on" : ""}">${ptPresetEsc(c)}</button>`).join("");
      const list = filtered();
      $("list").innerHTML = list.length
        ? list.map((x) => `<li draggable="true" data-id="${ptPresetEsc(x.id)}" class="${x.id === listSel ? "is-sel " : ""}${x.id === auditionId ? "is-aud " : ""}${x.id === st.currentId ? "is-loaded " : ""}${x.user ? "is-user" : ""}"><span>${ptPresetEsc(x.name)}</span><small>${ptPresetEsc(x.user ? "user" : "example")}</small></li>`).join("")
        : "<li class=\"empty\">No matches.</li>";
      const morph = ptPresetReadValue(article, "presetMorph");
      $("playhead").style.left = `${morph * 100}%`;
      const stops = st.stops.slice().sort((a, b) => a.pos - b.pos);
      $("stops").innerHTML = stops.map((x) => `<button type="button" class="sabrina-preset-stop${x.id === selStop ? " is-sel" : ""}" data-stop="${ptPresetEsc(x.id)}" style="left:${(x.pos * 100).toFixed(3)}%">${ptPresetEsc(x.name)}</button>`).join("");
      $("del-stop").disabled = !selStop;
      $("add-preset").disabled = !(byId(auditionId || st.currentId || lastPicked));
      const row = $("list").querySelector("li.is-sel, li.is-aud, li.is-loaded");
      if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    }

    function applyPreset(pr, drag) {
      if (!pr) return;
      ptPresetSmartApply(article, pr.values, null, null, drag);
    }

    function playPatch() {
      if (typeof triggerNodeGraphInputWireBreakPulse === "function") {
        triggerNodeGraphInputWireBreakPulse(nodeId, "Trigger");
      }
    }

    function audition(pr) {
      if (!pr) return;
      if (!auditionId) committed = ptPresetSnapshot(article);
      auditionId = pr.id;
      listSel = pr.id;
      lastPicked = pr.id;
      applyPreset(pr, true);
      refresh();
    }

    function commit(pr) {
      pr = pr || byId(auditionId);
      if (!pr) return;
      if (auditionId !== pr.id) applyPreset(pr, false);
      auditionId = null;
      const st = state();
      st.currentId = pr.id;
      st.currentName = pr.name;
      persist(st, true);
      committed = ptPresetSnapshot(article);
      refresh();
    }

    function cancelAudition() {
      if (!auditionId) return;
      auditionId = null;
      ptPresetSmartApply(article, committed, null, null, false);
      refresh();
    }

    function choose(pr) {
      if (!pr) return;
      lastPicked = pr.id;
      listSel = pr.id;
      if ($("audition").checked) audition(pr);
      else commit(pr);
      playPatch();
    }

    function step(dir) {
      const list = filtered();
      if (!list.length) return;
      const st = state();
      const cur = listSel || auditionId || st.currentId;
      let i = list.findIndex((x) => x.id === cur);
      i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
      choose(list[i]);
    }

    function applyMorph(t, drag) {
      const packed = ptPresetMorphValues(state().stops, t);
      if (!packed) return;
      if (auditionId) {
        auditionId = null;
      }
      ptPresetSmartApply(article, packed.values, packed.from, packed.to, drag);
      const st = state();
      st.currentId = "";
      st.currentName = "Morph";
      persist(st);
      refresh();
    }

    function ownsKeys(event) {
      if (!article.isConnected) return false;
      if (!panelOpen()) return false;
      if (ptPresetTypingField(event.target) && event.key !== "Escape" && event.key !== "Enter") return false;
      if (shell.contains(event.target)) return true;
      const ids = typeof nodeGraphSelectedNodeIds === "function" ? nodeGraphSelectedNodeIds() : null;
      if (ids && typeof ids.has === "function") return ids.has(nodeId);
      if (ids && typeof ids[Symbol.iterator] === "function") return [...ids].includes(nodeId);
      return false;
    }

    function onKeys(event) {
      if (!article.isConnected) {
        document.removeEventListener("keydown", onKeys, true);
        return;
      }
      if (!ownsKeys(event)) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        step(1);
        $("list").focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        step(-1);
        $("list").focus();
      } else if (event.key === "Enter" && auditionId) {
        event.preventDefault();
        event.stopPropagation();
        commit();
      } else if (event.key === "Escape" && auditionId) {
        event.preventDefault();
        event.stopPropagation();
        cancelAudition();
      }
    }
    document.addEventListener("keydown", onKeys, true);

    $("toggle").addEventListener("click", () => {
      const panel = shell.querySelector(".sabrina-preset-panel");
      const open = panel.hidden;
      panel.hidden = !open;
      $("toggle").setAttribute("aria-expanded", String(open));
      article.classList.toggle("sabrina-preset-open", open);
      refresh();
      if (open) $("list").focus();
    });
    $("prev").addEventListener("click", () => step(-1));
    $("next").addEventListener("click", () => step(1));
    $("name").addEventListener("click", () => $("toggle").click());
    $("cats").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-cat]");
      if (!b) return;
      cat = b.dataset.cat;
      refresh();
    });
    $("list").addEventListener("click", (e) => {
      const li = e.target.closest("li[data-id]");
      if (li) {
        choose(byId(li.dataset.id));
        $("list").focus();
      }
    });
    $("list").addEventListener("dblclick", (e) => {
      const li = e.target.closest("li[data-id]");
      if (li) commit(byId(li.dataset.id));
    });
    $("search").addEventListener("input", (e) => { query = e.target.value; refresh(); });
    $("load").addEventListener("click", () => commit());
    $("cancel").addEventListener("click", cancelAudition);
    $("save").addEventListener("click", () => {
      const name = String($("save-name").value || "").trim();
      if (!name) return;
      const folder = ptPresetCleanFolder($("save-folder").value);
      const values = ptPresetSnapshot(article);
      let rec = user.presets.find((u) => u.name === name && u.folder === folder);
      if (rec) rec.values = values;
      else {
        rec = { uid: ptPresetUid(), name, folder, values };
        user.presets.push(rec);
      }
      if (folder && !user.folders.includes(folder)) user.folders.push(folder);
      ptPresetSaveUser(user);
      commit({ id: `u:${rec.uid}`, name, values });
      $("save-name").value = "";
    });
    $("rename").addEventListener("click", () => {
      const pr = byId(listSel);
      const rec = pr && pr.user ? user.presets.find((u) => u.uid === pr.uid) : null;
      const name = String($("save-name").value || "").trim();
      if (!rec || !name) return;
      rec.name = name;
      ptPresetSaveUser(user);
      const st = state();
      if (st.currentId === `u:${rec.uid}`) { st.currentName = name; persist(st, true); }
      refresh();
    });
    $("delete").addEventListener("click", () => {
      const pr = byId(listSel);
      const rec = pr && pr.user ? user.presets.find((u) => u.uid === pr.uid) : null;
      if (!rec) return;
      if (auditionId === pr.id) cancelAudition();
      user.presets = user.presets.filter((u) => u !== rec);
      ptPresetSaveUser(user);
      const st = state();
      if (st.currentId === pr.id) { st.currentId = ""; persist(st, true); }
      listSel = null;
      refresh();
    });
    $("add-current").addEventListener("click", () => {
      const st = state();
      if (st.stops.length >= PT_PRESET_MAX_STOPS) return;
      const t = ptPresetReadValue(article, "presetMorph");
      st.stops.push({
        id: ptPresetUid(),
        pos: t,
        name: st.currentName || "Stop",
        values: ptPresetSnapshot(article),
      });
      selStop = st.stops[st.stops.length - 1].id;
      persist(st, true);
      applyMorph(t, true);
    });
    $("add-preset").addEventListener("click", () => {
      const pr = byId(auditionId || state().currentId || lastPicked);
      if (!pr) return;
      const st = state();
      if (st.stops.length >= PT_PRESET_MAX_STOPS) return;
      const t = ptPresetReadValue(article, "presetMorph");
      st.stops.push({ id: ptPresetUid(), pos: t, name: pr.name, values: ptPresetFill(pr.values) });
      selStop = st.stops[st.stops.length - 1].id;
      persist(st, true);
      applyMorph(t, true);
    });
    $("del-stop").addEventListener("click", () => {
      const st = state();
      st.stops = st.stops.filter((x) => x.id !== selStop);
      selStop = st.stops[0]?.id || null;
      persist(st, true);
      applyMorph(ptPresetReadValue(article, "presetMorph"), true);
    });
    $("stops").addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("[data-stop]");
      if (!btn) return;
      selStop = btn.dataset.stop;
      dragStop = { id: selStop };
      $("lane").setPointerCapture(e.pointerId);
      refresh();
    });
    $("lane").addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-stop]")) return;
      const r = $("lane").getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      const morphInput = ptPresetSlider(article, "presetMorph");
      if (morphInput) setNodeGraphModuleFaceValue(morphInput, t, false);
    });
    $("lane").addEventListener("pointermove", (e) => {
      if (!dragStop) return;
      const st = state();
      const x = st.stops.find((y) => y.id === dragStop.id);
      if (!x) return;
      const r = $("lane").getBoundingClientRect();
      x.pos = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      persist(st);
      applyMorph(ptPresetReadValue(article, "presetMorph"), true);
    });
    const endDrag = () => { dragStop = null; };
    $("lane").addEventListener("pointerup", endDrag);
    $("lane").addEventListener("pointercancel", endDrag);
    $("list").addEventListener("dragstart", (e) => {
      const li = e.target.closest("li[data-id]");
      if (!li) return;
      e.dataTransfer.setData("text/x-pulse-train-preset", li.dataset.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    $("lane").addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("text/x-pulse-train-preset")) e.preventDefault();
    });
    $("lane").addEventListener("drop", (e) => {
      e.preventDefault();
      const pr = byId(e.dataTransfer.getData("text/x-pulse-train-preset"));
      if (!pr) return;
      const r = $("lane").getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      const st = state();
      if (st.stops.length >= PT_PRESET_MAX_STOPS) return;
      st.stops.push({ id: ptPresetUid(), pos: t, name: pr.name, values: ptPresetFill(pr.values) });
      persist(st, true);
      applyMorph(ptPresetReadValue(article, "presetMorph"), true);
    });

    const morphInput = ptPresetSlider(article, "presetMorph");
    const onMorph = () => {
      if (article._pulseTrainPresetApplying) return;
      applyMorph(ptPresetReadValue(article, "presetMorph"), true);
    };
    if (morphInput) {
      morphInput.addEventListener("input", onMorph);
      if (typeof MutationObserver === "function") {
        new MutationObserver(onMorph).observe(morphInput, {
          attributes: true,
          attributeFilter: ["data-domain-value", "data-sent-domain-value"],
        });
      }
    }

    refresh();
    if (typeof layoutNodeGraphModuleFace === "function") layoutNodeGraphModuleFace(article);
  }

  function pulseTrainPresetBarOffset(article) {
    if (!(typeof NODE_GRAPH_MODULE_PRESETS_ENABLED !== "undefined" && NODE_GRAPH_MODULE_PRESETS_ENABLED === true)) return 0;
    if (!article) return 0;
    if (article.dataset?.nodeType === PT_PRESET_TYPE) return PT_PRESET_BAR_H;
    return article.querySelector(".sabrina-preset-shell .sabrina-preset-bar") ? PT_PRESET_BAR_H : 0;
  }

  globalThis.mountPulseTrainPresetBrowser = mountPulseTrainPresetBrowser;
  globalThis.pulseTrainPresetBarOffset = pulseTrainPresetBarOffset;
})();
