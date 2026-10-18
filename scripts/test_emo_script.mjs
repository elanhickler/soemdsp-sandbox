import { createRequire } from "node:module";
import assert from "node:assert";

const require = createRequire(import.meta.url);
const { compile } = require("../public/lib/emo/emo-compiler.js");

function run(source, frames, inputs, params) {
  const compiled = compile(source);
  if (!compiled.ok) {
    throw new Error(compiled.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join("\n"));
  }
  const instance = new WebAssembly.Instance(new WebAssembly.Module(compiled.wasm));
  const mem = new Float32Array(instance.exports.memory.buffer);
  const inN = compiled.inputs.length || 1;
  const outN = compiled.outputs.length || 1;
  const pN = compiled.params.length || 1;
  for (let f = 0; f < frames; f += 1) {
    for (let i = 0; i < inN; i += 1) mem[(4096 / 4) + f * inN + i] = inputs[i] || 0;
    for (let i = 0; i < pN; i += 1) mem[(8192 / 4) + f * pN + i] = params[i] || 0;
  }
  instance.exports.process_block(frames, 48000);
  const out = [];
  for (let f = 0; f < frames; f += 1) out.push(mem[(12288 / 4) + f * outN]);
  return { compiled, out };
}

const decay = run(`
param float decay = 0.5;
in float gate;
out float y;
float t;
void process() {
  t = gate > 0.5 ? 0.0 : t + dt;
  y = exp(-t / decay);
}
`, 8, [0], [0.5]);
assert.ok(decay.out[0] < 1 && decay.out[0] > 0, `decay ${decay.out[0]}`);
assert.ok(decay.out[7] < decay.out[0], "decay falls");

const choice = run(`
choice curve { linear, exponential, cosine };
param choice shape = linear;
out float y;
void process() {
  switch (shape) {
    case linear: y = 1.0;
    case exponential: y = 2.0;
    case cosine: y = 3.0;
  }
}
`, 1, [], [0]);
assert.strictEqual(choice.out[0], 1);

const klass = run(`
class OnePole { float z; float tick(float x, float k) { z += k * (x - z); return z; } }
OnePole lp;
in float x;
out float y;
void process() { y = lp.tick(x, 1.0); }
`, 2, [0.5], []);
assert.ok(Math.abs(klass.out[0] - 0.5) < 1e-4, `class ${klass.out[0]}`);

const missing = compile(`
choice curve { linear, exponential };
param choice shape = linear;
out float y;
void process() { switch (shape) { case linear: y = 1.0; } }
`);
assert.strictEqual(missing.ok, false);

const fn = run(`
float twice(float x) { return x * 2.0; }
out float y;
void process() { y = twice(0.25); }
`, 1, [], []);
assert.ok(Math.abs(fn.out[0] - 0.5) < 1e-5, `fn ${fn.out[0]}`);

const arr = run(`
float buf[4];
out float y;
void process() {
  buf[0] = 0.25;
  buf[1] = 0.5;
  y = buf[0] + buf[1];
}
`, 1, [], []);
assert.ok(Math.abs(arr.out[0] - 0.75) < 1e-5, `arr ${arr.out[0]}`);

function one(source) {
  return run(source, 1, [], []) .out[0];
}
const s0 = one(`out float y; void process() { y = sin(0.0); }`);
const s1 = one(`out float y; void process() { y = sin(1.5707963267948966); }`);
const c0 = one(`out float y; void process() { y = cos(0.0); }`);
const l1 = one(`out float y; void process() { y = log(2.718281828459045); }`);
const p8 = one(`out float y; void process() { y = pow(2.0, 3.0); }`);
const th = one(`out float y; void process() { y = tanh(0.0); }`);
assert.ok(Math.abs(s0) < 1e-4, `sin0 ${s0}`);
assert.ok(Math.abs(s1 - 1) < 1e-3, `sin90 ${s1}`);
assert.ok(Math.abs(c0 - 1) < 1e-4, `cos0 ${c0}`);
assert.ok(Math.abs(l1 - 1) < 1e-3, `logE ${l1}`);
assert.ok(Math.abs(p8 - 8) < 1e-2, `pow ${p8}`);
assert.ok(Math.abs(th) < 1e-3, `tanh ${th}`);

const multi = compile(`
out float a;
out float b;
void process() { a = 1.0; b = 3.0; }
`, { stdlib: false });
assert.strictEqual(multi.ok, true);
assert.deepStrictEqual(multi.outputs, ["a", "b"]);

const show = compile(`
out float y;
show float env;
show trace float wave[8];
show peak float pk;
void process() { y = 0.2; env = y; wave = y; pk = y; }
`);
assert.strictEqual(show.ok, true);
assert.strictEqual(show.shows.length, 3);

console.log("emo script ok", decay.out[0].toFixed(4), choice.out[0], klass.out[0], s1.toFixed(4), l1.toFixed(4), p8.toFixed(4));
