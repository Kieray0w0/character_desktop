'use strict';

// Visual-only fixtures. No Electron bridge, models, audio or camera is started.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'web');
const bridge = `
const callbacks = [];
const state = () => ({theme: localStorage.getItem('preview-theme') || 'classic'});
window.desktop = {onEvent: cb => callbacks.push(cb), getState: async () => state(),
  setTheme: async theme => {localStorage.setItem('preview-theme', theme); callbacks.forEach(cb => cb({type:'state',state:state()})); return state();}};
addEventListener('storage', () => callbacks.forEach(cb => cb({type:'state',state:state()})));
addEventListener('DOMContentLoaded', () => {
  const byId = id => document.getElementById(id);
  if (byId('model-controls')) byId('model-controls').disabled = false;
  if (byId('character-select')) byId('character-select').innerHTML = '<option>纳西索斯 / Narcissus</option>';
  if (byId('skin-select')) byId('skin-select').innerHTML = '<option>涟漪的裙裾 / Ripples Yet to Bloom</option>';
  if (byId('capture-toggle')) byId('capture-toggle').disabled = false;
  if (byId('capture-status')) byId('capture-status').textContent = '准备就绪。此页面仅预览外观，不使用摄像头。';
  if (!document.body.classList.contains('settings-window')) {
    document.body.classList.remove('controls-hidden');
    byId('loading').hidden = true;
    byId('capture-badge').hidden = false;
    byId('subtitle').hidden = false;
    byId('voice-label').textContent = '夜间 / Night';
    byId('voice-zh').textContent = '晚风拂过书页，故事还没有结束。';
    byId('voice-en').textContent = 'The evening breeze turns a page. Our story is not over yet.';
  }
});`;
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/compact') {
    const compact = req.url === '/compact';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Interface theme preview</title></head><body style="margin:0;padding:24px;background:#9a9790;font:14px Georgia"><p>Settings and subtitle preview (no camera or audio) | <a href="/compact">Compact</a> | <a href="/">Normal</a></p><div style="display:flex;gap:24px"><iframe title="Settings" src="/settings.html" style="width:${compact ? 280 : 360}px;height:${compact ? 360 : 650}px;border:0"></iframe><iframe title="Companion" src="/index.html" style="width:${compact ? 280 : 400}px;height:${compact ? 420 : 600}px;border:0"></iframe></div></body></html>`);
  }
  if (req.url === '/bridge.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bridge); }
  const name = req.url.slice(1);
  if (!['settings.html', 'index.html', 'desktop.css', 'themes.css', 'theme.js', 'button-icons.css', 'button-icons.js'].includes(name)) { res.writeHead(404); return res.end(); }
  let content = fs.readFileSync(path.join(root, name), 'utf8');
  const html = name.endsWith('.html');
  if (html) content = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('</head>', '<script src="bridge.js"></script><script src="theme.js" defer></script><script src="button-icons.js" defer></script></head>');
  res.setHeader('Content-Type', (html ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript') + '; charset=utf-8');
  res.end(content);
});
server.listen(0, '127.0.0.1', () => console.log('Theme preview: http://127.0.0.1:' + server.address().port));
