// Pure-function test: all 64 wiring combinations of soemdsp/routing/stereo_route.h
// against the rule table written out independently here.
// Build: clang++ -std=c++17 -I library/include scripts/test_stereo_route_table.cpp
#include <soemdsp/routing/stereo_route.h>
#include <cstdio>

using namespace soemdsp::routing;

int main() {
  int fails = 0;
  for (int bits = 0; bits < 64; bits++) {
    StereoRouteWiring w;
    w.inMono = bits & 1; w.inLeft = bits & 2; w.inRight = bits & 4;
    w.outMono = bits & 8; w.outLeft = bits & 16; w.outRight = bits & 32;
    const StereoRoute r = stereo_route(w);
    // Expected, written per the rule text.
    const bool stereo = w.inLeft && w.inRight;
    const bool noOut = !w.outMono && !w.outLeft && !w.outRight;
    bool eL, eR, eM;
    if (stereo) {
      eL = w.outLeft || w.outMono || noOut;
      eR = w.outRight || w.outMono || noOut;
      eM = false;
    } else {
      eL = w.outLeft; eR = w.outRight; eM = !w.outLeft && !w.outRight;
    }
    // Feed check with distinct m/l/r values.
    const double m = (w.inMono ? 1.0 : 0.0), l = (w.inLeft ? 10.0 : 0.0), rr = (w.inRight ? 100.0 : 0.0);
    const double fL = stereo_route_feed(r.feedL, m, l, rr);
    const double fR = stereo_route_feed(r.feedR, m, l, rr);
    const double fM = stereo_route_feed(r.feedMono, m, l, rr);
    const double eFL = stereo ? l + m : m + l + rr;
    const double eFR = stereo ? rr + m : m + l + rr;
    // Output check with distinct filter results.
    const double yM = 3.0, yL = 5.0, yR = 7.0;
    const double oM = stereo_route_out(r.outMono, yM, yL, yR);
    const double oL = stereo_route_out(r.outLeft, yM, yL, yR);
    const double oR = stereo_route_out(r.outRight, yM, yL, yR);
    const double eOM = eM ? yM : (eL && eR) ? 6.0 : eL ? yL : yR;
    const double eOL = eL ? yL : eOM;
    const double eOR = eR ? yR : eOM;
    // Every wired output must come from a running filter.
    bool wiredOk = true;
    if (w.outLeft && !r.runL) wiredOk = false;
    if (w.outRight && !r.runR) wiredOk = false;
    if ((w.outMono || noOut) && !(r.runMono || r.runL || r.runR)) wiredOk = false;
    const bool ok = r.runL == eL && r.runR == eR && r.runMono == eM && r.stereoSource == stereo
      && r.bothSides == (eL && eR) && fL == eFL && fR == eFR && fM == m + l + rr
      && oM == eOM && oL == eOL && oR == eOR && wiredOk
      && !(r.runMono && (r.runL || r.runR));
    if (!ok) {
      fails++;
      std::printf("FAIL in M%dL%dR%d out M%dL%dR%d: run M%d L%d R%d\n", w.inMono, w.inLeft, w.inRight,
        w.outMono, w.outLeft, w.outRight, r.runMono, r.runL, r.runR);
    }
  }
  static_assert(stereo_route(StereoRouteWiring{true, false, false, true, false, false}).runMono, "mono in/out");
  if (fails) { std::printf("test_stereo_route_table FAILED: %d/64\n", fails); return 1; }
  std::printf("test_stereo_route_table ok: 64/64 wirings match the rule\n");
  return 0;
}
