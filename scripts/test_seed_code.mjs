// Round-trip + parse tests for public/node-graph-seed-code.js (docs/SEED_CODE_PLAN.md).
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public", "node-graph-seed-code.js"), "utf8");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

const {
  formatNodeGraphSeedCode: enc,
  parseNodeGraphSeedInput: parse,
  decodeNodeGraphSeedCode: dec,
  NODE_GRAPH_SEED_MASK: MASK,
} = ctx;

let failures = 0;
const gate = (ok, msg) => {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${msg}`);
  }
};

gate(enc(1000) !== enc(1001), `neighbors scramble: ${enc(1000)} vs ${enc(1001)}`);
gate(parse("#3AC") === 0x33AACC, `color #3AC expands to #33AACC (got ${parse("#3AC")})`);
gate(parse("#3ac") === 0x33AACC, `color #3ac case-insensitive`);
gate(parse("#33AACC") === 0x33AACC, `color #33AACC is that color`);
gate(Number.isNaN(parse("42")), `42 is not a seed code`);
gate(Number.isNaN(parse("10000")), `10000 is not a seed code`);
const code1000 = enc(1000);
gate(code1000.length === 4, `code length 4 (${code1000})`);
gate(parse(code1000) === 1000, `code ${code1000} → 1000`);
gate(parse("1000") === dec("1000"), `code 1000 stays the code, not decimal 1000`);
gate(enc(parse("1000")) === "1000", `code 1000 round-trips to itself`);
gate(parse("1000") !== 1000, `code 1000 is not the integer 1000`);
gate(parse("-1AB") === dec("-1AB") && Number.isFinite(parse("-1AB")), `-1AB is a code, not -1`);
gate(parse("-1AB") !== -1, `-1AB is not decimal -1`);
gate(enc(0).length === 4, `seed 0 has its own code ${enc(0)}`);
gate(dec(enc(0)) === 0, `seed 0 round-trips through the code`);
gate(enc(16777215).length === 4, `max seed codes`);
const step = ctx.stepNodeGraphSeedCode;
const alpha = ctx.NODE_GRAPH_SEED_ALPHA;
function expectPlace(n, place, dir) {
  const before = enc(n);
  const after = enc(step(n, place, dir));
  for (let i = 0; i < 4; i += 1) {
    if (i === place) continue;
    gate(after[i] === before[i], `place ${place} left char ${i} (${before} → ${after})`);
  }
  const from = alpha.indexOf(before[place]);
  const to = alpha.indexOf(after[place]);
  const want = (from + (dir < 0 ? -1 : 1) + alpha.length) % alpha.length;
  gate(to === want, `place ${place} ${before} → ${after}, want index ${want} got ${to}`);
}
expectPlace(1000, 3, 1);
expectPlace(1000, 3, -1);
expectPlace(1000, 0, 1);
expectPlace(1000, 2, -1);
const wrapped = enc(step(dec(alpha[0] + alpha[0] + alpha[0] + alpha[alpha.length - 1]), 3, 1));
gate(wrapped[3] === alpha[0], `last character wraps ${wrapped}`);

let bad = 0;
const img = new Uint8Array(MASK + 1);
let scrambleCollide = 0;
for (let n = 0; n <= MASK; n += 1) {
  if (dec(enc(n)) !== n) bad += 1;
  const x = ctx.scrambleNodeGraphSeed(n);
  if (img[x]) scrambleCollide += 1;
  img[x] = 1;
  if (ctx.unscrambleNodeGraphSeed(x) !== n) bad += 1;
}
gate(bad === 0, `encode/decode identity over 2^24 (bad=${bad})`);
gate(scrambleCollide === 0, `scramble bijection (collisions=${scrambleCollide})`);

if (failures) {
  console.error(`${failures} FAIL`);
  process.exit(1);
}
console.log(`ok seed codes: 0→${enc(0)} 1000→${enc(1000)} 1001→${enc(1001)} max→${enc(MASK)}`);
