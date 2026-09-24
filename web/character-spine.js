"use strict";

(() => {
  const owners = new WeakMap();
  const runtimeURL = new URL("cute/vendor/spine-webgl-4.2.120.min.js", document.currentScript.src).href;
  const loadRuntime = () => {
    if (!window.__characterSpineRuntimePromise) {
      window.__characterSpineRuntimePromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const finish = (error) => {
          clearTimeout(timer);
          script.onload = script.onerror = null;
          if (error) { script.remove(); reject(error); }
          else resolve(window.spine);
        };
        const timer = setTimeout(() => finish(new Error("Spine runtime load timed out")), 30000);
        script.src = runtimeURL;
        script.onload = () => finish(window.spine?.SkeletonBinary ? null : new Error("Invalid Spine runtime"));
        script.onerror = () => finish(new Error("Could not load the local Spine runtime"));
        document.head.append(script);
      }).catch((error) => { window.__characterSpineRuntimePromise = null; throw error; });
    }
    return window.__characterSpineRuntimePromise;
  };

  window.createCharacterSpine = async ({
    container, skin, getSpeed = () => 1, getScale = () => 1,
    getBackgroundPlayback = () => false, status = () => {}, signal,
  }) => {
    if (signal?.aborted) throw new DOMException("Spine load aborted", "AbortError");
    owners.get(container)?.destroy();
    const requests = new AbortController();
    const canvas = document.createElement("canvas");
    canvas.className = "narcissus-live2d-canvas";
    canvas.setAttribute("aria-hidden", "true");
    let context, renderer, assets, skeleton, state, observer, controller;
    let destroyed = false, visible = true, speaking = false, busy = false;
    let raf = 0, backgroundTimer = 0, loadTimer = 0, previous = 0;
    let resize = () => {}, visibility = () => {};
    const owner = { destroy: () => destroy() };
    owners.set(container, owner);
    const active = () => !destroyed && !signal?.aborted && owners.get(container) === owner;
    const report = (message) => { if (active()) status(message); };
    const check = () => {
      if (!active() || requests.signal.aborted) {
        throw requests.signal.reason || new DOMException("Spine load aborted", "AbortError");
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      clearInterval(backgroundTimer);
      raf = backgroundTimer = 0;
    };
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      busy = false;
      requests.abort();
      clearTimeout(loadTimer);
      stop();
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      signal?.removeEventListener("abort", destroy);
      canvas.removeEventListener("webglcontextlost", lostContext);
      state?.clearListeners();
      state?.clearTracks();
      assets?.dispose();
      renderer?.dispose();
      context?.dispose();
      context?.gl?.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
      if (owners.get(container) === owner) {
        owners.delete(container);
        container.classList.remove("has-live2d");
        delete container.dataset.action;
        delete container.dataset.speaking;
      }
      skeleton = state = assets = renderer = context = null;
    }
    const fail = (error) => {
      const notify = active() ? controller?.onError : null;
      destroy();
      notify?.(error);
    };
    const lostContext = (event) => {
      event.preventDefault();
      fail(new Error("Spine WebGL context lost"));
    };
    const handleResize = () => { try { resize(); } catch (error) { fail(error); } };
    const handleVisibility = () => { try { visibility(); } catch (error) { fail(error); } };
    signal?.addEventListener("abort", destroy, { once: true });

    try {
      if (location.protocol === "file:") throw new Error("Open Spine through the local HTTP server");
      if (!skin?.model || !skin?.atlas) throw new Error("Spine skin requires model and atlas paths");
      const modelURL = new URL(skin.model, document.baseURI);
      const atlasURL = new URL(skin.atlas, document.baseURI);
      report("Spine: loading runtime");
      // A cancelled consumer must not cancel the shared runtime load for the next skin.
      const s = await new Promise((resolve, reject) => {
        const aborted = () => reject(requests.signal.reason);
        requests.signal.addEventListener("abort", aborted, { once: true });
        loadRuntime().then(resolve, reject).finally(() => requests.signal.removeEventListener("abort", aborted));
        if (requests.signal.aborted) aborted();
      });
      check();
      loadTimer = setTimeout(() => requests.abort(new Error("Spine model load timed out")), 60000);
      const fetchAsset = async (url, type) => {
        check();
        const response = await fetch(url, { signal: requests.signal });
        if (!response.ok) throw new Error(`Spine asset HTTP ${response.status}: ${url}`);
        return response[type]();
      };
      report("Spine: loading model and textures");
      const [buffer, atlasText] = await Promise.all([
        fetchAsset(modelURL, "arrayBuffer"), fetchAsset(atlasURL, "text"),
      ]);
      check();
      const bytes = new Uint8Array(buffer);
      let version;
      try {
        const header = new s.BinaryInput(bytes);
        header.readInt32(); header.readInt32();
        version = header.readString();
      } catch { /* Older binaries store the hash as a string, not two integers. */ }
      if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
        try {
          const legacy = new s.BinaryInput(bytes);
          legacy.readString();
          version = legacy.readString();
        } catch { throw new Error("Invalid Spine binary header"); }
      }
      if (!/^4\.2\./.test(version || "")) {
        throw new Error(`Unsupported Spine skeleton version ${version || "unknown"}; local runtime requires 4.2`);
      }
      const atlas = new s.TextureAtlas(atlasText);
      const data = new s.SkeletonBinary(new s.AtlasAttachmentLoader(atlas)).readSkeletonData(bytes);
      const idle = data.findAnimation("b_idle") || data.findAnimation("idle");
      if (!idle || !(idle.duration > 0)) throw new Error("Spine model has no supported idle animation");
      // Verified against 301701 (4.2.36), not inferred from arbitrary b_/t_ names.
      const charlie = /\/301701\.skel$/.test(modelURL.pathname);
      const actions = (charlie ? ["b_danglian", "b_kanshu", "b_taitou", "b_yaotou", "b_zhiwen"] : [])
        .map((name) => data.findAnimation(name)).filter((animation) => animation?.duration > 0);
      const talk = charlie && data.findAnimation("t_idle");
      const quiet = charlie && data.findAnimation("t_bizui");

      context = new s.ManagedWebGLRenderingContext(canvas, { alpha: true, antialias: true });
      if (!context.gl) throw new Error("WebGL is not available");
      canvas.addEventListener("webglcontextlost", lostContext);
      assets = new s.AssetManager(context);
      // Fetch ourselves: the runtime's Image/XHR loaders cannot be aborted. The
      // private AssetManager owns only this model's GPU textures, never a global cache.
      for (const page of atlas.pages) {
        const url = new URL(page.name, atlasURL).href;
        let texture = assets.get(url);
        if (!texture) {
          const blob = await fetchAsset(url, "blob");
          check();
          const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
          try {
            check();
            texture = new s.GLTexture(context, bitmap);
            assets.cache.assets[url] = texture;
          } finally { bitmap.close(); }
        }
        page.setTexture(texture);
      }
      check();
      clearTimeout(loadTimer);
      renderer = new s.SceneRenderer(canvas, context);
      skeleton = new s.Skeleton(data);
      skeleton.setToSetupPose();
      const stateData = new s.AnimationStateData(data);
      stateData.defaultMix = 0.25;
      state = new s.AnimationState(stateData);

      // Union sampled whole-body poses once; a stable camera avoids breathing zoom.
      const bounds = { left: Infinity, bottom: Infinity, right: -Infinity, top: -Infinity };
      const offset = new s.Vector2(), size = new s.Vector2();
      for (const animation of [idle, ...actions]) {
        for (let sample = 0; sample <= 20; sample++) {
          skeleton.setToSetupPose();
          animation.apply(skeleton, -1, animation.duration * sample / 20, false, [], 1, s.MixBlend.setup, s.MixDirection.mixIn);
          skeleton.updateWorldTransform(s.Physics.update);
          skeleton.getBounds(offset, size, []);
          bounds.left = Math.min(bounds.left, offset.x);
          bounds.bottom = Math.min(bounds.bottom, offset.y);
          bounds.right = Math.max(bounds.right, offset.x + size.x);
          bounds.top = Math.max(bounds.top, offset.y + size.y);
        }
      }
      if (!Object.values(bounds).every(Number.isFinite) || bounds.right <= bounds.left || bounds.top <= bounds.bottom) {
        throw new Error("Spine model has no visible bounds");
      }
      skeleton.setToSetupPose();
      state.setAnimationWith(0, idle, true);
      if (quiet) state.setAnimationWith(1, quiet, true);
      state.apply(skeleton);
      skeleton.updateWorldTransform(s.Physics.update);
      const gl = context.gl;
      const draw = () => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        renderer.begin();
        renderer.drawSkeleton(skeleton, atlas.pages[0]?.pma ?? false);
        renderer.end();
      };
      resize = () => {
        if (!active()) return;
        const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
        const scale = Number(getScale());
        const resolution = Math.min(4, Math.max(0.25, Math.max(2, window.devicePixelRatio || 1) * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
        canvas.width = Math.max(1, Math.round(width * resolution));
        canvas.height = Math.max(1, Math.round(height * resolution));
        const fit = Math.min(Math.max(1, width - 12) / ((bounds.right - bounds.left) * 1.12),
          Math.max(1, height - 12) / ((bounds.top - bounds.bottom) * 1.06));
        renderer.camera.position.x = (bounds.left + bounds.right) / 2;
        renderer.camera.position.y = bounds.bottom + (height / 2 - 4) / fit;
        renderer.camera.viewportWidth = width / fit;
        renderer.camera.viewportHeight = height / fit;
        renderer.camera.update();
        draw();
      };
      let returning = null, lastAction = -1;
      const advance = (now, maxDelta) => {
        if (!active()) return;
        const speed = Number(getSpeed());
        const delta = Math.min(Math.max(0, (now - previous) / 1000), maxDelta) * (Number.isFinite(speed) ? Math.max(0, speed) : 1);
        previous = now;
        state.update(delta);
        skeleton.update(delta);
        state.apply(skeleton);
        skeleton.updateWorldTransform(s.Physics.update);
        if (returning && state.getCurrent(0) === returning && returning.mixTime >= returning.mixDuration) {
          returning = null;
          busy = false;
          container.dataset.action = idle.name;
          report("Spine: idle");
        }
        if (active()) draw();
      };
      const frame = (now) => {
        raf = 0;
        try {
          if (!active() || !visible || document.hidden) return;
          advance(now, 0.05);
          if (active()) raf = requestAnimationFrame(frame);
        } catch (error) { fail(error); }
      };
      visibility = () => {
        stop();
        if (!active() || !visible) return;
        previous = performance.now();
        if (!document.hidden) raf = requestAnimationFrame(frame);
        else if (getBackgroundPlayback()) {
          backgroundTimer = setInterval(() => {
            try {
              if (active() && visible && document.hidden && getBackgroundPlayback()) advance(performance.now(), 1);
              else handleVisibility();
            } catch (error) { fail(error); }
          }, 250);
        }
      };
      controller = {
        destroy,
        resize: handleResize,
        get busy() { return busy; },
        setVisible(value) { if (active()) { visible = Boolean(value); handleVisibility(); } },
        setSpeaking(value) {
          if (!active() || speaking === Boolean(value)) return;
          speaking = Boolean(value);
          container.dataset.speaking = String(speaking);
          if (talk && quiet) {
            try { state.setAnimationWith(1, speaking ? talk : quiet, true); }
            catch (error) { fail(error); }
          }
        },
        async playSpecial() {
          if (!active() || busy || !visible || !actions.length) return;
          try {
            const choices = actions.map((_, i) => i).filter((i) => actions.length === 1 || i !== lastAction);
            lastAction = choices[Math.floor(Math.random() * choices.length)];
            const animation = actions[lastAction];
            busy = true;
            state.setAnimationWith(0, animation, false);
            // Positive delay preserves the ENTIRE one-shot, then mixes into idle.
            returning = state.addAnimationWith(0, idle, true, animation.duration);
            container.dataset.action = animation.name;
            report(`Spine: ${animation.name}`);
          } catch (error) { fail(error); }
        },
        onError: null,
      };
      check();
      container.append(canvas);
      container.classList.add("has-live2d");
      container.dataset.action = idle.name;
      container.dataset.speaking = "false";
      resize();
      window.addEventListener("resize", handleResize);
      observer = new ResizeObserver(handleResize);
      observer.observe(container);
      document.addEventListener("visibilitychange", handleVisibility);
      visibility();
      report("Spine: idle");
      check();
      return controller;
    } catch (error) {
      destroy();
      throw error;
    }
  };
})();
