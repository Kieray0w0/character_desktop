# Third-Party Resources

## Game Assets

Reverse: 1999 characters, artwork, models, skeletons, textures, animations,
voices and dialogue belong to Bluepoch and their respective creators.
Asset catalog/viewer: https://uttu.merui.net/
Model origin: https://model.merui.net/ (l2d and spine).
Voice origin: https://voice.merui.net/ (English voices, locally converted to MP3).
Attribution and possession of these files do not grant redistribution rights.
Obtain the necessary permissions before distributing game assets.

## Rendering Libraries

- PixiJS 6.5.10: MIT; web/cute/Narcissus/Live2D/vendor/PIXI-LICENSE.txt.
- pixi-live2d-display 0.4.0: MIT; web/cute/Narcissus/Live2D/vendor/PIXI-LIVE2D-LICENSE.txt.
- Live2D Cubism Core: separate proprietary SDK terms, not the PixiJS license.
  https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
  Original embedded notices and web/cute/Narcissus/Live2D/README.md are preserved.
- Spine WebGL 4.2.120: web/cute/vendor/spine-webgl-LICENSE.txt and README.md.
  https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-webgl@4.2.120/dist/iife/spine-webgl.min.js
  The Spine Runtimes and Spine Editor license requirements apply; this is not MIT.

## Local Face Tracking

Google MediaPipe @mediapipe/tasks-vision 0.10.21: Apache-2.0 runtime.
The complete upstream license, including its appended notice, is preserved in
web/face-tracking/vendor/LICENSE. Original package metadata, pinned URLs,
archive member information and hashes are in web/face-tracking/vendor/provenance.json
and provenance/package.json; the vendor README explains their verification.
The float16 revision-1 face_landmarker.task model has license NOASSERTION:
no model-specific license grant was verified. Do not infer model-weight rights
from the runtime license. Confirm terms with Google before redistribution.
https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

## Reproduction And Offline Verification

Run node scripts/import-assets.cjs to import from ../html into web.
Use --source PATH to select another source tree (relative to the app root).
Use --dry-run to validate and report without writing.
Run node scripts/import-assets.cjs --verify-only to check the complete imported
dependency closure and SHA-256 hashes without accessing the source or network.
resource-manifest.json records every imported file's source path, source SHA-256,
output SHA-256, byte counts and transformations. The catalog wrapper is generated
from cute/characters.json; voice manifests retain id/label/en/zh and use only MP3
for both audio fields. Only explicit runtime dependencies and approved license/
documentation/provenance files are imported. The source tree is never modified.
The importer does not own or overwrite the desktop frontend, main or preload.
All runtime resources are local after import; ../html is not needed to run them.
Source README references to downloaders/website tools are historical documentation,
not runtime dependencies. No source maps, OGG, GIFs, website HTML, contests/calendar,
Read folders, caches, snapshots, backups or repository histories are imported.
