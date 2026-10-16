// Smoke: face text must scale with its container (canvas tiles / embeds
// uniformly scale the zoom-1 layout). A font size that mixes a container unit
// with an absolute bound, e.g. clamp(0.5rem, 6cqi, 0.78rem), stops scaling as
// soon as the bound wins: Pitch Quantizer note names stayed 12.48px in a big
// canvas tile. New occurrences fail; the allowlist below is shrink-only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const gate = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures += 1; };
// file | selector -> reason (remove the entry when fixed; stale entries fail).
const ALLOW = new Map([
  ["public/styles.css|.node-sample-waveform-display[data-node-type=\"audioPlayer\"]", "Music Player HUD; JS also writes px (node-graph-sample-waveform.js); approved non-GL exception"],
  ["public/styles.css|.node-settings-actions button > span:first-child, .node-settings-actions a > span:first-child", "workspace settings menu, not a face"],
  ["public/styles.css|.node-settings-actions button > span:last-child, .node-settings-actions a > span:last-child", "workspace settings menu, not a face"],
  ["public/styles.css|.node-live-input-state-badge", "workspace chrome badge, not a face"],
  ["public/styles.css|.node-drag-handle, .node-action-button, .node-display-settings-button, .node-metaparameter-button, .node-bypass-button", "module header chrome (scaled by the whole-module transform)"],
  ["public/styles.css|.node-drag-handle", "module header chrome (scaled by the whole-module transform)"],
]);
const files = [path.join(root, "public", "styles.css")];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } })(path.join(root, "public", "modules"));
const CQ = /\d(cqi|cqw|cqh|cqb|cqmin|cqmax)\b/;
const ABS = /\d(px|rem|em)\b/;
const found = new Set();
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, "/");
  const text = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1].trim().split("\n").map((s) => s.trim()).filter(Boolean).join(" ");
    for (const decl of m[2].split(";")) {
      const [prop, ...rest] = decl.split(":");
      const name = (prop || "").trim();
      const val = rest.join(":");
      if (!/^(font|font-size)$|^--[\w-]*font[\w-]*$/.test(name)) continue;
      const fns = val.match(/(clamp|min|max)\((?:[^()]|\([^()]*\))*\)/g) || [];
      if (fns.some((fn) => CQ.test(fn) && ABS.test(fn))) {
        const key = `${rel}|${sel}`;
        found.add(key);
        if (!ALLOW.has(key)) gate(false, `${key}: ${name}:${val.trim()} mixes container units with px/rem bounds (text stops scaling in canvas tiles)`);
      }
    }
  }
}
for (const key of ALLOW.keys()) if (!found.has(key)) gate(false, `allowlist entry is clean now, delete it: ${key}`);
gate(true, `scanned ${files.length} css files; ${found.size} allowlisted mixed-unit font sizes`);
const pq = fs.readFileSync(path.join(root, "public/modules/pitchQuantizer/pitch-quantizer-ui.css"), "utf8");
gate(/\.node-pitch-quantizer-key-white \{[^}]*font-size: [\d.]+cqi;/.test(pq) && /\.node-pitch-quantizer-key-black \{[^}]*font-size: [\d.]+cqi;/.test(pq), "Pitch Quantizer note names: pure container units");
gate(/\.node-pitch-quantizer-face \{[^}]*container-type: inline-size;/.test(pq) && !/pitch-quantizer-(tool|toolbar|hint)/.test(pq), "Pitch Quantizer face: container units, no All/None toolbar");
gate(/\.node-pitch-quantizer-plate \{[^}]*padding: [\d.]+cqi;/.test(pq) && !/\d+px/.test(pq.replace(/\/\*[\s\S]*?\*\//g, "").replace("minmax(2px, 1fr)", "")), "Pitch Quantizer face: padding/gaps/borders in container units (uniform tile scale)");
const st = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
gate(/\.node-midi-keyboard-white-row span \{[^}]*font-size: calc\([\d.]+cqi \/ var\(--midi-key-units, 15\)\);/.test(st) && /\.node-midi-keyboard-black-row span \{[^}]*font-size: calc\([\d.]+cqi \/ var\(--midi-key-units, 15\)\);/.test(st), "MIDI key labels: per-key container units");
console.log(failures ? `FAILED ${failures}` : "smoke_face_text_container_scale ok");
if (failures) process.exit(1);
