'use strict';
// Explicitly record reviewed desktop changes without rewriting the website import baseline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'resource-manifest.json')));
const digest = file => {
  const bytes = fs.readFileSync(path.join(root, 'web', file));
  return { path: file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};
const model = digest('body-pose.task');
assert.equal(model.sha256, '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a');
const records = {
  schemaVersion: 1,
  overrides: ['face-capture.js', 'narcissus-live2d.js'].map(file => ({
    ...digest(file), baseSha256: baseline.files.find(entry => entry.path === file).sha256,
    reason: 'Desktop-only optional shoulder and 310504 arm tracking; preserve original website import provenance.',
  })),
  additions: [{ ...model,
    source: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    license: 'NOASSERTION: model-specific license not verified; do not infer rights from the runtime license.',
  }],
};
fs.writeFileSync(path.join(root, 'desktop-resources.json'), JSON.stringify(records, null, 2) + '\n');
console.log('Recorded reviewed desktop overrides and pinned pose model.');
