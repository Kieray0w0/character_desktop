'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const desktop = window.desktop;
  let editing = null;
  const pendingValues = new Map();
  let skinKey = '';
  const error = reason => { $('model-status').textContent = reason.message; };
  $('open-website').addEventListener('click', async event => {
    event.preventDefault();
    $('website-status').hidden = true;
    try {
      await desktop.openWebsite();
    } catch {
      $('website-status').textContent = '无法打开默认浏览器，请手动访问 https://Kieray0w0.github.io/';
      $('website-status').hidden = false;
    }
  });
  function applySnapshot(snapshot) {
    if (!snapshot) {
      editing = null;
      pendingValues.clear();
      skinKey = '';
      $('skin-select').replaceChildren();
      $('model-controls').disabled = true;
      $('capture-toggle').setAttribute('aria-pressed', 'false');
      $('capture-status').textContent = '等待角色状态…';
      $('model-status').textContent = '等待角色状态…';
      clearPreview();
      return;
    }
    const nextKey = JSON.stringify(snapshot.skins);
    if (nextKey !== skinKey) {
      skinKey = nextKey;
      $('skin-select').replaceChildren(...snapshot.skins.map(skin => new Option(skin.text, skin.value)));
    }
    for (const [id, control] of Object.entries(snapshot.controls)) {
      const element = $(id);
      // Window scale/topmost have one authoritative source: native state events.
      if (['size', 'size-value', 'topmost'].includes(id)) continue;
      if (pendingValues.has(id)) {
        if (String(control.value) !== pendingValues.get(id)) continue;
        pendingValues.delete(id);
      }
      if (id === 'speed-value' && pendingValues.has('speed')) continue;
      if (!element || id === editing || id === `${editing}-value`) continue;
      if ('value' in control) element.value = control.value;
      if ('checked' in control) element.checked = control.checked;
      if ('text' in control) element.textContent = control.text;
      element.disabled = control.disabled;
      element.hidden = control.hidden;
    }
    $('model-controls').disabled = false;
    $('capture-toggle').setAttribute('aria-pressed', String(snapshot.controls['capture-toggle'].text === '关闭摄像头动捕'));
    if ($('capture-toggle').getAttribute('aria-pressed') !== 'true') clearPreview();
  }
  function applyState(state) {
    $('topmost').checked = state.topmost;
    if (pendingValues.has('size') && Math.abs(Number(pendingValues.get('size')) - state.scale) < .01) pendingValues.delete('size');
    if (editing !== 'size' && !pendingValues.has('size')) {
      $('size').value = String(state.scale);
      $('size-value').textContent = `${Math.round(state.scale)}%`;
    }
  }
  function clearPreview() {
    $('camera-preview').hidden = true;
    $('camera-preview').removeAttribute('src');
  }
  function finishEditing() {
    editing = null;
  }
  desktop.onEvent(event => {
    if (event.type === 'settings-data') applySnapshot(event.snapshot);
    if (event.type === 'state') applyState(event.state);
    if (event.type === 'settings-preview') {
      if (!event.dataURL) clearPreview();
      else {
        $('camera-preview').src = event.dataURL;
        $('camera-preview').hidden = false;
      }
    }
  });
  $('character-select').replaceChildren(...window.CHARACTER_CATALOG.map(entry => new Option(`${entry.zh} / ${entry.en}`, entry.id)));
  for (const id of ['character-select', 'skin-select', 'voice-enabled', 'auto-interact', 'body-follow', 'arm-follow', 'speed']) {
    const element = $(id);
    const event = id === 'speed' ? 'input' : 'change';
    element.addEventListener(event, () => {
      const command = { id, event };
      if (element.type === 'checkbox') command.checked = element.checked;
      else command.value = element.value;
      if (id === 'speed') {
        pendingValues.set('speed', element.value);
        $('speed-value').textContent = `${element.value}×`;
      }
      desktop.settingsCommand(command);
    });
  }
  for (const id of ['capture-toggle', 'calibrate', 'retry', 'quit']) {
    $(id).addEventListener('click', () => desktop.settingsCommand({ id, event: 'click' }));
  }
  $('topmost').addEventListener('change', () => desktop.setTopmost($('topmost').checked).then(applyState).catch(error));
  $('size').addEventListener('input', () => {
    pendingValues.set('size', $('size').value);
    $('size-value').textContent = `${Math.round(Number($('size').value))}%`;
    desktop.setScale(Number($('size').value)).then(applyState).catch(error);
  });
  for (const id of ['size', 'speed']) {
    $(id).addEventListener('pointerdown', () => { editing = id; });
  }
  window.addEventListener('pointerup', finishEditing);
  window.addEventListener('pointercancel', finishEditing);
  window.addEventListener('blur', finishEditing);
  $('settings-close').addEventListener('click', () => desktop.closeSettings().catch(error));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') desktop.closeSettings().catch(error);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPreview(); });
  desktop.getState().then(applyState).catch(error);
  desktop.getSettings().then(applySnapshot).catch(error);
})();
