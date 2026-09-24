'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { inflateSync } = require('node:zlib');
const native = require('../native.cjs');

function temporaryDirectory(t) {
  const parent = path.join(os.tmpdir(), 'opencode');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'character-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: -1280, y: -100, width: 1280, height: 984 };

test('scale sanitization rejects non-numbers and bounds finite numbers', () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, '110', {}, []]) {
    assert.equal(native.clampScale(invalid), 100);
  }
  assert.equal(native.clampScale(-100), 70);
  assert.equal(native.clampScale(300), 150);
  assert.equal(native.clampScale(112.5), 112.5);
});

test('window bounds keep dimensions finite and fit work areas at every scale', () => {
  for (const scale of [70, 100, 150, 112.5, NaN, Infinity, '90']) {
    for (const area of [primary, secondary, { x: 10, y: 20, width: 200, height: 240 }]) {
      const result = native.fitBounds({ scale, x: area.x - 10000, y: area.y + 10000 }, [area]);
      assert.ok(Object.values(result).every(Number.isSafeInteger));
      assert.ok(result.width > 0 && result.height > 0);
      assert.ok(result.x >= area.x && result.y >= area.y);
      assert.ok(result.x + result.width <= area.x + area.width);
      assert.ok(result.y + result.height <= area.y + area.height);
    }
  }
  assert.deepEqual(native.fitBounds({ scale: 100, x: 20, y: 30 }, [primary]),
    { x: 20, y: 30, width: 400, height: 600 });
  assert.deepEqual(native.fitBounds({ scale: 150, x: 20, y: 30 }, [primary]),
    { x: 20, y: 30, width: 600, height: 900 });
  assert.throws(() => native.fitBounds({}, [{ ...primary, width: NaN }]), /work area/);
});

test('position restore selects negative-coordinate monitors and recovers removed monitors', () => {
  const saved = { scale: 100, x: -1100, y: -50 };
  assert.deepEqual(native.fitBounds(saved, [primary, secondary]),
    { x: -1100, y: -50, width: 400, height: 600 });
  assert.deepEqual(native.fitBounds(saved, [primary]),
    { x: 0, y: 0, width: 400, height: 600 });
  for (const x of [NaN, Infinity, 1e100, '100']) {
    assert.deepEqual(native.fitBounds({ x, y: 40 }, [primary]), native.fitBounds({}, [primary]));
  }
});

test('resize projects all four corners proportionally, fixes opposite anchors and clamps scale', () => {
  const area = { x: -2000, y: -2000, width: 6000, height: 6000 };
  const bounds = { x: 0, y: 0, width: 400, height: 600 };
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const sx = corner.endsWith('e') ? 1 : -1;
    const sy = corner.startsWith('s') ? 1 : -1;
    for (const [distance, scale] of [[0, 100], [0.1, 110], [-0.1, 90], [-10, 70], [10, 150]]) {
      const result = native.resizeBounds(bounds, corner, { x: 400 * distance * sx, y: 600 * distance * sy }, area);
      assert.ok(Math.abs(result.scale - scale) < 1e-8);
      assert.equal(result.width, 4 * scale);
      assert.equal(result.height, 6 * scale);
      assert.equal(result.x + (sx < 0 ? result.width : 0), sx < 0 ? 400 : 0);
      assert.equal(result.y + (sy < 0 ? result.height : 0), sy < 0 ? 600 : 0);
    }
    const perpendicular = native.resizeBounds(bounds, corner, { x: 600 * sx, y: -400 * sy }, area);
    assert.deepEqual(perpendicular, { ...bounds, scale: 100 });
  }
  assert.throws(() => native.resizeBounds(bounds, 'xx', { x: 0, y: 0 }, area), /geometry/);
  assert.throws(() => native.resizeBounds(bounds, 'se', { x: Infinity, y: 0 }, area), /geometry/);
});

test('resize uses DIP bounds without a start jump across DPI, work-area edges and tiny displays', () => {
  for (const area of [primary, secondary, { x: 1920, y: -360, width: 1536, height: 864 },
    { x: -500, y: 50, width: 200, height: 240 }]) {
    for (const scaleFactor of [1, 1.25, 1.5, 2]) {
      for (const scale of [70, 100, 112.37, 150]) {
        for (const corner of ['nw', 'ne', 'sw', 'se']) {
          const initial = native.fitBounds({ scale, x: area.x, y: area.y }, [area]);
          const start = native.resizeBounds(initial, corner, { x: 0, y: 0 }, { ...area, scaleFactor });
          const { scale: effective, ...geometry } = start;
          assert.deepEqual(geometry, initial);
          assert.ok(effective >= 70 && effective <= 150);
          for (const delta of [{ x: 10000, y: 10000 }, { x: -10000, y: -10000 }]) {
            const result = native.resizeBounds(initial, corner, delta, { ...area, scaleFactor });
            assert.ok(result.x >= area.x && result.y >= area.y);
            assert.ok(result.x + result.width <= area.x + area.width);
            assert.ok(result.y + result.height <= area.y + area.height);
            assert.ok(Math.abs(result.width * 3 - result.height * 2) <= 2);
            assert.ok(result.scale >= 70 && result.scale <= 150);
          }
        }
      }
    }
  }
  const initial = { x: 1500, y: 400, width: 400, height: 600 };
  const limited = native.resizeBounds(initial, 'se', { x: 1000, y: 1000 }, primary);
  assert.equal(limited.x, initial.x);
  assert.equal(limited.y, initial.y);
  assert.equal(limited.width, 420);
  assert.equal(limited.height, 630);
  const fallback = native.resizeBounds({ x: -200, y: -300, width: 400, height: 600 }, 'nw', { x: -1000, y: -1000 }, primary);
  assert.equal(fallback.x, 0);
  assert.equal(fallback.y, 0);
});

test('settings snapshots accept only bounded plain JSON records and typed control fields', () => {
  const snapshot = { controls: { speed: { value: '1', disabled: false, hidden: true, text: 'Speed' },
    'voice-enabled': { checked: true } }, skins: [{ value: 'default', text: 'Default' }] };
  assert.deepEqual(native.sanitizeSettingsSnapshot(snapshot), snapshot);
  assert.notEqual(native.sanitizeSettingsSnapshot(snapshot), snapshot);
  const invalid = [null, [], {}, { ...snapshot, extra: true }, { controls: [], skins: [] },
    { controls: {}, skins: {} }, { controls: { x: { checked: 'true' } }, skins: [] },
    { controls: { x: { value: {} } }, skins: [] }, { controls: { x: { value: Infinity } }, skins: [] },
    { controls: { x: { onclick: 'quit()' } }, skins: [] }, { controls: { x: new Date() }, skins: [] },
    { controls: {}, skins: [{ value: 'x', text: 'X', extra: true }] },
    { controls: {}, skins: [{ value: 'x' }] }, Object.create(snapshot),
    { controls: { x: { text: '\u00e9'.repeat(20000) } }, skins: [] }];
  for (const value of invalid) assert.equal(native.sanitizeSettingsSnapshot(value), null);
  const getter = { controls: {}, get skins() { throw new Error('Never invoke accessors'); } };
  assert.equal(native.sanitizeSettingsSnapshot(getter), null);
  const bounded = { controls: { x: { text: '' } }, skins: [] };
  bounded.controls.x.text = 'a'.repeat(32768 - Buffer.byteLength(JSON.stringify(bounded)));
  assert.ok(native.sanitizeSettingsSnapshot(bounded));
  bounded.controls.x.text += 'a';
  assert.equal(native.sanitizeSettingsSnapshot(bounded), null);
});

const settingsCommands = [
  { id: 'character-select', event: 'change', value: 'character' },
  { id: 'skin-select', event: 'change', value: 'default' },
  { id: 'speed', event: 'input', value: '0.25' }, { id: 'speed', event: 'input', value: 3 },
  { id: 'voice-enabled', event: 'change', checked: true },
  { id: 'auto-interact', event: 'change', checked: false },
  ...['capture-toggle', 'calibrate', 'retry', 'quit'].map(id => ({ id, event: 'click' })),
];
const invalidSettingsCommands = [null, [], {}, { id: 'eval', event: 'click' },
  { id: 'size', event: 'input', value: 100 }, { id: 'topmost', event: 'change', checked: true },
  { id: 'quit', event: 'click', value: 'anything' }, { id: 'retry', event: 'change' },
  { id: 'character-select', event: 'change', value: 'a'.repeat(81) },
  { id: 'skin-select', event: 'change', value: 1 },
  ...[NaN, Infinity, '', ' ', 'NaN', 'Infinity', 0.24, '3.01', null, true, [], {}]
    .map(value => ({ id: 'speed', event: 'input', value })),
  { id: 'voice-enabled', event: 'change', checked: 'true' },
  { id: 'auto-interact', event: 'click', checked: true },
];

test('settings action allowlist and JPEG preview limits reject malformed or arbitrary payloads', () => {
  for (const command of settingsCommands) assert.equal(native.isSettingsCommand(command), true);
  for (const command of invalidSettingsCommands) assert.equal(native.isSettingsCommand(command), false);
  for (const command of settingsCommands) {
    assert.equal(native.isSettingsCommand({ ...command, arbitrary: 'code()' }), false);
  }
  for (const value of [null, 'data:image/jpeg;base64,/9j/AA==']) assert.equal(native.isSettingsPreview(value), true);
  const prefix = 'data:image/jpeg;base64,';
  const largest = prefix + 'AAAA'.repeat(Math.floor((128 * 1024 - prefix.length) / 4));
  assert.equal(native.isSettingsPreview(largest), true);
  assert.equal(native.isSettingsPreview(largest + 'AAAA'), false);
  for (const value of [undefined, {}, '', 'https://example.com', 'data:image/png;base64,AAAA',
    'data:image/jpeg;base64,', 'data:image/jpeg;base64,AA=', 'data:image/jpeg;base64,AA==\n',
    'data:image/jpeg;base64,!!!!', 'data:image/jpeg;base64,' + 'AAAA'.repeat(32768)]) {
    assert.equal(native.isSettingsPreview(value), false);
  }
});

test('preferences round-trip atomically and discard invalid or oversized persisted input', t => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'data', 'desktop-state.json');
  assert.deepEqual(native.readPreferences(file), native.DEFAULTS);
  const expected = { topmost: false, scale: 125, x: -100, y: 12 };
  native.writePreferences(file, { ...expected, secret: 'not persisted' });
  assert.deepEqual(native.readPreferences(file), expected);
  native.writePreferences(file, { scale: 1, topmost: 'true', x: Infinity, y: 0 });
  assert.deepEqual(native.readPreferences(file), { topmost: true, scale: 70 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['desktop-state.json']);
  for (const content of ['{', 'null', '[]', '"string"', '{"scale":"130","x":1e999,"y":0}', ' '.repeat(4097)]) {
    fs.writeFileSync(file, content);
    assert.deepEqual(native.readPreferences(file), native.DEFAULTS);
  }
});

test('decoded path guard rejects traversal, ambiguous Windows paths and malformed escapes', () => {
  const prefix = '/secret/';
  for (const suffix of ['../x', '%2e%2e/x', 'a/%2e%2e/x', '%2e%2e%2fx',
    '%5c..%5cx', '..\\x', 'C:%5cx', 'index.html:secret', '%00x', '%0ax',
    '%', '%ff', './x', 'a//x', 'x.', 'x%20', '/index.html', 'x#fragment']) {
    assert.equal(native.resolveRequestPath(prefix + suffix, prefix), null, suffix);
  }
  assert.equal(native.resolveRequestPath('/else/index.html', prefix), null);
  assert.equal(native.resolveRequestPath('http://localhost/secret/index.html', prefix), null);
  assert.deepEqual(native.resolveRequestPath(prefix, prefix), ['index.html']);
  assert.deepEqual(native.resolveRequestPath(`${prefix}%2ex`, prefix), ['.x']);
  assert.deepEqual(native.resolveRequestPath(`${prefix}model/my%20file.json?v=1`, prefix), ['model', 'my file.json']);
});

async function serverFixture(t) {
  const directory = temporaryDirectory(t);
  const root = path.join(directory, 'web');
  fs.mkdirSync(root);
  const files = {
    'index.html': '<!doctype html><title>Local fixture</title>',
    'settings.html': '<!doctype html><title>Settings fixture</title>',
    'app.js': 'window.fixture = true;', 'app.css': 'body{}',
    'model.json': '{}', 'shader.wasm': Buffer.from([0, 97, 115, 109]),
    'track.mp3': '0123456789', 'empty.mp3': '', 'image.svg': '<svg/>',
    'font.woff2': 'font', 'unknown.bin': 'binary',
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name), body);
  fs.mkdirSync(path.join(root, 'folder'));
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'not public');
  const server = await native.createStaticServer(root);
  t.after(() => server.close());
  const url = new URL(server.baseURL);
  const request = (suffix = '', options = {}) => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + suffix,
      ...options, agent: false,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  return { server, url, request, root, outside };
}

test('HTTP serves only local files with correct MIME, CSP and GET/HEAD semantics', async t => {
  const { request, server } = await serverFixture(t);
  assert.match(server.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/$/);
  for (const [filename, mime] of [
    ['index.html', 'text/html; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'], ['model.json', 'application/json; charset=utf-8'],
    ['shader.wasm', 'application/wasm'], ['track.mp3', 'audio/mpeg'],
    ['image.svg', 'image/svg+xml'], ['font.woff2', 'font/woff2'], ['unknown.bin', 'application/octet-stream'],
  ]) {
    const response = await request(filename);
    assert.equal(response.status, 200, filename);
    assert.equal(response.headers['content-type'], mime);
    assert.equal(response.headers['content-length'], String(response.body.length));
    assert.equal(response.headers['content-security-policy'], native.CSP);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.match(response.headers['permissions-policy'], /microphone=\(\)/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await request()).status, 200);
  assert.equal((await request('app.js?v=1')).status, 200);
  const head = await request('track.mp3', { method: 'HEAD', headers: { Range: 'bytes=1-2' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], '10');
  assert.equal(head.body.length, 0);
  const post = await request('index.html', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.equal((await request('folder')).status, 404);
  assert.equal((await request('folder/')).status, 404);
  assert.equal((await request('missing')).status, 404);
  const settings = await request('settings.html');
  assert.equal(settings.status, 200);
  assert.equal(settings.headers['content-security-policy'], native.SETTINGS_CSP);
  assert.doesNotMatch(native.SETTINGS_CSP, /unsafe-eval|wasm-unsafe-eval/);
  assert.match(native.SETTINGS_CSP, /media-src 'none'/);
  assert.match(settings.headers['permissions-policy'], /camera=\(\)/);
});

test('HTTP supports MP3 byte ranges, suffixes and unsatisfiable requests', async t => {
  const { request } = await serverFixture(t);
  for (const [range, body, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-999', '89', 'bytes 8-9/10'],
    ['bytes=-999', '0123456789', 'bytes 0-9/10'],
  ]) {
    const response = await request('track.mp3', { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.body.toString(), body);
    assert.equal(response.headers['content-range'], contentRange);
    assert.equal(response.headers['content-length'], String(body.length));
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=a-b',
    'bytes=0-1,3-4', 'bytes=99999999999999999-', 'items=0-1']) {
    const response = await request('track.mp3', { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers['content-range'], 'bytes */10');
  }
  assert.equal((await request('empty.mp3')).status, 200);
  const empty = await request('empty.mp3', { headers: { Range: 'bytes=0-' } });
  assert.equal(empty.status, 416);
  assert.equal(empty.headers['content-range'], 'bytes */0');
});

test('HTTP denies forged hosts, foreign origins, token guessing and traversal', async t => {
  const { request, url } = await serverFixture(t);
  for (const host of ['localhost:' + url.port, 'evil.example', '127.0.0.1', url.host + '.evil']) {
    assert.equal((await request('index.html', { headers: { Host: host } })).status, 403);
  }
  assert.equal((await request('index.html', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('index.html', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('index.html', { headers: { Origin: url.origin } })).status, 200);
  assert.equal((await request('', { path: '/index.html' })).status, 404);
  assert.equal((await request('', { path: '/wrong/index.html' })).status, 404);
  for (const suffix of ['../outside/secret.txt', '%2e%2e/outside/secret.txt',
    '%2e%2e%2foutside/secret.txt', '%2e%2e%5coutside%5csecret.txt',
    'folder/%2e%2e/index.html', 'index.html%00', 'index.html::$DATA', 'index.html%20', '%ff']) {
    assert.equal((await request(suffix)).status, 404, suffix);
  }
});

test('HTTP refuses symlinks/junctions that escape the web root', async t => {
  const { request, root, outside } = await serverFixture(t);
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const response = await request('escape/secret.txt');
  assert.equal(response.status, 403);
  assert.equal(response.body.length, 0);
});

test('HTTP cancellation during filesystem awaits and streaming closes each descriptor once', async t => {
  for (const phase of ['realpath', 'open', 'stat', 'stream']) {
    await t.test(phase, { timeout: 5000 }, async t => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const responseClosed = Promise.withResolvers();
      const handlerFinished = Promise.withResolvers();
      const streamClosed = Promise.withResolvers();
      const createServer = http.createServer;
      t.mock.method(http, 'createServer', (options, handler) => createServer(options, (request, response) => {
        if (!request.url.endsWith('/track.mp3')) return handler(request, response);
        response.once('close', responseClosed.resolve);
        return handler(request, response).finally(handlerFinished.resolve);
      }));
      const { url, root, request } = await serverFixture(t);
      const target = path.join(root, 'track.mp3');
      let handle;
      let stream;
      let opens = 0;
      let stats = 0;
      let closes = 0;
      let streams = 0;
      const realpath = fs.promises.realpath;
      t.mock.method(fs.promises, 'realpath', async filename => {
        const result = await realpath(filename);
        if (filename === target && phase === 'realpath') {
          entered.resolve();
          await release.promise;
        }
        return result;
      });
      const open = fs.promises.open;
      t.mock.method(fs.promises, 'open', async (...args) => {
        const file = await open(...args);
        if (args[0] !== target) return file;
        handle = file;
        opens++;
        const close = file.close.bind(file);
        t.mock.method(file, 'close', () => { closes++; return close(); });
        const stat = file.stat.bind(file);
        t.mock.method(file, 'stat', async () => {
          stats++;
          const result = await stat();
          if (phase === 'stat') {
            entered.resolve();
            await release.promise;
          }
          return result;
        });
        const createReadStream = file.createReadStream.bind(file);
        t.mock.method(file, 'createReadStream', options => {
          streams++;
          stream = createReadStream(options);
          stream.once('close', streamClosed.resolve);
          // Hold the real file-backed stream open until the client cancels.
          if (phase === 'stream') t.mock.method(stream, '_read', () => entered.resolve());
          return stream;
        });
        if (phase === 'open') {
          entered.resolve();
          await release.promise;
        }
        return file;
      });
      const client = http.get(new URL('track.mp3', url), { agent: false });
      client.on('error', () => {}); // A client-side cancellation is intentional.
      t.after(async () => {
        client.destroy();
        release.resolve();
        stream?.destroy();
        if (handle && handle.fd !== -1) await handle.close();
      });
      await entered.promise;
      client.destroy();
      await responseClosed.promise;
      release.resolve();
      await handlerFinished.promise;
      if (phase === 'stream') await streamClosed.promise;
      assert.equal(opens, phase === 'realpath' ? 0 : 1);
      assert.equal(stats, ['realpath', 'open'].includes(phase) ? 0 : 1);
      assert.equal(streams, phase === 'stream' ? 1 : 0);
      assert.equal(closes, opens);
      if (handle) assert.equal(handle.fd, -1);
      if (stream) assert.equal(stream.destroyed, true);
      assert.equal((await request('app.js')).status, 200);
    });
  }
});

test('outbound request allowlist requires the app origin and token prefix', () => {
  const base = 'http://127.0.0.1:12345/token/';
  for (const url of [base + 'index.html', base + 'model/data.json?v=2', 'data:image/png;base64,AA==', `blob:${base}id`]) {
    assert.equal(native.isAllowedRequest(url, base), true, url);
  }
  for (const url of ['https://example.com', 'file:///C:/secret', 'ws://127.0.0.1:12345/token/',
    'http://127.0.0.1:12346/token/x', 'http://localhost:12345/token/x',
    'http://127.0.0.1:12345/token-evil/x', base + '../x', base + '%2e%2e%2fx',
    'http://user:pass@127.0.0.1:12345/token/x', 'not a URL']) {
    assert.equal(native.isAllowedRequest(url, base), false, url);
  }
});

test('media permission details must identify only video on the exact main document', () => {
  const index = 'http://127.0.0.1:12345/token/index.html';
  const details = { isMainFrame: true, requestingUrl: index, mediaTypes: ['video'] };
  assert.equal(native.isVideoPermissionRequest('media', details, index), true);
  assert.equal(native.isVideoPermissionRequest('media', { ...details, securityOrigin: new URL(index).origin + '/' }, index), true);
  for (const permission of ['microphone', 'camera', 'display-capture', 'notifications', 'fullscreen', 'unknown']) {
    assert.equal(native.isVideoPermissionRequest(permission, details, index), false);
  }
  for (const changed of [undefined, {}, { ...details, mediaTypes: [] }, { ...details, mediaTypes: ['audio'] },
    { ...details, mediaTypes: ['video', 'audio'] }, { ...details, mediaTypes: undefined },
    { ...details, mediaTypes: 'video' }, { ...details, isMainFrame: false },
    { ...details, requestingUrl: index + '#hash' }, { ...details, securityOrigin: 'https://evil.example' }]) {
    assert.equal(native.isVideoPermissionRequest('media', changed, index), false);
  }
});

test('tray buffer is a CRC-valid RGBA PNG rather than SVG', () => {
  const png = native.createTrayPNG();
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const types = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal(png.readUInt32BE(offset + 8 + length), (crc ^ 0xffffffff) >>> 0);
    if (type === 'IHDR') {
      assert.equal(data.readUInt32BE(0), 32);
      assert.equal(data.readUInt32BE(4), 32);
      assert.equal(data[9], 6);
    }
    if (type === 'IDAT') assert.equal(inflateSync(data).length, 32 * 129);
    types.push(type);
    offset += length + 12;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
});

// Exercise the real main/preload entry points without Electron or a production
// permission bypass. Native dialogs, displays and timers are test doubles only.
async function bootShell(t, directory, { readyBeforeLoad = false } = {}) {
  const app = new EventEmitter();
  app.quit = () => app.emit('before-quit');
  t.after(() => app.quit());
  directory ??= temporaryDirectory(t);
  const indexURL = 'http://127.0.0.1:12345/token/index.html';
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (name, callback) => handlers.set(name, callback);
  const power = new EventEmitter();
  app.commandLine = { appendSwitch() {}, hasSwitch: () => false };
  app.getPath = () => directory;
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  let window;
  const windows = [];
  let tray;
  const timers = new Set();
  const timer = (callback, delay) => { const value = { callback, delay }; timers.add(value); return value; };
  const display = new EventEmitter();
  display.getPrimaryDisplay = () => ({ id: 1, workArea: primary });
  display.getAllDisplays = () => [{ id: 1, workArea: primary }, { id: 2, workArea: secondary }];
  display.getDisplayMatching = bounds => ({ workArea: bounds.x < 0 ? secondary : primary });
  display.cursor = { x: 0, y: 0 };
  display.getCursorScreenPoint = () => display.cursor;
  const permissions = {};
  const dialogs = [];
  const errors = [];
  const isolated = new EventEmitter();
  isolated.setProxy = async () => {};
  isolated.webRequest = { onBeforeRequest: callback => { isolated.request = callback; } };
  isolated.setPermissionCheckHandler = callback => { permissions.check = callback; };
  isolated.setPermissionRequestHandler = callback => { permissions.request = callback; };
  isolated.setDevicePermissionHandler = callback => { permissions.device = callback; };
  isolated.setDisplayMediaRequestHandler = callback => { permissions.display = callback; };
  class MockWindow extends EventEmitter {
    constructor(options) {
      super();
      window ??= this;
      windows.push(this);
      this.options = options;
      this.minimumSize = [options.minWidth || 0, options.minHeight || 0];
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: indexURL }, getURL: () => this.url || indexURL,
        isDestroyed: () => Boolean(this.destroyed),
        send: (_channel, event) => this.events.push(event),
        setAudioMuted: value => { this.muted = value; },
        setWindowOpenHandler: callback => { this.openHandler = callback; },
      });
      this.events = [];
      this.loadURLs = [];
      this.reloads = [];
    }
    setMenu() {}
    isDestroyed() { return Boolean(this.destroyed); }
    isVisible() { return Boolean(this.visible); }
    isMinimized() { return Boolean(this.minimized); }
    isFocused() { return this.focused !== false; }
    getBounds() { return { ...this.bounds }; }
    getMinimumSize() { return [...this.minimumSize]; }
    setMinimumSize(width, height) { this.minimumSize = [width, height]; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    setBounds(bounds) { this.bounds = bounds; this.emit('move'); }
    setPosition(x, y) { this.setBounds({ ...this.bounds, x, y }); }
    setAlwaysOnTop(value) { this.topmost = value; }
    show() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    focus() {}
    restore() { this.minimized = false; this.emit('restore'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadURL(url) {
      this.url = url;
      this.webContents.mainFrame.url = url;
      this.loadURLs.push(url);
      this.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
      if (this.loadURLs.length > 1) {
        return new Promise((resolve, reject) => this.reloads.push({
          resolve, reject,
          complete: () => { this.webContents.emit('did-finish-load'); resolve(); },
        }));
      }
      if (this === window && readyBeforeLoad) {
        this.emit('ready-to-show');
        return new Promise(resolve => {
          this.finishInitialLoad = () => { this.webContents.emit('did-finish-load'); resolve(); };
        });
      }
      this.webContents.emit('did-finish-load');
      this.emit('ready-to-show');
    }
  }
  class MockTray extends EventEmitter {
    constructor() { super(); tray = this; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; this.updates = (this.updates || 0) + 1; }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
  }
  const externalURLs = [];
  const externalShell = { openExternal: async url => { externalURLs.push(url); } };
  const electron = {
    shell: externalShell,
    app, BrowserWindow: MockWindow, Tray: MockTray, ipcMain: ipc, screen: display,
    powerMonitor: power, Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromBuffer: value => value },
    session: { fromPartition: (partition, options) => {
      assert.equal(partition, 'character-desktop');
      assert.equal(options.cache, false);
      return isolated;
    } },
    dialog: {
      showErrorBox: (title, message) => errors.push({ title, message }),
      showMessageBox: (_owner, options) => new Promise(resolve => dialogs.push({ options, resolve })),
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  vm.runInNewContext(source, {
    require: name => {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return { ...fs, statSync: () => ({ isFile: () => true }) };
      if (name === './native.cjs') return { ...native, createStaticServer: async () => ({
        indexURL, baseURL: 'http://127.0.0.1:12345/token/', close: async () => {},
      }) };
      return require(name);
    },
    __dirname: path.join(__dirname, '..'), process: { env: {} }, console,
    setTimeout: timer, clearTimeout: value => timers.delete(value),
    setInterval: timer, clearInterval: value => timers.delete(value),
  }, { filename: 'main.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(window);
  assert.deepEqual(errors, []);
  const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return {
    externalURLs, externalShell,
    window, windows, tray, app, permissions, dialogs, errors, power, display, timers, isolated, handlers, sender, ipc, directory,
    invoke: (name, ...args) => handlers.get(`desktop:${name}`)(sender, ...args),
    send: (name, ...args) => ipc.emit(`desktop:${name}`, sender, ...args),
    settingsInvoke: (name, ...args) => {
      const contents = windows.at(-1).webContents;
      return handlers.get(`desktop:${name}`)({ sender: contents, senderFrame: contents.mainFrame }, ...args);
    },
    settingsSend: (name, ...args) => {
      const contents = windows.at(-1).webContents;
      return ipc.emit(`desktop:${name}`, { sender: contents, senderFrame: contents.mainFrame }, ...args);
    },
    media: (details = {}) => new Promise(resolve => permissions.request(window.webContents, 'media', resolve, {
      isMainFrame: true, requestingUrl: indexURL, mediaTypes: ['video'], ...details,
    })),
  };
}

test('website link opens only the fixed HTTPS site from the trusted settings frame', async t => {
  const shell = await bootShell(t);
  assert.throws(() => shell.invoke('openWebsite'), /Untrusted/);
  await shell.invoke('openSettings');
  assert.deepEqual(shell.externalURLs, []);
  await shell.settingsInvoke('openWebsite', 'file:///C:/untrusted.exe');
  assert.deepEqual(shell.externalURLs, ['https://Kieray0w0.github.io/']);
  const contents = shell.windows.at(-1).webContents;
  const open = shell.handlers.get('desktop:openWebsite');
  assert.throws(() => open({ sender: contents, senderFrame: { url: contents.mainFrame.url } }), /Untrusted/);
  assert.throws(() => open({ sender: {}, senderFrame: contents.mainFrame }), /Untrusted/);
  assert.equal(shell.window.isVisible(), true);
  shell.externalShell.openExternal = async () => { throw new Error('Browser unavailable'); };
  await assert.rejects(shell.settingsInvoke('openWebsite'), /Browser unavailable/);
});

test('main shell security, IPC validation, close/hide, blur and suspend lifecycle', async t => {
  const shell = await bootShell(t);
  const { window, invoke, tray, power } = shell;
  assert.equal(window.options.width, 400);
  assert.equal(window.options.height, 600);
  for (const key of ['transparent', 'skipTaskbar']) assert.equal(window.options[key], true);
  for (const key of ['frame', 'resizable', 'maximizable', 'fullscreenable']) assert.equal(window.options[key], false);
  for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(window.options.webPreferences[key], true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.backgroundThrottling, false);
  assert.equal(window.openHandler().action, 'deny');
  for (const [name, details] of [
    ['will-navigate', { url: 'https://example.com' }],
    ['will-frame-navigate', { url: shell.sender.senderFrame.url, isMainFrame: false }],
    ['will-redirect', {}], ['content-bounds-updated', {}], ['will-attach-webview', {}],
  ]) {
    let denied = false;
    window.webContents.emit(name, { ...details, preventDefault: () => { denied = true; } });
    assert.equal(denied, true, name);
  }
  let downloadDenied = false;
  shell.isolated.emit('will-download', { preventDefault: () => { downloadDenied = true; } });
  assert.equal(downloadDenied, true);
  shell.isolated.request({ url: 'https://example.com' }, result => assert.equal(result.cancel, true));
  shell.isolated.request({ url: shell.sender.senderFrame.url }, result => assert.equal(result.cancel, false));
  assert.equal(invoke('getState').hidden, false);
  assert.equal(invoke('setScale', 900).scale, 150);
  assert.equal(invoke('setScale', 0).scale, 70);
  for (const invalid of [NaN, Infinity, '100', null]) assert.throws(() => invoke('setScale', invalid), /finite/);
  assert.throws(() => invoke('setTopmost', 1), /boolean/);
  assert.equal(invoke('setTopmost', false).topmost, false);
  assert.equal(window.topmost, false);
  const get = shell.handlers.get('desktop:getState');
  assert.throws(() => get({ ...shell.sender, senderFrame: { url: shell.sender.senderFrame.url } }), /Untrusted/);
  assert.throws(() => get({ sender: {}, senderFrame: shell.sender.senderFrame }), /Untrusted/);
  window.webContents.mainFrame.url += '#wrong';
  assert.throws(() => get(shell.sender), /Untrusted/);
  window.webContents.mainFrame.url = 'http://127.0.0.1:12345/token/index.html';
  const count = window.events.length;
  window.emit('blur');
  assert.equal(window.events.length, count);
  assert.equal(window.muted, false);
  let prevented = false;
  window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.destroyed, undefined);
  assert.equal(invoke('getState').hidden, true);
  assert.equal(window.muted, true);
  assert.ok(window.events.some(event => event.type === 'visibility' && event.visible === false));
  tray.menu.find(item => item.label === 'Show').click();
  assert.equal(invoke('getState').hidden, false);
  window.minimized = true;
  window.emit('minimize');
  assert.equal(invoke('getState').hidden, true);
  window.restore();
  assert.equal(invoke('getState').hidden, false);
  power.emit('suspend');
  assert.equal(invoke('getState').hidden, true);
  power.emit('resume');
  assert.equal(invoke('getState').hidden, false);
  tray.menu.find(item => item.label === 'Settings').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shell.windows.length, 2);
  assert.equal(window.events.at(-1).type, 'settings-visibility');
  assert.equal(window.events.at(-1).visible, true);
  shell.app.emit('second-instance');
  assert.equal(invoke('getState').hidden, false);
  shell.app.quit();
  assert.equal(window.destroyed, true);
  assert.equal(tray.destroyed, true);
});

test('main camera prompts each request and invalidates approvals across hide/show', async t => {
  const shell = await bootShell(t);
  assert.equal(shell.permissions.check(), false);
  assert.equal(shell.permissions.device(), false);
  for (const details of [{ mediaTypes: ['audio'] }, { mediaTypes: ['video', 'audio'] },
    { mediaTypes: [] }, { mediaTypes: undefined }, { isMainFrame: false }]) {
    assert.equal(await shell.media(details), false);
  }
  assert.equal(shell.dialogs.length, 0);
  const first = shell.media();
  assert.equal(shell.dialogs.length, 1);
  assert.equal(shell.dialogs[0].options.defaultId, 0);
  assert.equal(await shell.media(), false); // No concurrent prompt pile-up.
  shell.window.emit('blur');
  shell.dialogs[0].resolve({ response: 1 });
  assert.equal(await first, true); // Blur is not revocation.
  await new Promise(resolve => setImmediate(resolve));
  const second = shell.media();
  assert.equal(shell.dialogs.length, 2); // Previous approval is not cached.
  shell.invoke('hide');
  assert.equal(await shell.media(), false);
  shell.app.emit('second-instance');
  shell.dialogs[1].resolve({ response: 1 });
  assert.equal(await second, false); // A stale prompt cannot grant after re-show.
  await new Promise(resolve => setImmediate(resolve));
  const third = shell.media();
  shell.dialogs[2].resolve({ response: 0 });
  assert.equal(await third, false);
});

test('main native cursor drag crosses monitors, then clamps on end/blur/15s timeout', async t => {
  const shell = await bootShell(t);
  shell.send('moveStart');
  const tick = [...shell.timers].find(value => value.delay === 16);
  assert.ok(tick);
  shell.display.cursor = { x: -10000, y: -10000 };
  tick.callback();
  assert.ok(shell.window.bounds.x < secondary.x); // Not clamped mid-drag.
  shell.send('moveEnd');
  assert.equal(shell.window.bounds.x, secondary.x);
  assert.equal(shell.window.bounds.y, secondary.y);
  assert.ok(![...shell.timers].some(value => value.delay === 16));
  shell.send('moveStart');
  shell.window.emit('blur');
  assert.ok(![...shell.timers].some(value => value.delay === 16));
  shell.send('moveStart');
  [...shell.timers].find(value => value.delay === 15000).callback();
  assert.ok(![...shell.timers].some(value => value.delay === 16));
});

test('settings window is independent, guarded, reusable and never changes companion camera visibility', async t => {
  const shell = await bootShell(t);
  const snapshot = { controls: { speed: { value: '1' } }, skins: [{ value: 'a', text: 'A' }] };
  shell.send('publishSettings', snapshot);
  const visibilityCount = shell.window.events.filter(event => event.type === 'visibility').length;
  await shell.invoke('openSettings');
  const settings = shell.windows[1];
  assert.equal(settings.options.width, 360);
  assert.equal(settings.options.height, 650);
  assert.equal(settings.options.minWidth, 280);
  assert.equal(settings.options.minHeight, 360);
  assert.equal(settings.options.resizable, true);
  assert.equal(settings.options.frame, false);
  assert.equal(settings.options.transparent, false);
  assert.equal(settings.options.backgroundColor, '#f8f9f1');
  assert.equal(settings.options.parent, undefined);
  assert.equal(settings.options.webPreferences.session, shell.window.options.webPreferences.session);
  for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(settings.options.webPreferences[key], true);
  assert.equal(settings.options.webPreferences.nodeIntegration, false);
  assert.match(settings.loadURLs[0], /\/token\/settings\.html$/);
  assert.equal(settings.muted, true);
  assert.equal(settings.isVisible(), true);
  assert.ok(settings.bounds.x + settings.bounds.width <= shell.window.bounds.x);
  assert.equal(shell.window.events.filter(event => event.type === 'visibility').length, visibilityCount);
  assert.deepEqual(shell.settingsInvoke('getSettings'), snapshot);
  assert.equal(settings.events[0].type, 'settings-data');
  assert.deepEqual(settings.events[0].snapshot, snapshot);
  assert.equal(settings.events[1].type, 'state');
  assert.equal(settings.openHandler().action, 'deny');
  for (const [name, details] of [
    ['will-navigate', { url: shell.window.url }], ['will-navigate', { url: 'https://example.com' }],
    ['will-frame-navigate', { url: settings.url, isMainFrame: false }],
    ['will-redirect', {}], ['will-attach-webview', {}], ['content-bounds-updated', {}],
  ]) {
    let denied = false;
    settings.webContents.emit(name, { ...details, preventDefault: () => { denied = true; } });
    assert.equal(denied, true, name);
  }
  assert.equal(await new Promise(resolve => shell.permissions.request(settings.webContents, 'media', resolve, {
    isMainFrame: true, requestingUrl: settings.url, mediaTypes: ['video'],
  })), false);
  assert.equal(shell.dialogs.length, 0);
  settings.setPosition(100, 150);
  const independent = settings.getBounds();
  shell.invoke('setScale', 80);
  shell.window.setPosition(900, 200);
  assert.deepEqual(settings.getBounds(), independent);
  assert.equal(settings.events.at(-1).state.scale, 80);
  assert.equal(shell.settingsInvoke('setScale', 120).scale, 120);
  assert.equal(shell.settingsInvoke('setTopmost', false).topmost, false);
  for (const close of [
    () => shell.settingsInvoke('closeSettings'),
    () => settings.emit('close', { preventDefault() {} }),
    () => settings.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'Escape' }),
    () => shell.invoke('closeSettings'),
  ]) {
    await shell.invoke('openSettings');
    close();
    assert.equal(settings.isVisible(), false);
    assert.equal(settings.isDestroyed(), false);
    assert.equal(shell.window.isVisible(), true);
    assert.equal(shell.window.muted, false);
    assert.equal(shell.window.events.at(-1).type, 'settings-visibility');
    assert.equal(shell.window.events.at(-1).visible, false);
  }
  await shell.invoke('openSettings');
  assert.equal(shell.windows.length, 2);
  assert.deepEqual(settings.getBounds(), independent);
  assert.equal(settings.loadURLs.length, 1);
  shell.invoke('hide');
  assert.equal(settings.isVisible(), false);
  shell.app.emit('second-instance');
  assert.equal(settings.isVisible(), false);
  await shell.invoke('openSettings');
  shell.power.emit('suspend');
  assert.equal(settings.isVisible(), false);
  shell.power.emit('resume');
  assert.equal(settings.isVisible(), false);
  shell.app.quit();
  assert.equal(settings.isDestroyed(), true);
});

test('settings IPC enforces roles, main frames, exact commands, bounded snapshots and ephemeral previews', async t => {
  const shell = await bootShell(t);
  assert.throws(() => shell.invoke('getSettings'), /Untrusted/);
  await shell.invoke('openSettings');
  const settings = shell.windows[1];
  assert.equal(shell.settingsInvoke('getSettings'), null);
  for (const channel of ['openSettings', 'hide']) assert.throws(() => shell.settingsInvoke(channel), /Untrusted/);
  const get = shell.handlers.get('desktop:getSettings');
  const sender = { sender: settings.webContents, senderFrame: settings.webContents.mainFrame };
  assert.throws(() => get({ ...sender, senderFrame: { url: settings.url } }), /Untrusted/);
  settings.webContents.mainFrame.url += '#wrong';
  assert.throws(() => get(sender), /Untrusted/);
  settings.webContents.mainFrame.url = settings.url;
  const snapshot = { controls: { status: { text: 'Ready' } }, skins: [] };
  shell.settingsSend('publishSettings', snapshot);
  assert.equal(shell.settingsInvoke('getSettings'), null);
  shell.send('publishSettings', snapshot);
  shell.send('publishSettings', { controls: { status: { text: 'x'.repeat(32768) } }, skins: [] });
  assert.deepEqual(shell.settingsInvoke('getSettings'), snapshot);
  const initial = shell.window.events.filter(event => event.type === 'settings-command').length;
  for (const command of settingsCommands) {
    shell.send('settingsCommand', command);
    shell.ipc.emit('desktop:settingsCommand', { ...sender, senderFrame: { url: settings.url } }, command);
  }
  for (const command of invalidSettingsCommands) shell.settingsSend('settingsCommand', command);
  assert.equal(shell.window.events.filter(event => event.type === 'settings-command').length, initial);
  for (const command of settingsCommands) shell.settingsSend('settingsCommand', command);
  assert.deepEqual(shell.window.events.filter(event => event.type === 'settings-command').map(event => event.command), settingsCommands);
  assert.equal(settings.events.some(event => event.type === 'settings-command'), false);
  assert.equal(shell.dialogs.length, 0);
  assert.equal(shell.window.isDestroyed(), false); // Quit is a command, not arbitrary native dispatch.
  for (const channel of ['quit', 'moveStart', 'resizeStart']) shell.settingsSend(channel, 'se');
  assert.equal(shell.window.isDestroyed(), false);
  assert.equal([...shell.timers].some(timer => timer.delay === 16), false);
  const preview = 'data:image/jpeg;base64,/9j/AA==';
  const previews = () => settings.events.filter(event => event.type === 'settings-preview');
  const epoch = shell.window.events.filter(event => event.type === 'settings-visibility').at(-1).previewEpoch;
  shell.settingsSend('publishPreview', preview, epoch);
  shell.settingsSend('publishPreview', null, epoch);
  shell.send('publishPreview', 'data:image/png;base64,AAAA', epoch);
  for (const invalid of [undefined, null, NaN, Infinity, '1', String(epoch), epoch + 0.5, epoch - 1, epoch + 1]) {
    shell.send('publishPreview', preview, invalid);
  }
  assert.equal(previews().length, 0);
  shell.send('publishPreview', preview, epoch);
  shell.send('publishPreview', null);
  assert.deepEqual(previews().map(event => event.dataURL), [preview, null]);
  assert.equal(shell.window.events.some(event => event.type === 'settings-preview'), false);
  shell.settingsInvoke('closeSettings');
  const cleared = previews().length;
  assert.equal(previews().at(-1).dataURL, null);
  shell.send('publishPreview', preview, epoch);
  shell.settingsSend('settingsCommand', settingsCommands[0]);
  assert.equal(shell.window.events.filter(event => event.type === 'settings-command').length, settingsCommands.length);
  await shell.invoke('openSettings');
  assert.equal(previews().length, cleared);
  settings.minimized = true;
  const currentEpoch = shell.window.events.filter(event => event.type === 'settings-visibility').at(-1).previewEpoch;
  shell.send('publishPreview', preview, currentEpoch);
  assert.equal(previews().length, cleared);
});

test('settings previews clear across visibility and renderer resets, rejecting every old visibility epoch', async t => {
  const shell = await bootShell(t);
  await shell.invoke('openSettings');
  const settings = shell.windows[1];
  const frame = 'data:image/jpeg;base64,/9j/AA==';
  const notification = () => shell.window.events.filter(event => event.type === 'settings-visibility').at(-1);
  const previews = () => settings.events.filter(event => event.type === 'settings-preview');
  const hide = settings.hide.bind(settings);
  t.mock.method(settings, 'hide', () => {
    assert.equal(previews().at(-1).dataURL, null); // Must clear before native hide, not just its event.
    hide();
  });
  const previousEpochs = [];
  for (const action of ['close', 'minimize', 'hide', 'suspend', 'reset', 'settings-reset']) {
    const epoch = notification().previewEpoch;
    assert.equal(notification().visible, true);
    shell.send('publishPreview', frame, epoch);
    assert.equal(previews().at(-1).dataURL, frame);
    previousEpochs.push(epoch);
    if (action === 'close') shell.invoke('closeSettings');
    if (action === 'minimize') { settings.minimized = true; settings.emit('minimize'); }
    if (action === 'hide') shell.invoke('hide');
    if (action === 'suspend') shell.power.emit('suspend');
    if (action === 'reset') shell.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    if (action === 'settings-reset') settings.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    assert.equal(previews().at(-1).dataURL, null, action);
    if (action !== 'reset') {
      assert.equal(notification().visible, false, action);
      assert.ok(notification().previewEpoch > epoch);
    }
    const cleared = previews().length;
    shell.send('publishPreview', frame, epoch);
    shell.send('publishPreview', frame, notification().previewEpoch);
    assert.equal(previews().length, cleared);
    if (!['reset', 'settings-reset'].includes(action)) {
      shell.send('publishPreview', null, -123); // Clears ignore epoch and visibility.
      shell.send('publishPreview', null);
      assert.equal(previews().length, cleared + 2);
      assert.equal(previews().at(-1).dataURL, null);
    }
    if (action === 'minimize') settings.restore();
    if (action === 'suspend') shell.power.emit('resume');
    if (action === 'reset') {
      assert.equal(settings.events.filter(event => event.type === 'settings-data').at(-1).snapshot, null);
      shell.window.webContents.emit('did-finish-load');
    }
    if (action === 'settings-reset') settings.webContents.emit('did-finish-load');
    await shell.invoke('openSettings');
    assert.equal(notification().visible, true);
    assert.ok(notification().previewEpoch > epoch);
    const reopened = previews().length;
    for (const oldEpoch of previousEpochs) shell.send('publishPreview', frame, oldEpoch);
    assert.equal(previews().length, reopened, action);
    shell.send('publishPreview', frame, notification().previewEpoch);
    assert.equal(previews().length, reopened + 1);
  }
  const events = shell.window.events.filter(event => event.type === 'settings-visibility');
  for (let index = 1; index < events.length; index++) {
    assert.ok(Number.isSafeInteger(events[index].previewEpoch));
    assert.ok(events[index].previewEpoch > events[index - 1].previewEpoch);
  }
  shell.app.quit();
  assert.equal(previews().at(-1).dataURL, null);
});

test('settings renderer crashes recreate only on next open, retain snapshots and do not stop camera', async t => {
  const shell = await bootShell(t);
  const snapshot = { controls: {}, skins: [] };
  shell.send('publishSettings', snapshot);
  await shell.invoke('openSettings');
  const settings = shell.windows[1];
  const frame = 'data:image/jpeg;base64,/9j/AA==';
  const epoch = shell.window.events.filter(event => event.type === 'settings-visibility').at(-1).previewEpoch;
  shell.send('publishPreview', frame, epoch);
  settings.webContents.emit('render-process-gone');
  assert.equal(settings.events.filter(event => event.type === 'settings-preview').at(-1).dataURL, null);
  assert.equal(settings.isDestroyed(), true);
  assert.equal(shell.windows.length, 2);
  assert.equal(shell.window.isVisible(), true);
  assert.equal(shell.window.muted, false);
  await shell.invoke('openSettings');
  assert.equal(shell.windows.length, 3);
  assert.equal(shell.windows[2].isVisible(), true);
  assert.deepEqual(shell.windows[2].events[0].snapshot, snapshot);
  shell.send('publishPreview', frame, epoch);
  assert.equal(shell.windows[2].events.some(event => event.type === 'settings-preview' && event.dataURL !== null), false);
  const freshEpoch = shell.window.events.filter(event => event.type === 'settings-visibility').at(-1).previewEpoch;
  shell.send('publishPreview', frame, freshEpoch);
  shell.window.webContents.emit('render-process-gone');
  assert.equal(shell.windows[2].isVisible(), false);
  assert.equal(shell.settingsInvoke('getSettings'), null);
  assert.equal(shell.windows[2].events.filter(event => event.type === 'settings-data').at(-1).snapshot, null);
  assert.equal(shell.windows[2].events.filter(event => event.type === 'settings-preview').at(-1).dataURL, null);
  assert.equal(shell.dialogs.length, 0);
});

test('pending settings loads cannot reshow after hide, suspend, crash or quit; failures retry explicitly', async t => {
  for (const action of ['close', 'hide', 'suspend', 'crash', 'quit', 'failure']) {
    await t.test(action, async t => {
      const shell = await bootShell(t);
      const prototype = shell.window.constructor.prototype;
      const original = prototype.loadURL;
      let complete;
      let reject;
      t.mock.method(prototype, 'loadURL', function(url) {
        if (!url.endsWith('/settings.html')) return original.call(this, url);
        this.url = url;
        this.webContents.mainFrame.url = url;
        this.loadURLs.push(url);
        return new Promise((resolve, fail) => {
          reject = fail;
          complete = () => { this.webContents.emit('did-finish-load'); resolve(); };
        });
      });
      const opening = shell.invoke('openSettings');
      const again = shell.invoke('openSettings');
      assert.equal(shell.windows.length, 2);
      const settings = shell.windows[1];
      if (action === 'close') shell.invoke('closeSettings');
      if (action === 'hide') shell.invoke('hide');
      if (action === 'suspend') shell.power.emit('suspend');
      if (action === 'crash') settings.webContents.emit('render-process-gone');
      if (action === 'quit') shell.app.quit();
      if (action === 'failure') reject(new Error('Missing settings.html'));
      else complete();
      await Promise.all([opening, again]);
      assert.equal(settings.isVisible(), false);
      assert.equal(shell.errors.length, action === 'failure' ? 1 : 0);
      if (action === 'failure') {
        const retry = shell.invoke('openSettings');
        assert.equal(shell.windows.length, 3);
        complete();
        await retry;
        assert.equal(shell.windows[2].isVisible(), true);
      }
    });
  }
});

test('early settings requests drain after did-finish-load even when ready-to-show already fired', async t => {
  for (const action of ['open', 'close', 'hide', 'suspend', 'quit']) {
    await t.test(action, async t => {
      const shell = await bootShell(t, undefined, { readyBeforeLoad: true });
      assert.equal(shell.window.isVisible(), true);
      await shell.invoke('openSettings');
      assert.equal(shell.windows.length, 1);
      if (action === 'close') shell.invoke('closeSettings');
      if (action === 'hide') shell.invoke('hide');
      if (action === 'suspend') shell.power.emit('suspend');
      if (action === 'quit') shell.app.quit();
      shell.window.finishInitialLoad();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(shell.windows.length, action === 'open' ? 2 : 1);
      if (action === 'open') assert.equal(shell.windows[1].isVisible(), true);
      assert.equal(shell.dialogs.length, 0);
    });
  }
});

test('settings reopen at 250 percent DPI never round-trips already-contained native bounds', async t => {
  const shell = await bootShell(t);
  shell.display.getDisplayMatching = () => ({ workArea: primary, scaleFactor: 2.5 });
  await shell.invoke('openSettings');
  const settings = shell.windows[1];
  // Native getBounds already includes DIP rounding from the first window creation.
  settings.bounds = { x: 693, y: 50, width: 361, height: 651 };
  const initial = settings.getBounds();
  const original = settings.setBounds.bind(settings);
  let roundTrips = 0;
  let simulateRounding = true;
  t.mock.method(settings, 'setBounds', bounds => {
    roundTrips++;
    original({ ...bounds, width: bounds.width + (simulateRounding ? 1 : 0) });
  });
  const minimumSize = t.mock.method(settings, 'setMinimumSize');
  for (let cycle = 0; cycle < 8; cycle++) {
    shell.invoke('closeSettings');
    await shell.invoke('openSettings');
    assert.deepEqual(settings.getBounds(), initial);
  }
  shell.display.emit('display-metrics-changed');
  assert.equal(roundTrips, 0);
  assert.equal(minimumSize.mock.callCount(), 0);
  simulateRounding = false;
  settings.bounds.x = -1;
  shell.display.emit('display-metrics-changed');
  assert.equal(roundTrips, 1);
  assert.deepEqual(settings.getBounds(), { ...initial, x: 0 });
  settings.bounds = { x: 0, y: 0, width: primary.width + 1, height: primary.height + 1 };
  shell.display.emit('display-metrics-changed');
  assert.equal(roundTrips, 2);
  assert.deepEqual(settings.getBounds(), primary);
  await shell.invoke('openSettings');
  assert.equal(roundTrips, 2);
});

test('settings initial placement chooses available side and clamps small or changed displays', async t => {
  const shell = await bootShell(t);
  shell.window.setPosition(20, 100);
  await shell.invoke('openSettings');
  const settings = shell.windows[1];
  assert.ok(settings.bounds.x >= shell.window.bounds.x + shell.window.bounds.width);
  shell.display.getDisplayMatching = () => ({ workArea: { x: -500, y: -300, width: 240, height: 300 } });
  shell.display.emit('display-metrics-changed');
  assert.deepEqual(settings.getBounds(), { x: -500, y: -300, width: 240, height: 300 });
  assert.deepEqual(settings.minimumSize, [240, 300]);
  settings.webContents.emit('render-process-gone');
  await shell.invoke('openSettings');
  assert.deepEqual(shell.windows[2].getBounds(), { x: -500, y: -300, width: 240, height: 300 });
});

test('native resize updates state live without saving or rebuilding the tray each frame', async t => {
  const shell = await bootShell(t);
  shell.window.setPosition(600, 100);
  await shell.invoke('openSettings');
  const settingsBounds = shell.windows[1].getBounds();
  const file = path.join(shell.directory, 'desktop-state.json');
  const before = fs.readFileSync(file, 'utf8');
  const trayUpdates = shell.tray.updates;
  shell.send('resizeStart', 'se');
  const tick = [...shell.timers].find(timer => timer.delay === 16);
  assert.ok(tick);
  shell.send('moveStart');
  shell.send('resizeStart', 'nw');
  assert.equal([...shell.timers].filter(timer => timer.delay === 16).length, 1);
  shell.display.cursor = { x: 40, y: 60 };
  tick.callback();
  assert.ok(Math.abs(shell.invoke('getState').scale - 110) < 1e-8);
  assert.deepEqual(shell.window.getBounds(), { x: 600, y: 100, width: 440, height: 660 });
  assert.ok(Math.abs(shell.windows[1].events.at(-1).state.scale - 110) < 1e-8);
  assert.deepEqual(shell.windows[1].getBounds(), settingsBounds);
  assert.equal([...shell.timers].some(timer => timer.delay === 200), false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(shell.tray.updates, trayUpdates);
  shell.send('resizeEnd');
  assert.equal([...shell.timers].some(timer => timer.delay === 16), false);
  assert.equal(shell.tray.updates, trayUpdates + 1);
  assert.ok(Math.abs(native.readPreferences(file).scale - 110) < 1e-8);
  assert.equal(native.readPreferences(file).x, 600);
  assert.equal(native.readPreferences(file).y, 100);
});

test('resize requires a focused visible companion and ends on lifecycle, release, timeout and slider', async t => {
  const shell = await bootShell(t);
  const resizing = () => [...shell.timers].some(timer => timer.delay === 16);
  shell.send('resizeStart', 'invalid');
  assert.equal(resizing(), false);
  shell.window.focused = false;
  shell.send('resizeStart', 'se');
  assert.equal(resizing(), false);
  shell.window.focused = true;
  shell.send('moveStart');
  shell.send('resizeStart', 'se');
  assert.equal([...shell.timers].filter(timer => timer.delay === 16).length, 1);
  shell.send('moveEnd');
  assert.equal(resizing(), false);
  for (const end of [
    () => shell.send('resizeEnd'), () => shell.window.emit('blur'), () => shell.invoke('hide'),
    () => shell.power.emit('suspend'), () => shell.display.emit('display-added'),
    () => shell.display.emit('display-removed'), () => shell.display.emit('display-metrics-changed'),
    () => [...shell.timers].find(timer => timer.delay === 15000).callback(),
    () => shell.invoke('setScale', 90),
  ]) {
    shell.power.emit('resume');
    shell.app.emit('second-instance');
    shell.send('resizeStart', 'nw');
    assert.equal(resizing(), true);
    end();
    assert.equal(resizing(), false);
  }
  shell.invoke('hide');
  shell.send('resizeStart', 'se');
  assert.equal(resizing(), false);
  shell.app.emit('second-instance');
  shell.send('resizeStart', 'se');
  shell.window.webContents.emit('render-process-gone');
  assert.equal(resizing(), false);
});

test('main recovers crashed pages only on explicit Show, Settings or second instance', async t => {
  for (const action of ['Show', 'Settings', 'second-instance']) {
    await t.test(action, async t => {
      const shell = await bootShell(t);
      const { window, tray, app } = shell;
      const indexURL = window.loadURLs[0];
      const oldApproval = shell.media();
      window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      assert.equal(window.isVisible(), false);
      assert.equal(window.muted, true);
      assert.equal(window.reloads.length, 0);
      assert.equal(await shell.media(), false);
      const show = () => action === 'second-instance' ? app.emit(action) :
        tray.menu.find(item => item.label === action).click();
      show();
      show();
      app.emit('second-instance');
      assert.deepEqual(window.loadURLs, [indexURL, indexURL]);
      assert.equal(window.isVisible(), false);
      assert.equal(await shell.media(), false);
      window.reloads[0].complete();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(window.isVisible(), true);
      assert.equal(window.muted, false);
      assert.equal(shell.invoke('getState').hidden, false);
      assert.equal(shell.windows.length, action === 'Settings' ? 2 : 1);
      if (action === 'Settings') assert.equal(shell.windows[1].isVisible(), true);
      assert.equal(shell.dialogs.length, 1); // Recovery itself never asks for camera access.
      shell.dialogs[0].resolve({ response: 1 });
      assert.equal(await oldApproval, false);
      await new Promise(resolve => setImmediate(resolve));
      const newApproval = shell.media();
      assert.equal(shell.dialogs.length, 2); // A fresh request still needs native consent.
      shell.dialogs[1].resolve({ response: 0 });
      assert.equal(await newApproval, false);
      app.emit('second-instance');
      assert.equal(window.reloads.length, 1); // Normal shows do not reload a healthy page.
      assert.deepEqual(shell.errors, []);
    });
  }
});

test('main recovery failure stays hidden with an actionable error and no retry loop', async t => {
  const shell = await bootShell(t);
  const { window, app } = shell;
  window.webContents.emit('render-process-gone');
  app.emit('second-instance');
  window.reloads[0].reject(new Error('ERR_CONNECTION_REFUSED'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.isVisible(), false);
  assert.equal(window.muted, true);
  assert.equal(window.reloads.length, 1);
  assert.equal(shell.errors.length, 1);
  assert.match(shell.errors[0].message, /ERR_CONNECTION_REFUSED/);
  assert.match(shell.errors[0].message, /Show.*retry.*Quit/);
  shell.power.emit('resume');
  window.webContents.emit('render-process-gone');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.reloads.length, 1);
  assert.equal(shell.errors.length, 1);
  app.emit('second-instance'); // One deliberate retry after the failed attempt.
  window.webContents.emit('render-process-gone');
  window.reloads[1].resolve(); // Even a fulfilled load must have a live, loaded page.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.isVisible(), false);
  assert.equal(window.reloads.length, 2);
  assert.equal(shell.errors.length, 2);
  app.emit('second-instance');
  window.reloads[2].complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.isVisible(), true);
  assert.equal(window.reloads.length, 3);
  assert.equal(shell.dialogs.length, 0);
});

test('hide or quit during recovery does not reshow the window or report a quit error', async t => {
  const shell = await bootShell(t);
  const { window, app } = shell;
  window.webContents.emit('render-process-gone');
  app.emit('second-instance');
  shell.invoke('hide');
  window.reloads[0].complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.isVisible(), false);
  assert.equal(window.muted, true);
  app.emit('second-instance');
  assert.equal(window.isVisible(), true);
  assert.equal(window.reloads.length, 1);
  window.webContents.emit('render-process-gone');
  app.emit('second-instance');
  app.quit();
  window.reloads[1].reject(new Error('ERR_ABORTED'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.destroyed, true);
  assert.deepEqual(shell.errors, []);
});

test('main persists desktop-state.json on debounced move and restores it on restart', async t => {
  const shell = await bootShell(t);
  const file = path.join(shell.directory, 'desktop-state.json');
  shell.invoke('setScale', 125);
  shell.invoke('setTopmost', false);
  shell.window.setPosition(-1100, -50);
  [...shell.timers].find(timer => timer.delay === 200).callback();
  const expected = { topmost: false, scale: 125, x: -1100, y: -50 };
  assert.deepEqual(native.readPreferences(file), expected);
  shell.app.quit();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), expected);
  const restarted = await bootShell(t, shell.directory);
  assert.equal(restarted.invoke('getState').scale, 125);
  assert.equal(restarted.invoke('getState').topmost, false);
  assert.equal(restarted.window.options.alwaysOnTop, false);
  assert.deepEqual(restarted.window.bounds, native.fitBounds(expected, [primary, secondary]));
  restarted.window.setPosition(90000, 90000);
  restarted.invoke('hide');
  const bounded = native.fitBounds({ ...expected, x: 90000, y: 90000 }, [primary, secondary]);
  assert.deepEqual(native.readPreferences(file), { ...expected, x: bounded.x, y: bounded.y });
  assert.deepEqual(fs.readdirSync(shell.directory), ['desktop-state.json']);
  restarted.app.quit();
});

test('right-click toggles controls, cancels resize and retains five-second auto-hide', () => {
  // Run the actual controls and drag helpers without booting model or camera assets.
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'desktop.js'), 'utf8');
  const controls = source.slice(0, source.indexOf('  function stopVoice()'));
  const drag = source.slice(source.indexOf('  function stopDragging()'), source.indexOf('  function setVisible('));
  const classes = new Set(['controls-hidden']);
  const classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  const events = new Map();
  const timers = new Map();
  let timerID = 0;
  let prevented = 0;
  let resizeEnds = 0;
  const character = { classList, focus() {}, hasPointerCapture: () => false };
  const context = {
    document: { body: { classList }, activeElement: null, getElementById: () => character,
      addEventListener: (name, callback) => events.set(name, callback) },
    window: { desktop: { moveEnd() {}, resizeEnd() { resizeEnds++; } }, CHARACTER_CATALOG: [] },
    setTimeout: (callback, delay) => { const id = ++timerID; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), queueMicrotask,
  };
  vm.runInNewContext(controls + drag + '\nwindow.beginResize = () => { resizePointer = { id: 1, target: character }; document.body.classList.add("is-resizing"); };\n})();', context);
  const click = () => events.get('contextmenu')({ preventDefault() { prevented++; } });
  click();
  assert.equal(classes.has('controls-hidden'), false);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 5000);
  click();
  assert.equal(classes.has('controls-hidden'), true);
  assert.equal(timers.size, 0);
  click();
  [...timers.values()][0].callback();
  assert.equal(classes.has('controls-hidden'), true);
  click();
  context.window.beginResize();
  click();
  assert.equal(classes.has('controls-hidden'), true);
  assert.equal(classes.has('is-resizing'), false);
  assert.equal(timers.size, 0);
  assert.equal(resizeEnds, 5);
  assert.equal(prevented, 5);
});

test('settings website link works before model load and reports browser errors', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'settings.html'), 'utf8');
  const link = html.match(/<a id="open-website"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(link);
  assert.equal(link[1].replace(/<[^>]*>/g, '').trim(), 'Kieray0w0.github.io');
  assert.match(link[1], /<svg aria-hidden="true"/);
  assert.ok(link.index > html.indexOf('id="quit"'));
  assert.match(html.slice(link.index + link[0].length), /^\s*<\/div>\s*<\/section>/);
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, handlers: new Map(), replaceChildren() {}, setAttribute() {}, removeAttribute() {},
      addEventListener(name, callback) { this.handlers.set(name, callback); },
    });
    return elements.get(id);
  };
  let calls = 0;
  let fail = false;
  const desktop = {
    onEvent() {}, getState: async () => ({ topmost: true, scale: 100 }), getSettings: async () => null,
    openWebsite: async () => { calls++; if (fail) throw new Error('Browser unavailable'); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'settings.js'), 'utf8'), {
    document: { getElementById: getElement, addEventListener() {} },
    window: { desktop, CHARACTER_CATALOG: [], addEventListener() {} }, console,
  });
  await Promise.resolve();
  assert.equal(getElement('model-controls').disabled, true);
  const click = getElement('open-website').handlers.get('click');
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  await click(event);
  assert.equal(calls, 1);
  assert.equal(getElement('website-status').hidden, true);
  fail = true;
  await click(event);
  assert.equal(getElement('website-status').hidden, false);
  assert.match(getElement('website-status').textContent, /https:\/\/Kieray0w0.github.io\//);
  fail = false;
  await click(event);
  assert.equal(getElement('website-status').hidden, true);
  assert.equal(prevented, 3);
});

test('preload exposes only the frozen desktop contract and removable event listeners', async () => {
  const renderer = new EventEmitter();
  const calls = [];
  renderer.invoke = async (...args) => { calls.push(args); return { topmost: true, scale: 100, hidden: false }; };
  renderer.send = (...args) => calls.push(args);
  let api;
  const windowEvents = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8'), {
    require: () => ({ ipcRenderer: renderer, contextBridge: { exposeInMainWorld: (name, value) => {
      assert.equal(name, 'desktop'); api = value;
    } } }),
    window: { addEventListener: (name, callback) => windowEvents.set(name, callback) },
    queueMicrotask, console,
  });
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api).sort(), ['getState', 'hide', 'moveEnd', 'moveStart', 'onEvent', 'quit', 'setScale', 'setTopmost',
    'resizeStart', 'resizeEnd', 'openSettings', 'closeSettings', 'getSettings', 'publishSettings', 'settingsCommand', 'publishPreview', 'openWebsite'].sort());
  await api.openWebsite('https://untrusted.example/');
  assert.deepEqual(calls.at(-1), ['desktop:openWebsite']);
  await api.getState();
  await api.setScale(120);
  await api.setTopmost(false);
  await assert.rejects(api.setScale(NaN), /finite/);
  await assert.rejects(api.setTopmost('true'), /boolean/);
  renderer.emit('desktop:event', {}, { type: 'visibility', visible: false });
  const received = [];
  const unsubscribe = api.onEvent(event => received.push(event));
  await Promise.resolve();
  assert.equal(received[0].visible, false);
  renderer.emit('desktop:event', {}, { type: 'settings' });
  assert.equal(received[1].type, 'settings');
  unsubscribe();
  renderer.emit('desktop:event', {}, { type: 'settings' });
  assert.equal(received.length, 2);
  windowEvents.get('blur')();
  windowEvents.get('pagehide')();
  assert.deepEqual(calls.slice(-4), [['desktop:moveEnd'], ['desktop:resizeEnd'], ['desktop:moveEnd'], ['desktop:resizeEnd']]);
  for (const event of ['pointerup', 'pointercancel', 'mouseup']) {
    windowEvents.get(event)();
    assert.deepEqual(calls.at(-1), ['desktop:resizeEnd']);
  }
  await api.openSettings();
  await api.closeSettings();
  await api.getSettings();
  const snapshot = { controls: {}, skins: [] };
  const command = { id: 'retry', event: 'click' };
  api.publishSettings(snapshot);
  api.settingsCommand(command);
  api.publishPreview(null, 7);
  api.resizeStart('nw');
  api.resizeStart('invalid');
  api.resizeEnd();
  assert.deepEqual(calls.slice(-8), [
    ['desktop:openSettings'], ['desktop:closeSettings'], ['desktop:getSettings'],
    ['desktop:publishSettings', snapshot], ['desktop:settingsCommand', command], ['desktop:publishPreview', null, 7],
    ['desktop:resizeStart', 'nw'], ['desktop:resizeEnd'],
  ]);
  for (const event of [
    { type: 'state', state: { scale: 120 } }, { type: 'settings-data', snapshot },
    { type: 'settings-visibility', visible: true, previewEpoch: 8 }, { type: 'settings-command', command },
    { type: 'settings-preview', dataURL: null }, { type: 'untrusted-event' },
  ]) renderer.emit('desktop:event', {}, event);
  const replayed = [];
  api.onEvent(event => replayed.push(event));
  await Promise.resolve();
  assert.deepEqual(replayed.map(event => event.type).sort(), ['settings', 'settings-data', 'settings-visibility', 'state', 'visibility']);
  assert.equal(replayed.find(event => event.type === 'settings-visibility').previewEpoch, 8);
  api.publishPreview('data:image/jpeg;base64,/9j/AA==', 8);
  assert.deepEqual(calls.at(-1), ['desktop:publishPreview', 'data:image/jpeg;base64,/9j/AA==', 8]);
  api.publishPreview(null);
  assert.deepEqual(calls.at(-1), ['desktop:publishPreview', null, undefined]);
  renderer.emit('desktop:event', {}, { type: 'settings-command', command });
  renderer.emit('desktop:event', {}, { type: 'settings-preview', dataURL: null });
  assert.deepEqual(replayed.slice(-2).map(event => event.type), ['settings-command', 'settings-preview']);
});
