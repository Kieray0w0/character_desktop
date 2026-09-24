'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'web');
const context = { console, WebAssembly, TextDecoder, TextEncoder, performance, setTimeout, clearTimeout, atob };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'cute/Narcissus/Live2D/vendor/live2dcubismcore.min.js'), 'utf8'), context);
context.window = {};
vm.runInContext(fs.readFileSync(path.join(root, 'cute/characters.js'), 'utf8'), context);
setTimeout(() => {
  const core = context.Live2DCubismCore;
  for (const character of context.window.CHARACTER_CATALOG) for (const skin of character.skins) {
    if (skin.type !== 'live2d') continue;
    const modelPath = path.join(root, skin.model);
    const json = JSON.parse(fs.readFileSync(modelPath));
    const buffer = fs.readFileSync(path.join(path.dirname(modelPath), json.FileReferences.Moc));
    const moc = core.Moc.fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    const model = core.Model.fromMoc(moc);
    const p = model.parameters;
    const parameters = p.ids.map((id, i) => ({id, min:p.minimumValues[i], max:p.maximumValues[i], default:p.defaultValues[i]}));
    const index = p.ids.indexOf('ParamBodyAngleZ');
    model.update();
    const before = model.drawables.vertexPositions.map(vertices => Array.from(vertices));
    p.values[index] = Math.min(p.maximumValues[index], p.defaultValues[index] + 5.4);
    model.update();
    let changedCoordinates = 0;
    model.drawables.vertexPositions.forEach((vertices, i) => vertices.forEach((value, j) => {
      if (Math.abs(value - before[i][j]) > .00001) changedCoordinates++;
    }));
    if (index < 0 || changedCoordinates === 0) throw new Error('No effective body tilt: ' + skin.id);
    console.log(JSON.stringify({character:character.id, skin:skin.id, changedCoordinates,
      parameters:parameters.filter(p=>/body|arm|hand|shoulder|elbow|hiji|ude|kata|leg/i.test(p.id))}));
    model.release(); moc._release();
  }
}, 500);
