# Local FaceLandmarker Resources

Pinned browser runtime: `@mediapipe/tasks-vision@0.10.21`, an available stable
release verified against the npm registry. These are unmodified upstream bytes.
No frontend integration, camera capture, server, npm install, or ffmpeg is added.

## Download And Verify

From the workspace root (Python 3.9+; standard library only):

```powershell
python download_face_tracking.py --dest "C:\Users\Admin\Downloads\html\face-tracking\vendor"
python download_face_tracking.py --dest "C:\Users\Admin\Downloads\html\face-tracking\vendor" --verify-only
```

The default destination is `face-tracking/vendor` beside the script, independent
of the current working directory. `--dest` explicitly selects a different local
vendor directory. Downloads retry four times, validate pinned hashes and file
signatures, and atomically replace changed files. Re-running repairs damaged
assets; it does not upgrade to an unpinned release. Updating the version requires
reviewing the source URLs, integrity pins, API checks, and licenses in the script.
Offline verification makes no network requests and writes no files.

## Files

| Path relative to this directory | Purpose |
| --- | --- |
| `vision_bundle.mjs` | Browser ESM exports |
| `wasm/vision_wasm_internal.js` | SIMD loader |
| `wasm/vision_wasm_internal.wasm` | SIMD runtime |
| `wasm/vision_wasm_nosimd_internal.js` | Non-SIMD loader |
| `wasm/vision_wasm_nosimd_internal.wasm` | Non-SIMD runtime |
| `models/face_landmarker.task` | Official float16, revision 1 model bundle |
| `LICENSE` | Unmodified upstream Apache-2.0 license, including its appended notice |
| `provenance/package.json` | Exact npm package metadata, including its license declaration |
| `provenance.json` | Source URLs, archive members, byte sizes, SHA-256 hashes and verification evidence |

Runtime plus model: **23,327,422 bytes (22.25 MiB)**. Including LICENSE and npm
metadata: **23,340,345 bytes (22.26 MiB)**. Generated provenance and this README
are excluded from these totals.

The npm archive SHA-512 integrity is also pinned. Its full member list is recorded
in `provenance.json`; it includes no standalone LICENSE or NOTICE file. The
upstream repository LICENSE is fetched at the commit for tag `v0.10.21`.
Any NOTICE members included in the pinned package are preserved by the downloader.
Embedded upstream notices in downloaded JavaScript remain unchanged.

## Browser API

Reference only, not frontend integration. For a page served from the workspace
root, the exact local imports and initialization are:

```javascript
import { FaceLandmarker, FilesetResolver } from './face-tracking/vendor/vision_bundle.mjs';

const fileset = await FilesetResolver.forVisionTasks('face-tracking/vendor/wasm');
const landmarker = await FaceLandmarker.createFromOptions(fileset, {
  baseOptions: {
    modelAssetPath: 'face-tracking/vendor/models/face_landmarker.task',
    delegate: 'CPU',
  },
  runningMode: 'VIDEO',
  numFaces: 1,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true,
});

// video is a ready HTMLVideoElement backed by a local camera MediaStream.
// Call once per new frame, with monotonically increasing millisecond timestamps.
const result = landmarker.detectForVideo(video, performance.now());
// result.faceLandmarks
// result.faceBlendshapes
// result.facialTransformationMatrixes
// Call landmarker.close() and stop camera tracks when finished.
```

`Matrixes` is the upstream API spelling, not `Matrices`. The pinned declarations
and ESM support both optional outputs. The model bundle contains
`face_blendshapes.tflite` and
`geometry_pipeline_metadata_landmarks.binarypb`, in addition to its face detector
and landmark detector. The downloader checks ZIP CRCs and TFLite `TFL3` signatures.
These checks verify assets and API support, not live camera inference.
Node.js validation also confirmed the ESM exports, both resolver branches' local
filenames, and successful compilation of both WASM binaries with fetch disabled.

Keep the WASM filenames unchanged: `FilesetResolver` selects the SIMD or non-SIMD
pair based on browser capability. Serve the workspace from localhost (or HTTPS),
with JavaScript and WASM MIME types; do not open it via `file://`. Local browser
camera access requires user permission and a secure context. Use only a local
camera MediaStream as input; no video upload or remote service is needed.
With the explicit local paths above, all inference assets load from the local
server and no external network is required at runtime. The upstream source-map
comment is retained; source maps are not required for execution and are omitted.

## Model Provenance And License

Publisher: Google MediaPipe. Exact official model URL:

https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

Task documentation:

https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

The official `.task` archive has no standalone LICENSE or NOTICE. A specific
license grant for these model weights has not been verified. Its license is
recorded as `NOASSERTION`, not Apache-2.0: neither the runtime's license nor the
documentation footer is evidence of a model-weight license. Confirm the model's
terms with its publisher before redistribution or other license-dependent use.

`provenance.json` records every downloaded resource's source, size and hash, the
model's internal member hashes, and the source/hash of the API declarations used
for verification. Totals distinguish runtime plus model from downloaded assets
including licensing/metadata; generated provenance and this README are excluded.
