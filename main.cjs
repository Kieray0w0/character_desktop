'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain,
  session, dialog, powerMonitor, shell,
} = require('electron');
const {
  clampScale, fitBounds, readPreferences, writePreferences, createStaticServer,
  isAllowedRequest, isVideoPermissionRequest, createTrayPNG,
  resizeBounds, sanitizeSettingsSnapshot, isSettingsCommand, isSettingsPreview,
} = require('./native.cjs');

// Test isolation changes only the data directory, never security or permissions.
const testUserData = process.env.CHARACTER_DESKTOP_TEST_USER_DATA;
if (testUserData) {
  if (!path.isAbsolute(testUserData)) throw new Error('CHARACTER_DESKTOP_TEST_USER_DATA must be absolute');
  fs.mkdirSync(testUserData, { recursive: true });
  app.setPath('userData', testUserData);
}
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

let win;
let tray;
let server;
let preferences;
let preferenceFile;
let quitting = false;
let suspended = false;
let loaded = false;
let needsReload = false;
let reloadPending = false;
let showAfterReload = false;
let visible = false;
let settingsPending = false;
let saveTimer;
let drag;
let resize;
let settingsWin;
let settingsLoaded = false;
let settingsWanted = false;
let settingsLoad;
let settingsSnapshot = null;
let previewEpoch = 0;
let isolatedSession;
let permissionEpoch = 0;
let permissionPending = false;
const mutedBySwitch = app.commandLine.hasSwitch('mute-audio');

function alive() { return win && !win.isDestroyed(); }
function state() { return { topmost: preferences.topmost, scale: preferences.scale, theme: preferences.theme, hidden: !visible }; }
function send(event) {
  if (alive() && loaded && !win.webContents.isDestroyed()) win.webContents.send('desktop:event', event);
}
function settingsAlive() { return settingsWin && !settingsWin.isDestroyed(); }
function sendSettings(event) {
  if (settingsAlive() && settingsLoaded && !settingsWin.webContents.isDestroyed()) {
    settingsWin.webContents.send('desktop:event', event);
  }
}
function settingsVisibility() {
  const next = Boolean(visible && !quitting && !suspended && settingsWanted && settingsLoaded &&
    settingsAlive() && settingsWin.isVisible() && !settingsWin.isMinimized());
  previewEpoch++;
  if (!next) sendSettings({ type: 'settings-preview', dataURL: null });
  send({ type: 'settings-visibility', visible: next, previewEpoch });
}
function closeSettings() {
  settingsPending = false;
  settingsWanted = false;
  settingsVisibility(); // Clear the document and invalidate in-flight frames before hiding.
  if (settingsAlive()) settingsWin.hide();
}
function guardNavigation(window, url) {
  window.setMenu(null);
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('content-bounds-updated', event => event.preventDefault());
  window.webContents.on('will-navigate', event => { if (event.url !== url) event.preventDefault(); });
  window.webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame || event.url !== url) event.preventDefault();
  });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'), session: isolatedSession,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    navigateOnDragDrop: false, spellcheck: false, backgroundThrottling: false,
  };
}
function clampSettingsWindow() {
  if (!settingsAlive()) return;
  const bounds = settingsWin.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const [minWidth, minHeight] = settingsWin.getMinimumSize();
  if (minWidth !== Math.min(280, area.width) || minHeight !== Math.min(360, area.height)) {
    settingsWin.setMinimumSize(Math.min(280, area.width), Math.min(360, area.height));
  }
  const corrected = { width, height,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
  };
  // A redundant DIP -> pixel -> DIP round-trip can grow the window at fractional DPI.
  if (Object.keys(corrected).some(key => corrected[key] !== bounds[key])) settingsWin.setBounds(corrected);
}
async function openSettings() {
  if (!alive() || quitting || suspended) return;
  if (!loaded || needsReload) {
    showWindow();
    settingsPending = true;
    return;
  }
  if (!visible) showWindow();
  settingsWanted = true;
  if (!settingsAlive()) {
    const character = win.getBounds();
    const area = screen.getDisplayMatching(character).workArea;
    const width = Math.min(360, area.width);
    const height = Math.min(650, area.height);
    const right = area.x + area.width - character.x - character.width;
    const left = character.x - area.x;
    const x = right >= width + 12 || right >= left ? character.x + character.width + 12 : character.x - width - 12;
    const window = new BrowserWindow({
      x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(character.y, area.y + area.height - height))),
      width, height, minWidth: Math.min(280, area.width), minHeight: Math.min(360, area.height),
      show: false, frame: false, transparent: false, backgroundColor: preferences.theme === 'archive' ? '#212121' : '#f8f9f1',
      resizable: true, maximizable: false, fullscreenable: false, autoHideMenuBar: true,
      title: 'Character Desktop Settings', icon: path.join(__dirname, 'assets', 'app.ico'), webPreferences: webPreferences(),
    });
    settingsWin = window;
    const url = `${server.baseURL}settings.html`;
    guardNavigation(window, url);
    window.webContents.on('did-start-navigation', event => {
      if (settingsWin === window && event.isMainFrame && !event.isSameDocument) {
        sendSettings({ type: 'settings-preview', dataURL: null });
        settingsLoaded = false;
        settingsVisibility();
      }
    });
    window.webContents.on('did-finish-load', () => {
      if (settingsWin !== window) return;
      settingsLoaded = true;
      sendSettings({ type: 'settings-data', snapshot: settingsSnapshot });
      sendSettings({ type: 'state', state: state() });
      if (window.isVisible()) settingsVisibility();
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); closeSettings(); }
    });
    window.webContents.on('render-process-gone', () => {
      if (settingsWin === window) { closeSettings(); window.destroy(); }
    });
    window.on('close', event => { if (!quitting) { event.preventDefault(); closeSettings(); } });
    for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, settingsVisibility);
    window.on('closed', () => {
      if (settingsWin !== window) return;
      settingsWin = undefined;
      settingsLoaded = false;
      settingsVisibility();
    });
    settingsLoad = window.loadURL(url).catch(error => {
      if (settingsWin !== window || quitting) return;
      closeSettings();
      window.destroy();
      dialog.showErrorBox('Settings could not open', `Unable to load local web/settings.html: ${error.message}`);
    });
  }
  const window = settingsWin;
  await settingsLoad;
  if (settingsWin !== window || !settingsAlive() || !settingsLoaded || !settingsWanted || !visible || quitting || suspended) return;
  clampSettingsWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function workAreas() {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter(display => display.id !== primary.id)]
    .map(display => display.workArea);
}
function persist() {
  clearTimeout(saveTimer);
  if (!preferences || !preferenceFile) return;
  if (alive()) {
    const [x, y] = win.getPosition();
    const bounded = fitBounds({ ...preferences, x, y }, workAreas());
    preferences.x = bounded.x;
    preferences.y = bounded.y;
  }
  try { writePreferences(preferenceFile, preferences); }
  catch (error) { console.error('Unable to save desktop preferences:', error.code || error.message); }
}
function scheduleSave() {
  if (resize) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 200);
}
function clampWindow(reset = false) {
  if (!alive()) return;
  const [x, y] = win.getPosition();
  win.setBounds(fitBounds(reset ? { ...preferences, x: undefined, y: undefined } : { ...preferences, x, y }, workAreas()));
  persist();
}
function stopDrag() {
  if (!drag) return;
  clearInterval(drag.interval);
  clearTimeout(drag.timeout);
  drag = undefined;
  clampWindow();
}
function startDrag() {
  if (drag || resize || !alive() || !visible || !win.isFocused()) return;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  drag = {
    interval: setInterval(() => {
      if (!alive()) return stopDrag();
      const next = screen.getCursorScreenPoint();
      win.setPosition(Math.round(x + next.x - cursor.x), Math.round(y + next.y - cursor.y));
    }, 16),
    timeout: setTimeout(stopDrag, 15000),
  };
}
function stopResize() {
  if (!resize) return;
  clearInterval(resize.interval);
  clearTimeout(resize.timeout);
  resize = undefined;
  persist();
  updateTray();
}
function startResize(corner) {
  if (!['nw', 'ne', 'sw', 'se'].includes(corner) || resize || drag ||
      !alive() || !visible || !win.isFocused()) return;
  clearTimeout(saveTimer);
  const cursor = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  resize = {
    interval: setInterval(() => {
      if (!alive() || !visible || !win.isFocused()) return stopResize();
      const next = screen.getCursorScreenPoint();
      const { scale, ...nextBounds } = resizeBounds(bounds, corner,
        { x: next.x - cursor.x, y: next.y - cursor.y }, area);
      preferences.scale = scale;
      win.setBounds(nextBounds);
      publishState(false);
    }, 16),
    timeout: setTimeout(stopResize, 15000),
  };
}
function publishState(trayUpdate = true) {
  send({ type: 'state', state: state() });
  sendSettings({ type: 'state', state: state() });
  if (trayUpdate) updateTray();
}
function setVisibility(next) {
  visible = Boolean(next && !quitting && !suspended);
  if (!visible) {
    permissionEpoch++;
    stopDrag();
    stopResize();
    closeSettings();
  }
  if (alive()) win.webContents.setAudioMuted(!visible || mutedBySwitch);
  // The page must call capture.stop() and stop audio on false. Permission denial
  // prevents new streams, but cannot revoke already-live MediaStreamTracks.
  send({ type: 'visibility', visible });
  publishState();
}
function hideWindow() {
  if (!alive()) return;
  showAfterReload = false;
  settingsPending = false;
  setVisibility(false); // Deliver before hiding; renderer throttling is disabled.
  win.hide();
  persist();
}
function showWindow() {
  if (!alive() || quitting) return;
  if (needsReload) {
    showAfterReload = true;
    if (reloadPending) return;
    reloadPending = true;
    // Only an explicit show retries a crashed page. Never retry from a crash or
    // failure callback, and never restore camera grants from the old renderer.
    void win.loadURL(server.indexURL).then(() => {
      if (!alive() || quitting) return;
      if (!loaded) throw new Error('The renderer exited during recovery.');
      needsReload = false;
      if (showAfterReload) showWindow();
    }).catch(error => {
      if (!alive() || quitting) return;
      loaded = false;
      needsReload = true;
      hideWindow();
      dialog.showErrorBox('Character Desktop could not recover',
        `The local character page could not be reloaded: ${error.message}\n\n` +
        'Verify that the web folder and index.html are present. Choose Show in the tray to retry, or Quit to restart the app.');
    }).finally(() => { reloadPending = false; });
    return;
  }
  clampWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  setVisibility(true);
  win.focus();
  if (settingsPending && loaded) { settingsPending = false; void openSettings(); }
}
function setTopmost(value) {
  preferences.topmost = value;
  win.setAlwaysOnTop(value);
  persist();
  publishState();
  return state();
}
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide' : 'Show', click: () => visible ? hideWindow() : showWindow() },
    { label: 'Settings', click: () => { void openSettings(); } },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: preferences.topmost, click: item => setTopmost(item.checked) },
    { label: 'Reset position', click: () => { stopDrag(); stopResize(); clampWindow(true); showWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}
function trustedContents(contents) {
  return alive() && contents === win.webContents && !contents.isDestroyed() &&
    contents.getURL() === server.indexURL && contents.mainFrame.url === server.indexURL;
}
function trustedIPC(event, role = 'companion') {
  if (role === 'both') return trustedIPC(event) || trustedIPC(event, 'settings');
  const window = role === 'settings' ? settingsWin : win;
  const url = role === 'settings' ? `${server.baseURL}settings.html` : server.indexURL;
  return window && !window.isDestroyed() && event.sender === window.webContents &&
    !event.sender.isDestroyed() && event.sender.getURL() === url &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === url;
}
function installIPC() {
  const handle = (channel, callback, role = 'companion') => ipcMain.handle(`desktop:${channel}`, (event, ...args) => {
    if (!trustedIPC(event, role)) throw new Error('Untrusted desktop IPC sender');
    return callback(...args);
  });
  handle('getState', () => state(), 'both');
  handle('setTheme', value => {
    if (!['classic', 'archive'].includes(value)) throw new TypeError('Unknown interface theme');
    // Persist before broadcasting so failed writes do not claim a saved selection.
    writePreferences(preferenceFile, { ...preferences, theme: value });
    preferences.theme = value;
    publishState(false);
    return state();
  }, 'settings');
  handle('setTopmost', value => {
    if (typeof value !== 'boolean') throw new TypeError('topmost must be boolean');
    return setTopmost(value);
  }, 'both');
  handle('setScale', value => {
    if (!Number.isFinite(value)) throw new TypeError('scale must be finite');
    stopDrag();
    stopResize();
    preferences.scale = clampScale(value);
    clampWindow();
    publishState();
    return state();
  }, 'both');
  handle('hide', () => hideWindow());
  handle('openSettings', openSettings);
  handle('closeSettings', closeSettings, 'both');
  handle('getSettings', () => settingsSnapshot, 'settings');
  handle('openWebsite', () => shell.openExternal('https://Kieray0w0.github.io/'), 'settings');
  const on = (channel, callback, role = 'companion') => {
    ipcMain.on(`desktop:${channel}`, (event, ...args) => { if (trustedIPC(event, role)) callback(...args); });
  };
  for (const [channel, callback] of [['quit', () => app.quit()], ['moveStart', startDrag], ['moveEnd', stopDrag],
    ['resizeStart', startResize], ['resizeEnd', stopResize]]) {
    on(channel, callback);
  }
  on('publishSettings', snapshot => {
    const valid = sanitizeSettingsSnapshot(snapshot);
    if (!valid) return;
    settingsSnapshot = valid;
    sendSettings({ type: 'settings-data', snapshot: valid });
  });
  on('settingsCommand', command => {
    if (loaded && visible && settingsLoaded && settingsAlive() && settingsWin.isVisible() &&
        isSettingsCommand(command)) send({ type: 'settings-command', command });
  }, 'settings');
  on('publishPreview', (dataURL, epoch) => {
    if (dataURL === null) {
      sendSettings({ type: 'settings-preview', dataURL: null });
      return;
    }
    if (Number.isSafeInteger(epoch) && epoch === previewEpoch && loaded && visible && !quitting && !suspended &&
        settingsWanted && settingsLoaded && settingsAlive() && settingsWin.isVisible() &&
        !settingsWin.isMinimized() && isSettingsPreview(dataURL)) {
      sendSettings({ type: 'settings-preview', dataURL });
    }
  });
}

async function start() {
  preferenceFile = path.join(app.getPath('userData'), 'desktop-state.json');
  preferences = readPreferences(preferenceFile);
  if (!fs.statSync(path.join(__dirname, 'web', 'index.html')).isFile()) throw new Error('Missing local index.html');
  server = await createStaticServer(path.join(__dirname, 'web'));
  if (quitting) { await server.close(); return; }
  const isolated = session.fromPartition('character-desktop', { cache: false });
  isolatedSession = isolated;
  await isolated.setProxy({ mode: 'direct' });
  if (quitting) return;
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, server.baseURL) });
  });
  isolated.on('will-download', event => event.preventDefault());
  // Never cache a camera grant: a check must fall through to the native prompt.
  isolated.setPermissionCheckHandler(() => false);
  isolated.setDevicePermissionHandler(() => false);
  isolated.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  isolated.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!visible || permissionPending || !trustedContents(contents) ||
        !isVideoPermissionRequest(permission, details, server.indexURL)) return callback(false);
    permissionPending = true;
    const epoch = permissionEpoch;
    const frame = contents.mainFrame;
    dialog.showMessageBox(win, {
      type: 'question', title: 'Allow camera access?',
      message: 'Allow Character Desktop to use your camera for this request?',
      detail: 'Video is processed locally. Microphone access is never allowed. Hiding the character stops capture.',
      buttons: ['Deny', 'Allow camera'], defaultId: 0, cancelId: 0, noLink: true,
    }).then(result => {
      callback(result.response === 1 && epoch === permissionEpoch && visible &&
        trustedContents(contents) && contents.mainFrame === frame);
    }, () => callback(false)).finally(() => { permissionPending = false; });
  });

  win = new BrowserWindow({
    ...fitBounds(preferences, workAreas()),
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: preferences.topmost, autoHideMenuBar: true, hasShadow: false,
    title: 'Character Desktop',
    icon: path.join(__dirname, 'assets', 'app.ico'),
    webPreferences: webPreferences(),
  });
  guardNavigation(win, server.indexURL);
  win.webContents.on('did-start-navigation', event => {
    if (event.isMainFrame && !event.isSameDocument) {
      permissionEpoch++;
      stopDrag();
      stopResize();
      loaded = false;
      settingsSnapshot = null;
      sendSettings({ type: 'settings-data', snapshot: null });
      closeSettings();
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (!alive() || quitting) return;
    loaded = true;
    const pending = settingsPending;
    setVisibility(win.isVisible() && !win.isMinimized());
    // Recovery loads while hidden; preserve an explicit Settings request until Show.
    if (needsReload && showAfterReload) settingsPending = pending;
    settingsVisibility();
    if (settingsPending && visible && !suspended && !quitting && !needsReload) {
      settingsPending = false;
      void openSettings();
    }
  });
  win.webContents.on('render-process-gone', () => {
    loaded = false;
    needsReload = true;
    settingsSnapshot = null;
    sendSettings({ type: 'settings-data', snapshot: null });
    hideWindow();
  });
  win.on('close', event => {
    if (!quitting) { event.preventDefault(); hideWindow(); }
  });
  win.on('hide', () => setVisibility(false));
  win.on('minimize', () => setVisibility(false));
  win.on('show', () => setVisibility(!win.isMinimized()));
  win.on('restore', () => setVisibility(win.isVisible()));
  win.on('blur', () => { stopDrag(); stopResize(); }); // Blur must not stop capture.
  win.on('move', scheduleSave);
  win.once('ready-to-show', () => { if (!needsReload) showWindow(); });
  win.on('closed', () => { win = undefined; });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => { stopDrag(); stopResize(); clampWindow(); clampSettingsWindow(); });
  }
  powerMonitor.on('suspend', () => { suspended = true; setVisibility(false); persist(); });
  powerMonitor.on('resume', () => {
    suspended = false;
    if (alive()) setVisibility(win.isVisible() && !win.isMinimized());
  });
  tray = new Tray(nativeImage.createFromBuffer(createTrayPNG()));
  tray.setToolTip('Character Desktop');
  tray.on('double-click', showWindow);
  updateTray();
  installIPC();
  await win.loadURL(server.indexURL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    if (preferences) setVisibility(false);
    stopDrag();
    stopResize();
    persist();
    if (tray) { tray.destroy(); tray = undefined; }
    if (settingsAlive()) settingsWin.destroy();
    if (alive()) win.destroy(); // Actually release renderer/media on real quit.
    if (server) void server.close().catch(() => {});
  });
  app.on('window-all-closed', () => { if (!quitting) app.quit(); });
  app.whenReady().then(start).catch(error => {
    if (quitting) return;
    console.error('Character Desktop startup failed:', error.message);
    dialog.showErrorBox('Character Desktop could not start', 'Unable to load the local application. Verify that the web folder and its index.html are present.');
    app.quit();
  });
}
