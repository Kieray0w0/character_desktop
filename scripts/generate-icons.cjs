'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createTrayPNG } = require('../native.cjs');

const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => createTrayPNG(size));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
const assets = path.join(__dirname, '..', 'assets');
fs.writeFileSync(path.join(assets, 'app.ico'), Buffer.concat([header, ...images]));
fs.writeFileSync(path.join(assets, 'app.png'), images.at(-1));
fs.writeFileSync(path.join(assets, 'tray.png'), createTrayPNG());
console.log('Generated app.ico (8 sizes), app.png and tray.png.');
