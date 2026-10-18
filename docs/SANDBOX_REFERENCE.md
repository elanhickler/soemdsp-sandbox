# Sandbox setup reference

Project overview, live demo and license: [`README.md`](../README.md). This file owns setup.

## Requirements

- Python 3
- A modern browser
- No package install is required for the sandbox server.

## Download, run, stop, test

```powershell
git clone https://github.com/elanhickler/soemdsp-sandbox.git
cd soemdsp-sandbox

python server.py
# open http://127.0.0.1:8765
# stop: Ctrl+C

python scripts\smoke_test.py   # optional
```

## Optional artifact packet

Only if the sibling soemdsp repo is built locally:

```powershell
C:\Users\argit\Documents\_PROGRAMMING\soemdsp\build-moved\examples\Debug\runtime_dsp_object_bound_wav_resync_demo.exe
python server.py
```

CLAP *host* experiments (third-party plugins) live in a separate fork (soemdsp-sandbox-claphost), not in this tree.

## Guides

- [`ADDING_HARDCODED_SANDBOX_MODULE.md`](ADDING_HARDCODED_SANDBOX_MODULE.md)
- [`OSC_MODULE_NON_UI_REFERENCE.md`](OSC_MODULE_NON_UI_REFERENCE.md)

## Boundaries

- The server only writes through explicit save / settings / audio helper routes.
- Open Path is restricted to Downloads.
- The browser patch graph is demo-scoped state.
- The browser path is not the production soemdsp scheduler.
- Patch files save current module instances and settings; they cannot define new module types by themselves.
