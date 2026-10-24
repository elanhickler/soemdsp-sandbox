// Headless Logic truth table: A/B in {0,1}×{0,1} plus negative A.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const imp = { env: { emo_process_block: () => 0 } };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), imp);
const e = instance.exports;

function must(name) {
  const fn = e[name];
  if (typeof fn !== "function") throw new Error(`missing export ${name}`);
  return fn;
}

const create = must("soemdsp_logic_create");
const destroy = must("soemdsp_logic_destroy");
const sample = must("soemdsp_logic_sample");
const andOut = must("soemdsp_logic_and");
const orOut = must("soemdsp_logic_or");
const xorOut = must("soemdsp_logic_xor");
const nandOut = must("soemdsp_logic_nand");
const norOut = must("soemdsp_logic_nor");
const xnorOut = must("soemdsp_logic_xnor");
const notOut = must("soemdsp_logic_not");
const thruOut = must("soemdsp_logic_thru");
const bOut = must("soemdsp_logic_b");
const version = must("soemdsp_logic_version");
const graphVersion = must("soemdsp_graph_version");

const h = create() | 0;
if (!h) throw new Error("logic create failed");

function bits(a, b) {
  sample(h, a, b);
  return {
    and: andOut(h),
    or: orOut(h),
    xor: xorOut(h),
    nand: nandOut(h),
    nor: norOut(h),
    xnor: xnorOut(h),
    not: notOut(h),
    thru: thruOut(h),
    b: bOut(h),
  };
}

function expect(got, want, label) {
  if (got !== want) throw new Error(`${label}: got ${got}, want ${want}`);
}

const table = [
  { a: 0, b: 0, and: 0, or: 0, xor: 0, nand: 1, nor: 1, xnor: 1, not: 1 },
  { a: 0, b: 1, and: 0, or: 1, xor: 1, nand: 1, nor: 0, xnor: 0, not: 1 },
  { a: 1, b: 0, and: 0, or: 1, xor: 1, nand: 1, nor: 0, xnor: 0, not: 0 },
  { a: 1, b: 1, and: 1, or: 1, xor: 0, nand: 0, nor: 0, xnor: 1, not: 0 },
];

for (const row of table) {
  const g = bits(row.a, row.b);
  const tag = `A=${row.a} B=${row.b}`;
  expect(g.and, row.and, `${tag} AND`);
  expect(g.or, row.or, `${tag} OR`);
  expect(g.xor, row.xor, `${tag} XOR`);
  expect(g.nand, row.nand, `${tag} NAND`);
  expect(g.nor, row.nor, `${tag} NOR`);
  expect(g.xnor, row.xnor, `${tag} XNOR`);
  expect(g.not, row.not, `${tag} NOT`);
  expect(g.thru, row.a, `${tag} Thru`);
  expect(g.b, row.b, `${tag} __B`);
}

const neg = bits(-0.4, 1);
expect(neg.and, 0, "neg A AND");
expect(neg.or, 1, "neg A OR");
expect(neg.xor, 1, "neg A XOR");
expect(neg.not, 1, "neg A NOT");
expect(neg.thru, -0.4, "neg A Thru");

if ((version() | 0) < 1) throw new Error(`logic version ${version()}`);
if ((graphVersion() | 0) < 275) throw new Error(`graph version ${graphVersion()} expected >= 275`);

destroy(h);
console.log(`smoke_graph_logic ok: logic=${version() | 0} graph=${graphVersion() | 0}`);
