const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

// Anatomical left/right, unmirrored camera coordinates. Correct for video aspect ratio.
export function shoulderSample(result, faceNose, width, height, neutral = null) {
  const p = result?.landmarks?.[0];
  const valid = point => point && [point.x, point.y].every(Number.isFinite) &&
    point.x > .01 && point.x < .99 && point.y > .01 && point.y < .99 &&
    Number.isFinite(point.visibility) && point.visibility >= .7;
  if (!p || ![p[0], p[11], p[12]].every(valid) ||
      ![width, height].every(v => Number.isFinite(v) && v > 0) ||
      !faceNose || ![faceNose.x, faceNose.y].every(Number.isFinite)) return null;
  // Reject a pose belonging to a different face or poorly resolved/side-on shoulders.
  const dx = (p[11].x - p[12].x) * width;
  const dy = (p[11].y - p[12].y) * height;
  const span = Math.hypot(dx, dy);
  if (dx < width * .08 || span < width * .12 || span > width * .85 ||
      Math.hypot((p[0].x - faceNose.x) * width, (p[0].y - faceNose.y) * height) > span * .25) return null;
  const angle = -Math.atan2(dy, dx) * 180 / Math.PI;
  if (Math.abs(angle) > 45) return null;
  const reference = Number.isFinite(neutral) ? neutral : angle;
  return { neutral: reference, bodyRoll: clamp(angle - reference, -12, 12) };
}

// Image-plane arm angles relative to the shoulder axis, not global camera axes.
// Each side is independent; wrist loss must not discard a visible upper arm.
export function armSample(result, width, height) {
  const p = result?.landmarks?.[0];
  const valid = point => point && [point.x, point.y, point.visibility].every(Number.isFinite) &&
    point.visibility >= .75 && point.x > .01 && point.x < .99 && point.y > .01 && point.y < .99;
  if (!p || ![p[11], p[12]].every(valid) || ![width, height].every(v => Number.isFinite(v) && v > 0)) return {};
  const vector = (a, b) => [(b.x - a.x) * width, (b.y - a.y) * height];
  const shoulder = vector(p[12], p[11]), span = Math.hypot(...shoulder);
  if (shoulder[0] < width * .08 || span < width * .12) return {};
  const across = shoulder.map(v => v / span), down = [-across[1], across[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const values = {};
  for (const [side, shoulderIndex, elbowIndex, wristIndex, direction] of [['L',11,13,15,1], ['R',12,14,16,-1]]) {
    if (!valid(p[elbowIndex])) continue;
    const upper = vector(p[shoulderIndex], p[elbowIndex]), length = Math.hypot(...upper);
    if (length < span * .18 || length > span * 1.35) continue;
    const lift = Math.atan2(direction * dot(upper, across), dot(upper, down)) * 180 / Math.PI;
    if (lift < -30 || lift > 150) continue;
    values[`armLift${side}`] = lift;
    if (!valid(p[wristIndex])) continue;
    const lower = vector(p[elbowIndex], p[wristIndex]), lowerLength = Math.hypot(...lower);
    if (lowerLength < span * .15 || lowerLength > span * 1.4) continue;
    const bend = Math.acos(clamp(dot(upper, lower) / (length * lowerLength), -1, 1)) * 180 / Math.PI;
    if (bend <= 155) values[`elbowBend${side}`] = bend;
  }
  return values;
}

// Optional tracker: failure must never take down face capture or request another camera.
export async function loadBodyTracker({ create, current, report, armsEnabled = false, timeoutMs = 10000 }) {
  let expired = false;
  let timer;
  let tracker;
  const creation = Promise.resolve().then(create).then(value => {
    if (expired || !current()) { value.close(); return null; }
    return value;
  });
  try {
    tracker = await Promise.race([creation, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('timeout')); }, timeoutMs);
    })]);
  } catch {
    expired = true;
    if (current()) report('身体模型加载失败，已回退为面部动捕。');
    return null;
  } finally { clearTimeout(timer); }
  if (!tracker || !current()) { tracker?.close(); return null; }
  let neutral = null, values = null, lastRun = -Infinity, lastGood = -Infinity;
  const armNeutral = new Map(), armPending = new Map();
  let closed = false;
  const clear = () => { values = null; lastGood = -Infinity; armPending.clear(); };
  const close = () => {
    if (closed) return;
    closed = true;
    clear();
    try { tracker.close(); } catch { /* Camera ownership remains with face capture. */ }
  };
  report('上半身跟随已就绪，请让双肩完整入镜。');
  return {
    close,
    clear,
    calibrate() { neutral = null; armNeutral.clear(); clear(); },
    sample(video, now, faceNose) {
      if (closed || !current()) return null;
      if (!faceNose) { clear(); return null; }
      if (now - lastRun >= 160) {
        lastRun = now;
        try {
          const result = tracker.detectForVideo(video, now);
          const sample = shoulderSample(result, faceNose, video.videoWidth, video.videoHeight, neutral);
          if (sample) {
            neutral = sample.neutral;
            values = { bodyRoll: sample.bodyRoll };
            if (armsEnabled) {
              const arms = armSample(result, video.videoWidth, video.videoHeight);
              for (const key of ['armLiftL', 'armLiftR', 'elbowBendL', 'elbowBendR']) {
                if (!Number.isFinite(arms[key])) { armPending.delete(key); continue; }
                if (!armNeutral.has(key)) {
                  let pending = armPending.get(key) || [];
                  if (pending.length && Math.abs(arms[key] - pending[0]) > 12) pending = [];
                  pending.push(arms[key]); armPending.set(key, pending);
                  if (pending.length < 3) continue;
                  armNeutral.set(key, pending.reduce((a,b) => a+b, 0) / pending.length);
                  armPending.delete(key);
                }
                const limit = key.startsWith('armLift') ? 45 : 60;
                values[key] = clamp(arms[key] - armNeutral.get(key), -limit, limit);
              }
            }
            lastGood = now;
            if (armsEnabled) {
              const channels = Object.keys(values).length - 1;
              report(channels ? `身体及手臂跟随中（${channels}/4 手臂通道）；丢失部位回到中立。` : '身体跟随中；请让肩、肘、腕入镜并静止片刻，建立手臂基准。');
            } else report('身体跟随中：双肩倾斜控制身体侧倾；手臂未启用。');
          } else {
            clear();
            report('双肩不清晰或超出画面，身体回到中立；面部动捕继续。');
          }
        } catch {
          close();
          report('身体识别发生错误，已回退为面部动捕。');
        }
      }
      return now - lastGood <= 400 ? values : null;
    },
  };
}
