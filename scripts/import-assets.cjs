#!/usr/bin/env node
'use strict';

// No build_online invocation, network access, or recursive source-directory copy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'web');
const MANIFEST = 'resource-manifest.json';
const EXPECTED = { files: 675, live2d: 9, spine: 1, voiceManifests: 9, mp3: 261 };
const WHITELIST = [
  'narcissus-live2d.js',
  'character-spine.js',
  'face-capture.js',
  'cute/Narcissus/Live2D/vendor/live2dcubismcore.min.js',
  'cute/Narcissus/Live2D/vendor/pixi.min.js',
  'cute/Narcissus/Live2D/vendor/cubism4.min.js',
  'cute/Narcissus/Live2D/vendor/PIXI-LICENSE.txt',
  'cute/Narcissus/Live2D/vendor/PIXI-LIVE2D-LICENSE.txt',
  'cute/Narcissus/Live2D/README.md',
  'cute/vendor/spine-webgl-4.2.120.min.js',
  'cute/vendor/spine-webgl-LICENSE.txt',
  'cute/vendor/README.md',
  'face-tracking/pose.mjs',
  'face-tracking/README.md',
  'face-tracking/vendor/vision_bundle.mjs',
  'face-tracking/vendor/wasm/vision_wasm_internal.js',
  'face-tracking/vendor/wasm/vision_wasm_internal.wasm',
  'face-tracking/vendor/wasm/vision_wasm_nosimd_internal.js',
  'face-tracking/vendor/wasm/vision_wasm_nosimd_internal.wasm',
  'face-tracking/vendor/models/face_landmarker.task',
  'face-tracking/vendor/LICENSE',
  'face-tracking/vendor/README.md',
  'face-tracking/vendor/provenance.json',
  'face-tracking/vendor/provenance/package.json',
];
const THIRD_PARTY = `# Third-Party Resources

## Game Assets

Reverse: 1999 characters, artwork, models, skeletons, textures, animations,
voices and dialogue belong to Bluepoch and their respective creators.
Asset catalog/viewer: https://uttu.merui.net/
Model origin: https://model.merui.net/ (l2d and spine).
Voice origin: https://voice.merui.net/ (English voices, locally converted to MP3).
Attribution and possession of these files do not grant redistribution rights.
Obtain the necessary permissions before distributing game assets.

## Rendering Libraries

- PixiJS 6.5.10: MIT; web/cute/Narcissus/Live2D/vendor/PIXI-LICENSE.txt.
- pixi-live2d-display 0.4.0: MIT; web/cute/Narcissus/Live2D/vendor/PIXI-LIVE2D-LICENSE.txt.
- Live2D Cubism Core: separate proprietary SDK terms, not the PixiJS license.
  https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
  Original embedded notices and web/cute/Narcissus/Live2D/README.md are preserved.
- Spine WebGL 4.2.120: web/cute/vendor/spine-webgl-LICENSE.txt and README.md.
  https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-webgl@4.2.120/dist/iife/spine-webgl.min.js
  The Spine Runtimes and Spine Editor license requirements apply; this is not MIT.

## Local Face Tracking

Google MediaPipe @mediapipe/tasks-vision 0.10.21: Apache-2.0 runtime.
The complete upstream license, including its appended notice, is preserved in
web/face-tracking/vendor/LICENSE. Original package metadata, pinned URLs,
archive member information and hashes are in web/face-tracking/vendor/provenance.json
and provenance/package.json; the vendor README explains their verification.
The float16 revision-1 face_landmarker.task model has license NOASSERTION:
no model-specific license grant was verified. Do not infer model-weight rights
from the runtime license. Confirm terms with Google before redistribution.
https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

## Reproduction And Offline Verification

Run node scripts/import-assets.cjs to import from ../html into web.
Use --source PATH to select another source tree (relative to the app root).
Use --dry-run to validate and report without writing.
Run node scripts/import-assets.cjs --verify-only to check the complete imported
dependency closure and SHA-256 hashes without accessing the source or network.
resource-manifest.json records every imported file's source path, source SHA-256,
output SHA-256, byte counts and transformations. The catalog wrapper is generated
from cute/characters.json; voice manifests retain id/label/en/zh and use only MP3
for both audio fields. Only explicit runtime dependencies and approved license/
documentation/provenance files are imported. The source tree is never modified.
The importer does not own or overwrite the desktop frontend, main or preload.
All runtime resources are local after import; ../html is not needed to run them.
Source README references to downloaders/website tools are historical documentation,
not runtime dependencies. No source maps, OGG, GIFs, website HTML, contests/calendar,
Read folders, caches, snapshots, backups or repository histories are imported.
`;

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function relativePath(value) {
  // Reject URL escapes and Windows aliases as well as ordinary traversal.
  if (typeof value !== 'string' || !value || /[\\:%?#\x00-\x1f<>"|*]/.test(value)) {
    throw new Error(`Invalid resource path: ${value}`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe resource path: ${value}`);
  }
  return value;
}

function checkedPath(root, relative, mustExist = true) {
  relativePath(relative);
  // The root itself is valid for top-level JS wrappers; only member paths need
  // nonempty components. Reject junctions/symlinks before reading or writing.
  const segments = [root];
  for (const component of relative.split('/')) segments.push(path.join(segments.at(-1), component));
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (!mustExist && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Symlink/junction refused: ${current}`);
    if (i < segments.length - 1 && !stat.isDirectory()) throw new Error(`Not a directory: ${current}`);
    if (i === segments.length - 1 && (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error(`Not a regular, unshared file: ${current}`);
    }
  }
  const target = segments.at(-1);
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`Outside root: ${target}`);
  return target;
}

function forbidden(relative) {
  return relative.split('/').some(part => /^(read|archive|\.git|__pycache__|node_modules|gif|snapshots?|history|histories|backups?|story)$/i.test(part)
    || /(?:cache|snapshot|backup)/i.test(part))
    || /\.(?:html?|css|ogg|gif|map|pyc|bak)$/i.test(relative)
    || /(?:^|\/)(?:contests[^/]*|calendar[^/]*|character-gif\.js|assets\.json)$/i.test(relative);
}

function plan(root, offline = false) {
  const files = new Map();
  const folded = new Set();
  const voices = new Set();
  const audioFiles = new Set();
  const models = { live2d: new Set(), spine: new Set() };
  function add(relative, source = relative, transform) {
    relativePath(relative);
    if (forbidden(relative)) throw new Error(`Forbidden import: ${relative}`);
    if (files.has(relative)) return files.get(relative).data;
    if (folded.has(relative.toLowerCase())) throw new Error(`Case collision: ${relative}`);
    const original = fs.readFileSync(checkedPath(root, source));
    const data = transform ? transform(original) : original;
    files.set(relative, { data, entry: {
      path: relative, source, sourceBytes: original.length, sourceSha256: sha(original),
      bytes: data.length, sha256: sha(data), transform: transform ? 'generated' : 'copy',
    } });
    folded.add(relative.toLowerCase());
    return data;
  }
  function resource(relative, extension) {
    relativePath(relative);
    if (!/^cute\/[^/]+\/(?:Live2D|Spine|Voice)\//.test(relative) || !extension.test(relative)) {
      throw new Error(`Unexpected dependency: ${relative}`);
    }
    return add(relative);
  }
  function dependency(parent, reference, extension) {
    relativePath(reference); // Validate before joining, so ../ cannot disappear.
    return resource(`${path.posix.dirname(parent)}/${reference}`, extension);
  }
  const catalogPath = offline ? 'cute/characters.js' : 'cute/characters.json';
  const catalogText = fs.readFileSync(checkedPath(root, catalogPath), 'utf8');
  // Parse the pure assignment wrapper as JSON, never execute imported code.
  const wrapped = offline && /^window\.CHARACTER_CATALOG = ([\s\S]*);\n$/.exec(catalogText);
  if (offline) assert(wrapped, 'Invalid catalog JS wrapper');
  const catalog = JSON.parse(offline ? wrapped[1] : catalogText);
  add('cute/characters.js', catalogPath, () =>
    Buffer.from(`window.CHARACTER_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`));
  for (const character of catalog) {
    for (const skin of character.skins) {
      if (skin.type === 'live2d') {
        models.live2d.add(skin.model);
        const refs = JSON.parse(resource(skin.model, /\.model3\.json$/)).FileReferences;
        const known = ['Moc', 'Textures', 'Physics', 'Pose', 'DisplayInfo', 'UserData', 'Motions', 'Expressions'];
        for (const key of Object.keys(refs)) {
          if (!known.includes(key)) throw new Error(`Unrecognized Live2D reference field: ${key}`);
        }
        dependency(skin.model, refs.Moc, /\.moc3$/);
        for (const texture of refs.Textures) dependency(skin.model, texture, /\.(?:webp|png|jpe?g)$/i);
        for (const key of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) {
          if (refs[key]) dependency(skin.model, refs[key], /\.json$/);
        }
        for (const motion of Object.values(refs.Motions || {}).flat()) {
          dependency(skin.model, motion.File, /\.motion3\.json$/);
          if (motion.Sound) dependency(skin.model, motion.Sound, /\.mp3$/);
        }
        for (const expression of refs.Expressions || []) dependency(skin.model, expression.File, /\.exp3\.json$/);
      } else if (skin.type === 'spine') {
        models.spine.add(skin.model);
        resource(skin.model, /\.skel$/);
        const atlas = resource(skin.atlas, /\.atlas$/).toString('utf8');
        // A Spine atlas page starts the file or follows an empty line.
        let page = true;
        let pages = 0;
        for (const line of atlas.split(/\r?\n/)) {
          const text = line.trim();
          if (!text) { page = true; continue; }
          if (page) { dependency(skin.atlas, text, /\.(?:webp|png|jpe?g)$/i); pages++; }
          page = false;
        }
        assert(pages > 0, `No atlas pages: ${skin.atlas}`);
      } else {
        throw new Error(`Unsupported model type: ${skin.type}`);
      }
      if (voices.has(skin.voices)) continue;
      relativePath(skin.voices);
      if (!/^cute\/[^/]+\/Voice\/(?:[^/]+\/)?voices\.json$/.test(skin.voices)) {
        throw new Error(`Unexpected voice manifest: ${skin.voices}`);
      }
      voices.add(skin.voices);
      add(skin.voices, skin.voices, original => {
        const manifest = JSON.parse(original);
        const records = manifest.voices.map(record => {
          const audio = record.audioMp3 || record.audio;
          resource(audio, /\.mp3$/);
          audioFiles.add(audio);
          const normalized = {};
          for (const key of ['id', 'label', 'en', 'zh']) {
            assert(Object.hasOwn(record, key), `Missing voice field ${key}: ${skin.voices}`);
            normalized[key] = record[key];
          }
          return { ...normalized, audio, audioMp3: audio };
        });
        const result = { source: manifest.source ?? null, voices: records };
        assert(!/\.ogg\b/i.test(JSON.stringify(result)), `OGG in normalized manifest: ${skin.voices}`);
        return jsonBytes(result);
      });
    }
  }
  for (const relative of WHITELIST) add(relative);
  const provenance = JSON.parse(files.get('face-tracking/vendor/provenance.json').data);
  for (const asset of provenance.assets) {
    relativePath(asset.file);
    const item = files.get(`face-tracking/vendor/${asset.file}`);
    assert(item, `Unlisted face dependency: ${asset.file}`);
    assert.equal(item.entry.sha256, asset.sha256, `Face provenance SHA: ${asset.file}`);
    assert.equal(item.entry.bytes, asset.bytes, `Face provenance size: ${asset.file}`);
  }
  const counts = { files: files.size, live2d: models.live2d.size, spine: models.spine.size,
    voiceManifests: voices.size, mp3: audioFiles.size };
  assert.deepEqual(counts, EXPECTED, `Unexpected resource counts: ${JSON.stringify(counts)}`);
  return { files: new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), counts };
}

function auditOutput(allowed) {
  if (!fs.existsSync(OUT)) return;
  const walk = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error(`Output symlink/junction: ${relative}`);
      // Frontend files are owned by the application, never by the importer.
      if (!prefix && (['index.html', 'desktop.js', 'settings.html', 'settings.js', 'theme.js', 'button-icons.js', 'body-motion.mjs'].includes(item.name) || /\.css$/i.test(item.name))) continue;
      if (forbidden(relative)) throw new Error(`Forbidden output: ${relative}`);
      if (item.isDirectory()) walk(path.join(directory, item.name), `${relative}/`);
      else if (!allowed.has(relative)) throw new Error(`Unmanaged runtime file (not removed): ${relative}`);
    }
  };
  checkedPath(APP, 'web/.import-path-check', false);
  walk(OUT);
}

function verify() {
  const manifest = JSON.parse(fs.readFileSync(checkedPath(APP, MANIFEST)));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.output, 'web');
  assert.deepEqual(manifest.counts, EXPECTED);
  const imported = plan(OUT, true); // This path never accesses the original source.
  const desktop = JSON.parse(fs.readFileSync(checkedPath(APP, 'desktop-resources.json')));
  assert.equal(desktop.schemaVersion, 1);
  assert.deepEqual(desktop.overrides.map(entry => entry.path).sort(), ['face-capture.js', 'narcissus-live2d.js']);
  assert.deepEqual(desktop.additions.map(entry => entry.path), ['body-pose.task']);
  const overrides = new Map(desktop.overrides.map(entry => [entry.path, entry]));
  for (const entry of [...desktop.overrides, ...desktop.additions]) {
    const data = fs.readFileSync(checkedPath(OUT, entry.path));
    assert.equal(data.length, entry.bytes, `Desktop size mismatch: ${entry.path}`);
    assert.equal(sha(data), entry.sha256, `Desktop SHA mismatch: ${entry.path}`);
  }
  assert.deepEqual(manifest.files.map(entry => entry.path), [...imported.files.keys()]);
  let bytes = 0;
  for (const entry of manifest.files) {
    relativePath(entry.source);
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    const data = fs.readFileSync(checkedPath(OUT, entry.path));
    const override = overrides.get(entry.path);
    if (override) assert.equal(override.baseSha256, entry.sha256, `Desktop baseline mismatch: ${entry.path}`);
    assert.equal(data.length, (override || entry).bytes, `Size mismatch: ${entry.path}`);
    assert.equal(sha(data), (override || entry).sha256, `SHA mismatch: ${entry.path}`);
    assert.equal(sha(data), imported.files.get(entry.path).entry.sha256, `Normalization mismatch: ${entry.path}`);
    if (entry.transform === 'copy') {
      assert.equal(entry.sourceSha256, entry.sha256, `Source SHA mismatch: ${entry.path}`);
      assert.equal(entry.sourceBytes, entry.bytes);
    }
    bytes += entry.bytes;
  }
  assert.equal(bytes, manifest.totalBytes);
  const attribution = fs.readFileSync(checkedPath(APP, 'THIRD_PARTY.md'));
  assert.equal(sha(attribution), manifest.attribution.sha256);
  assert.equal(attribution.length, manifest.attribution.bytes);
  auditOutput(new Set([...imported.files.keys(), ...desktop.additions.map(entry => entry.path)]));
  console.log(`Verified offline: ${manifest.files.length} baseline resources, ${desktop.overrides.length} desktop overrides and ${desktop.additions.length} pinned pose model; 9 Live2D, 1 Spine, 261 MP3; no forbidden/unmanaged runtime files.`);
  return manifest;
}

function main() {
  let source = path.resolve(APP, '../html');
  let verifyOnly = false;
  let dryRun = false;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--source' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) source = path.resolve(APP, process.argv[++i]);
    else if (arg === '--verify-only') verifyOnly = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help') {
      console.log('node scripts/import-assets.cjs [--source PATH] [--dry-run | --verify-only]\nOutput is always this application\'s web directory. --verify-only needs no source.');
      return;
    } else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (verifyOnly && dryRun) throw new Error('Choose --verify-only or --dry-run');
  if (verifyOnly) { verify(); return; }
  if (fs.existsSync(path.join(APP, 'desktop-resources.json'))) {
    throw new Error('Desktop tracking overrides are present. Import is blocked to prevent overwriting desktop code; merge resource updates and review desktop-resources.json explicitly.');
  }
  const realSource = fs.realpathSync(source);
  const realApp = fs.realpathSync(APP);
  const overlap = (a, b) => { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  if (overlap(realSource, realApp) || overlap(realApp, realSource)) throw new Error('Source and application must be disjoint');
  const imported = plan(source);
  auditOutput(new Set(imported.files.keys()));
  for (const relative of imported.files.keys()) checkedPath(OUT, relative, false);
  checkedPath(APP, MANIFEST, false);
  checkedPath(APP, 'THIRD_PARTY.md', false);
  const entries = [...imported.files.values()].map(item => item.entry);
  const attribution = Buffer.from(THIRD_PARTY);
  const manifest = {
    schemaVersion: 1, algorithm: 'sha256', source: path.relative(APP, source).split(path.sep).join('/'),
    output: 'web', counts: imported.counts, totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    attribution: { path: 'THIRD_PARTY.md', bytes: attribution.length, sha256: sha(attribution) }, files: entries,
  };
  console.log(`${dryRun ? 'Would import' : 'Importing'} ${entries.length} files from ${source} into ${OUT}: ${manifest.totalBytes} bytes.`);
  if (dryRun) return;
  for (const [relative, { data }] of imported.files) {
    const target = checkedPath(OUT, relative, false);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Avoid writes on repeated imports; only the selected resource set is owned.
    if (!fs.existsSync(target) || sha(fs.readFileSync(target)) !== sha(data)) fs.writeFileSync(target, data);
    assert.equal(sha(fs.readFileSync(target)), sha(data), `Post-copy SHA: ${relative}`);
  }
  fs.writeFileSync(checkedPath(APP, 'THIRD_PARTY.md', false), attribution);
  fs.writeFileSync(checkedPath(APP, MANIFEST, false), jsonBytes(manifest));
  verify();
  console.log(`Written: web resources (${manifest.totalBytes} bytes), ${MANIFEST} (${jsonBytes(manifest).length} bytes), THIRD_PARTY.md (${attribution.length} bytes).`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
