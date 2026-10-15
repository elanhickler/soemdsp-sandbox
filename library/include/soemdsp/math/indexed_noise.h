// Sandbox Native Module Maths -- random-access (indexed) step generators.
// Freestanding (no libm). Nested soemdsp::math; soemdsp_maths mirror.
//
// Every function is a pure function of (seed, step index k), so callers can
// read any step -- ahead, behind, after a jump -- without running a sequence.
// Seeds follow math/seed.h: seed_mix(seed, part, index); Seed 0 is valid.
// Values are in "digit units" 0..9 (so they line up with stored digit tables).
//   indexed_digit       uniform integer 0..9
//   indexed_white       uniform continuous [0, 9)
//   indexed_gauss       Irwin-Hall (sum of 4 uniforms) in [0, 9), mean 4.5
//   indexed_walk_sum    free +/-1 walk position after k steps (popcount blocks)
//   fold_reflect_0_9    fold any integer into 0..9 (reflecting walls)
//   fibonacci_mod10     F(n) mod 10 (Pisano period 60)
//   logistic_block      n logistic-map values x*9, block b restarted from a
//                       seed-hashed x0 (chaotic r: blocks decorrelate fast)
#pragma once

#include <soemdsp/math/seed.h>

namespace soemdsp::math {

static inline double indexed_u01(unsigned int seed, unsigned int part, unsigned long long k) {
  const unsigned int h = seed_mix(seed_mix(seed, part, (unsigned int)(k >> 32)), part, (unsigned int)k);
  return (double)(h >> 8) * (1.0 / 16777216.0);
}

static inline int indexed_digit(unsigned int seed, unsigned int part, unsigned long long k) {
  const unsigned int h = seed_mix(seed_mix(seed, part, (unsigned int)(k >> 32)), part, (unsigned int)k);
  return (int)(((unsigned long long)h * 10ull) >> 32);
}

static inline double indexed_white(unsigned int seed, unsigned int part, unsigned long long k) {
  return indexed_u01(seed, part, k) * 9.0;
}

// parts part .. part+3 are used.
static inline double indexed_gauss(unsigned int seed, unsigned int part, unsigned long long k) {
  double s = 0.0;
  for (unsigned int i = 0; i < 4u; i += 1) s += indexed_u01(seed, part + i, k);
  return s * (9.0 / 4.0);
}

// 32 walk steps per hashed word: bit set = +1, clear = -1.
static inline unsigned int walk_word(unsigned int seed, unsigned int part, long long w) {
  return seed_mix(seed, part, (unsigned int)w);
}

// Sum of the first `bits` steps of word w (bits 0..32).
static inline int walk_word_partial(unsigned int word, int bits) {
  if (bits <= 0) return 0;
  const unsigned int m = bits >= 32 ? 0xFFFFFFFFu : ((1u << bits) - 1u);
  return 2 * __builtin_popcount(word & m) - bits;
}

// Cursor so neighbouring lookups cost O(1); far jumps walk word by word
// (k / 32 popcounts).
struct WalkCursor {
  long long word;   // words [0, word) are summed into sum
  long long sum;
  unsigned int seed;
  bool valid;
};

static inline long long indexed_walk_sum(WalkCursor& c, unsigned int seed, unsigned int part, long long k) {
  if (!c.valid || c.seed != seed) { c.word = 0; c.sum = 0; c.seed = seed; c.valid = true; }
  const long long w = k >> 5;
  while (c.word < w) { c.sum += walk_word_partial(walk_word(seed, part, c.word), 32); c.word += 1; }
  while (c.word > w) { c.word -= 1; c.sum -= walk_word_partial(walk_word(seed, part, c.word), 32); }
  return c.sum + walk_word_partial(walk_word(seed, part, w), (int)(k & 31));
}

static inline int fold_reflect_0_9(long long p) {
  long long m = p % 18;
  if (m < 0) m += 18;
  return (int)(m <= 9 ? m : 18 - m);
}

static inline int fibonacci_mod10(long long n) {
  static const unsigned char kPisano10[60] = {
    0,1,1,2,3,5,8,3,1,4,5,9,4,3,7,0,7,7,4,1,5,6,1,7,8,5,3,8,1,9,
    0,9,9,8,7,5,2,7,9,6,5,1,6,7,3,0,3,3,6,9,5,4,9,3,2,5,7,2,9,1 };
  long long m = n % 60;
  if (m < 0) m += 60;
  return kPisano10[m];
}

static inline void logistic_block(
  unsigned int seed, unsigned int part, long long block, double r, double* out, int n
) {
  double x = 0.05 + 0.9 * indexed_u01(seed, part, (unsigned long long)block);
  for (int i = 0; i < 8; i += 1) x = r * x * (1.0 - x);  // settle onto the attractor
  for (int i = 0; i < n; i += 1) {
    out[i] = x * 9.0;
    x = r * x * (1.0 - x);
  }
}

}  // namespace soemdsp::math

namespace soemdsp_maths {
using soemdsp::math::indexed_u01;
using soemdsp::math::indexed_digit;
using soemdsp::math::indexed_white;
using soemdsp::math::indexed_gauss;
using soemdsp::math::WalkCursor;
using soemdsp::math::indexed_walk_sum;
using soemdsp::math::fold_reflect_0_9;
using soemdsp::math::fibonacci_mod10;
using soemdsp::math::logistic_block;
}  // namespace soemdsp_maths
