// soemdsp-native-module: logic
// soemdsp-native-label: Logic
// soemdsp-native-target: logic
// soemdsp-native-kind: utility
//
// Boolean pack. True = gate_on (x > 0). Unwired B is 0 (false).
// AND / OR / XOR / NAND / NOR / XNOR / NOT are exact 0 or 1.
// Thru is A passthrough. NOT ignores B.
// Main _sample() returns AND; other outs via accessors.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 64;

struct LogicState {
  bool active;
  double lastAnd;
  double lastOr;
  double lastXor;
  double lastNand;
  double lastNor;
  double lastXnor;
  double lastNot;
  double lastThru;
  double lastB;
};

static LogicState gPool[kMaxInstances];

static inline double bit(bool v) {
  return v ? 1.0 : 0.0;
}

}  // namespace

extern "C" int soemdsp_logic_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      LogicState& s = gPool[i];
      s.lastAnd = 0.0;
      s.lastOr = 0.0;
      s.lastXor = 0.0;
      s.lastNand = 1.0;
      s.lastNor = 1.0;
      s.lastXnor = 1.0;
      s.lastNot = 1.0;
      s.lastThru = 0.0;
      s.lastB = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_logic_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_logic_sample(int handle, double aIn, double bIn) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  LogicState& s = gPool[handle - 1];
  const double aRaw = safe(aIn);
  const double bRaw = safe(bIn);
  const bool a = gate_on(aRaw);
  const bool b = gate_on(bRaw);
  const bool aand = a && b;
  const bool aor = a || b;
  const bool axor = a != b;
  s.lastThru = aRaw;
  s.lastB = bit(b);
  s.lastAnd = bit(aand);
  s.lastOr = bit(aor);
  s.lastXor = bit(axor);
  s.lastNand = bit(!aand);
  s.lastNor = bit(!aor);
  s.lastXnor = bit(!axor);
  s.lastNot = bit(!a);
  return s.lastAnd;
}

extern "C" double soemdsp_logic_and(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastAnd;
}

extern "C" double soemdsp_logic_or(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastOr;
}

extern "C" double soemdsp_logic_xor(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastXor;
}

extern "C" double soemdsp_logic_nand(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastNand;
}

extern "C" double soemdsp_logic_nor(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastNor;
}

extern "C" double soemdsp_logic_xnor(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastXnor;
}

extern "C" double soemdsp_logic_not(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastNot;
}

extern "C" double soemdsp_logic_thru(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastThru;
}

extern "C" double soemdsp_logic_b(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].lastB;
}

extern "C" int soemdsp_logic_version() {
  return 1;
}
