# Spine Runtime and Standalone Renderer

`spine-webgl-4.2.120.min.js` is the unmodified IIFE distribution of
`@esotericsoftware/spine-webgl@4.2.120`, downloaded from:

https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-webgl@4.2.120/dist/iife/spine-webgl.min.js

SHA-256: `9e495034588d2195c379422df37151a0750f79e2f4211434ca482520da3df6e0`

This is the exact package/version used by UTTU's viewer:
https://uttu.merui.net/_astro/ProfileL2DModal.astro_astro_type_script_index_0_lang.fOm3MiHn.js

The runtime is **not MIT licensed**. See `spine-webgl-LICENSE.txt` for the
complete upstream Spine Runtimes License Agreement. Integration and distribution
require compliance with that agreement and the Spine Editor License Agreement;
vendoring the runtime does not grant a Spine Editor license.

Character artwork, skeletons, textures and audio are separate third-party game
assets, not covered by the runtime license. No ownership or redistribution rights
to those assets are asserted here. Obtain the necessary permissions before
redistributing them. This renderer never loads or plays audio.

## API

Load `character-spine.js` as a classic script. It does not wire itself into the
page or catalog. Serve over HTTP, not `file:`.

```js
const renderer = await window.createCharacterSpine({
  container,
  skin: {
    model: "/cute/Charlie/Spine/301701/301701.skel",
    atlas: "/cute/Charlie/Spine/301701/301701.atlas",
  },
  getSpeed: () => 1,
  getScale: () => 1,
  getBackgroundPlayback: () => false,
  status: (message) => {},
  signal: abortController.signal,
});
renderer.onError = (error) => {};
```

- `destroy()` is idempotent. It cancels owned requests/scheduling/listeners and
  releases GPU textures, renderer, context, canvas and owned container metadata.
- `resize()` refits the full body with padding. CSS size is independent of the
  DPR/`getScale()` drawing resolution, capped at 4x. Call after scale changes.
- `busy` remains true through the complete one-shot and the 0.25-second idle mix.
- `setVisible(bool)` pauses/resumes scheduling, not container CSS visibility.
  Hidden documents advance at 250 ms intervals only if background playback is
  enabled. Call `setVisible` again after changing that setting while hidden.
- `setSpeaking(bool)` uses verified `t_idle` / `t_bizui` on a separate mouth
  track for 301701. It is a safe animation no-op when that pair is absent or the
  model is not verified. No mouth names are extrapolated from expression names.
- `async playSpecial()` starts one random verified body animation, avoiding an
  immediate repeat. The promise resolves after scheduling, not after playback;
  use `busy` for completion. Busy/hidden/destroyed/unsupported requests are no-ops.
- Assignable `onError` defaults to `null`; fatal playback/context errors destroy
  the instance before notifying it. Initialization errors reject the factory.
- An aborted load rejects with `AbortError`; aborting a ready renderer destroys
  it silently. A new factory call on the same container supersedes the old one.
  Stale instances cannot write status or remove the new instance's canvas/class.
- Only the runtime promise is global. Each instance loads its selected model and
  atlas pages, with texture reuse confined to that model; no catalog preloading.

## Verified Model

Source: https://model.merui.net/spine/301701/301701.skel

The binary header and successful runtime parse identify **Spine 4.2.36**, not
3.8. UTTU directly uses `SkeletonBinary` from the pinned 4.2 runtime, with no
legacy conversion. The standalone loader checks the binary version before
parsing and rejects non-4.2 data with an explicit error.

The atlas names `301701.webp` (2048 x 2048). Texture URLs resolve relative to the
atlas URL, so the local filename must match its atlas page name.

| Purpose | Verified animation | Duration (seconds) |
| --- | --- | --- |
| Idle loop | `b_idle` | 10.000 |
| Body one-shot | `b_danglian` | 4.500 |
| Body one-shot | `b_kanshu` | 3.833 |
| Body one-shot | `b_taitou` | 4.667 |
| Body one-shot | `b_yaotou` | 2.333 |
| Body one-shot | `b_zhiwen` | 4.000 |
| Speaking loop | `t_idle` | 2.167 |
| Closed mouth | `t_bizui` | 0 (pose) |

The special allowlist contains only the five complete body clips above.
Expression-only `e_*`, blink `h_biyan`, mouth `t_*`, unknown clips and any
standalone end segments are never selected as body specials. Other models can
use an actual `b_idle` or `idle` loop, but specials/talk require a verified map.

## Verification

Checked with `node --check character-spine.js` and a temporary muted headless
Chrome/CDP harness on port 9251, using temporary copies of the source assets:

- Parsed the binary and rendered idle plus all five body clips at their midpoint
  and near completion. Screenshot inspection and alpha-pixel bounds confirmed
  complete, unclipped poses with transparent margins.
- Played all five full-duration one-shots through their idle mix; checked mouth
  tracks, mobile sizing, 4x resolution cap, zero speed and hidden playback.
- Checked shared runtime loading, aborted loads, same-container replacement,
  abort during image decoding, missing skeleton/texture and legacy-version errors.
- Checked context-loss notification and idempotent cleanup. No owned RAF,
  intervals, observers or canvas/window/document listeners remained after teardown;
  late decoded bitmaps were closed, and GPU assets/context were disposed.
- No uncaught browser errors or audio requests. The harness closes its browser
  and temporary server; no harness files are added to the application.

The final catalog paths/downloads are intentionally outside this renderer's scope.
