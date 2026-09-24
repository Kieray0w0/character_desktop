'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'web');
const folder = path.join(root, 'cute/Flutterpage/Live2D/310504');
const context = {console, WebAssembly, TextDecoder, TextEncoder, performance, setTimeout, clearTimeout, atob};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'cute/Narcissus/Live2D/vendor/live2dcubismcore.min.js'), 'utf8'), context);
setTimeout(() => {
  const core = context.Live2DCubismCore, buffer = fs.readFileSync(path.join(folder, '310504.moc3'));
  const moc = core.Moc.fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const model = core.Model.fromMoc(moc), p = model.parameters, d = model.drawables;
  for (const file of ['b_idle', 't_bizui']) {
    const json = JSON.parse(fs.readFileSync(path.join(folder, `motions/${file}.motion3.json`)));
    for (const curve of json.Curves) {
      if (curve.Target === 'Parameter') { const i = p.ids.indexOf(curve.Id); if (i >= 0) p.values[i] = curve.Segments[1]; }
    }
  }
  const baseline = Float32Array.from(p.values);
  model.update();
  const before = d.vertexPositions.map(v => Array.from(v));
  const mean = v => [v.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(v.length/2), v.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/(v.length/2)];
  for (const id of ['ParamArmLxuanzhuan','ParamArmRxuanzhuan','ParamLSArmxuanzhuan','ParamRSArmxuanzhuan']) {
    const i = p.ids.indexOf(id);
    for (const delta of [-10, 10]) {
      p.values.set(baseline); p.values[i] = Math.max(p.minimumValues[i],Math.min(p.maximumValues[i],baseline[i]+delta));
      model.update();
      const affected = d.vertexPositions.map((vertices, j)=>{
        const after=Array.from(vertices), a=mean(before[j]), b=mean(after);
        return {id:d.ids[j],opacity:d.opacities[j],before:a.map(v=>+v.toFixed(3)),after:b.map(v=>+v.toFixed(3)),distance:+Math.hypot(b[0]-a[0],b[1]-a[1]).toFixed(3)};
      }).filter(v=>v.opacity>.1&&v.distance>.001&&!/bone/i.test(v.id)).sort((a,b)=>b.distance-a.distance).slice(0,8);
      console.log(JSON.stringify({id,base:baseline[i],delta:p.values[i]-baseline[i],min:p.minimumValues[i],max:p.maximumValues[i],affected}));
    }
  }
  model.release();moc._release();
},500);
