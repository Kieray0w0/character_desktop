# Character Desktop

A standalone Windows desktop companion with local Live2D/Spine rendering and
camera face capture. The `html` and `html_online` websites are not used at runtime.

## Start

Double-click `start_desktop.bat`. When a packaged build exists, it starts
`dist/CharacterDesktop-win32-x64/CharacterDesktop.exe`; otherwise it starts the
development app. A packaged build needs neither Node.js nor Python. Keep the
entire packaged folder together, not just its executable.

For development, install Node.js 22.12 or newer, run `npm ci`, then `npm start`.
If npm blocks dependency install scripts and the Electron executable is missing,
run `node node_modules/electron/install.js` once. The batch launcher also handles
this case. The initial dependency installation requires the internet. The app
itself runs offline.

## Controls

- Hold and drag the character to move its desktop window. A movement threshold
  distinguishes dragging from a single-click interaction.
- The bottom name/control bar and active camera badge hide after five seconds.
  Right-click the character to toggle them: hidden controls appear for five
  seconds, and another right-click hides them immediately. This also works while
  Settings is open and does not close it. Hovering or left-clicking does not
  reveal controls. Hiding the badge does not stop capture.
  The tray Settings command is always available.
- Open **Settings** to select a character/skin, resize, change speed, toggle
  always-on-top, or enable camera capture.
- The **Kieray0w0.github.io** link at the bottom of Settings opens https://Kieray0w0.github.io/
  in your default browser. This online page requires internet access; the desktop
  character continues running independently.
- Settings opens in a separate window next to the character when space permits.
  Drag its top title bar to move it anywhere; changing character size does not
  move or scale this window. Its position is kept while the app is running.
- Right-click the character to reveal four corner resize handles. Hold any
  corner to resize proportionally within 70--150%, anchored at the opposite
  corner where screen space permits. Size updates live in Settings and is saved
  when you release. Arrow keys on a focused handle adjust size in 5% steps.
- Settings scroll independently of the fixed header, so **Collapse** stays
  accessible at every scroll position. Closing settings leaves the bars hidden.
  Collapsing or closing Settings hides only that window, not the character or
  active face capture. Reopen it using the character control bar or system tray.
- The window position, size and always-on-top preference persist between runs.
  Character/skin, playback and auto-interaction choices last for the current run.
- Automatic minute-by-minute interaction is off initially. Voice is allowed for
  manual interactions; it can be disabled in settings or stopped in subtitles.
- **Hide** sends the character to the system tray and releases the camera and
  audio. Double-click its tray icon to restore it. Right-click the tray for
  settings, visibility, always-on-top, position reset and exit.
- Closing the window hides it; **Quit** in settings or the tray exits fully.
- Moving focus to another app does not interrupt face capture. Native hide,
  minimize, sleep, skin switching and exit stop capture; it never auto-restarts.

## Camera

The first face detected establishes a neutral head orientation. Face the camera
and use **Calibrate** to reset it. Nine Live2D skins support head orientation,
blinking and jaw opening. Smile and eyebrow support varies by skin. Charlie's
Spine model is available as a desktop character but does not support capture.
There is no full-body, hand or finger tracking.

Every camera request requires approval in a native permission dialog. Processing
uses the bundled MediaPipe model locally: no recording, upload or microphone
access. Thirty seconds without a face stops capture. Real-camera quality depends
on lighting, camera angle, hardware and each model's authored parameter limits.
Only the character window owns camera access. While Settings is visible, its
preview receives small in-memory JPEG frames over local Electron IPC. These
frames are not saved; hiding Settings or stopping capture clears the preview,
and stale frames from an earlier visibility session are rejected.

## Build And Verify

```text
npm test
node scripts/import-assets.cjs --verify-only
npm run package
```

`npm run package` creates a portable Windows x64 app under `dist/`. Packaging is
local and unsigned; redistribution may require signing and separate asset
licenses. See `THIRD_PARTY.md`. This is not an installer and does not add startup
entries, services, firewall rules or desktop shortcuts.

`web/` includes a snapshot of the complete model, MP3 and face-tracking assets.
To explicitly refresh that snapshot from the sibling source website, run
`node scripts/import-assets.cjs --source ../html`, then rebuild. This import is
not part of startup; verification works without access to the website folder.
`resource-manifest.json` records copied resources and SHA-256 checksums.

The Electron renderer is sandboxed, has no Node.js access, and talks to a small
validated preload API. A token-protected loopback server handles local resources;
it binds only to `127.0.0.1` on an ephemeral port and shuts down with the program.
External renderer requests and navigation are blocked. No browser or separately
started Python server is required. Small transparent margins still belong to the
window; this version does not implement per-pixel desktop click-through.
