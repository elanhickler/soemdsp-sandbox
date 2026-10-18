# soemdsp-sandbox

Browser-based modular audio synthesis — patch native C++/WASM DSP modules, watch waveforms live, hear the result. Python file server + modern browser; no package install for the sandbox itself.

### Live demo — [soundemote.io/sandbox](http://soundemote.io/sandbox)

---

## What's inside

- **Live Audio** — AudioWorklet graph; patch modules and hear them in real time
- **Native DSP** — oscillators, filters, envelopes, reverb, chaos generators (C++ → WASM)
- **Scopes** — phosphor / 2D faces for patch visualization
- **Render Sample** — bounce a patch to audio and inspect the waveform

Plugin **hosting** experiments live elsewhere (soemdsp-sandbox-claphost). This repo is modular authoring only.

---

## Quick start

```powershell
python server.py   # then open http://127.0.0.1:8765
```

Full setup (requirements, clone, smoke test, optional native artifact resync, server boundaries): [`docs/SANDBOX_REFERENCE.md`](docs/SANDBOX_REFERENCE.md).

---

## Docs & reference

| Doc | Topic |
|---|---|
| [`docs/SANDBOX_REFERENCE.md`](docs/SANDBOX_REFERENCE.md) | Setup, run, test, boundaries |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | High-level architecture |
| [`docs/ADDING_HARDCODED_SANDBOX_MODULE.md`](docs/ADDING_HARDCODED_SANDBOX_MODULE.md) | Add a hardcoded module |
| [`docs/OSC_MODULE_NON_UI_REFERENCE.md`](docs/OSC_MODULE_NON_UI_REFERENCE.md) | Oscillator module non-UI notes |
| [`POWER_ENGINE_SYNTHESIS.md`](POWER_ENGINE_SYNTHESIS.md) | Spiral / engine synthesis notes |
| `BEAMING_RADAR_SIGNAL_TO_JEROBEAM.md` (removed from the repo; see git history) | Jerobeam module dedication |

---

## Related forks

| Project | Focus |
|---|---|
| [Aliasing Wars](https://soundemote.io/aliasingwars) | Anti-aliased hard-sync / PolyBLEP |
| [White Wire](https://soundemote.io/whitewire) | Bit-oriented patch wires / LUT cell |
| [Phosphor](https://soundemote.io/phosphor) | CRT-style scope decay |
| [Analog Filters](https://soundemote.io/analogfilters) | Circuit-style filter models (Flower Child family, etc.) |
| [SIMD](https://soundemote.io/simd) | WASM SIMD128 + block-processing boundary |
| [Creatures](https://soundemote.io/creatures) | Patchable virtual pet |
| [Efficient Patch System](https://soundemote.io/efficientpatchsystem) | Multiplayer / performance experiments |

---

## License

Source-available for noncommercial use only. Commercial use requires a separate written commercial license from Soundemote. See [`LICENSE`](LICENSE).
