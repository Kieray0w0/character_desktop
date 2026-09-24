'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const desktop = window.desktop;
  const catalog = window.CHARACTER_CATALOG;
  const character = $('character');
  const settings = $('settings');
  const audio = $('voice');
  let renderer, request, version = 0, visible = true, speed = 1;
  let voices = [], lastVoice = -1, voiceBusy = false, voiceVersion = 0, voiceTimer, subtitleTimer;
  let silentStreak = 0, pointer, savedSkins = {};
  let controlsTimer;
  let shownInitially = false;
  let settingsOpen = false, resizePointer = null;
  let previewEpoch = 0;
  let currentScale = 100;
  function hideControls() {
    clearTimeout(controlsTimer);
    if (document.activeElement?.closest('.toolbar, #capture-badge, .resize-handle')) character.focus({ preventScroll: true });
    document.body.classList.add('controls-hidden');
  }
  function showControls() {
    clearTimeout(controlsTimer);
    if (!visible) return;
    document.body.classList.remove('controls-hidden');
    controlsTimer = setTimeout(hideControls, 5000);
  }
  document.addEventListener('contextmenu', event => {
    event.preventDefault();
    const wasHidden = document.body.classList.contains('controls-hidden');
    stopDragging();
    stopResizing();
    if (wasHidden) showControls();
    else hideControls();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' || event.target.closest('.toolbar, #capture-badge, .resize-handle')) clearTimeout(controlsTimer);
  });
  document.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (!document.activeElement?.closest('.toolbar, #capture-badge, .resize-handle') && !resizePointer) {
        clearTimeout(controlsTimer);
        controlsTimer = setTimeout(hideControls, 5000);
      }
    });
  });

  function stopVoice() {
    voiceVersion++;
    voiceBusy = false;
    clearTimeout(voiceTimer);
    clearTimeout(subtitleTimer);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    $('subtitle').hidden = true;
    renderer?.setSpeaking(false);
  }

  const capture = window.createFaceCapture({
    video: $('camera-preview'),
    onSample: values => renderer?.updateMotionCapture?.(values),
    onState: ({ active, state, message }) => {
      if (active) stopVoice();
      renderer?.setMotionCapture?.(active);
      $('capture-toggle').textContent = active ? '关闭摄像头动捕' : '开启摄像头动捕';
      $('capture-toggle').setAttribute('aria-pressed', String(active));
      $('capture-status').textContent = message.replace('请在浏览器地址栏允许后重试。', '请再次开启，并在权限弹窗中选择允许。');
      $('capture-status').dataset.state = state;
      $('capture-badge').hidden = !active;
      $('calibrate').hidden = !active || state === 'loading';
      if (!active) {
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        desktop.publishPreview(null);
        previewSent = false;
      }
    },
  });

  function report(message) { $('model-status').textContent = message; }
  function available() {
    $('capture-toggle').disabled = !visible || !renderer?.supportsMotionCapture;
    if (!renderer) $('capture-status').textContent = '请等待角色加载。';
    else if (!renderer.supportsMotionCapture) $('capture-status').textContent = '夏利的 Spine 模型暂不支持摄像头动捕。';
    else $('capture-status').textContent = '开启动捕时会请求摄像头权限，关闭后恢复普通互动。';
  }
  function showSettings(show) {
    hideControls();
    stopDragging();
    stopResizing();
    const action = show ? desktop.openSettings() : desktop.closeSettings();
    action.catch(error => report(error.message));
  }
  function stopDragging() {
    if (pointer && character.hasPointerCapture(pointer.id)) character.releasePointerCapture(pointer.id);
    pointer = null;
    character.classList.remove('dragging');
    desktop.moveEnd();
  }
  function stopResizing() {
    const previous = resizePointer;
    resizePointer = null;
    document.body.classList.remove('is-resizing');
    if (previous && previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
    desktop.resizeEnd();
    if (previous) showControls();
  }
  function setVisible(value) {
    visible = value;
    if (value && !shownInitially) {
      shownInitially = true;
      showControls();
    }
    if (!value) {
      hideControls();
      stopDragging();
      stopResizing();
      capture.stop('角色已隐藏，摄像头已关闭。');
      stopVoice();
    }
    renderer?.setVisible(value);
    $('capture-toggle').disabled = !value || !renderer?.supportsMotionCapture;
  }

  async function playVoice() {
    if (!voices.length || voiceBusy || capture.active || !visible) return;
    voiceBusy = true;
    const current = ++voiceVersion;
    let index = Math.floor(Math.random() * voices.length);
    if (index === lastVoice) index = (index + 1) % voices.length;
    lastVoice = index;
    const entry = voices[index];
    clearTimeout(subtitleTimer);
    $('voice-label').textContent = entry.label;
    $('voice-zh').textContent = entry.zh;
    $('voice-en').textContent = entry.en;
    $('subtitle').hidden = false;
    audio.src = entry.audioMp3 || entry.audio;
    audio.playbackRate = speed;
    audio.preservesPitch = true;
    voiceTimer = setTimeout(() => {
      if (current === voiceVersion && voiceBusy && audio.readyState < 3) {
        stopVoice();
        report('语音加载超时，请重试。');
      }
    }, 20000);
    try { await audio.play(); }
    catch (error) {
      if (current === voiceVersion) { stopVoice(); report(`语音无法播放：${error.message}`); }
    } finally { if (current === voiceVersion) clearTimeout(voiceTimer); }
  }
  audio.volume = 0.8;
  audio.addEventListener('playing', () => {
    if (!visible || capture.active) { stopVoice(); return; }
    silentStreak = 0;
    renderer?.setSpeaking(true);
  });
  audio.addEventListener('ended', () => {
    voiceBusy = false;
    renderer?.setSpeaking(false);
    clearTimeout(voiceTimer);
    subtitleTimer = setTimeout(() => { $('subtitle').hidden = true; }, 8000);
  });
  audio.addEventListener('error', () => {
    if (voiceBusy) { stopVoice(); report('本地语音加载失败，请重试或检查资源完整性。'); }
  });
  audio.addEventListener('pause', () => renderer?.setSpeaking(false));

  function interact() {
    if (!visible || pointer || resizePointer || capture.active || !renderer || renderer.busy || voiceBusy) return;
    renderer.playSpecial();
    if ($('voice-enabled').checked && (silentStreak >= 2 || Math.random() < .5)) playVoice();
    else silentStreak++;
  }
  const interval = setInterval(() => { if ($('auto-interact').checked) interact(); }, 60000);

  async function chooseSkin() {
    const entry = catalog.find(item => item.id === $('character-select').value);
    const skin = entry.skins.find(item => item.id === $('skin-select').value);
    const generation = ++version;
    capture.stop('切换角色或皮肤后，需手动重新开启动捕。');
    stopVoice();
    stopDragging();
    stopResizing();
    request?.abort();
    renderer?.destroy();
    renderer = null;
    request = new AbortController();
    const signal = request.signal;
    const current = () => generation === version && !signal.aborted;
    voices = [];
    lastVoice = -1;
    silentStreak = 0;
    savedSkins[entry.id] = skin.id;
    character.dataset.character = entry.id;
    character.dataset.skin = skin.id;
    character.dataset.renderer = 'loading';
    $('character-name').textContent = `${entry.zh} / ${entry.en}`;
    $('loading').hidden = false;
    $('loading').textContent = `正在加载 ${entry.zh}…`;
    $('retry').hidden = true;
    available();
    const voiceReady = fetch(skin.voices, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(data => { if (current()) voices = data.voices; })
      .catch(error => { if (current()) report(`语音资源加载失败：${error.message}`); });
    try {
      const create = skin.type === 'spine' ? window.createCharacterSpine : window.createNarcissusLive2D;
      const controller = await create({
        container: character, skin, signal,
        getSpeed: () => speed, getScale: () => 1, getBackgroundPlayback: () => false,
        status: message => { if (current()) report(message); },
      });
      if (!current()) { controller.destroy(); return; }
      renderer = controller;
      controller.setVisible(visible);
      character.dataset.renderer = skin.type;
      $('loading').hidden = true;
      available();
      controller.onError = error => {
        if (!current()) return;
        capture.stop('模型显示中断，摄像头已关闭。');
        stopVoice();
        controller.destroy();
        renderer = null;
        character.dataset.renderer = 'error';
        available();
        report(`角色显示中断：${error.message}`);
        $('loading').textContent = '角色显示中断，请在设置中重新加载。';
        $('loading').hidden = false;
        $('retry').hidden = false;
      };
    } catch (error) {
      if (!current()) return;
      character.dataset.renderer = 'error';
      report(`加载失败：${error.message}`);
      $('loading').textContent = '模型加载失败，请在设置中重新加载。';
      $('retry').hidden = false;
    }
    await voiceReady;
  }
  function chooseCharacter() {
    const entry = catalog.find(item => item.id === $('character-select').value);
    $('skin-select').replaceChildren(...entry.skins.map(skin => new Option(`${skin.zh} / ${skin.en}`, skin.id)));
    if (entry.skins.some(skin => skin.id === savedSkins[entry.id])) $('skin-select').value = savedSkins[entry.id];
    chooseSkin();
  }

  character.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || resizePointer) return;
    pointer = { id: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
    character.setPointerCapture(event.pointerId);
  });
  character.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || pointer.dragging) return;
    if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) >= 5) {
      pointer.dragging = true;
      character.classList.add('dragging');
      desktop.moveStart();
    }
  });
  character.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const click = !pointer.dragging;
    stopDragging();
    if (click) interact();
  });
  character.addEventListener('pointercancel', stopDragging);
  character.addEventListener('lostpointercapture', () => { if (pointer) stopDragging(); });
  character.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); interact(); }
  });
  for (const handle of document.querySelectorAll('.resize-handle')) {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !visible) return;
      event.preventDefault();
      stopDragging();
      stopResizing();
      clearTimeout(controlsTimer);
      resizePointer = { id: event.pointerId, target: handle };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing');
      desktop.resizeStart(handle.dataset.corner);
    });
    handle.addEventListener('pointerup', stopResizing);
    handle.addEventListener('pointercancel', stopResizing);
    handle.addEventListener('lostpointercapture', () => { if (resizePointer) stopResizing(); });
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      const delta = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 5 : -5;
      desktop.setScale(currentScale + delta).then(applyState).catch(error => report(error.message));
    });
  }
  window.addEventListener('blur', () => { stopDragging(); stopResizing(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') showSettings(false); });
  window.addEventListener('pagehide', () => {
    clearTimeout(controlsTimer);
    stopDragging();
    stopResizing();
    clearInterval(previewTimer);
    settingsObserver.disconnect();
    clearInterval(interval);
    capture.stop();
    stopVoice();
    request?.abort();
    renderer?.destroy();
  });

  function applyState(state) {
    currentScale = state.scale;
    $('topmost').checked = state.topmost;
    $('size').value = String(state.scale);
    $('size-value').textContent = `${Math.round(state.scale)}%`;
    publishSettings();
  }
  desktop.onEvent(event => {
    if (event.type === 'settings') showSettings(true);
    if (event.type === 'state') applyState(event.state);
    if (event.type === 'visibility') setVisible(event.visible);
    if (event.type === 'settings-visibility') {
      settingsOpen = event.visible;
      previewEpoch = event.previewEpoch;
      if (!settingsOpen) {
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        desktop.publishPreview(null);
        previewSent = false;
      }
      $('settings-toggle').setAttribute('aria-expanded', String(settingsOpen));
      if (settingsOpen) { hideControls(); publishSettings(); }
    }
    if (event.type === 'settings-command') {
      const command = event.command;
      const element = $(command.id);
      if (!element || element.disabled) return;
      if ('value' in command) {
        if (element instanceof HTMLSelectElement && ![...element.options].some(option => option.value === command.value)) return;
        element.value = command.value;
      }
      if ('checked' in command) element.checked = command.checked;
      element.dispatchEvent(new Event(command.event, { bubbles: true }));
      publishSettings();
    }
  });
  desktop.getState().then(state => { applyState(state); setVisible(!state.hidden); }).catch(error => report(error.message));
  $('settings-toggle').addEventListener('click', () => showSettings(true));
  $('settings-close').addEventListener('click', () => showSettings(false));
  $('hide').addEventListener('click', () => { setVisible(false); desktop.hide().catch(error => report(error.message)); });
  $('quit').addEventListener('click', () => { setVisible(false); desktop.quit(); });
  $('topmost').addEventListener('change', () => desktop.setTopmost($('topmost').checked).then(applyState).catch(error => report(error.message)));
  $('size').addEventListener('input', () => { $('size-value').textContent = `${$('size').value}%`; });
  $('size').addEventListener('change', () => desktop.setScale(Number($('size').value)).then(applyState).catch(error => report(error.message)));
  $('speed').addEventListener('input', () => {
    speed = Number($('speed').value);
    $('speed-value').textContent = `${speed}×`;
    audio.defaultPlaybackRate = audio.playbackRate = speed;
    audio.preservesPitch = true;
  });
  $('voice-enabled').addEventListener('change', () => { if (!$('voice-enabled').checked) stopVoice(); });
  $('voice-stop').addEventListener('click', stopVoice);
  $('capture-toggle').addEventListener('click', () => {
    if (capture.active) capture.stop();
    else if (visible && renderer?.supportsMotionCapture) capture.start();
  });
  $('capture-stop').addEventListener('click', () => capture.stop());
  $('calibrate').addEventListener('click', () => capture.calibrate());
  $('character-select').replaceChildren(...catalog.map(entry => new Option(`${entry.zh} / ${entry.en}`, entry.id)));
  $('character-select').addEventListener('change', chooseCharacter);
  $('skin-select').addEventListener('change', chooseSkin);
  $('retry').addEventListener('click', chooseSkin);

  // Keep one owner for model/audio/camera controls; the independent window mirrors
  // this hidden control state and sends only validated input commands through IPC.
  function publishSettings() {
    const controls = {};
    for (const id of ['character-select', 'skin-select', 'speed', 'size', 'topmost', 'voice-enabled', 'auto-interact',
      'capture-toggle', 'capture-status', 'calibrate', 'model-status', 'retry', 'speed-value', 'size-value']) {
      const element = $(id);
      const control = { disabled: Boolean(element.disabled), hidden: element.hidden };
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) control.value = element.value;
      if (id === 'size') control.value = String(currentScale);
      if (element instanceof HTMLInputElement && element.type === 'checkbox') control.checked = element.checked;
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) control.text = element.textContent;
      controls[id] = control;
    }
    desktop.publishSettings({ controls, skins: [...$('skin-select').options].map(option => ({ value: option.value, text: option.text })) });
  }
  const settingsObserver = new MutationObserver(publishSettings);
  settingsObserver.observe(settings, { subtree: true, childList: true, characterData: true, attributes: true });
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = 240;
  previewCanvas.height = 180;
  const previewContext = previewCanvas.getContext('2d');
  let previewSent = false;
  const previewTimer = setInterval(() => {
    const video = $('camera-preview');
    if (settingsOpen && capture.active && video.readyState >= 2) {
      try {
        previewContext.drawImage(video, 0, 0, 240, 180);
        desktop.publishPreview(previewCanvas.toDataURL('image/jpeg', .65), previewEpoch);
        previewSent = true;
      } catch { /* Preview failure must not interrupt tracking. */ }
    } else if (previewSent) {
      previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      desktop.publishPreview(null);
      previewSent = false;
    }
  }, 250);
  chooseCharacter();
})();
