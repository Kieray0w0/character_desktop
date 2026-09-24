# Camera Face Capture

Open the local website using `start_local.bat`. In character settings, select a
Live2D character, then enable camera capture and allow camera access. The first
detected face establishes a neutral head orientation. Use the calibration
button while facing the camera to reset it. Camera access requires HTTPS or
localhost; plain HTTP on a phone's LAN address is not sufficient.

All nine Live2D skins support head orientation, blinking and jaw opening. Some
skins have one shared eye control, so independent winks are unavailable. Smile
mapping is omitted for Flutterpage 310502/310503. Eyebrow tracking is available
only for Narcissus. Charlie's Spine rig is explicitly unsupported. This is
face/head capture, not full-body, hand or finger capture.

The renderer applies samples after motion evaluation, preserving the authored
idle pose and clamping to real parameter limits. Automatic interactions, voice
lip-sync and expression queues are suspended until capture is turned off.

Camera input is processed locally using the pinned MediaPipe Tasks Vision
runtime and model under `vendor/`. There is no recording, upload, microphone
permission or CDN request. The preview is mirrored. Detection runs at up to
12.5 FPS on CPU; character rendering and smoothing continue independently.
Tracking quality, expression appearance and head-axis signs still require
real-camera/device validation. Avoid multiple faces in the camera view.

Turning capture off, switching skins, hiding the character, putting the page
in the background or navigating away releases camera tracks. Loss of face
returns the model toward neutral; after 30 seconds without a face, capture
stops. Start-up times out after 60 seconds; a late permission grant is also
released. Capture permission/activation is never persisted or auto-restored.

For pinned download sources, checksums and licensing details see
`vendor/provenance.json` and `vendor/README.md`. Verify the local assets with
`python download_face_tracking.py --verify-only` from the project root.
