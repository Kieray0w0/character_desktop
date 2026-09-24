'use strict';
// Manual visual audit using the production renderer; no camera, audio or automatic motions.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..', 'web');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Arm mapping preview</title>
<style>body{margin:20px;background:#dedbd4;font:14px sans-serif}button{padding:8px;margin:3px}.models{display:flex;gap:20px}.model{width:440px;height:560px;position:relative;border:1px solid #888;background:#ede9e1}.model canvas{width:100%;height:100%}p{margin:8px 0}</style>
<script src="narcissus-live2d.js"></script></head><body><h1>310504 arm mapping audit</h1>
<p id="status">Loading the production renderer...</p><div id="buttons"></div>
<p id="pose">Neutral</p><div id="sample" class="model"></div>
<script type="module">
const skin={id:'310504',model:'cute/Flutterpage/Live2D/310504/310504.model3.json'};
try {
const controller=await window.createNarcissusLive2D({container:document.getElementById('sample'),skin,status:()=>{},getBackgroundPlayback:()=>true});
controller.setMotionCapture(true);
const samples={'Neutral':{},'Left upper +45':{armLiftL:45},'Right upper +45':{armLiftR:45},'Left elbow +60':{elbowBendL:60},'Right elbow +60':{elbowBendR:60},'Both raised':{armLiftL:45,armLiftR:45,elbowBendL:60,elbowBendR:60},'Both lowered':{armLiftL:-45,armLiftR:-45,elbowBendL:-60,elbowBendR:-60}};
for(const [name,values] of Object.entries(samples)){const b=document.createElement('button');b.textContent=name;b.onclick=()=>{controller.updateMotionCapture(values);document.getElementById('pose').textContent=name;};document.getElementById('buttons').append(b);}
document.getElementById('status').textContent='READY: controller reports arms='+controller.supportsArmCapture;
addEventListener('pagehide',()=>controller.destroy(),{once:true});
}catch(e){document.getElementById('status').textContent='FAIL: '+e.message;}
</script></body></html>`;
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 const relative=req.url.slice(1);
 if(relative.includes('..')||relative.includes('\\')||!(relative==='narcissus-live2d.js'||relative.startsWith('cute/Flutterpage/Live2D/310504/')||['live2dcubismcore.min.js','pixi.min.js','cubism4.min.js'].some(f=>relative==='cute/Narcissus/Live2D/vendor/'+f))){res.writeHead(404);return res.end();}
 const file=path.join(root,relative);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.webp')?'image/webp':'application/octet-stream');fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log('Arm model preview: http://127.0.0.1:'+server.address().port));
