import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function load(name) {
  const bytes = readFileSync(new URL(`../native_modules/${name}/${name}.wasm`, import.meta.url));
  return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
}

function loadCombined() {
  const bytes = readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url));
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { emo_process_block: () => {} },
  }).exports;
}

{
  const h = load("hyperbolic_decay");
  const free = h.soemdsp_hyperbolic_decay_create();
  const latch = h.soemdsp_hyperbolic_decay_create();
  assert.ok(free && latch);
  for (let i = 0; i < 11; i++) {
    h.soemdsp_hyperbolic_decay_sample(free, i === 0 ? 1 : 0, 0.1, 0, 1, 0, 1000);
    h.soemdsp_hyperbolic_decay_sample(latch, i === 0 ? 1 : 0, 0.1, 0, 1, 1, 1000);
  }
  const freeChanged = h.soemdsp_hyperbolic_decay_sample(free, 0, 0.005, 0, 0.2, 0, 1000);
  const latchChanged = h.soemdsp_hyperbolic_decay_sample(latch, 0, 0.005, 0, 0.2, 1, 1000);
  assert.equal(freeChanged, 0, "Free should follow a shortened duration");
  assert.ok(latchChanged > 0.005, "Latch should retain trigger-time settings");
  h.soemdsp_hyperbolic_decay_destroy(free);
  h.soemdsp_hyperbolic_decay_destroy(latch);
}

{
  const p = load("audio_player");
  const handle = p.soemdsp_audio_player_create();
  const frames = 256;
  const cycles = 8;
  assert.ok(handle);
  assert.equal(p.soemdsp_audio_player_set_pcm(handle, frames, 44100, 1), 1);
  const pcm = new Float32Array(p.memory.buffer, p.soemdsp_audio_player_l_ptr(handle), frames);
  for (let i = 0; i < frames; i++) pcm[i] = Math.sin(2 * Math.PI * cycles * i / frames);
  let cubicError = 0;
  let linearError = 0;
  let count = 0;
  for (let i = 0; i < 2000; i++) {
    const actual = p.soemdsp_audio_player_sample(
      handle, 0, 0, 0, 0, 3, 0.1, 0, 1, 1, 0, 0, 0, 0, 44100,
    );
    const index = p.soemdsp_audio_player_phase(handle) * (frames - 1);
    if (index < 2 || index > frames - 3) continue;
    const lo = Math.floor(index);
    const t = index - lo;
    const ideal = Math.sin(2 * Math.PI * cycles * index / frames);
    const linear = pcm[lo] + (pcm[lo + 1] - pcm[lo]) * t;
    cubicError += (actual - ideal) ** 2;
    linearError += (linear - ideal) ** 2;
    count++;
  }
  assert.ok(count > 1000);
  assert.ok(cubicError < linearError * 0.25,
    `Cubic reconstruction should beat linear at slow speed (${cubicError} vs ${linearError})`);
  p.soemdsp_audio_player_destroy(handle);
}

{
  const g = loadCombined();
  const generator = 101;
  const out = 102;
  const mod = 103;
  const speaker = 104;
  const render = (withMod) => {
    const handle = g.soemdsp_graph_create();
    assert.ok(handle);
    for (const [id, type] of [[generator, 111], [out, 113], [mod, 1], [speaker, 6]]) {
      assert.ok(g.soemdsp_graph_add_node(handle, id, type) >= 0);
    }
    assert.equal(g.soemdsp_graph_connect(handle, generator, 23, out, 23), 0);
    assert.equal(g.soemdsp_graph_connect(handle, out, 0, speaker, 1), 0);
    if (withMod) {
      assert.equal(g.soemdsp_graph_add_param_mod_edge(handle, mod, 0, out, 81), 0);
    }
    assert.equal(g.soemdsp_graph_set_param_domain(handle, out, 81, 1, 32, 0), 0);
    assert.equal(g.soemdsp_graph_set_param(handle, generator, 22, 32), 0);
    assert.equal(g.soemdsp_graph_set_param(handle, out, 10, 440), 0);
    assert.equal(g.soemdsp_graph_set_param(handle, out, 80, 1), 0);
    assert.equal(g.soemdsp_graph_set_param(handle, out, 81, 1), 0);
    assert.equal(g.soemdsp_graph_set_param(handle, mod, 10, 1000), 0);
    assert.equal(g.soemdsp_graph_compile(handle), 0);
    assert.equal(g.soemdsp_graph_process_block(handle, 128), 128);
    const ptr = g.soemdsp_graph_node_port_ptr(handle, out, 0);
    const samples = Array.from(new Float64Array(g.memory.buffer, ptr, 128));
    g.soemdsp_graph_destroy(handle);
    return samples;
  };
  const modulated = render(true);
  const unmodulated = render(false);
  assert.deepEqual(render(false), unmodulated, "Additive comparison needs deterministic baseline");
  assert.ok(modulated.every(Number.isFinite), "Modulated Additive Out must stay finite");
  assert.ok(modulated.some((sample) => Math.abs(sample) > 1e-5),
    "Modulated Additive Out must produce a signal");
  const difference = modulated.reduce((sum, sample, i) => sum + Math.abs(sample - unmodulated[i]), 0);
  assert.ok(difference > 0.01, "Slope End audio-rate modulation must change Additive Out sound");
}

console.log("ingest3 native smoke: Hyperbolic, Music Player, and Additive Out passed");
