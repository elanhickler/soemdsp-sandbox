// Golden probe for scripts/test_softpop_filter_library_regression.mjs.
// Renders a fixed grid through Softpop Filter colors 0–4 (White / Gaussian /
// Average / Pink / Brown) so the library extraction of tilt / level / decramp
// can prove those colours stay byte-identical. Built on demand by the test;
// not a module.

extern "C" int soemdsp_softpop_filter_create();
extern "C" void soemdsp_softpop_filter_destroy(int handle);
extern "C" void soemdsp_softpop_filter_reset(int handle);
extern "C" double soemdsp_softpop_filter_sample(
  int handle,
  double freqHz,
  double inL,
  double inR,
  double useInput,
  double width,
  double pitchModCents,
  double ampMod,
  double amplitude,
  double color,
  double seedValue,
  double sampleRate
);
extern "C" double soemdsp_softpop_filter_left(int handle);
extern "C" double soemdsp_softpop_filter_right(int handle);
extern "C" double soemdsp_softpop_filter_noise(int handle, int ch);
extern "C" double soemdsp_softpop_filter_cv(int handle, int ch);

namespace {

static const int kCap = 262144;
static double gOut[kCap];
static int gCount = 0;

static void put(double v) {
  if (gCount < kCap) gOut[gCount] = v;
  gCount += 1;
}

static void put_frame(int h, double mono) {
  put(mono);
  put(soemdsp_softpop_filter_left(h));
  put(soemdsp_softpop_filter_right(h));
  put(soemdsp_softpop_filter_noise(h, 0));
  put(soemdsp_softpop_filter_noise(h, 1));
  put(soemdsp_softpop_filter_cv(h, 0));
  put(soemdsp_softpop_filter_cv(h, 1));
}

}  // namespace

extern "C" int probe_buffer_ptr() { return (int)(long)gOut; }
extern "C" int probe_capacity() { return kCap; }

extern "C" int probe_render_softpop_filter() {
  gCount = 0;
  const double freqs[] = {50.0, 440.0, 1000.0, 8000.0};
  const double widths[] = {0.0, 0.3, 1.0};
  const double pitches[] = {0.0, 600.0};
  const double amps[] = {0.0, 0.5};
  const double seeds[] = {1.0, 4242.0};
  for (int color = 0; color <= 4; color += 1) {
    for (int fi = 0; fi < 4; fi += 1) {
      for (int wi = 0; wi < 3; wi += 1) {
        for (int pi = 0; pi < 2; pi += 1) {
          for (int ai = 0; ai < 2; ai += 1) {
            for (int si = 0; si < 2; si += 1) {
              const int h = soemdsp_softpop_filter_create();
              for (int n = 0; n < 32; n += 1) {
                const double y = soemdsp_softpop_filter_sample(
                  h, freqs[fi], 0.0, 0.0, 0.0, widths[wi], pitches[pi], amps[ai],
                  1.0, (double)color, seeds[si], 48000.0
                );
                put_frame(h, y);
              }
              soemdsp_softpop_filter_reset(h);
              for (int n = 0; n < 8; n += 1) {
                const double y = soemdsp_softpop_filter_sample(
                  h, freqs[fi], 0.0, 0.0, 0.0, widths[wi], pitches[pi], amps[ai],
                  1.0, (double)color, seeds[si], 44100.0
                );
                put_frame(h, y);
              }
              soemdsp_softpop_filter_destroy(h);
            }
          }
        }
      }
    }
  }
  return gCount;
}
