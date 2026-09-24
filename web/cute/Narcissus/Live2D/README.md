# Local Narcissus Live2D

Model: `315701`, default garment, from
https://model.merui.net/l2d/315701/315701.model3.json
Viewer reference: https://uttu.merui.net/profiles/narcissus/

Run `python download_narcissus_live2d.py` from the repository root to download
the manifest and its referenced files. `assets.json` records each source URL,
size and SHA-256 hash. Existing local assets are preserved on repeated runs.

The website loads these local resources, not the original site's servers.
Use `start_local.bat` for local preview; `file://` displays an error because
model files cannot be fetched safely. The website no longer loads GIF fallback.

`narcissus-live2d.js` uses a continuous idle queue, a one-shot body queue, and a
separate mouth queue. The native expression manager runs after these
layers. Body clips are explicitly one-shot even though their source metadata
sets Loop=true. Idle/body fades are 0.3 seconds. No GIF decoding or fetching
occurs; existing GIF files are retained in the private repository as an archive.

The current manifest has no Physics/Pose file. Procedural blink, breath and
mouse focus are disabled so they do not conflict with the authored curves.
Animation speed scales model time, including fade times. Background playback is
configurable; when enabled the model advances at low frequency in hidden tabs,
otherwise it pauses. Canvas sizing follows the existing fixed character container.
The visibility setting also pauses rendering. Speaking uses the matching
`t_*` talk motion while audio is playing and returns to `t_*_bizui` afterward.
The common click/60-second scheduler chooses either silent or voiced actions.
Canvas resolution accounts for both display pixel ratio and the size slider,
with 2x supersampling on ordinary displays and a 4x backing-resolution cap.
Changing character size redraws at the new resolution instead of only enlarging
the existing pixels. This improves edges without increasing asset downloads,
but increases GPU rendering work.

Runtime versions: PixiJS 6.5.10, pixi-live2d-display 0.4.0, and Cubism Core
downloaded from Live2D's SDK distribution (exact bytes pinned by assets.json).
The original license headers and bundled MIT license files are retained.
Cubism Core has its own license, not the PixiJS MIT license:
https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html

Character assets belong to Bluepoch. This download and attribution do not grant
redistribution rights. The deployment owner must comply with the model and SDK
licenses, including any applicable Live2D publication requirements.
