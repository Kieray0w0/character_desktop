'use strict';

(() => {
  const shapes = {
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    settings: '<path d="m9 3-.6 2.3-2 1.2-2.3-.6-2 3.4 1.7 1.7v2.2l-1.7 1.7 2 3.4 2.3-.6 2 1.2L9 21h4l.6-2.3 2-1.2 2.3.6 2-3.4-1.7-1.7v-2.2l1.7-1.7-2-3.4-2.3.6-2-1.2L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    hide: '<path d="M4 5h16v14H4zM8 12h8m-3-3 3 3-3 3"/>',
    collapse: '<path d="m6 9 6 6 6-6"/>',
    camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    cameraOff: '<path d="m3 3 18 18M9 6h5a2 2 0 0 1 2 2v2l5-3v10l-3-1.8M16 16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 .6-1.4"/>',
    calibrate: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/><path d="M12 10v4m-2-2h4"/>',
    retry: '<path d="M20 7v5h-5M4 17v-5h5M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7"/>',
    quit: '<path d="M12 3v9M6.4 5.7a8 8 0 1 0 11.2 0"/>',
  };
  const icons = {
    'voice-stop': 'stop', 'settings-toggle': 'settings', hide: 'hide',
    'settings-close': 'collapse', 'capture-stop': 'cameraOff',
    'capture-toggle': 'camera', calibrate: 'calibrate', retry: 'retry', quit: 'quit',
  };
  function describe(id, text, pressed) {
    const icon = id === 'capture-toggle' && pressed === 'true' ? 'cameraOff' : icons[id];
    if (!icon) return null;
    const label = id === 'capture-toggle' ? (pressed === 'true' ? '关闭摄像头动捕' : '开启摄像头动捕') : text.trim();
    return { icon, label };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { describe, shapes }; return; }
  for (const id of Object.keys(icons)) {
    const button = document.getElementById(id);
    if (!button) continue;
    let previousIcon;
    const refresh = () => {
      const { icon, label } = describe(id, button.textContent, button.getAttribute('aria-pressed'));
      if (previousIcon !== icon) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${shapes[icon]}</svg>`;
        button.style.setProperty('--button-icon', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
        previousIcon = icon;
      }
      if (button.title !== label) button.title = label;
      if (id === 'capture-toggle' || !button.hasAttribute('aria-label')) button.setAttribute('aria-label', label);
    };
    button.classList.add('icon-button');
    refresh();
    // Keep text nodes intact: the existing settings IPC uses them as state labels.
    new MutationObserver(refresh).observe(button, {
      childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['aria-pressed'],
    });
  }
})();
