(() => {
  const base = new URL('face-tracking/', document.currentScript.src);
  window.createFaceCapture = ({ video, onState, onSample, getBodyEnabled = () => false, getArmsEnabled = () => false, onBodyState = () => {} }) => {
    let active = false, generation = 0, stream, landmarker, frame = 0, timeout;
    let neutral = null, lastTime = -1, lastFrame = -Infinity, lastFace = 0;
    let stateKey = '';
    let bodyTracker = null;
    const report = (state, message) => {
      const key = `${state}:${message}`;
      if (key === stateKey) return;
      stateKey = key;
      onState({ active, state, message });
    };
    const stop = (message = '动捕已关闭，摄像头已释放。', state = 'off') => {
      active = false;
      generation++;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      const previous = stream;
      stream = null;
      previous?.getTracks().forEach(track => track.stop());
      video.pause();
      video.srcObject = null;
      video.hidden = true;
      const previousLandmarker = landmarker;
      landmarker = null;
      bodyTracker?.close();
      bodyTracker = null;
      onBodyState('上半身跟随已关闭。');
      try { previousLandmarker?.close(); } catch { /* Camera tracks are already stopped. */ }
      neutral = null;
      onSample(null);
      report(state, message);
    };
    const start = async () => {
      if (active) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        report('error', '摄像头需要 HTTPS 或 localhost，请通过 start_local.bat 打开。');
        return;
      }
      if (document.hidden) return;
      active = true;
      const request = ++generation;
      const current = () => active && request === generation;
      report('loading', '请允许摄像头权限；只在本机识别，不录制、不上传。');
      timeout = setTimeout(() => { if (current()) stop('摄像头或动捕加载超时，请重试。', 'error'); }, 60000);
      try {
        const camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 30 } },
        });
        // Permission dialogs cannot be aborted. Release even a late permission grant.
        if (!current()) { camera.getTracks().forEach(track => track.stop()); return; }
        stream = camera;
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => { if (current()) stop('摄像头已断开，请重新开启动捕。', 'error'); }, { once: true });
        }
        video.srcObject = camera;
        video.hidden = false;
        await video.play();
        if (!current()) return;
        report('loading', '正在加载本地人脸识别模型…');
        const [{ FaceLandmarker, PoseLandmarker, FilesetResolver }, { faceSample }] = await Promise.all([
          import(new URL('vendor/vision_bundle.mjs', base).href),
          import(new URL('pose.mjs', base).href),
        ]);
        if (!current()) return;
        const fileset = await FilesetResolver.forVisionTasks(new URL('vendor/wasm', base).href);
        if (!current()) return;
        const tracker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL('vendor/models/face_landmarker.task', base).href, delegate: 'CPU' },
          runningMode: 'VIDEO', numFaces: 1,
          outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        });
        if (!current()) { tracker.close(); return; }
        landmarker = tracker;
        if (getBodyEnabled()) {
          onBodyState('正在加载本地身体模型…');
          try {
            const { loadBodyTracker } = await import(new URL('../body-motion.mjs', base).href);
            if (!current()) return;
            const body = await loadBodyTracker({
              armsEnabled: Boolean(getArmsEnabled()),
              current, report: message => { if (current()) onBodyState(message); },
              create: () => PoseLandmarker.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: new URL('../body-pose.task', base).href, delegate: 'CPU' },
                runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .6,
                minPosePresenceConfidence: .6, minTrackingConfidence: .6, outputSegmentationMasks: false,
              }),
            });
            if (!current()) { body?.close(); return; }
            bodyTracker = body;
          } catch {
            if (current()) onBodyState('身体模型不可用，已回退为面部动捕。');
          }
        } else onBodyState('仅面部动捕；上半身跟随未开启。');
        if (!current()) return;
        clearTimeout(timeout);
        neutral = null;
        lastTime = -1;
        lastFrame = -Infinity;
        lastFace = performance.now();
        report('searching', '请正对摄像头，首次识别会校准头部朝向。');
        const tick = now => {
          if (!current()) return;
          try {
            // Inference is throttled separately from the character's render ticker.
            if (video.readyState >= 2 && video.currentTime !== lastTime && now - lastFrame >= 80) {
              lastTime = video.currentTime;
              lastFrame = now;
              const result = tracker.detectForVideo(video, now);
              const sample = faceSample(result, neutral);
              if (sample) {
                neutral ||= sample.rotation;
                lastFace = now;
                const body = bodyTracker?.sample(video, now, result.faceLandmarks?.[0]?.[1]);
                onSample({ ...sample.values, ...body });
                report('tracking', '动捕中：头部、眨眼、张嘴；微笑和眉毛依皮肤支持。');
              } else {
                bodyTracker?.clear();
                onSample(null);
                report('searching', '未检测到人脸，角色正回到中立姿态。');
              }
            }
            if (now - lastFace > 1000) onSample(null);
            if (now - lastFace > 30000) {
              stop('30 秒未检测到人脸，已关闭摄像头。');
              return;
            }
            frame = requestAnimationFrame(tick);
          } catch (error) {
            if (current()) stop(`动捕运行失败，摄像头已释放：${error.message}`, 'error');
          }
        };
        frame = requestAnimationFrame(tick);
      } catch (error) {
        if (!current()) return;
        const messages = {
          NotAllowedError: '摄像头权限被拒绝，请在浏览器地址栏允许后重试。',
          NotFoundError: '未找到摄像头，请连接摄像头后重试。',
          NotReadableError: '无法读取摄像头，可能正被其他应用占用。',
          SecurityError: '浏览器禁止访问摄像头，请检查站点权限。',
        };
        stop(messages[error.name] || `动捕加载失败，摄像头已释放：${error.message}`, 'error');
      }
    };
    return {
      start, stop,
      get active() { return active; },
      calibrate() {
        if (!active || !landmarker) return;
        neutral = null;
        bodyTracker?.calibrate();
        onSample(null);
        if (bodyTracker) onBodyState('请让双肩及需要跟随的手臂入镜，静止片刻重新校准基准…');
        report('searching', bodyTracker ? '请正对摄像头，正在重新校准头部和身体姿态…' : '请正对摄像头，正在重新校准头部朝向…');
      },
    };
  };
})();
