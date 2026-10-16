# Frame batch format (display data: engine → page)

One message per display frame carries everything the page needs to paint:
scope samples, the audio meter and the visual-control state. The page ingests
it once per `requestAnimationFrame`.

## Entry point

```js
nodeGraphReceiveFrameBatch(batch)   // public/node-graph-live-runtime.js, also window.nodeGraphReceiveFrameBatch
```

Source-agnostic. The AudioWorklet posts the batch on its port (the port handler
forwards it here); the plugin's native engine (C++ via a JUCE event, no
worklet) calls the same function with the same object. Returns `true` when
accepted. Batches are processed on the next animation frame; if a second batch
arrives first, the older one is ingested immediately so order is kept and no
samples or meter counts are lost.

## Shape (version 1)

```js
{
  type: "frameBatch",          // required when posted through the worklet port
  version: 1,
  sessionId: <number|string>,  // must equal nodeGraphMvp.live.sessionId, else ignored
  scope: null | {              // samples written since the previous batch
    patchFingerprint: "...",   // fingerprint of the plan the engine is running
    sampleRate: 44100,         // engine rate
    values: [                  // one entry per watched output
      [ "<id>", Float32Array samples, {
          absoluteFrame,       // total samples ever posted for this id (after this chunk)
          startFrame,          // absoluteFrame - samples.length
          sampleRate,          // capture rate of this id (engine rate / stride)
          sampleStride,        // engine samples per captured sample
          sourceSampleRate,    // engine rate
      } ],
      ...
    ],
    dataPorts: [ [ "<nodeId>", "<PortName>", <any> ], ... ]   // optional, non-audio data outputs
  },
  meter: null | { ...meter fields } | [ { ...meter }, ... ],   // array when several meter windows were held
  visualControls: null | { red, green, blue, x, y, screenDim, screenShake,
                           visualGlow, visualBloom, visualBrightness,
                           chromaHue, chromaSaturation, chromaLightness, chromaAlpha,
                           chromaDrift, chromaSpread, scopePaused, scopeTracesOff, patchFingerprint }
}
```

Any of `scope`, `meter`, `visualControls` may be `null`. Part objects are the
same objects the old standalone `scope` / `meter` / `visualControls` messages
carried (minus `type`), so their field lists are defined by the existing
handlers in `handleNodeGraphLiveWorkletMessage`.

## Per-scope ids

- `"<nodeId>"`: the module's main output (scope/display modules, LCD values).
- `"<nodeId>:<Port>"`: a named input of a display sink (for example
  `out1:Left` / `out1:Right` for Output, `scope3:X` for a 2-input trace).

## Which outputs are watched, and how the list is learned

The engine does not decide this. The page sends it with every plan
(`setPlan`): `scopeCaptureNodeIds` (modules whose output is recorded),
`scopeCaptureRates` (per-module `writeHz`: `0` = every sample, waveform ring;
`> 0` = latest value at display FPS) and `visualSinks` (display modules with
their connected inputs, which produce the `"<nodeId>:<Port>"` ids). The
worklet compiles that list in `compileScopeCapture()`
(`node-live-audio-worklet-scope-io.js`); a native engine should watch exactly the same ids from the
same plan fields. The display rate comes from `setDisplayFps`.

## Flow control

After the page ingests a batch with a `scope` part it posts `{ type: "scopeAck" }`.
The worklet keeps one scope batch in flight and skips snapshots until acked. Meter /
visualControls parts are held for the next scope batch, and ship in a
scope-less batch after 50 ms if none goes out (no scopes, paused, page busy).
With display FPS 0 they are posted standalone as before.
