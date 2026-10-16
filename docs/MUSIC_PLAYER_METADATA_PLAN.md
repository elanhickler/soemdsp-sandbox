# Music Player metadata, Album Art, rich Text Box: plan

Status: **planned, not started; Argi must OK step 1.**

Source: Argi + Webby (2026-10-15). Docs only; nothing implemented.

## Tracker

| ID | Step | Status |
|----|------|--------|
| MM-1 | soundemote-com `scripts/build-playlist.mjs`: read ID3 (title, artist, album, year, duration, embedded cover) into `playlist.json`; hand-edited titles win; extract covers once to small images (e.g. `public/music/covers/*.jpg`) | planned (needs Argi OK) |
| MM-2 | Player API: `track-change` event carrying the current playlist entry, plus play/pause/position updates | planned |
| MM-3 | Music Player "Album Art" RGBA output (cover, transparent outside the art); main RGB output unchanged | planned |
| MM-4 | Music Player "Track" data output (whole metadata entry on one wire) | planned |
| MM-5 | Text Box rich text: safe HTML subset, per-character styling, live `<field>` fed by Track wire, WebGL glyph-atlas face | planned |
| MM-6 | Fonts: `.ttf`/`.otf`/`.woff2`, size-capped, stored in/alongside the patch; "Load font" button | planned |
| MM-7 | Native builds read the same HTML subset | planned |
| MM-8 | soundemote.dev offsite editor: font loading, field chips, live preview (same renderer), "Copy for sandbox" | planned |
| MM-9 | Later: direct send from the editor into an open sandbox tab | planned |

Order: MM-1..MM-4 (Album Art + Track data) first, then MM-5..MM-7 (text box + HTML subset + fonts), then MM-8..MM-9 (editor).

## 1. Track metadata (build time)

- `scripts/build-playlist.mjs` in soundemote-com reads MP3 ID3 tags at build time: title, artist, album, year, duration, embedded cover, into `playlist.json`.
- Hand-edited titles in the playlist win over ID3.
- Covers are extracted once as small images (e.g. `public/music/covers/*.jpg`), so sites never download a whole MP3 just for its art.
- Tracks still stream lazily, one at a time.

## 2. Website API

- The embedded player sends `track-change` over the existing `soemdsp:player:*` postMessage API (`public/modules/audioPlayer/audio-player-api.js`, docs/EMBED.md "Player API") with the current playlist entry, plus play/pause/position updates.

## 3. Music Player outputs

- Main RGB output stays exactly what the face shows ("send what the display shows").
- New RGBA output **Album Art**: current cover, transparent outside the art.
- New **Track** data output: the whole current metadata entry on one wire. No wire per field.

## 4. Text Box module (rich text)

- Builds on the planned wireable title/text plate.
- Per-character styling: font, size, weight, italic, color, alignment, spacing.
- Metadata fields inserted as live fields fed by the Track wire.
- Stored format: a safe, small HTML subset, pasteable from an external editor:
  `<span style>`, `<b>`, `<i>`, `<br>`, `<field name="title"/>`. Anything else is ignored.
- Face renders in WebGL from a glyph atlas (WebGL display policy).
- The glyph atlas is shared with the circuit builder GL work (`docs/WEBGL_DISPLAY_PLAN.md` section 11, GB-3).
- Native builds read the same subset.

## 5. Fonts

- `.ttf` / `.otf` / `.woff2`, size-capped, saved inside or alongside the patch.
- "Load font" button on the text box, so shared patches render the same everywhere.

## 6. soundemote.dev editor

- Offsite rich-text editor: font loading, field chips, live preview using the same renderer, "Copy for sandbox".
- Later: direct send into an open sandbox tab.

## Open questions (from reading current code)

1. **No RGB output exists today.** The Music Player (`audioPlayer`, label in `public/node-graph-module-definitions.js` L265 / `public/node-graph-module-store.js` L1442) has outputs `Mono, Left, Right, Phase, Trigger` and a `sampleWaveform` display; no RGB/picture output found. Does MM-3 also add the main RGB "what the face shows" output, or is that a separate prerequisite?
2. **No data/object wire type found.** Module definitions only declare audio `inputs/outputs` and `digitalInputs/digitalOutputs`. The Track output needs a new wire kind: how does it route through the native graph (`graph_engine.wasm`) without JS audio DSP, and what does a Track wire do when plugged into an audio input?
3. **No "wireable title/text plate" plan doc exists** in `docs/` (closest: `docs/CODE_BOX_AND_TEXT_CATEGORY.md`, `docs/B-064_TEXT_BOX_HIDDEN_TITLE_BACKGROUND_OVERFLOW.md`, `docs/B-071_CANVAS_TEXT_BOX_SCALING.md`). Which doc/spec should MM-5 build on, or should this plan define the plate?
4. **Text Box today is plain text with one font per box** (`public/modules/textBox/text-box-widget.js` `textBoxWidgetNormalizeFont` / `textBoxWidgetFontFamily`, colors via Sound Color Widgets in `text-box-settings.js`). Is rich text a new mode of the existing Text Box (fixed parameter set) or a new module? Existing patches' plain text would need to load as-is (no shim) — confirm plain text is simply valid subset content.
5. **Track-change vs existing `state` event.** `audio-player-api.js` already emits `state` (nodeId, playing, paused, index, count, title, position, duration, volume, needsGesture) on change. Is `track-change` an additional event (API version stays 1) or does `state` gain the entry? Position updates already exist via `state`.
6. **Playlist entry fields.** The player only reads `title`/`name` (`audio-player-api.js` L70, L104, L127; `audio-player-embed.js` L46). Where do artist/album/year/cover URL live in the sandbox playlist items, and are they saved in the patch?
7. **Cover for locally loaded files.** Files dropped into the sandbox (not from soundemote-com `playlist.json`) have no extracted cover; should the sandbox read ID3 itself, or Album Art stays transparent?
8. **Font storage limits.** Exact size cap and whether fonts are embedded in the patch JSON (base64) or stored next to it; how saved patches/URLs carry them.
9. **Native "same subset"**: which native build (plugin? standalone?) renders text, and does it get a glyph-atlas renderer too?
