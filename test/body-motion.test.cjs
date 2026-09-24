'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const native = require('../native.cjs');
const modulePromise = import('../web/body-motion.mjs');
const nose = { x: .5, y: .3 };
const pose = (degrees = 0) => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  const dy = Math.tan(degrees * Math.PI / 180) * .4 * 480 / 360;
  landmarks[0] = { ...nose, visibility: 1 };
  landmarks[11] = { x: .7, y: .6 + dy / 2, visibility: 1 };
  landmarks[12] = { x: .3, y: .6 - dy / 2, visibility: 1 };
  return { landmarks: [landmarks] };
};
test('shoulders calibrate independently, correct video aspect and clamp tilt', async () => {
  const { shoulderSample } = await modulePromise;
  assert.equal(shoulderSample(pose(8), nose, 480, 360).bodyRoll, 0);
  const reference = shoulderSample(pose(8), nose, 480, 360).neutral;
  assert.ok(Math.abs(shoulderSample(pose(13), nose, 480, 360, reference).bodyRoll + 5) < 1e-8);
  assert.equal(shoulderSample(pose(30), nose, 480, 360, 0).bodyRoll, -12);
  assert.equal(shoulderSample(pose(-30), nose, 480, 360, 0).bodyRoll, 12);
});
test('shoulder tracking rejects missing, obscured, offscreen or mismatched subjects', async () => {
  const { shoulderSample } = await modulePromise;
  for (const landmark of [0, 11, 12]) for (const patch of [{visibility: .1}, {visibility: undefined}, {x: NaN}, {y: 1.1}]) {
    const input = pose();
    Object.assign(input.landmarks[0][landmark], patch);
    assert.equal(shoulderSample(input, nose, 480, 360), null);
  }
  assert.equal(shoulderSample({}, nose, 480, 360), null);
  assert.equal(shoulderSample(pose(), null, 480, 360), null);
  assert.equal(shoulderSample(pose(), {x:.1,y:.1}, 480, 360), null);
  assert.equal(shoulderSample(pose(), nose, 0, 360), null);
  const crossed = pose(); [crossed.landmarks[0][11], crossed.landmarks[0][12]] = [crossed.landmarks[0][12], crossed.landmarks[0][11]];
  assert.equal(shoulderSample(crossed, nose, 480, 360), null);
});
test('body tracker throttles, clears on missing face, recalibrates and closes on detection errors', async () => {
  const { loadBodyTracker } = await modulePromise;
  let degrees = 0, calls = 0, closes = 0, fail = false;
  const messages = [];
  const tracker = await loadBodyTracker({ current: () => true, report: m => messages.push(m), create: async () => ({
    detectForVideo() { calls++; if (fail) throw Error('detect'); return pose(degrees); }, close() { closes++; },
  }) });
  const video = { videoWidth:480, videoHeight:360 };
  assert.equal(tracker.sample(video, 0, nose).bodyRoll, 0);
  degrees = 10;
  tracker.sample(video, 80, nose); assert.equal(calls, 1);
  assert.ok(tracker.sample(video, 160, nose).bodyRoll < -9);
  assert.equal(tracker.sample(video, 170, null), null);
  assert.equal(tracker.sample(video, 240, nose), null);
  tracker.calibrate();
  assert.equal(tracker.sample(video, 320, nose).bodyRoll, 0);
  fail = true;
  assert.equal(tracker.sample(video, 480, nose), null);
  assert.equal(closes, 1);
  tracker.close(); assert.equal(closes, 1);
  assert.ok(messages.at(-1).includes('回退'));
});
test('body startup timeout or cancellation closes late trackers and returns safely', async () => {
  const { loadBodyTracker } = await modulePromise;
  for (const cancel of [false, true]) {
    let current = true, closes = 0;
    const pending = Promise.withResolvers();
    const started = loadBodyTracker({ create: () => pending.promise, current: () => current, report() {}, timeoutMs: 5 });
    if (cancel) current = false;
    assert.equal(await started, null);
    pending.resolve({close() { closes++; }});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1);
  }
  assert.equal(await loadBodyTracker({create: async () => {throw Error('bad model');},current:()=>true,report() {}}), null);
});

function captureFixture({ body = true, bodyFailure = false } = {}) {
  let callback, mediaRequests = 0, faceClosed = 0, bodyClosed = 0, stopped = 0;
  let facePresent = true, timestamp = 0;
  const samples = [], states = [], bodyStates = [];
  const video = { hidden:true, readyState:2, currentTime:0, videoWidth:480, videoHeight:360, play:async()=>{},pause(){} };
  const fakeBody = {sample:()=>({bodyRoll:3}),clear(){},calibrate(){this.calibrated=true;},close(){bodyClosed++;}};
  const context = {
    window: { isSecureContext:true }, document: {currentScript:{src:'http://localhost/face-capture.js'},hidden:false},
    navigator:{mediaDevices:{getUserMedia:async options=>{mediaRequests++; assert.equal(options.audio,false); return {getTracks:()=>[{stop(){stopped++;}}],getVideoTracks:()=>[{addEventListener(){}}]};}}},
    URL, Promise, performance:{now:()=>timestamp},setTimeout,clearTimeout,
    requestAnimationFrame:cb=>{callback=cb;return 1;},cancelAnimationFrame(){callback=null;},
    __import:async url=> {
      if(url.endsWith('vision_bundle.mjs'))return {FilesetResolver:{forVisionTasks:async()=>({})},
        FaceLandmarker:{createFromOptions:async()=>({close(){faceClosed++;},detectForVideo(){return {faceLandmarks:facePresent?[[{},nose]]:[]};}})},
        PoseLandmarker:{createFromOptions:async()=>({})}};
      if(url.endsWith('/body-motion.mjs'))return {loadBodyTracker:async()=> {if(bodyFailure)throw Error('unavailable'); return fakeBody;}};
      return {faceSample:()=>facePresent?{rotation:[1],values:{yaw:2}}:null};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/face-capture.js'),'utf8').replace(/\bimport\(/g,'__import('),context);
  const capture = context.window.createFaceCapture({video,onState:s=>states.push(s),onSample:s=>samples.push(s),getBodyEnabled:()=>body,onBodyState:s=>bodyStates.push(s)});
  return {capture,video,samples,states,bodyStates,fakeBody,
    stats:()=>({mediaRequests,faceClosed,bodyClosed,stopped}),
    tick(present=true){facePresent=present;timestamp+=160;video.currentTime+=.16;callback(timestamp);},
  };
}
test('combined capture shares one camera, merges body samples and closes both trackers', async () => {
  const f=captureFixture(); await f.capture.start(); f.tick();
  assert.equal(f.samples.at(-1).bodyRoll,3); assert.equal(f.samples.at(-1).yaw,2);
  f.capture.calibrate(); assert.equal(f.fakeBody.calibrated,true);
  f.tick(false); assert.equal(f.samples.at(-1),null);
  f.capture.stop();
  assert.deepEqual(f.stats(),{mediaRequests:1,faceClosed:1,bodyClosed:1,stopped:1});
  assert.equal(f.video.srcObject,null);
});
test('body disabled or failed does not prevent face-only capture', async () => {
  for (const options of [{body:false},{bodyFailure:true}]) {
    const f=captureFixture(options); await f.capture.start(); f.tick();
    assert.equal(f.samples.at(-1).yaw,2); assert.equal(f.samples.at(-1).bodyRoll,undefined);
    f.capture.stop(); assert.equal(f.stats().stopped,1);
  }
  assert.equal(native.isSettingsCommand({id:'body-follow',event:'change',checked:true}),true);
  assert.equal(native.isSettingsCommand({id:'body-follow',event:'change',checked:'true'}),false);
  assert.equal(native.isSettingsCommand({id:'arm-follow',event:'change',checked:true}),true);
  assert.equal(native.isSettingsCommand({id:'arm-follow',event:'change',checked:'true'}),false);
});

function armPose(left = 0, right = 0, leftBend = 0, rightBend = 0) {
  const result = pose(), p = result.landmarks[0];
  p[11] = {x:.65,y:.4,visibility:1}; p[12] = {x:.35,y:.4,visibility:1};
  for (const [s,e,w,angle,bend,direction] of [[11,13,15,left,leftBend,1],[12,14,16,right,rightBend,-1]]) {
    const offset = a => ({x:direction*Math.sin(a*Math.PI/180)*60/480,y:Math.cos(a*Math.PI/180)*60/360});
    const u=offset(angle), f=offset(angle+bend);
    p[e]={x:p[s].x+u.x,y:p[s].y+u.y,visibility:1};
    p[w]={x:p[e].x+f.x,y:p[e].y+f.y,visibility:1};
  }
  return result;
}
test('arm angles distinguish anatomical sides, elbow flexion and torso tilt', async () => {
  const {armSample}=await modulePromise;
  const original=armPose(35,20,50,70);
  const values=armSample(original,480,360);
  for(const [key,expected] of Object.entries({armLiftL:35,armLiftR:20,elbowBendL:50,elbowBendR:70})) assert.ok(Math.abs(values[key]-expected)<1e-6,key);
  const rotated=structuredClone(original), angle=10*Math.PI/180;
  for(const point of rotated.landmarks[0]) {
    const x=(point.x-.5)*480, y=(point.y-.4)*360;
    point.x=.5+(x*Math.cos(angle)-y*Math.sin(angle))/480;
    point.y=.4+(x*Math.sin(angle)+y*Math.cos(angle))/360;
  }
  const relative=armSample(rotated,480,360);
  for(const key of Object.keys(values)) assert.ok(Math.abs(relative[key]-values[key])<1e-6,key);
});
test('wrist or elbow loss clears only the corresponding channels; invalid geometry is rejected',async()=>{
  const {armSample}=await modulePromise;
  const result=armPose(20,20,30,30);
  result.landmarks[0][15].visibility=.2;
  let values=armSample(result,480,360);
  assert.equal(values.elbowBendL,undefined);assert.ok(Number.isFinite(values.armLiftL));assert.ok(Number.isFinite(values.elbowBendR));
  result.landmarks[0][13].x=NaN;
  values=armSample(result,480,360);
  assert.equal(values.armLiftL,undefined);assert.ok(Number.isFinite(values.armLiftR));
  result.landmarks[0][14]={...result.landmarks[0][12]};
  assert.deepEqual(armSample(result,480,360),{});
  assert.deepEqual(armSample({},480,360),{});
  assert.deepEqual(armSample(armPose(),NaN,360),{});
});
test('arm tracker waits for stable calibration, clamps offsets and returns lost limbs to neutral',async()=>{
  const {loadBodyTracker}=await modulePromise;
  let result=armPose();
  const create=async()=>({detectForVideo:()=>result,close(){}});
  const tracker=await loadBodyTracker({create,current:()=>true,report(){},armsEnabled:true});
  const video={videoWidth:480,videoHeight:360};
  assert.equal(tracker.sample(video,0,nose).armLiftL,undefined);
  assert.equal(tracker.sample(video,160,nose).armLiftL,undefined);
  assert.equal(tracker.sample(video,320,nose).armLiftL,0);
  result=armPose(80,30,80,40);
  let values=tracker.sample(video,480,nose);
  assert.equal(values.armLiftL,45);assert.equal(values.elbowBendL,60);
  assert.ok(Math.abs(values.armLiftR-30)<1e-6);
  result.landmarks[0][15].visibility=.1;
  values=tracker.sample(video,640,nose);
  assert.equal(values.elbowBendL,undefined);assert.equal(values.armLiftL,45);
  tracker.calibrate();
  assert.equal(tracker.sample(video,800,nose).armLiftR,undefined);
  tracker.sample(video,960,nose);
  assert.equal(tracker.sample(video,1120,nose).armLiftR,0);
  assert.equal(tracker.sample(video,1130,null),null);
  tracker.close();
  const disabled=await loadBodyTracker({create,current:()=>true,report(){},armsEnabled:false});
  assert.deepEqual(Object.keys(disabled.sample(video,0,nose)),['bodyRoll']);disabled.close();
});
