// Seed display/input codes (docs/SEED_CODE_PLAN.md).
// Storage stays an integer 0…16,777,215. The 4-character URL-safe base64
// code is display/input only. Scramble constants are frozen: changing them
// changes every shown code; stored seeds stay the same.
(function (root) {
  const MASK = 0x00ffffff;
  const MUL = 0x009e3779;
  const INV = 0x00b382c9;
  const SHIFT = 9;
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function u24(n) {
    return (Number(n) >>> 0) & MASK;
  }

  function scramble(n) {
    let x = u24(n);
    x = (Math.imul(x, MUL) >>> 0) & MASK;
    x ^= x >>> SHIFT;
    return u24(x);
  }

  function unscramble(n) {
    let x = u24(n);
    x ^= x >>> SHIFT;
    x ^= x >>> (SHIFT * 2);
    x = (Math.imul(x, INV) >>> 0) & MASK;
    return u24(x);
  }

  function formatNodeGraphSeedCode(n) {
    if (!Number.isFinite(Number(n))) return "";
    const x = scramble(Math.round(Number(n)));
    return ALPHA[(x >>> 18) & 63]
      + ALPHA[(x >>> 12) & 63]
      + ALPHA[(x >>> 6) & 63]
      + ALPHA[x & 63];
  }

  // place 0 is the first character, 3 is the last. dir +1 / -1 walks the alphabet.
  function stepNodeGraphSeedCode(n, place, dir) {
    const code = formatNodeGraphSeedCode(n);
    if (code.length !== 4) return u24(n);
    const index = Math.max(0, Math.min(3, place | 0));
    const delta = dir < 0 ? -1 : 1;
    const chars = code.split("");
    const at = ALPHA.indexOf(chars[index]);
    if (at < 0) return u24(n);
    chars[index] = ALPHA[(at + delta + ALPHA.length) % ALPHA.length];
    const next = decodeNodeGraphSeedCode(chars.join(""));
    return Number.isFinite(next) ? next : u24(n);
  }

  // Any length of alphabet characters. Extra characters wrap in 24 bits
  // (shift 6, keep MASK) so "baby" and "babys" are different seeds.
  function decodeNodeGraphSeedCode(text) {
    const s = String(text ?? "");
    if (!s.length) return NaN;
    let x = 0;
    for (let i = 0; i < s.length; i += 1) {
      const p = ALPHA.indexOf(s[i]);
      if (p < 0) return NaN;
      x = ((x << 6) | p) & MASK;
    }
    return unscramble(x);
  }

  function parseNodeGraphSeedHex(text) {
    let h = String(text ?? "").trim();
    if (h.charAt(0) !== "#") return NaN;
    h = h.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return NaN;
    return parseInt(h, 16);
  }

  // Typed text is a seed code, including all-digit codes such as 1000.
  // #rgb / #rrggbb is a color: the seed becomes that color. It is not a
  // hex number entry. A leading "-" is a code character, not a minus.
  // Shorter than 4: right-pad with "_" (blank at entry only; "_" stays
  // alphabet index 63). Longer than 4: wrap in 24 bits, do not drop.
  function parseNodeGraphSeedInput(text) {
    const s = String(text ?? "").trim().replace(/[, ]/g, "");
    if (!s) return NaN;
    if (s.charAt(0) === "#") return parseNodeGraphSeedHex(s);
    const code = s.length < 4 ? s.padEnd(4, "_") : s;
    return decodeNodeGraphSeedCode(code);
  }

  const api = {
    NODE_GRAPH_SEED_MASK: MASK,
    NODE_GRAPH_SEED_MUL: MUL,
    NODE_GRAPH_SEED_INV: INV,
    NODE_GRAPH_SEED_SHIFT: SHIFT,
    NODE_GRAPH_SEED_ALPHA: ALPHA,
    scrambleNodeGraphSeed: scramble,
    unscrambleNodeGraphSeed: unscramble,
    formatNodeGraphSeedCode,
    stepNodeGraphSeedCode,
    decodeNodeGraphSeedCode,
    parseNodeGraphSeedHex,
    parseNodeGraphSeedInput,
  };
  Object.assign(root, api);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
