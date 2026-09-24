"use strict";

(() => {
const owners = new WeakMap();
const scripts = new Map();
const loadScript = (path) => {
  if (!scripts.has(path)) {
    scripts.set(path, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const finish = (error) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("运行库加载超时")), 30000);
      script.src = `cute/Narcissus/Live2D/vendor/${path}`;
      script.onload = () => finish();
      script.onerror = () => finish(new Error("运行库加载失败"));
      document.head.append(script);
    }).catch((error) => { scripts.delete(path); throw error; }));
  }
  return scripts.get(path);
};

window.createNarcissusLive2D = async ({ container, skin = {
  id: "315701", model: "cute/Narcissus/Live2D/315701/315701.model3.json",
}, signal, getSpeed = () => 1, getScale = () => 1, getBackgroundPlayback = () => false, status = () => {} }) => {
  signal?.throwIfAborted();
  owners.get(container)?.();
  const lifetime = new AbortController();
  const active = () => !lifetime.signal.aborted && owners.get(container) === destroy;
  const guard = () => {
    if (!active()) throw lifetime.signal.reason || new DOMException("Live2D replaced", "AbortError");
  };
  const report = (message) => { if (active()) status(message); };
  const wait = (promise) => new Promise((resolve, reject) => {
    const abort = () => reject(lifetime.signal.reason);
    lifetime.signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => lifetime.signal.removeEventListener("abort", abort));
    if (lifetime.signal.aborted) abort();
  });
  const modelURL = new URL(skin.model, location.href);
  const loadAsset = async (path, type = "json") => {
    guard();
    const response = await fetch(new URL(path, modelURL), {
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(30000)]),
    });
    guard();
    if (!response.ok) throw new Error(`模型资源请求失败 (${response.status})`);
    const data = await response[type]();
    guard();
    return data;
  };
  const jsonCache = new Map();
  const loadJSON = (path) => {
    if (!jsonCache.has(path)) {
      jsonCache.set(path, loadAsset(path).catch((error) => { jsonCache.delete(path); throw error; }));
    }
    return jsonCache.get(path);
  };

  let app;
  let model;
  let observer;
  let destroyed = false;
  let visible = true;
  let lostContext;
  let visibility;
  let backgroundTimer;
  let resizeView;
  let setupTimer;
  const bitmaps = new Set();
  const textures = new Set();
  const queues = [];
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    lifetime.abort(new DOMException("Live2D destroyed", "AbortError"));
    signal?.removeEventListener("abort", cancel);
    clearTimeout(setupTimer);
    observer?.disconnect();
    if (resizeView) window.removeEventListener("resize", resizeView);
    app?.stop();
    clearInterval(backgroundTimer);
    if (visibility) document.removeEventListener("visibilitychange", visibility);
    if (lostContext) app?.view.removeEventListener("webglcontextlost", lostContext);
    for (const queue of queues) queue.release();
    if (model && !model.destroyed) {
      if (model.internalModel) model.destroy();
      else window.PIXI.Container.prototype.destroy.call(model);
    }
    for (const texture of textures) texture.destroy(true);
    textures.clear();
    for (const bitmap of bitmaps) bitmap.close();
    bitmaps.clear();
    const context = app?.renderer.gl;
    app?.destroy(true, { children: true });
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    jsonCache.clear();
    if (owners.get(container) === destroy) {
      owners.delete(container);
      container.classList.remove("has-live2d");
      delete container.dataset.action;
      delete container.dataset.actions;
      delete container.dataset.speaking;
    }
  };
  const cancel = () => { lifetime.abort(signal.reason); destroy(); };
  owners.set(container, destroy);
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    guard();
    if (location.protocol === "file:") throw new Error("请用 start_local.bat 打开 Live2D");
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) throw new Error("浏览器不支持 WebGL");
    gl.getExtension("WEBGL_lose_context")?.loseContext();

    report("Live2D：加载运行库…");
    if (!window.Live2DCubismCore) { await wait(loadScript("live2dcubismcore.min.js")); guard(); }
    if (!window.PIXI) { await wait(loadScript("pixi.min.js")); guard(); }
    if (!window.PIXI.live2d) { await wait(loadScript("cubism4.min.js")); guard(); }
    const PIXI = window.PIXI;
    const L = PIXI.live2d;
    setupTimer = setTimeout(() => {
      lifetime.abort(new DOMException("模型加载超时", "TimeoutError"));
      destroy();
    }, 60000);
    report("Live2D：加载模型与纹理…");
    const settings = await loadJSON(modelURL.href);
    guard();
    settings.url = modelURL.href;
    const refs = settings.FileReferences;
    const motionFile = (name) => {
      const file = refs.Motions?.[name]?.[0]?.File;
      if (!file) throw new Error(`未知动作 ${name}`);
      return file;
    };
    const hasMotion = (name) => Boolean(refs.Motions?.[name]?.[0]?.File);
    const expressionNames = new Set((refs.Expressions || []).map((entry) => entry.Name));
    // Reviewed complete gestures, not numbered enter/hold/exit fragments. Unknown skins
    // get only the common nod/shake; a matching file name alone is not proof of safety.
    const complete = {
      "315701": "sikao shenshou2 chayao kuqi shenshou1",
      "315702": "sikao shenshou2 chayao kuqi shenshou1 shuilian",
      "307301": "cashi chashou guancha hequan queyue",
      "307304": "cashi chashou guancha queyue huolian tiaowan",
      "310502": "beishou fengzhizi jiaoxing sikao taitou taitou01 zhaoshou",
      "310503": "beishou fengzhizi jiaoxing sikao taitou taitou01 zhaoshou songhua toukan",
      "310504": "erji erji1 fengzhizi jiaocha sikao taitou taitou01 zhaoshou",
      "306604": "fumo gongji shenshou sisuo tiyi xinxu zhanshi",
      "306605": "fumo niunai sisuo xinxu xuegao zhangshi",
    };
    const moods = { sikao: "renzhen", sisuo: "yansu", chayao: "deyi", kuqi: "nanguo" };
    const actions = ["diantou", "yaotou", ...(complete[skin.id]?.split(" ") || [])]
      .filter((name) => hasMotion(`b_${name}`)).map((name) => {
        const mood = moods[name] || name;
        const paired = expressionNames.has(`e_${mood}`) && hasMotion(`t_${mood}_bizui`) && hasMotion(`t_${mood}`);
        return [`b_${name}`, paired ? `e_${mood}` : "e_idle", paired ? `t_${mood}_bizui` : "t_bizui"];
      });
    const modelOptions = {
      autoUpdate: false, autoInteract: false,
      motionPreload: L.MotionPreloadStrategy.NONE,
      idleMotionGroup: "b_idle",
    };
    const runtime = L.Live2DFactory.findRuntime(settings);
    if (!runtime) throw new Error("不支持的 Live2D 模型");
    await wait(runtime.ready());
    guard();
    // Do not use the factory's uncancellable texture tasks or PIXI's shared URL cache.
    // Every decoded image/texture belongs to this instance, even for the same skin URL.
    const [moc, idleJSON, mouthJSON, physics, pose] = await wait(Promise.all([
      loadAsset(refs.Moc, "arrayBuffer"),
      loadJSON(motionFile("b_idle")), loadJSON(motionFile("t_bizui")),
      refs.Physics ? loadJSON(refs.Physics) : undefined,
      refs.Pose ? loadJSON(refs.Pose) : undefined,
      ...refs.Textures.map(async (file, index) => {
        const blob = await loadAsset(file, "blob");
        guard();
        // WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmap uploads.
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
        if (!active()) { bitmap.close(); guard(); }
        bitmaps.add(bitmap);
        const texture = new PIXI.Texture(new PIXI.BaseTexture(bitmap));
        textures.add(texture);
        texture.modelIndex = index;
      }),
    ]));
    guard();
    if (!runtime.isValidMoc(moc)) throw new Error("无效的 Live2D 模型");
    model = new L.Live2DModel(modelOptions);
    const coreModel = runtime.createCoreModel(moc);
    try {
      model.internalModel = runtime.createInternalModel(coreModel, runtime.createModelSettings(settings), modelOptions);
    } catch (error) { coreModel.release(); throw error; }
    model.textures = [...textures].sort((a, b) => a.modelIndex - b.modelIndex);
    model.emit("modelLoaded", model.internalModel);
    const im = model.internalModel;
    const core = im.coreModel;
    if (physics) im.physics = runtime.createPhysics(core, physics);
    if (pose) im.pose = runtime.createPose(core, pose);
    const mm = im.motionManager;
    let captureActive = false;
    let actionGeneration = 0;
    const currentAction = (generation) => active() && !captureActive && generation === actionGeneration;
    const expressionManager = mm.expressionManager;
    if (expressionManager) {
      const updateExpressions = expressionManager.update.bind(expressionManager);
      expressionManager.update = (target, seconds) => !captureActive && updateExpressions(target, seconds);
    }
    const setExpression = async (name, generation = actionGeneration) => {
      guard();
      const manager = expressionManager;
      if (!currentAction(generation) || !manager || !expressionNames.has(name)) return;
      const index = manager.getExpressionIndex(name);
      if (index < 0) throw new Error(`未知表情 ${name}`);
      if (!manager.expressions[index]) {
        const definition = settings.FileReferences.Expressions[index];
        const data = await loadJSON(definition.File);
        guard();
        if (!currentAction(generation)) return;
        manager.expressions[index] = manager.createExpression(data, definition);
      }
      await wait(manager.setExpression(index));
      guard();
    };
    const queue = () => {
      const result = new L.CubismMotionQueueManager();
      result.setEventCallback(() => {});
      queues.push(result);
      return result;
    };
    const idle = queue();
    const body = queue();
    const mouth = queue();
    const motion = (data, loop) => {
      const result = L.CubismMotion.create(data);
      result.setIsLoop(loop);
      result.setIsLoopFadeIn(false);
      result.setFadeInTime(0.3);
      result.setFadeOutTime(0.3);
      result.setEffectIds(im.settings.getEyeBlinkParameters() || [], im.settings.getLipSyncParameters() || []);
      return result;
    };
    const defaults = Array.from({ length: core.getParameterCount() }, (_, i) => core.getParameterDefaultValue(i));
    const partDefaults = Array.from({ length: core.getPartCount() }, (_, i) => core.getPartOpacityByIndex(i));
    let neutralParameters = defaults;
    let neutralParts = partDefaults;
    let busy = false;
    let playing = false;
    let lastAction = -1;
    let restoreRequested = false;
    let speaking = false;
    let activeMouth = "t_bizui";
    let mouthRequest = 0;
    const updateMouth = async () => {
      if (!active() || captureActive) return;
      const generation = actionGeneration;
      const request = ++mouthRequest;
      const requested = speaking ? (activeMouth === "t_bizui" ? "t_idle" : activeMouth.replace("_bizui", "")) : activeMouth;
      const name = hasMotion(requested) ? requested : "t_bizui";
      try {
        const data = await loadJSON(motionFile(name));
        if (currentAction(generation) && request === mouthRequest) {
          mouth.startMotion(motion(data, true), true, model.elapsedTime / 1000);
        }
      } catch {
        if (currentAction(generation) && request === mouthRequest) {
          mouth.startMotion(motion(mouthJSON, true), true, model.elapsedTime / 1000);
        }
      }
    };
    mm.stopAllMotions();
    im.breath = undefined;
    im.eyeBlink = undefined;
    im.updateFocus = () => {};
    // The first frame is also the deterministic capture baseline, without fade-in.
    const initialIdle = motion(idleJSON, true);
    const initialMouth = motion(mouthJSON, true);
    initialIdle.setFadeInTime(0);
    initialMouth.setFadeInTime(0);
    idle.startMotion(initialIdle, true, 0);
    mouth.startMotion(initialMouth, true, 0);

    // The running idle remains underneath the one-shot body layer during both fades.
    mm.update = (target, seconds) => {
      if (captureActive) {
        for (let i = 0; i < neutralParameters.length; i++) target.setParameterValueByIndex(i, neutralParameters[i]);
        for (let i = 0; i < neutralParts.length; i++) target.setPartOpacityByIndex(i, neutralParts[i]);
        return true;
      }
      for (let i = 0; i < defaults.length; i++) target.setParameterValueByIndex(i, defaults[i]);
      for (let i = 0; i < partDefaults.length; i++) target.setPartOpacityByIndex(i, partDefaults[i]);
      idle.doUpdateMotion(target, seconds);
      body.doUpdateMotion(target, seconds);
      mouth.doUpdateMotion(target, seconds);
      if (playing && body.isFinished() && !restoreRequested) {
        restoreRequested = true;
        playing = false;
        activeMouth = "t_bizui";
        updateMouth();
        const generation = actionGeneration;
        setExpression("e_idle", generation).then(() => {
          if (!currentAction(generation)) return;
          busy = false;
          container.dataset.action = "b_idle";
          report("Live2D · 待机");
        }).catch(() => { if (currentAction(generation)) busy = false; });
      }
      return true;
    };
    const bones = Array.from({ length: core.getDrawableCount() }, (_, i) => i)
      .filter((i) => /bone/i.test(core.getDrawableId(i)));
    const update = im.update.bind(im);
    im.update = (dt, now) => {
      update(dt, now);
      for (const i of bones) core.getModel().drawables.opacities[i] = 0;
    };
    await setExpression("e_idle");
    guard();
    im.update(0, 0);
    // Cubism restores the pre-expression parameters after updating the mesh.
    neutralParameters = defaults.map((_, i) => core.getParameterValueByIndex(i));
    neutralParts = partDefaults.map((_, i) => core.getPartOpacityByIndex(i));
    const parameterData = core.getModel().parameters;
    // getParameterIndex() synthesizes missing IDs in this runtime; never use it here.
    const parameterIndices = new Map(parameterData.ids.map((id, i) => [id, i]));
    const sharedEyes = skin.id === "310504" || skin.id === "306604";
    const spathodea = skin.id === "307301" || skin.id === "307304";
    // Inputs use anatomical sides; 306605's authored L/R eye labels are reversed.
    const mapping = [
      ["ParamAngleX", "yaw", -30, 30, 0.7, true],
      ["ParamAngleY", "pitch", -25, 25, 0.7, true],
      ["ParamAngleZ", "roll", -25, 25, 0.7, true],
      ["ParamEyeLOpen", sharedEyes ? "eyeOpen" : skin.id === "306605" ? "eyeOpenR" : "eyeOpenL", 0, 1],
      [spathodea ? "ParamEyeLOpen2" : "ParamEyeROpen", skin.id === "306605" ? "eyeOpenL" : "eyeOpenR", 0, 1],
      ["ParamMouthOpenY", "jawOpen", 0, 1],
    ];
    const smileGain = { "315701": 1, "315702": 1, "307301": -1, "307304": -1, "310504": 1, "306604": 1, "306605": 30 }[skin.id];
    if (smileGain !== undefined) mapping.push(["ParamMouthForm", "smile", 0, 1, smileGain]);
    if (skin.id === "315701" || skin.id === "315702") {
      mapping.push(["ParamBrowLY", "browL", -1, 1], ["ParamBrowRY", "browR", -1, 1]);
    }
    const captureChannels = mapping.filter(([id]) => parameterIndices.has(id)).map(([id, key, low, high, gain = 1, offset = false]) => {
      const index = parameterIndices.get(id);
      return { index, key, low, high, gain, offset, min: parameterData.minimumValues[index], max: parameterData.maximumValues[index],
        neutral: neutralParameters[index], value: neutralParameters[index] };
    });
    let captureValues = null;
    let captureTime = performance.now();
    im.on("beforeModelUpdate", () => {
      if (!active() || !captureActive || !visible) return;
      const now = performance.now();
      const weight = 1 - Math.exp(-Math.max(0, now - captureTime) / 80);
      captureTime = now;
      for (const channel of captureChannels) {
        const input = captureValues?.[channel.key];
        const target = input === undefined ? channel.neutral : Math.max(channel.min, Math.min(channel.max,
          (channel.offset ? channel.neutral : 0) + input * channel.gain));
        channel.value += (target - channel.value) * weight;
        core.setParameterValueByIndex(channel.index, channel.value);
      }
    });

    // Model bounds contain large transparent margins; fit the visible mesh instead.
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    const point = new PIXI.Point();
    for (let i = 0; i < core.getDrawableCount(); i++) {
      if (bones.includes(i) || core.getDrawableOpacity(i) <= 0.001) continue;
      const vertices = im.getDrawableVertices(i);
      for (let j = 0; j < vertices.length; j += 2) {
        point.set(vertices[j], vertices[j + 1]);
        im.localTransform.apply(point, point);
        bounds.left = Math.min(bounds.left, point.x);
        bounds.right = Math.max(bounds.right, point.x);
        bounds.top = Math.min(bounds.top, point.y);
        bounds.bottom = Math.max(bounds.bottom, point.y);
      }
    }
    if (!Number.isFinite(bounds.left)) throw new Error("模型没有可显示的图层");
    // Supersample small artwork, accounting for the container's CSS scale as well as DPR.
    const resolution = () => Math.min(4, Math.max(2, devicePixelRatio || 1) * getScale());
    app = new PIXI.Application({
      width: container.clientWidth, height: container.clientHeight,
      resolution: resolution(), autoDensity: true,
      backgroundAlpha: 0, antialias: true, autoStart: false,
    });
    app.view.className = "narcissus-live2d-canvas";
    app.view.setAttribute("aria-hidden", "true");
    app.stage.addChild(model);
    model.anchor.set(0);
    const resize = () => {
      if (!active()) return;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      app.renderer.resolution = resolution();
      app.renderer.resize(width, height);
      // Reserve space for accessories/arms; never refit every frame (which causes wobble).
      const scale = Math.min(Math.max(1, width - 12) / ((bounds.right - bounds.left) * 1.18),
        Math.max(1, height - 12) / ((bounds.bottom - bounds.top) * 1.06));
      model.scale.set(scale);
      model.position.set(width / 2 - (bounds.left + bounds.right) / 2 * scale, height - 4 - bounds.bottom * scale);
    };
    resize();
    resizeView = resize;
    window.addEventListener("resize", resizeView);
    observer = new ResizeObserver(resize);
    observer.observe(container);
    app.ticker.add(() => {
      if (active()) model.update(Math.min(app.ticker.deltaMS, 50) * getSpeed());
    }, undefined, PIXI.UPDATE_PRIORITY.HIGH);
    visibility = () => {
      clearInterval(backgroundTimer);
      if (!active()) return;
      if (!visible || document.hidden) app.stop();
      else app.start();
      // requestAnimationFrame pauses in background tabs; advance at low frequency
      // so actions can finish and subsequent idle interactions are not locked out.
      if (visible && document.hidden && getBackgroundPlayback()) {
        let previous = performance.now();
        backgroundTimer = setInterval(() => {
          if (!active()) return;
          const now = performance.now();
          model.update(Math.min(now - previous, 1000) * getSpeed());
          previous = now;
          app.renderer.render(app.stage);
        }, 250);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    app.renderer.render(app.stage);
    guard();
    container.append(app.view);
    container.classList.add("has-live2d");
    container.dataset.action = "b_idle";
    container.dataset.actions = JSON.stringify(actions.map(([name]) => name));
    container.dataset.speaking = "false";
    visibility();
    clearTimeout(setupTimer);
    report("Live2D · 待机");
    guard();

    const controller = {
      destroy,
      resize,
      actions: Object.freeze(actions.map(([name]) => name)),
      supportsMotionCapture: true,
      get busy() { return active() && (busy || captureActive); },
      setVisible(value) {
        if (!active()) return;
        visible = Boolean(value);
        if (!visible) {
          captureValues = null;
          captureTime = performance.now();
          for (const channel of captureChannels) channel.value = channel.neutral;
        }
        visibility();
      },
      setMotionCapture(value) {
        if (!active() || captureActive === Boolean(value)) return;
        captureActive = Boolean(value);
        const generation = ++actionGeneration;
        ++mouthRequest;
        idle.stopAllMotions();
        body.stopAllMotions();
        mouth.stopAllMotions();
        if (expressionManager) {
          expressionManager.stopAllExpressions();
          expressionManager.reserveExpressionIndex = -1;
          // A stopped cached e_idle must not make setExpression() return early.
          expressionManager.currentExpression = expressionManager.defaultExpression;
        }
        captureValues = null;
        captureTime = performance.now();
        for (const channel of captureChannels) channel.value = channel.neutral;
        playing = restoreRequested = speaking = false;
        activeMouth = "t_bizui";
        container.dataset.speaking = "false";
        busy = true;
        if (captureActive) {
          container.dataset.action = "motion_capture";
          report("Live2D · 摄像头动捕");
        } else {
          const seconds = model.elapsedTime / 1000;
          idle.startMotion(motion(idleJSON, true), true, seconds);
          mouth.startMotion(motion(mouthJSON, true), true, seconds);
          setExpression("e_idle", generation).then(() => {
            if (!currentAction(generation)) return;
            busy = false;
            container.dataset.action = "b_idle";
            report("Live2D · 待机");
          }).catch((error) => {
            if (!currentAction(generation)) return;
            busy = false;
            container.dataset.action = "b_idle";
            report(`Live2D · 待机表情恢复失败：${error.message}`);
          });
        }
      },
      updateMotionCapture(values) {
        if (!active() || !captureActive || !visible) return;
        captureValues = null;
        if (!values || typeof values !== "object") return;
        const packet = {};
        for (const channel of captureChannels) {
          if (channel.key === "eyeOpen") {
            const eyes = [values.eyeOpenL, values.eyeOpenR].filter(Number.isFinite).map(value => Math.max(0, Math.min(1, value)));
            if (eyes.length) packet.eyeOpen = eyes.reduce((sum, value) => sum + value, 0) / eyes.length;
          } else if (Number.isFinite(values[channel.key])) {
            packet[channel.key] = Math.max(channel.low, Math.min(channel.high, values[channel.key]));
          }
        }
        captureValues = packet;
      },
      setSpeaking(value) {
        if (!active() || captureActive || speaking === Boolean(value)) return;
        speaking = Boolean(value);
        container.dataset.speaking = String(speaking);
        updateMouth();
      },
      async playSpecial() {
        if (!active() || captureActive || busy || !visible || !actions.length) return;
        const generation = ++actionGeneration;
        busy = true;
        let index = Math.floor(Math.random() * actions.length);
        if (index === lastAction) index = (index + 1) % actions.length;
        lastAction = index;
        const [bodyName, expressionName, mouthName] = actions[index];
        report("Live2D：加载动作…");
        try {
          const [bodyJSON] = await Promise.all([
            loadJSON(motionFile(bodyName)), loadJSON(motionFile(mouthName)),
          ]);
          guard();
          if (!currentAction(generation)) return;
          await setExpression(expressionName, generation);
          guard();
          if (!currentAction(generation)) return;
          const seconds = model.elapsedTime / 1000;
          activeMouth = mouthName;
          updateMouth();
          body.startMotion(motion(bodyJSON, false), true, seconds);
          restoreRequested = false;
          playing = true;
          container.dataset.action = bodyName;
          report(`Live2D · ${bodyName}`);
        } catch (error) {
          if (currentAction(generation)) { busy = false; report(`动作加载失败，可重试：${error.message}`); }
        }
      },
      onError: null,
    };
    lostContext = (event) => {
      event.preventDefault();
      destroy();
      controller.onError?.(new Error("WebGL 上下文丢失"));
    };
    app.view.addEventListener("webglcontextlost", lostContext);
    return controller;
  } catch (error) {
    destroy();
    throw error;
  }
};
})();
