'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { deflateSync } = require('node:zlib');

const DEFAULTS = Object.freeze({ topmost: true, scale: 100, theme: 'classic' });
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
});

// PIXI generates optimized shader/uniform functions with new Function(). This
// permits that local code generation, not remote or inline script loading.
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:",
  "media-src 'self' blob: data:", "font-src 'self' data:",
  "connect-src 'self' blob: data:", "worker-src 'self' blob:",
  "object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'",
  "base-uri 'none'", "form-action 'none'",
].join('; ');

const SETTINGS_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "font-src 'self'", "connect-src 'none'",
  "media-src 'none'", "worker-src 'none'", "object-src 'none'",
  "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

function clampScale(value) {
  return Number.isFinite(value) ? Math.min(150, Math.max(70, value)) : DEFAULTS.scale;
}

function sanitizePreferences(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {
    topmost: typeof input.topmost === 'boolean' ? input.topmost : DEFAULTS.topmost,
    scale: clampScale(input.scale),
    theme: input.theme === 'archive' ? 'archive' : DEFAULTS.theme,
  };
  // Coordinates must also fit Electron's signed integer rectangle fields.
  if (Number.isFinite(input.x) && Number.isFinite(input.y) &&
      Math.abs(input.x) <= 2147483647 && Math.abs(input.y) <= 2147483647) {
    result.x = Math.round(input.x);
    result.y = Math.round(input.y);
  }
  return result;
}

function fitBounds(preferences, workAreas) {
  const prefs = sanitizePreferences(preferences);
  const areas = workAreas.filter(area => area &&
    ['x', 'y', 'width', 'height'].every(key => Number.isFinite(area[key])) &&
    area.width >= 1 && area.height >= 1 &&
    ['x', 'y', 'width', 'height'].every(key => Math.abs(area[key]) <= 2147483647));
  if (!areas.length) throw new TypeError('At least one valid work area is required');
  let area = areas[0];
  if (prefs.x !== undefined) {
    const distance = candidate => Math.hypot(
      Math.max(candidate.x - prefs.x, 0, prefs.x - (candidate.x + candidate.width)),
      Math.max(candidate.y - prefs.y, 0, prefs.y - (candidate.y + candidate.height)),
    );
    area = areas.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
  }
  // Keep the user's 70..150 preference; exceptionally small screens can require
  // a smaller effective size. Never leave part of the character unreachable.
  const factor = Math.min(prefs.scale / 100, area.width / 400, area.height / 600);
  const width = Math.max(1, Math.floor(400 * factor + 1e-9));
  const height = Math.max(1, Math.floor(600 * factor + 1e-9));
  const x = prefs.x ?? area.x + area.width - width - 24;
  const y = prefs.y ?? area.y + area.height - height - 24;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width, height,
  };
}

// All inputs and outputs are Electron DIP coordinates, not physical pixels.
function resizeBounds(bounds, corner, delta, area) {
  if (!['nw', 'ne', 'sw', 'se'].includes(corner) ||
      ![bounds?.x, bounds?.y, bounds?.width, bounds?.height, delta?.x, delta?.y,
        area?.x, area?.y, area?.width, area?.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0 || area.width < 1 || area.height < 1) {
    throw new TypeError('Invalid resize geometry');
  }
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  const anchorX = bounds.x + (sx < 0 ? bounds.width : 0);
  const anchorY = bounds.y + (sy < 0 ? bounds.height : 0);
  const maximum = Math.min(1.5, area.width / 400, area.height / 600);
  const minimum = Math.min(0.7, maximum);
  const initial = Math.max(bounds.width / 400, bounds.height / 600);
  const contained = bounds.x >= area.x && bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
  const anchoredMaximum = Math.max(contained ? Math.min(initial, maximum) : 0, Math.min(maximum,
    (sx > 0 ? area.x + area.width - anchorX : anchorX - area.x) / 400,
    (sy > 0 ? area.y + area.height - anchorY : anchorY - area.y) / 600));
  // Recover the effective size from getBounds, including small-screen clamping
  // and integer rounding. Project the cursor delta onto the aspect-ratio vector.
  const projected = initial + (sx * delta.x * 400 + sy * delta.y * 600) / 520000;
  const factor = Math.max(minimum, Math.min(projected,
    anchoredMaximum >= minimum ? anchoredMaximum : maximum));
  const width = Math.max(1, Math.floor(400 * factor + 1e-9));
  const height = Math.max(1, Math.floor(600 * factor + 1e-9));
  return {
    x: Math.round(Math.max(area.x, Math.min(anchorX - (sx < 0 ? width : 0), area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(anchorY - (sy < 0 ? height : 0), area.y + area.height - height))),
    width, height, scale: clampScale(factor * 100),
  };
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' &&
      Object.getOwnPropertyDescriptor(value, key).enumerable &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function sanitizeSettingsSnapshot(value) {
  if (!plainRecord(value) || Object.keys(value).length !== 2 ||
      !plainRecord(value.controls) || !Array.isArray(value.skins) ||
      Object.keys(value.controls).length > 32768 || value.skins.length > 32768) return null;
  const text = item => typeof item === 'string' && item.length <= 32768;
  for (const control of Object.values(value.controls)) {
    if (!plainRecord(control)) return null;
    for (const [key, item] of Object.entries(control)) {
      if (key === 'value') {
        if (!text(item) && !(typeof item === 'number' && Number.isFinite(item))) return null;
      } else if (key === 'text') {
        if (!text(item)) return null;
      } else if (!['checked', 'disabled', 'hidden'].includes(key) || typeof item !== 'boolean') return null;
    }
  }
  for (const skin of value.skins) {
    if (!plainRecord(skin) || Object.keys(skin).length !== 2 || !text(skin.value) || !text(skin.text)) return null;
  }
  try {
    const json = JSON.stringify(value);
    return Buffer.byteLength(json, 'utf8') <= 32768 ? JSON.parse(json) : null;
  } catch { return null; }
}

function isSettingsCommand(command) {
  if (!plainRecord(command)) return false;
  const { id, event, value, checked } = command;
  let fields;
  if (['character-select', 'skin-select'].includes(id)) {
    if (event !== 'change' || typeof value !== 'string' || value.length > 80) return false;
    fields = ['id', 'event', 'value'];
  } else if (id === 'speed') {
    if (event !== 'input' || !['string', 'number'].includes(typeof value) ||
        (typeof value === 'string' && (!value.trim() || value.length > 80)) ||
        !Number.isFinite(Number(value)) || Number(value) < 0.25 || Number(value) > 3) return false;
    fields = ['id', 'event', 'value'];
  } else if (['voice-enabled', 'auto-interact', 'body-follow', 'arm-follow'].includes(id)) {
    if (event !== 'change' || typeof checked !== 'boolean') return false;
    fields = ['id', 'event', 'checked'];
  } else if (['capture-toggle', 'calibrate', 'retry', 'quit'].includes(id)) {
    if (event !== 'click') return false;
    fields = ['id', 'event'];
  } else return false;
  return Object.keys(command).length === fields.length && Object.keys(command).every(key => fields.includes(key));
}

function isSettingsPreview(value) {
  return value === null || (typeof value === 'string' && value.length <= 128 * 1024 &&
    /^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && !/\s/.test(value) &&
    value.length > 'data:image/jpeg;base64,'.length);
}

function readPreferences(filename) {
  try {
    if (fs.statSync(filename).size > 4096) return { ...DEFAULTS };
    return sanitizePreferences(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch {
    return { ...DEFAULTS };
  }
}

function writePreferences(filename, preferences) {
  const value = sanitizePreferences(preferences);
  const temporary = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return value;
}

function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveRequestPath(rawURL, prefix) {
  if (typeof rawURL !== 'string' || !rawURL.startsWith(prefix) || rawURL.includes('#')) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawURL.split('?')[0]); } catch { return null; }
  if (!decoded.startsWith(prefix) || /[\\:\x00-\x1f\x7f]/.test(decoded)) return null;
  const relative = decoded.slice(prefix.length) || 'index.html';
  const parts = relative.split('/');
  // Reject decoded traversal before path.resolve; Windows also aliases trailing
  // dots/spaces and supports alternate streams, so those spellings are refused.
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) return null;
  return parts;
}

function parseRange(header, size) {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function isAllowedRequest(url, baseURL) {
  try {
    const target = new URL(url);
    if (target.protocol === 'data:' || target.protocol === 'blob:') return true;
    const base = new URL(baseURL);
    return target.origin === base.origin && !target.username && !target.password &&
      resolveRequestPath(target.pathname, base.pathname) !== null;
  } catch { return false; }
}

function isVideoPermissionRequest(permission, details, indexURL) {
  if (details?.securityOrigin !== undefined) {
    try {
      if (new URL(details.securityOrigin).origin !== new URL(indexURL).origin) return false;
    } catch { return false; }
  }
  return permission === 'media' && details?.isMainFrame === true &&
    details.requestingUrl === indexURL && Array.isArray(details.mediaTypes) &&
    details.mediaTypes.length === 1 && details.mediaTypes[0] === 'video';
}

async function createStaticServer(webRoot) {
  const root = await fs.promises.realpath(webRoot);
  if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('Web root must be a directory');
  const prefix = `/${randomBytes(32).toString('hex')}/`;
  let host;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    let file;
    let stream;
    let closed = false;
    // Cancellation can arrive during any filesystem await, before a stream exists.
    response.once('close', () => {
      closed = true;
      stream?.destroy();
    });
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), display-capture=(), geolocation=(), usb=(), serial=()');
    response.setHeader('Cache-Control', 'no-store');
    const fail = status => {
      if (closed || response.destroyed) return;
      response.writeHead(status, { 'Content-Length': '0' });
      response.end();
    };
    if (request.headers.host !== host ||
        (request.headers.origin && request.headers.origin !== `http://${host}`) ||
        request.headers['sec-fetch-site'] === 'cross-site') return fail(403);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return fail(405);
    }
    const parts = resolveRequestPath(request.url, prefix);
    if (!parts) return fail(404);
    if (parts.length === 1 && parts[0] === 'settings.html') {
      response.setHeader('Content-Security-Policy', SETTINGS_CSP);
      response.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=(), geolocation=(), usb=(), serial=()');
    }
    try {
      const filename = await fs.promises.realpath(path.resolve(root, ...parts));
      if (closed || response.destroyed) return;
      if (!isWithin(root, filename)) return fail(403);
      file = await fs.promises.open(filename, 'r');
      if (closed || response.destroyed) return;
      const stat = await file.stat();
      if (closed || response.destroyed) return;
      if (!stat.isFile()) return fail(404);
      response.setHeader('Content-Type', MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream');
      response.setHeader('Accept-Ranges', 'bytes');
      // RFC 9110: Range only applies to GET; HEAD describes the full resource.
      const range = request.method === 'GET' ? parseRange(request.headers.range, stat.size) : null;
      if (range === false) {
        response.setHeader('Content-Range', `bytes */${stat.size}`);
        return fail(416);
      }
      response.setHeader('Content-Length', range ? range.end - range.start + 1 : stat.size);
      if (range) response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      response.writeHead(range ? 206 : 200);
      if (request.method === 'HEAD' || stat.size === 0) return response.end();
      stream = file.createReadStream(range || {});
      file = null; // The stream owns and closes this descriptor, including aborts.
      stream.on('error', () => response.destroy());
      if (closed || response.destroyed) return stream.destroy();
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) fail(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500);
      else response.destroy();
    } finally {
      if (file) await file.close().catch(() => {});
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      host = `127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return {
    baseURL: `http://${host}${prefix}`,
    indexURL: `http://${host}${prefix}index.html`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

function createTrayPNG(size = 32) {
  if (!Number.isInteger(size) || size < 16 || size > 256) throw new RangeError('Icon size must be 16..256');
  const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const polygon = (x, y, points) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i], [bx, by] = points[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
  const palette = [
    [[238, 159, 167], [205, 116, 135]],
    [[242, 203, 119], [216, 167, 82]],
    [[148, 196, 172], [102, 158, 136]],
    [[153, 189, 219], [110, 150, 190]],
  ];
  const rotate = ([x, y], turns) => {
    x -= 16; y -= 14;
    for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    return [x + 16, y + 14];
  };
  const blades = palette.map(([front, fold], turns) => ({
    front, fold,
    outline: [[16, 14], [5, 3], [16, 3], [21, 8]].map(point => rotate(point, turns)),
    crease: [[16, 14], [16, 3], [21, 8]].map(point => rotate(point, turns)),
  }));
  const sample = (x, y) => {
    let color = null;
    if ((x >= 14.9 && x <= 17.1 && y >= 14 && y <= 29.5) || ellipse(x, y, 16, 29.5, 1.1, 1.1)) color = [168, 139, 108];
    for (const blade of blades) {
      if (polygon(x, y, blade.outline)) color = blade.front;
      if (polygon(x, y, blade.crease)) color = blade.fold;
    }
    if (ellipse(x, y, 16, 14, 2, 2)) color = [255, 247, 226];
    if (ellipse(x, y, 16, 14, .65, .65)) color = [169, 128, 84];
    return color;
  };
  // Supersample in a 32-unit design space; transparent edges use coverage alpha.
  const stride = 1 + size * 4;
  const pixels = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const color = sample((x + (sx + .5) / 4) * 32 / size, (y + (sy + .5) / 4) * 32 / size);
        if (color) { hits++; for (let c = 0; c < 3; c++) sum[c] += color[c]; }
      }
      if (hits) pixels.set([...sum.map(value => Math.round(value / hits)), Math.round(hits * 255 / 16)], y * stride + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    body.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = {
  DEFAULTS, CSP, clampScale, sanitizePreferences, fitBounds, readPreferences,
  writePreferences, resolveRequestPath, parseRange, isAllowedRequest,
  isVideoPermissionRequest, createStaticServer, createTrayPNG,
  SETTINGS_CSP, resizeBounds, sanitizeSettingsSnapshot, isSettingsCommand, isSettingsPreview,
};
