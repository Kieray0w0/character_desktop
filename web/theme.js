'use strict';

(() => {
  const desktop = window.desktop;
  const picker = document.getElementById('interface-theme');
  const status = document.getElementById('theme-status');
  let current = 'classic';
  let receivedState = false;
  let pending = false;
  function apply(state) {
    current = state?.theme === 'archive' ? 'archive' : 'classic';
    document.documentElement.dataset.theme = current;
    if (picker) { picker.value = current; picker.disabled = pending; }
  }
  desktop.onEvent(event => {
    if (event.type !== 'state') return;
    receivedState = true;
    apply(event.state);
  });
  desktop.getState().then(state => { if (!receivedState) apply(state); }).catch(() => {
    if (status) { status.hidden = false; status.textContent = '无法读取界面设置，请重新打开设置窗口。'; }
  });
  picker?.addEventListener('change', async () => {
    if (pending) return;
    pending = true;
    picker.disabled = true;
    status.hidden = true;
    try { apply(await desktop.setTheme(picker.value)); }
    catch {
      picker.value = current;
      status.textContent = '界面皮肤保存失败，请重试。';
      status.hidden = false;
    } finally { pending = false; picker.disabled = false; }
  });
})();
