# Rounding Error Sequencer: next steps

Module key `blitTrigger` (type 260). DSP: `native_modules/blit_trigger/blit_trigger.cpp`.
Display: `public/modules/blitTrigger/rounding-error-display.js`. Definition: `blitTrigger`
in `public/node-graph-module-definitions.js`.

How it works now: step k sits at `Rotate + k * Spacing` internal samples, on a grid of
48 kHz x Clock Speed. Each step's accent is the peak of a band-limited gate of `Gate`
samples, so it depends on the fractional part of `k * Spacing`. Length N loops the
pattern exactly. The display draws one bar per step, computed ahead of time, and
highlights the current Step.

## UX note

Spacing is confusing to use: Argi had to turn Spacing **up** to make the pattern
**slower**. Consider splitting it into two controls:
- a rate or speed control, where up = faster, for the whole-sample part;
- a "Pattern" or "Remainder" control (0..1) for the fractional part that picks the pattern.

## To do

1. **Length 0 (free run) display: waterfall.** Show the last 16 steps as bars that
   scroll right to left as each step fires. The newest step enters at the right.
2. **Fixed Length display: ghost highlight.** Keep the bars in place, one per loop step.
   When a step fires, light its bar, then fade it like a ghost. Add the ghost settings
   to the display settings: fade time, ghost brightness, and so on, using the app's
   existing ghost parameters as the model.
3. **Display settings: colours.** Foreground (bar) colour and background colour, through
   the standard display settings schema, the same as other faces.
4. **"Exaggerate Difference" control.** Widens the dynamic range of the accents. Accents
   currently sit in a narrow band (about 0.8 to 0.92 at Gate 2). Map each step's accent
   through an expanding curve around the loop's min and max, for example
   `out = ((a - min) / (max - min)) ^ k`, mixed with the raw accent by the control. Apply
   it to Velocity, the BLIT out and the hard trigger level, and draw the display bars
   with the same mapping.

## Rules

- WebGL only: no DOM text or overlays on displays.
- Pixel-for-pixel displays.
- Preserve each file's line endings. Edit byte-exact; never use `sed -i`.
- Bump the `?v=` cache tags in `public/index.html` and `public/perform.html`.
- Commit when done. Don't push.
