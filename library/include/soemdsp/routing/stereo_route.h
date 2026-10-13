// Stereo I/O routing rule (Argi, 2026-10-13) -- single source of truth.
//
// Inputs only decide what feeds the filters. Wired outputs decide which
// filters run. A filter whose output isn't needed doesn't run.
//
// Input resolution
//   Single source: Mono In alone, a lone Left in, a lone Right in (a lone side
//     counts as mono in), or nothing wired.  m = M + L + R (unwired = 0).
//   Stereo source: Left and Right in both wired.  l' = L + M, r' = R + M.
// Filters that run
//   Single: Left out -> L filter on m; Right out -> R filter on m.
//           Neither Left nor Right out -> Mono filter on m only.
//   Stereo: Left out or Mono out -> L filter on l'; Right out or Mono out ->
//           R filter on r'.  There is never a third (Mono) filter.
// Outputs
//   Mono out = the Mono filter when it runs, else the average 0.5*(L+R) of the
//   running sides (one side alone when only one runs).
//   An unwired Left / Right port mirrors Mono out (display taps only).
//   No output wired at all is treated as Mono out wired.
// Stateless, header-only, no dependencies.
#pragma once

namespace soemdsp::routing {

struct StereoRouteWiring {
  bool inMono = false;
  bool inLeft = false;
  bool inRight = false;
  bool outMono = false;
  bool outLeft = false;
  bool outRight = false;
};

// What a filter is fed: Single = M + L + R, LeftPlusMono = L + M, RightPlusMono = R + M.
enum class StereoRouteFeed : unsigned char { Single, LeftPlusMono, RightPlusMono };

// Where an output port's sample comes from.
enum class StereoRouteOut : unsigned char { MonoFilter, LeftFilter, RightFilter, AverageLR };

struct StereoRoute {
  bool stereoSource = false;
  bool runMono = false;
  bool runL = false;
  bool runR = false;
  bool bothSides = false;  // L and R filters both run (stereo spread applies)
  StereoRouteFeed feedMono = StereoRouteFeed::Single;
  StereoRouteFeed feedL = StereoRouteFeed::Single;
  StereoRouteFeed feedR = StereoRouteFeed::Single;
  StereoRouteOut outMono = StereoRouteOut::MonoFilter;
  StereoRouteOut outLeft = StereoRouteOut::MonoFilter;
  StereoRouteOut outRight = StereoRouteOut::MonoFilter;
};

constexpr StereoRoute stereo_route(const StereoRouteWiring& w) {
  StereoRoute r{};
  const bool anyOut = w.outMono || w.outLeft || w.outRight;
  const bool wantMono = w.outMono || !anyOut;
  r.stereoSource = w.inLeft && w.inRight;
  if (r.stereoSource) {
    r.runL = w.outLeft || wantMono;
    r.runR = w.outRight || wantMono;
    r.runMono = false;
    r.feedL = StereoRouteFeed::LeftPlusMono;
    r.feedR = StereoRouteFeed::RightPlusMono;
  } else {
    r.runL = w.outLeft;
    r.runR = w.outRight;
    r.runMono = !(r.runL || r.runR);
    r.feedL = StereoRouteFeed::Single;
    r.feedR = StereoRouteFeed::Single;
  }
  r.feedMono = StereoRouteFeed::Single;
  r.bothSides = r.runL && r.runR;
  r.outMono = r.runMono ? StereoRouteOut::MonoFilter
    : r.bothSides ? StereoRouteOut::AverageLR
    : r.runL ? StereoRouteOut::LeftFilter
    : StereoRouteOut::RightFilter;
  r.outLeft = r.runL ? StereoRouteOut::LeftFilter : r.outMono;
  r.outRight = r.runR ? StereoRouteOut::RightFilter : r.outMono;
  return r;
}

constexpr double stereo_route_feed(StereoRouteFeed feed, double m, double l, double r) {
  return feed == StereoRouteFeed::LeftPlusMono ? l + m
    : feed == StereoRouteFeed::RightPlusMono ? r + m
    : m + l + r;
}

constexpr double stereo_route_out(StereoRouteOut src, double yMono, double yL, double yR) {
  return src == StereoRouteOut::LeftFilter ? yL
    : src == StereoRouteOut::RightFilter ? yR
    : src == StereoRouteOut::AverageLR ? 0.5 * (yL + yR)
    : yMono;
}

}  // namespace soemdsp::routing
