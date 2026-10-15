// Sandbox Native Module Maths -- lagged Fibonacci generator (LFG).
// Freestanding. Nested soemdsp::math; soemdsp_maths mirror.
//
//   x_n = (x_{n-j} OP x_{n-k}) mod 2^32,   0 < j < k <= kLaggedFibMaxLag
//   OP: 0 Add, 1 Subtract, 2 Multiply, 3 XOR
// With (j, k) from a primitive trinomial x^k + x^j + 1 (kLaggedFibPairs):
//   Add / Subtract  period (2^k - 1) * 2^31 (needs one odd seed word; forced)
//   Multiply        period (2^k - 1) * 2^29 (all seed words forced odd)
//   XOR             period  2^k - 1 per bit (a GFSR)
// Seeding follows math/seed.h: word i = seed_mix(seed, part, i), so Seed 0 is
// valid and every (seed, part) gives its own stream. lagged_fib_init also
// runs a warm-up of 4 k steps so the hashed seed words are mixed through.
#pragma once

#include <soemdsp/math/seed.h>

namespace soemdsp::math {

static const int kLaggedFibMaxLag = 1279;
static const int kLaggedFibRing = 2048;  // power of 2 > max lag

struct LaggedFibPair { int j, k; };
static const int kLaggedFibPairCount = 6;
static const LaggedFibPair kLaggedFibPairs[kLaggedFibPairCount] = {
  { 24, 55 }, { 5, 17 }, { 31, 63 }, { 97, 127 }, { 273, 607 }, { 418, 1279 }
};

enum LaggedFibOp { kLfgAdd = 0, kLfgSubtract = 1, kLfgMultiply = 2, kLfgXor = 3 };

struct LaggedFibonacci {
  unsigned int ring[kLaggedFibRing];
  unsigned long long n;  // outputs produced (ring index of the next one)
  int j, k, op;
};

static inline unsigned int lagged_fib_next(LaggedFibonacci& g) {
  const unsigned int m = (unsigned int)(kLaggedFibRing - 1);
  const unsigned int a = g.ring[(unsigned int)(g.n - (unsigned long long)g.j) & m];
  const unsigned int b = g.ring[(unsigned int)(g.n - (unsigned long long)g.k) & m];
  unsigned int r;
  switch (g.op) {
    case kLfgSubtract: r = a - b; break;
    case kLfgMultiply: r = a * b; break;
    case kLfgXor: r = a ^ b; break;
    default: r = a + b; break;
  }
  g.ring[(unsigned int)g.n & m] = r;
  g.n += 1;
  return r;
}

// j, k must satisfy 0 < j < k <= kLaggedFibMaxLag (callers pick from kLaggedFibPairs).
static inline void lagged_fib_init(
  LaggedFibonacci& g, unsigned int seed, unsigned int part, int j, int k, int op
) {
  g.j = j; g.k = k; g.op = op;
  bool anyNonzero = false;
  for (int i = 0; i < k; i += 1) {
    unsigned int w = seed_mix(seed, part, (unsigned int)i);
    if (op == kLfgMultiply) w |= 1u;
    if (w != 0u) anyNonzero = true;
    g.ring[i] = w;
  }
  if (op == kLfgAdd || op == kLfgSubtract) g.ring[0] |= 1u;
  if (!anyNonzero) g.ring[0] = 1u;  // XOR all-zero state is a fixed point
  g.n = (unsigned long long)k;
  for (int i = 0; i < 4 * k; i += 1) lagged_fib_next(g);
}

}  // namespace soemdsp::math

namespace soemdsp_maths {
using soemdsp::math::kLaggedFibMaxLag;
using soemdsp::math::kLaggedFibPairCount;
using soemdsp::math::kLaggedFibPairs;
using soemdsp::math::LaggedFibPair;
using soemdsp::math::LaggedFibonacci;
using soemdsp::math::lagged_fib_next;
using soemdsp::math::lagged_fib_init;
}  // namespace soemdsp_maths
