'use strict';
// Real MediaPipe model smoke check on a synthetic blank frame, without camera permission.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'web');
const allowed = new Set(['body-pose.task','face-tracking/vendor/models/face_landmarker.task',
  'face-tracking/vendor/vision_bundle.mjs','face-tracking/vendor/wasm/vision_wasm_internal.js',
  'face-tracking/vendor/wasm/vision_wasm_internal.wasm','face-tracking/vendor/wasm/vision_wasm_nosimd_internal.js',
  'face-tracking/vendor/wasm/vision_wasm_nosimd_internal.wasm']);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Body tracking runtime check</title></head><body>
<h1>Local face + body runtime check</h1><p>No camera, microphone or network upload.</p><pre id="result">Loading local models...</pre><canvas id="frame" width="480" height="360"></canvas>
<script type="module">
import {FilesetResolver,FaceLandmarker,PoseLandmarker} from '/face-tracking/vendor/vision_bundle.mjs';
let face,pose;
try {
  const files=await FilesetResolver.forVisionTasks('/face-tracking/vendor/wasm');
  face=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/face-tracking/vendor/models/face_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true});
  pose=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/body-pose.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,outputSegmentationMasks:false});
  const canvas=document.getElementById('frame'); const ctx=canvas.getContext('2d');ctx.fillStyle='#888';ctx.fillRect(0,0,480,360);
  for (const timestamp of [1000,1160,1320]) {face.detectForVideo(canvas,timestamp);pose.detectForVideo(canvas,timestamp);}
  document.getElementById('result').textContent='PASS: both local CPU models loaded and performed three video inferences each.';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.message;}
finally{face?.close();pose?.close();}
</script></body></html>`;
const server=http.createServer((req,res)=>{
  const relative=req.url.slice(1);
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(!allowed.has(relative)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',relative.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(relative)?'text/javascript':'application/octet-stream');
  fs.createReadStream(path.join(root,relative)).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log('Body smoke: http://127.0.0.1:'+server.address().port));
