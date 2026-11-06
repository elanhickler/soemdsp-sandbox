# Sandbox scripts

Run these from File Explorer or a terminal. All paths below are relative to the
`soemdsp-sandbox` repository.

| Task | Entry point | Effect |
| --- | --- | --- |
| Start the local sandbox | `scripts/start_sandbox_debug.cmd` | Restarts the debug server at `http://127.0.0.1:8766/`. Does not build WASM. |
| Preview the sandbox on soundemote-io | `scripts/soundemote_io_preview.cmd` | Builds native modules, runs the smoke report, copies the release sandbox into the sibling `soundemote-io` repo, and starts its local site at `http://localhost:8080/`. No commit or push. |
| Send patches live | `scripts/soundemote_io_publish_patches.cmd` | Preflights and commits sandbox patches, copies them to `soundemote-io`, updates its catalog, then commits and pushes both repos. No WASM build. |
| Publish a full release | `scripts/soundemote_io_publish.cmd` | Builds, runs the smoke report, syncs the site copy, commits, and pushes both repos. **This goes live.** |
| Run the smoke report alone | `node scripts/smoke.mjs` | Compares the rendered `smoke_test` patch with its reference WAV. It currently reports mismatches without a nonzero exit code. Read its output. |

The three `soundemote_io_*.cmd` wrappers use `scripts/soundemote_io.ps1`.
`scripts/sync_soundemote_io.ps1` is the lower-level copy step; it replaces the
site's vendored sandbox tree but does not commit or push. Run it only when that
full copy is intended. `scripts/prepare_page_patches.ps1` is the patch preflight.

`scripts/build_native_modules.ps1` builds WASM without starting a server or
publishing. `scripts/start_soundemote_sites.cmd` starts the three sibling site
dev servers without copying or building anything. `scripts/generate_vs_project.bat`
generates the optional Visual Studio solution. Ignored experiments live under
`scripts/_scratch/` and are not part of the release workflow.
