(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MB = 1000000;
  const MIN_VIDEO_BPS = 150000;
  const MAX_VIDEO_BPS = 50000000;
  const state = {
    file: null, url: "", width: 0, height: 0, duration: 0,
    busy: false, session: null, resultUrl: "", mode: "auto", output: null
  };

  const fmtMB = (bytes) => (bytes / MB).toFixed(2) + " MB";
  const fmtRate = (bps) => bps >= 1000000 ? (bps / 1000000).toFixed(2) + " Mbps" : Math.round(bps / 1000) + " kbps";
  const fmtTime = (seconds) => {
    const s = Math.floor(Math.max(0, Number(seconds) || 0));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };

  function supportedMime(kind, audio) {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
    const mp4Audio = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4;codecs="avc1.4D401F,mp4a.40.2"',
    ];
    const mp4Silent = [
      'video/mp4;codecs="avc1.42E01E"',
      'video/mp4;codecs="avc1.4D401F"',
    ];
    const webmAudio = [
      'video/webm;codecs="vp9,opus"',
      'video/webm;codecs="vp8,opus"',
      "video/webm"
    ];
    const webmSilent = [
      'video/webm;codecs="vp9"',
      'video/webm;codecs="vp8"',
      "video/webm"
    ];
    const types = kind === "webm"
      ? [...(audio ? webmAudio : webmSilent), ...(audio ? mp4Audio : mp4Silent)]
      : [...(audio ? mp4Audio : mp4Silent), ...(audio ? webmAudio : webmSilent)];
    return types.find((mime) => MediaRecorder.isTypeSupported(mime)) || null;
  }

  function selectedMime() {
    return supportedMime($("output-type").value, Number($("audio-rate").value) > 0);
  }

  function outputResolution() {
    if (!state.width || !state.height) return null;
    if (state.mode === "auto") return [state.width, state.height];
    const choice = $("resolution").value;
    if (choice === "original") return [state.width, state.height];
    if (choice === "custom") {
      const width = Number($("custom-width").value);
      const height = Number($("custom-height").value);
      if (!Number.isInteger(width) || !Number.isInteger(height) ||
          width < 64 || height < 64 || width > 4096 || height > 4096) {
        throw new Error("自定义尺寸必须是 64–4096 之间的整数像素");
      }
      if (width * height > 16000000) throw new Error("输出画面不能超过 1600 万像素");
      return [width, height];
    }
    const limits = { "2160": 3840, "1080": 1920, "720": 1280, "480": 854, "360": 640 };
    const ratio = Math.min(1, limits[choice] / Math.max(state.width, state.height));
    return [
      Math.max(2, Math.round(state.width * ratio / 2) * 2),
      Math.max(2, Math.round(state.height * ratio / 2) * 2)
    ];
  }

  function autoRates() {
    const target = Number($("target-size").value);
    const audioRate = Number($("audio-rate").value) * 1000;
    if (!Number.isFinite(target) || target < 1 || target > 2000) {
      throw new Error("目标大小请输入 1–2000 MB");
    }
    if (!state.duration) throw new Error("请先导入视频");
    // Reserve 9% for container overhead and real-world encoder overshoot.
    const total = target * MB * 8 / state.duration * .91;
    const videoBps = Math.min(MAX_VIDEO_BPS, Math.max(MIN_VIDEO_BPS, Math.floor(total - audioRate)));
    return { videoBps, audioBps: audioRate, targetBytes: target * MB };
  }

  function customRates() {
    const mbps = Number($("manual-bitrate").value);
    if (!Number.isFinite(mbps) || mbps < .15 || mbps > 50) {
      throw new Error("视频码率范围为 0.15–50 Mbps");
    }
    return { videoBps: Math.round(mbps * 1000000), audioBps: Number($("audio-rate").value) * 1000, targetBytes: 0 };
  }

  function updateMimeHint() {
    const mime = selectedMime();
    if (!mime) {
      $("type-hint").textContent = "当前浏览器不支持所需的视频录制格式。请尝试最新版 Chrome / Edge，并确保使用 HTTPS。";
      return;
    }
    const preferred = $("output-type").value;
    const actual = mime.startsWith("video/mp4") ? "MP4" : "WebM";
    const fallback = preferred !== actual.toLowerCase();
    $("type-hint").textContent =
      "当前浏览器预计导出：" + actual +
      (fallback ? "（首选格式不可用，自动选择兼容格式）" : "") +
      "。输出格式以实际编码器为准，无法保证所有浏览器都支持 MP4。";
  }

  function updateEstimates() {
    updateMimeHint();
    if (!state.file) {
      $("auto-res").textContent = "与原视频相同";
      $("auto-bitrate").textContent = "导入后计算";
      $("auto-estimate").textContent = "—";
      $("custom-estimate").textContent = "导入后计算";
      $("custom-res").textContent = "—";
      return;
    }
    $("auto-res").textContent = state.width + " × " + state.height;
    try {
      const auto = autoRates();
      $("auto-bitrate").textContent = fmtRate(auto.videoBps);
      const size = state.duration * (auto.videoBps + auto.audioBps) / 8;
      $("auto-estimate").textContent = fmtMB(size) + "（近似）";
    } catch {
      $("auto-bitrate").textContent = "请填写目标 MB";
      $("auto-estimate").textContent = "—";
    }
    try {
      const size = outputResolution();
      const manual = customRates();
      $("custom-res").textContent = size[0] + " × " + size[1];
      $("custom-estimate").textContent = fmtMB(state.duration * (manual.videoBps + manual.audioBps) / 8 * 1.04) + "（近似）";
    } catch {
      $("custom-res").textContent = "设置有误";
      $("custom-estimate").textContent = "—";
    }
    const target = Number($("target-size").value);
    document.querySelectorAll("[data-target]").forEach((button) =>
      button.classList.toggle("selected", Number(button.dataset.target) === target));
  }

  function setBusy(value) {
    state.busy = value;
    $("start").disabled = value || !state.file || !selectedMime();
    $("clear-video").disabled = value || !state.file;
    $("choose-file").disabled = value;
    $("cancel").hidden = !value;
    for (const element of document.querySelectorAll(".settings-panel input, .settings-panel select, .settings-panel .segmented button, .settings-panel .size-presets button")) {
      element.disabled = value;
    }
    $("reset").disabled = value;
  }

  function closeResult() {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = "";
    $("result-preview").pause();
    $("result-preview").removeAttribute("src");
    $("result-preview").load();
    $("results").hidden = true;
  }

  function cleanupInput() {
    $("source-preview").pause();
    $("source-preview").removeAttribute("src");
    $("source-preview").load();
    if (state.url) URL.revokeObjectURL(state.url);
    state.file = null;
    state.url = "";
    state.width = state.height = state.duration = 0;
    $("source-card").hidden = true;
    $("source-codec").hidden = true;
    closeResult();
    $("progress").hidden = true;
    updateEstimates();
    setBusy(false);
  }

  async function inspectFileCodec(file) {
    // MP4 is a container. For a practical, privacy-preserving hint, inspect
    // only the head and tail, where the ISO-BMFF movie metadata usually lives.
    const inspectSize = Math.min(8 * 1024 * 1024, file.size);
    const buffers = [file.slice(0, inspectSize).arrayBuffer()];
    if (file.size > inspectSize) {
      buffers.push(file.slice(Math.max(inspectSize, file.size - inspectSize)).arrayBuffer());
    }
    let text = "";
    try {
      const chunks = await Promise.all(buffers);
      text = chunks.map((chunk) => new TextDecoder("latin1").decode(chunk)).join("");
    } catch {
      return { name: "未知", category: "unknown", label: "无法读取编码标识" };
    }
    const markers = [
      { regex: /hvc1|hev1|dvh1|dvhe/i, name: "H.265 / HEVC", category: "hevc" },
      { regex: /av01/i, name: "AV1", category: "av1" },
      { regex: /avc1|avc3/i, name: "H.264 / AVC", category: "h264" },
      { regex: /vp09/i, name: "VP9", category: "vp9" },
      { regex: /mp4v/i, name: "MPEG-4 Visual", category: "mpeg4" }
    ];
    const marker = markers.find((item) => item.regex.test(text));
    return marker
      ? { name: marker.name, category: marker.category, label: "检测到编码标识：" + marker.name }
      : { name: "未知", category: "unknown", label: "未能在文件开头或结尾找到可识别的视频编码标识" };
  }

  function showDiagnostic(title, message, details) {
    $("diagnostic-title").textContent = title;
    $("diagnostic-message").textContent = message;
    $("diagnostic-details").textContent = details;
    $("codec-diagnostic").hidden = false;
  }

  function hideDiagnostic() {
    $("codec-diagnostic").hidden = true;
  }

  function diagnoseProblem(file, codec, error) {
    const reason = error && error.message ? error.message : "读取失败";
    let advice;
    if (codec.category === "hevc") {
      advice = "这个 MP4 可能使用 H.265/HEVC。部分 Windows 电脑或浏览器无法直接解码。建议先将视频转为 H.264 视频编码 + AAC 音频编码的 MP4，再导入本工具。";
    } else if (codec.category === "av1") {
      advice = "检测到 AV1 视频编码，可能不被当前浏览器或设备支持。请尝试更新 Chrome/Edge，或转换为 H.264/AAC MP4。";
    } else if (codec.category === "h264") {
      advice = "检测到 H.264 标识，但仍未正常读取。可能与音轨编码、MP4 文件索引、视频损坏或浏览器解码能力有关。请使用 VLC 的「工具 → 编解码器信息」查看视频和音频编码。";
    } else {
      advice = "MP4 只是封装格式。请使用 VLC 的「工具 → 编解码器信息」确认视频为 H.264、音频为 AAC；也可尝试用视频编辑软件重新导出为 H.264/AAC MP4。";
    }
    showDiagnostic(
      "此视频暂时无法在当前浏览器中读取",
      advice,
      "文件：" + file.name + "（" + fmtMB(file.size) + "）｜" +
      codec.label + "｜浏览器提示：" + reason +
      "。本工具不上传文件，只有浏览器能解码的视频才能直接压缩。"
    );
  }

  function loadVideoInfo(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.muted = true;
      let settled = false;
      let timeout = null;
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
      };
      const fail = (message) => {
        if (settled) return;
        settled = true;
        const raw = video.error ? video.error.code : null;
        cleanup();
        const labels = {
          1: "加载被中止",
          2: "文件读取出错",
          3: "视频解码失败",
          4: "不支持该视频编码或封装"
        };
        reject(new Error(message || (labels[raw] || ("媒体读取失败（代码 " + (raw || "未知") + "）"))));
      };
      const accept = () => {
        if (settled) return;
        const info = {
          width: video.videoWidth, height: video.videoHeight, duration: video.duration
        };
        if (!info.width || !info.height || !Number.isFinite(info.duration) || info.duration <= 0) {
          fail("已读到部分视频信息，但未获得有效时长/分辨率");
          return;
        }
        settled = true;
        cleanup();
        resolve(info);
      };
      video.addEventListener("loadedmetadata", accept, { once: true });
      video.addEventListener("error", () => fail(), { once: true });
      timeout = window.setTimeout(() =>
        fail("读取视频元数据超时（超过 60 秒），可能与超大文件、视频索引或浏览器兼容性有关"), 60000);
      video.src = url;
      video.load();
    });
  }

  async function chooseVideo(file) {
    if (state.busy || !file) return;
    hideDiagnostic();
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv|ogv)$/i.test(file.name)) {
      showDiagnostic("无法识别文件", "请选择 MP4、WebM 等视频文件。", "文件：" + file.name);
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      showDiagnostic("文件较大", "当前建议单个视频不超过 2 GB，以免浏览器内存不足。", "文件：" + file.name);
      return;
    }
    const url = URL.createObjectURL(file);
    let meta, codec;
    try {
      // The probe does not upload the video or depend on network APIs.
      codec = await inspectFileCodec(file);
      meta = await loadVideoInfo(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      diagnoseProblem(file, codec || { category: "unknown", label: "编码标识尚未读取" }, error);
      return;
    }
    cleanupInput();
    hideDiagnostic();
    state.file = file;
    state.url = url;
    state.width = meta.width;
    state.height = meta.height;
    state.duration = meta.duration;
    $("source-preview").src = state.url;
    $("source-name").textContent = file.name;
    $("source-name").title = file.name;
    $("source-size").textContent = fmtMB(file.size);
    $("source-res").textContent = meta.width + " × " + meta.height;
    $("source-duration").textContent = fmtTime(meta.duration);
    $("source-bitrate").textContent = fmtRate(file.size * 8 / meta.duration);
    $("source-codec").textContent = codec.label + "（依据文件中的编码标识初步判断）";
    $("source-codec").hidden = codec.category === "unknown";
    $("source-card").hidden = false;
    $("custom-width").value = String(meta.width);
    $("custom-height").value = String(meta.height);
    updateEstimates();
    setBusy(false);
  }

  function setMode(mode) {
    if (state.busy) return;
    state.mode = mode;
    $("mode-auto").setAttribute("aria-selected", String(mode === "auto"));
    $("mode-custom").setAttribute("aria-selected", String(mode === "custom"));
    $("auto-settings").hidden = mode !== "auto";
    $("custom-settings").hidden = mode !== "custom";
    updateEstimates();
  }

  function syncResolution() {
    $("custom-dims").hidden = $("resolution").value !== "custom";
    updateEstimates();
  }

  function syncAspect(changed) {
    if (!state.width || !state.height || !$("lock-ratio").checked || $("resolution").value !== "custom") return;
    if (changed === "width") {
      const width = Number($("custom-width").value);
      if (Number.isFinite(width) && width > 0) {
        $("custom-height").value = String(Math.max(64, Math.min(4096, Math.round(width * state.height / state.width / 2) * 2)));
      }
    } else {
      const height = Number($("custom-height").value);
      if (Number.isFinite(height) && height > 0) {
        $("custom-width").value = String(Math.max(64, Math.min(4096, Math.round(height * state.width / state.height / 2) * 2)));
      }
    }
    updateEstimates();
  }

  function showProgress(stage, time, attempt, attempts) {
    $("progress").hidden = false;
    $("progress-title").textContent = "视频压缩进行中";
    $("progress-stage").textContent = stage;
    $("progress-percent").textContent = Math.round(Math.min(100, time / state.duration * 100)) + "%";
    $("progress-fill").style.width = Math.min(100, time / state.duration * 100) + "%";
    $("progress-time").textContent = fmtTime(time) + " / " + fmtTime(state.duration);
    $("attempt-label").textContent = "第 " + attempt + " / " + attempts + " 次编码";
  }

  function createSession() {
    return {
      cancelled: false,
      cancelCurrent: null,
      cancel() {
        this.cancelled = true;
        if (typeof this.cancelCurrent === "function") this.cancelCurrent();
      }
    };
  }

  // MediaRecorder respects approximate videoBitsPerSecond and audioBitsPerSecond.
  // Canvas retains the requested dimensions while drawing source frames.
  async function recordOnce(settings, attemptNumber, totalAttempts, session) {
    if (session.cancelled) throw new Error("已取消压缩");
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = false;
    video.volume = 1;
    video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    video.src = state.url;
    let canvas = null, stream = null, recorder = null, audioContext = null, interval = null;
    let callbackId = null, frameRun = false, done = false, abort = null;

    const finish = async () => {
      frameRun = false;
      if (interval) window.clearInterval(interval);
      if (typeof video.cancelVideoFrameCallback === "function" && callbackId !== null) {
        try { video.cancelVideoFrameCallback(callbackId); } catch {}
      } else if (callbackId !== null) window.cancelAnimationFrame(callbackId);
      video.pause();
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (audioContext) {
        try { await audioContext.close(); } catch {}
      }
      video.removeAttribute("src");
      video.load();
      video.remove();
      if (canvas) canvas.width = canvas.height = 1;
      session.cancelCurrent = null;
    };

    try {
      await new Promise((resolve, reject) => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener("loadeddata", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("无法加载视频画面")), { once: true });
        video.load();
      });
      if (session.cancelled) throw new Error("已取消压缩");

      const [width, height] = settings.resolution;
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!context) throw new Error("浏览器无法创建视频编码画布");
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);

      const renderFrame = () => {
        if (!frameRun) return;
        if (video.readyState >= 2) {
          try { context.drawImage(video, 0, 0, width, height); } catch {}
        }
        if (typeof video.requestVideoFrameCallback === "function") {
          callbackId = video.requestVideoFrameCallback(renderFrame);
        } else {
          callbackId = window.requestAnimationFrame(renderFrame);
        }
      };

      const frameStream = canvas.captureStream(settings.fps);
      const tracks = [...frameStream.getVideoTracks()];

      if (settings.audioBps > 0) {
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextConstructor) throw new Error("浏览器无法处理音轨，请尝试静音导出");
        audioContext = new AudioContextConstructor();
        await audioContext.resume();
        const audioSource = audioContext.createMediaElementSource(video);
        const audioDest = audioContext.createMediaStreamDestination();
        audioSource.connect(audioDest);
        tracks.push(...audioDest.stream.getAudioTracks());
      }
      stream = new MediaStream(tracks);
      const options = {
        mimeType: settings.mime,
        videoBitsPerSecond: Math.round(settings.videoBps)
      };
      if (settings.audioBps > 0) options.audioBitsPerSecond = Math.round(settings.audioBps);
      recorder = new MediaRecorder(stream, options);
      const chunks = [];
      const blobPromise = new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = (blob) => { if (!settled) { settled = true; resolve(blob); } };
        const rejectOnce = (error) => { if (!settled) { settled = true; reject(error); } };

        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener("error", (event) =>
          rejectOnce(new Error("编码器异常：" + (event.error?.message || "无法录制"))));
        recorder.addEventListener("stop", () => {
          if (session.cancelled) { rejectOnce(new Error("已取消压缩")); return; }
          const mime = recorder.mimeType || settings.mime;
          const blob = new Blob(chunks, { type: mime });
          if (blob.size === 0) rejectOnce(new Error("没有生成有效视频，尝试更低码率或更换浏览器"));
          else resolveOnce(blob);
        });
        abort = () => {
          if (recorder && recorder.state !== "inactive") recorder.stop();
          else rejectOnce(new Error("已取消压缩"));
        };
        session.cancelCurrent = abort;
      });

      frameRun = true;
      renderFrame();
      recorder.start(1000);
      let lastMoved = performance.now(), lastTime = 0;
      interval = window.setInterval(() => {
        const current = Math.min(state.duration, video.currentTime || 0);
        if (current > lastTime + .01) { lastMoved = performance.now(); lastTime = current; }
        showProgress("正在编码 · " + fmtRate(settings.videoBps) + " 视频码率",
          current, attemptNumber, totalAttempts);
        if (!session.cancelled && performance.now() - lastMoved > 30000) {
          session.cancelled = true;
          session.cancelCurrent?.();
        }
      }, 300);

      const onEnded = () => {
        done = true;
        showProgress("完成编码，正在封装文件…", state.duration, attemptNumber, totalAttempts);
        if (recorder.state !== "inactive") recorder.stop();
      };
      video.addEventListener("ended", onEnded, { once: true });
      await video.play();
      const blob = await blobPromise;
      if (!done && !session.cancelled) throw new Error("录制未正常完成");
      return { blob, mime: recorder.mimeType || settings.mime, width, height };
    } finally {
      await finish();
    }
  }

  function setResult(result, initial, params, note) {
    closeResult();
    state.resultUrl = URL.createObjectURL(result.blob);
    state.output = result;
    $("result-original").textContent = fmtMB(initial.size);
    $("result-compressed").textContent = fmtMB(result.blob.size);
    const format = result.mime.startsWith("video/mp4") ? "MP4" : "WebM";
    $("result-spec").textContent = format + " · " + result.width + " × " + result.height;
    const reduction = Math.round((1 - result.blob.size / initial.size) * 100);
    $("result-reduction").textContent = reduction > 0
      ? ("减小 " + reduction + "%")
      : (reduction === 0 ? "体积基本不变" : "增大 " + Math.abs(reduction) + "%");
    $("result-note").textContent = note;
    $("result-preview").src = state.resultUrl;
    $("result-preview").hidden = false;
    const name = initial.name.replace(/\.[^.]+$/, "");
    $("download").download = name + "-Qualitell-压缩." + (format === "MP4" ? "mp4" : "webm");
    $("download").href = state.resultUrl;
    $("results").hidden = false;
    $("results").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function startCompression() {
    if (state.busy || !state.file) return;
    if (typeof HTMLCanvasElement.prototype.captureStream !== "function") {
      window.alert("浏览器不支持本地视频编码，请使用最新版 Chrome / Edge");
      return;
    }
    let settings;
    try {
      const mime = selectedMime();
      if (!mime) throw new Error("当前浏览器不支持选定的视频编码格式");
      const rates = state.mode === "auto" ? autoRates() : customRates();
      const resolution = outputResolution();
      const fps = state.mode === "auto" ? 60 : Number($("fps").value);
      settings = { ...rates, mime, resolution, fps };
      if (state.mode === "auto" && rates.videoBps === MIN_VIDEO_BPS) {
        const estimate = state.duration * (MIN_VIDEO_BPS + rates.audioBps) / 8;
        if (estimate > rates.targetBytes * 1.08) {
          throw new Error("目标文件过小：仅最低视频码率和音频就可能超过目标，请增大 MB 或关闭音频");
        }
      }
    } catch (error) {
      window.alert(error.message);
      return;
    }
    const initial = { name: state.file.name, size: state.file.size, duration: state.duration };
    $("source-preview").pause();
    closeResult();
    const session = createSession();
    state.session = session;
    setBusy(true);

    let best = null;
    let current = { ...settings };
    const totalAttempts = state.mode === "auto" ? 3 : 1;
    try {
      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        if (session.cancelled) throw new Error("已取消压缩");
        showProgress("准备视频编码器…", 0, attempt, totalAttempts);
        const result = await recordOnce(current, attempt, totalAttempts, session);
        if (!best || result.blob.size < best.blob.size) best = result;
        if (!settings.targetBytes || best.blob.size <= settings.targetBytes) break;
        const ratio = settings.targetBytes / Math.max(best.blob.size, 1);
        current.videoBps = Math.max(MIN_VIDEO_BPS,
          Math.floor(current.videoBps * Math.min(.83, ratio * .87)));
        if (current.videoBps === MIN_VIDEO_BPS && attempt >= 2) break;
        showProgress("目标未达到，自动降低码率准备重试…", 0, attempt + 1, totalAttempts);
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      if (!best) throw new Error("压缩没有输出结果");
      const achieved = settings.targetBytes && best.blob.size <= settings.targetBytes;
      const note = state.mode === "auto"
        ? (achieved
          ? "已达到目标大小以内，输出分辨率保持与原视频一致。实际画质取决于目标体积与画面复杂程度。"
          : "已尝试降低码率，但仍未压到目标大小。可适当提高目标 MB，或切换自定义模式降低分辨率；输出尺寸保持了原始宽高。")
        : "按照自定义尺寸、码率与帧率完成编码；实际文件体积可能与预估存在偏差。";
      setResult(best, initial, current, note +
        (best.blob.size >= initial.size ? " 注意：输出不比源文件小，源视频可能已具有较高压缩率。" : ""));
      $("progress").hidden = true;
    } catch (error) {
      $("progress-title").textContent = session.cancelled ? "已取消压缩" : "压缩失败";
      $("progress-stage").textContent = session.cancelled
        ? "当前任务已经取消，源视频保持不变。"
        : String(error?.message || error || "未知错误");
      if (!session.cancelled) {
        window.alert("视频压缩失败：" + (error?.message || error));
      }
    } finally {
      state.session = null;
      setBusy(false);
    }
  }

  function resetSettings() {
    if (state.busy) return;
    $("target-size").value = "25";
    $("resolution").value = "original";
    $("custom-dims").hidden = true;
    $("lock-ratio").checked = true;
    $("manual-bitrate").value = "3.0";
    $("fps").value = "60";
    $("audio-rate").value = "96";
    $("output-type").value = "mp4";
    setMode("auto");
  }

  function bind() {
    $("choose-file").addEventListener("click", (event) => { event.stopPropagation(); $("video-file").click(); });
    $("dropzone").addEventListener("click", (event) => { if (!event.target.closest("button")) $("video-file").click(); });
    $("dropzone").addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        $("video-file").click();
      }
    });
    $("video-file").addEventListener("change", async (event) => {
      await chooseVideo(event.target.files?.[0]);
      event.target.value = "";
    });
    for (const eventName of ["dragenter", "dragover"]) {
      $("dropzone").addEventListener(eventName, (event) => {
        event.preventDefault();
        $("dropzone").classList.add("dragover");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      $("dropzone").addEventListener(eventName, (event) => {
        event.preventDefault();
        $("dropzone").classList.remove("dragover");
      });
    }
    $("dropzone").addEventListener("drop", (event) => chooseVideo(event.dataTransfer.files?.[0]));
    $("clear-video").addEventListener("click", () => { cleanupInput(); hideDiagnostic(); });
    $("mode-auto").addEventListener("click", () => setMode("auto"));
    $("mode-custom").addEventListener("click", () => setMode("custom"));
    $("resolution").addEventListener("change", syncResolution);
    $("custom-width").addEventListener("input", () => syncAspect("width"));
    $("custom-height").addEventListener("input", () => syncAspect("height"));
    for (const id of ["target-size", "manual-bitrate", "audio-rate", "fps", "output-type", "lock-ratio"]) {
      $(id).addEventListener("input", updateEstimates);
      $(id).addEventListener("change", updateEstimates);
    }
    for (const button of document.querySelectorAll("[data-target]")) {
      button.addEventListener("click", () => {
        $("target-size").value = button.dataset.target;
        updateEstimates();
      });
    }
    $("reset").addEventListener("click", resetSettings);
    $("start").addEventListener("click", startCompression);
    $("cancel").addEventListener("click", () => state.session?.cancel());
    window.addEventListener("beforeunload", () => {
      state.session?.cancel();
      if (state.url) URL.revokeObjectURL(state.url);
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    });
  }

  function init() {
    bind();
    updateEstimates();
    setBusy(false);
    if (!selectedMime() || !HTMLCanvasElement.prototype.captureStream) {
      $("type-hint").textContent = "当前浏览器缺少视频压缩所需的 MediaRecorder 或 Canvas Capture API，请更新 Chrome / Edge。";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();