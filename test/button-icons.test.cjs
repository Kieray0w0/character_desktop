'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, shapes } = require('../web/button-icons.js');

test('action icons use distinct symbols and camera labels follow pressed state', () => {
  const cases = [['voice-stop','停止','stop'], ['settings-toggle','设置','settings'],
    ['hide','隐藏','hide'], ['settings-close','收起','collapse'], ['capture-stop','关闭','cameraOff'],
    ['calibrate','校准正面姿态','calibrate'], ['retry','重新加载角色','retry'], ['quit','退出桌面程序','quit']];
  for (const [id, label, icon] of cases) {
    assert.deepEqual(describe(id, label), { label, icon });
    assert.ok(shapes[icon]);
  }
  assert.equal(describe('capture-toggle', 'stale label', 'true').label, '关闭摄像头动捕');
  assert.equal(describe('capture-toggle', 'stale label', 'false').icon, 'camera');
  assert.equal(describe('open-website', 'Kieray0w0.github.io'), null);
});

test('icon decoration preserves settings text and syncs dynamic title without changing handlers', () => {
  const attrs = new Map([['aria-pressed', 'false']]);
  const styles = new Map();
  const button = { textContent: '开启摄像头动捕', title: '',
    getAttribute: key => attrs.get(key), hasAttribute: key => attrs.has(key),
    setAttribute: (key, value) => attrs.set(key, value),
    classList: { add() {} }, style: { setProperty: (key, value) => styles.set(key, value) } };
  let refresh;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/button-icons.js'), 'utf8'), {
    document: { getElementById: id => id === 'capture-toggle' ? button : null },
    MutationObserver: class { constructor(cb) { refresh = cb; } observe() {} },
  });
  assert.equal(button.textContent, '开启摄像头动捕');
  assert.equal(button.title, button.textContent);
  const previous = styles.get('--button-icon');
  attrs.set('aria-pressed', 'true');
  button.textContent = '关闭摄像头动捕';
  refresh();
  assert.equal(button.title, '关闭摄像头动捕');
  assert.equal(attrs.get('aria-label'), button.title);
  assert.notEqual(styles.get('--button-icon'), previous);
  refresh();
  assert.equal(button.textContent, '关闭摄像头动捕');
});
