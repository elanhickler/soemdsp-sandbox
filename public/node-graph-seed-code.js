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

  function decodeNodeGraphSeedCode(text) {
    const s = String(text ?? "");
    if (s.length !== 4) return NaN;
    let x = 0;
    for (let i = 0; i < 4; i += 1) {
      const p = ALPHA.indexOf(s[i]);
      if (p < 0) return NaN;
      x = (x << 6) | p;
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

  // Code, decimal, or #hex. All-digit input is always decimal, so 4-digit
  // codes are only reached by dice / +/− / drag. A leading "-" on a 4-char
  // code is a code, not a negative integer.
  function parseNodeGraphSeedInput(text) {
    const s = String(text ?? "").trim().replace(/[, ]/g, "");
    if (!s) return NaN;
    if (s.charAt(0) === "#") return parseNodeGraphSeedHex(s);
    if (/^[0-9]+$/.test(s)) return Number(s);
    if (s.length === 4) return decodeNodeGraphSeedCode(s);
    return NaN;
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
    decodeNodeGraphSeedCode,
    parseNodeGraphSeedHex,
    parseNodeGraphSeedInput,
  };
  Object.assign(root, api);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
