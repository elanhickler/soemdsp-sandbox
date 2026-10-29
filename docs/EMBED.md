# Embedding the sandbox (Music Player)

Any site can embed a sandbox patch from soundemote.io with an iframe. No copy of the runtime needed.

```html
<iframe
  src="https://soundemote.io/soemdsp-sandbox/index.html?patch=musicplayer&embed=1&playlist=https://example.com/music/playlist.json&autoplay=1"
  allow="autoplay"
  style="width:100%;aspect-ratio:16/9;border:0"
  title="Music player"></iframe>
```

## URL parameters

| Param | Meaning |
| --- | --- |
| `patch=<slug>` | Patch from `patches/` to load. Alias of `pagePatch` (`public/embed-params.js` rewrites it before boot). |
| `embed=1` | Chrome-less frame: sets `hideui=1` and `autoframe=1` (unless given) and adds the `soemdsp-embed` class on `<html>`. Live audio waits for a click on the module (no full-frame start overlay). |
| `playlist=<url>` | JSON manifest of tracks, bound to the patch's first Music Player (`audioPlayer`) node. |
| `src=<url>` | A single audio file instead of a playlist. |
| `module=<nodeId|type>` | Show one whole module full-frame: its own panel with parameters, no graph (see below). `type` picks the first module of that type. |
| `autoplay=1` | Start playing once loaded if the browser allows it. |
| `loading=all\|lazy` | Default loading mode for Player API `load` (default `all`). A `load` message's own `loading` field wins. See "Loading modes". |
| `bg=<css color>` | Perform background (`--soemdsp-perform-bg` on `<html>`). Any CSS color, alpha included: `bg=rgba(0,0,0,0.5)`, `bg=%2300000080` (encode `#`), `bg=transparent`. Default `#050805` with `embed=1`, `#0a0a0a` otherwise. Invalid values are ignored. |
| `unfocused=play` | Keep playing while the host tab is hidden (same as the locked Play button). Without it the sandbox pauses on leaving the tab. soundemote.com's music page sets it; soundemote.io does not. |
| `hideui`, `autoframe`, `autostart`, `mode=perform`, `wasmLoad` | Existing params, unchanged. |

`playlist`/`src` handling lives in `public/modules/audioPlayer/audio-player-embed.js` and runs after `nodeSandboxInterfaceReady`.

## Playlist manifest

```json
{ "version": 1, "tracks": [ { "url": "/music/01-song.mp3", "title": "Song", "bytes": 4123456 } ] }
```

- `tracks` may also be a bare array, and entries may be plain URL strings.
- Relative `url`s resolve against the manifest's own URL.
- Title fallback: the file name.
- soundemote-com generates one with `bun run playlist` (`scripts/build-playlist.mjs`).

Playlist entries carry a `url`. The Music Player fetches the file when it's played (`nodeGraphAudioPlayerLibraryEnsureItemLoaded`, "decode via URL" branch), caches it in memory as a `File`, then decodes it like a picked file.

## CORS

The sandbox fetches the manifest and audio with `fetch(..., { mode: "cors" })`, so the audio host must send `Access-Control-Allow-Origin: *` (or the sandbox's origin) on both. Without it the player reports "playlist failed to load (CORS?)" or "could not fetch … (CORS or network)". Same-origin files (hosted on soundemote.io itself) need nothing.

## Autoplay

- Browsers start Web Audio only after a user gesture inside the frame. Chrome may allow it after earlier engagement with the site; Safari/iOS and Firefox generally don't. A click on the host page doesn't count for a cross-origin iframe.
- The iframe needs `allow="autoplay"`.
- `autoplay=1` tries to start audio. If the browser blocks it, use Play on the Music Player itself. Embeds do not autostart live output unless `autostart=1`.
- A muted start doesn't help: Web Audio stays suspended either way.

## postMessage security

Messages that edit the graph (`soundemote:sandbox-project-data`, `soemdsp-sandbox-file-grid-selection`, `soemdsp-sandbox-button-event`) are accepted only from the sandbox's own origin (`nodeGraphExternalMessageSameOriginStrict` in `node-graph-external-ui-events.js`). A cross-origin player-control API (`soemdsp:player:*`) is phase 2; see soundemote-com `plans/music-page.md`.

## Whole-module view (`?module=`)

```html
<iframe src="https://soundemote.io/soemdsp-sandbox/index.html?patch=musicplayer&module=audioPlayer&embed=1&playlist=https://example.com/music/playlist.json&autoplay=1"
        allow="autoplay" style="width:100%;aspect-ratio:16/9;border:0"></iframe>
```

- `public/embed-module.js` resolves the module and sets `nodeGraphMvp.embedWholeModuleId`. It limits the layout canvas to that module (wrapping `nodeGraphLayoutCanvasPinnedNodeIds`) and pins it at 0,0,1,1 with `persist: false`, so the patch isn't marked dirty. Then it opens the canvas in perform mode (`nodeGraphLayoutCanvasOpen("perform")`). For a Music Player it also opens the playlist page.
- In `public/node-graph-screen-solo.js`, `nodeGraphScreenSoloWholeModuleFor` makes the module's own `.dsp-node` the tile face instead of its best display element. The existing placeholder and restore logic is reused. Any module can opt in permanently with `node.ui.canvasWholeModule: true` in the patch, together with "Show in canvas".
- **Size rule:** the module's size at workspace zoom 1.0 is the only size. `nodeGraphScreenSoloWholeModuleCapture` measures the `.dsp-node` before it leaves the workspace and stores that size and the custom properties and fonts it inherits there. Its offset size ignores the zoom transform, so it is the zoom-1 size at any zoom. `nodeGraphScreenSoloWholeModuleFit` then lays the module out at exactly that size in the tile and applies one transform: `translate(...) scale(s)`, where `s = min(tileW / w, tileH / h)`. The fit is contain, centered, with the aspect ratio preserved. A ResizeObserver refits the module when the tile changes size. The whole-module face doesn't get the solo-face classes, so the solo/canvas stretch rules never apply to it, and there's no per-element reflow.
- **Chrome:** the module is the same as in the circuit builder (header, body, sliders, jacks). The drag handle does not move the tile.
- **Input under the scale:** sliders, playlist rows and buttons work under the scale, because the sandbox maps pointer positions with `getBoundingClientRect`. Click/drag on the waveform seeks in the current zoom window (same mapping as the phosphor view).
- **Rebuilds:** a module rebuilt while shown is re-captured. A MutationObserver on the module's graph container sees the new element and reopens the canvas with it. The stale element is dropped rather than restored.
- **Audio start:** embed does not show a full-frame click-to-start overlay. Play on the module is the gesture.
- In `public/node-graph-patch-core.js`, `applyNodeGraphModuleElementFromPatch` leaves a module that is inside a canvas tile where it is when the patch re-renders.
- **Limits:**
  - The module appears exactly as in the workspace, so a tall module letterboxes in a wide frame.
  - Workspace-only styling that is scoped to `.node-graph-workspace` doesn't apply in the tile (box-shadow and filter are matched inline).
  - The input/output section's labels stay visible; only its jacks are hidden.

## Player API (postMessage, version 1)

Script: `public/modules/audioPlayer/audio-player-api.js`. Every message is `{ type: "soemdsp:player:<name>", version: 1, ...fields }`.

Commands (host -> iframe):

| type | fields | effect |
|---|---|---|
| `soemdsp:player:load` | `tracks: [{ title?, bytes: ArrayBuffer \| Blob \| File, mimeType? }]` or `tracks: [{ title?, url }]`; `loading?: "all" \| "lazy"`, `startIndex?`, `autoplay?` | Replace the playlist. Bytes need no CORS; urls must be fetchable by the iframe. Do not mix bytes and urls. With `loading: "lazy"`, tracks are metadata only: `[{ title?, name?, url?, size? }]` (no bytes). |
| `soemdsp:player:track` | `requestId`, and `bytes: ArrayBuffer` (transfer it) or `file: Blob`, `name?`, `mime?`; or `error: string` | Reply to a `need-track` request (lazy mode). |
| `soemdsp:player:play` | `index?` | Start (or resume) playback, optionally at a track. |
| `soemdsp:player:pause` / `stop` / `next` / `prev` | - | Transport. |
| `soemdsp:player:select` | `index`, `play?` | Select a track. |
| `soemdsp:player:seek` | `seconds` or `position` (0..1) | Move the playhead. |
| `soemdsp:player:volume` | `value` (0..1) | Player amplitude. |
| `soemdsp:player:get-state` | - | Replies with a `state` event. |

Events (iframe -> host): `need-track { index, requestId, title }` (lazy mode: send that one track with a `track` reply), `ready { patch, nodeId }`, `state { playing, paused, index, count, title, position, duration, volume, needsGesture }` (4 Hz while changing, and on demand), `error { code, message }` with code `bad-request`, `autoplay-blocked`, `decode`, `no-player`, `unknown-type`, `internal`. Commands sent before boot are queued. `state.needsGesture` is true while the AudioContext is not running.

### Loading modes

- `all` (default; sandbox and soundemote.io use): every track's bytes or url is bound up front, as before.
- `lazy` (websites): the host sends the playlist without audio. The player shows the full list, and whenever a track is about to play (start, play/select, next/prev, playlist click, end-of-track advance) it posts `need-track { index, requestId }`. The host fetches that one file and replies `{ type: "soemdsp:player:track", version: 1, requestId, bytes }`, transferring the ArrayBuffer. Nothing is prefetched. The reply File is not cached, and the previous track's decoded PCM is released once the new one is bound, so only the playing track is held (in JS and in the WASM player buffer). Replaying a track asks again. Unanswered requests fail after 120 s with a `decode` error; a new `load` cancels outstanding ones.

```js
iframe.contentWindow.postMessage({ type: "soemdsp:player:load", version: 1, loading: "lazy",
  tracks: [{ title: "Song", url: "/music/song.mp3", size: 4123456 }] }, sandboxOrigin);
addEventListener("message", async (e) => {
  if (e.origin !== sandboxOrigin || e.data?.type !== "soemdsp:player:need-track") return;
  const bytes = await (await fetch(tracks[e.data.index].url)).arrayBuffer();
  e.source.postMessage({ type: "soemdsp:player:track", version: 1, requestId: e.data.requestId, bytes },
    sandboxOrigin, [bytes]);
});
```

## Message origins

- Player messages (`soemdsp:player:*`) are accepted from the sandbox's own origin, or from the direct parent window (`event.source === window.parent`). Add `?origins=https://a.example,https://b.example` to restrict parents to an allowlist.
- Every other message type (autoframe, set-view, set-live-output, request-live-state, request-current-patch, project data, ...) is accepted only from the sandbox's own origin.
- Replies go to the requester's `event.origin`, never `"*"`.

## Perform-canvas embed (`?mode=perform&embed=1`)

A patch can set up its own full-frame embed: pin a module in `view.canvases.root.elements` (x 0, y 0, w 1, h 1), and set `node.ui.showInCanvas` and `node.ui.canvasWholeModule` on it. `?patch=<slug>&mode=perform&embed=1` then boots straight into the perform canvas (no start menu) with that module shown whole at its zoom-1 size, scaled uniformly to fit. A Music Player opens on its playlist page. Example: `patches/soundemotecommusicplayer.json` (used by soundemote.com/music). Circuit-builder view hotkeys (F, Escape, V, arrows, Space transport steal, …) stay off in perform and embed.
