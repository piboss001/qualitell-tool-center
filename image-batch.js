(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { items: [], busy: false, nextId: 1, toastTimer: null };
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_DIMENSION = 12000;
  const MAX_PIXELS = 40000000;

  const els = {
    fileInput: $("#file-input"),
    chooseFiles: $("#choose-files"),
    dropzone: $("#dropzone"),
    fileGrid: $("#file-grid"),
    fileCount: $("#file-count"),
    queueHint: $("#queue-hint"),
    clearFiles: $("#clear-files"),
    resizeMode: $("#resize-mode"),
    widthField: $("#width-field"),
    heightField: $("#height-field"),
    targetWidth: $("#target-width"),
    targetHeight: $("#target-height"),
    resizeHelp: $("#resize-help"),
    outputFormat: $("#output-format"),
    qualitySetting: $("#quality-setting"),
    quality: $("#quality"),
    qualityValue: $("#quality-value"),
    backgroundColor: $("#background-color"),
    transparentBackground: $("#transparent-background"),
    addNumber: $("#add-number"),
    numberStart: $("#number-start"),
    numberDigits: $("#number-digits"),
    namePrefix: $("#name-prefix"),
    nameSuffix: $("#name-suffix"),
    watermarkText: $("#watermark-text"),
    watermarkPosition: $("#watermark-position"),
    watermarkColor: $("#watermark-color"),
    watermarkOpacity: $("#watermark-opacity"),
    watermarkOpacityValue: $("#watermark-opacity-value"),
    resetSettings: $("#reset-settings"),
    processButton: $("#process-button"),
    progressPanel: $("#progress-panel"),
    progressTitle: $("#progress-title"),
    progressText: $("#progress-text"),
    progressPercent: $("#progress-percent"),
    progressFill: $("#progress-fill"),
    progressMessage: $("#progress-message"),
    resultsPanel: $("#results-panel"),
    resultsSummary: $("#results-summary"),
    resultsList: $("#results-list"),
    downloadZip: $("#download-zip"),
    toast: $("#toast")
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function showToast(message, isError) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle("error", Boolean(isError));
    els.toast.classList.add("show");
    state.toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function updateQueueHeader() {
    const count = state.items.length;
    els.fileCount.textContent = String(count);
    els.clearFiles.disabled = count === 0 || state.busy;
    els.processButton.disabled = count === 0 || state.busy;
    els.queueHint.textContent = count ? ("已添加 " + count + " 张图片") : "尚未添加图片";
  }

  function revokeItemUrls(item) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    item.previewUrl = "";
    item.outputUrl = "";
  }

  async function readDimensions(file) {
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("浏览器无法读取该图片"));
      };
      image.src = url;
    });
  }

  async function addFiles(fileList) {
    if (state.busy) return;
    const incoming = Array.from(fileList || []);
    const imageFiles = incoming.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      showToast("请选择 PNG、JPG、WebP 等图片文件", true);
      return;
    }

    let added = 0;
    for (const file of imageFiles) {
      if (file.size > MAX_FILE_BYTES) {
        showToast(file.name + " 超过 50 MB，已跳过", true);
        continue;
      }
      const duplicate = state.items.some((item) =>
        item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified
      );
      if (duplicate) continue;

      const item = {
        id: state.nextId++,
        file,
        previewUrl: URL.createObjectURL(file),
        outputUrl: "",
        outputBlob: null,
        outputName: "",
        width: 0,
        height: 0,
        status: "读取图片信息…",
        error: ""
      };
      state.items.push(item);
      added += 1;
      renderFiles();
      try {
        const dimensions = await readDimensions(file);
        item.width = dimensions.width;
        item.height = dimensions.height;
        item.status = "等待处理";
      } catch (error) {
        item.status = "无法读取";
        item.error = error.message || "图片读取失败";
      }
      renderFiles();
    }

    updateQueueHeader();
    if (added) showToast("已添加 " + added + " 张图片");
    if (added === 0 && imageFiles.length) showToast("这些图片已在队列中，或超过文件大小限制", true);
  }

  function renderFiles() {
    if (!state.items.length) {
      els.fileGrid.innerHTML = '<div class="empty-queue"><span class="empty-symbol">▧</span><strong>图片队列还是空的</strong><span>添加图片后，可以在右侧统一设置处理规则</span></div>';
      updateQueueHeader();
      return;
    }

    els.fileGrid.innerHTML = state.items.map((item) => {
      const dimensions = item.width && item.height ? (item.width + " × " + item.height + " px") : "尺寸读取失败";
      const statusClass = item.status.startsWith("完成") ? "done" : (item.status.startsWith("失败") || item.status === "无法读取" ? "error" : "");
      const thumbUrl = item.outputUrl || item.previewUrl;
      const outputAction = item.outputUrl
        ? '<a class="result-download" href="' + escapeHtml(item.outputUrl) + '" download="' + escapeHtml(item.outputName) + '">下载结果</a>'
        : "";
      return '<article class="file-card" data-id="' + item.id + '">' +
        '<div class="file-thumb"><img src="' + escapeHtml(thumbUrl) + '" alt=""></div>' +
        '<div class="file-details">' +
          '<div class="file-name" title="' + escapeHtml(item.file.name) + '">' + escapeHtml(item.file.name) + '</div>' +
          '<div class="file-meta">' + dimensions + '<br>' + formatBytes(item.file.size) + '</div>' +
          '<div class="file-status ' + statusClass + '" title="' + escapeHtml(item.error) + '">' + escapeHtml(item.status) + '</div>' +
        '</div>' +
        '<div class="file-card-actions">' + outputAction +
          '<button type="button" data-remove="' + item.id + '" aria-label="移除 ' + escapeHtml(item.file.name) + '">移除</button>' +
        '</div>' +
      '</article>';
    }).join("");
    updateQueueHeader();
  }

  function syncResizeFields() {
    const mode = els.resizeMode.value;
    const showWidth = mode !== "original" && mode !== "height";
    const showHeight = ["height", "fit", "fill", "stretch"].includes(mode);
    els.widthField.classList.toggle("is-hidden", !showWidth);
    els.heightField.classList.toggle("is-hidden", !showHeight);
    const help = {
      original: "保持每张图片原来的宽高，不进行缩放。",
      width: "所有图片统一为指定宽度，高度按原始比例自动计算。",
      height: "所有图片统一为指定高度，宽度按原始比例自动计算。",
      fit: "输出为指定画布尺寸，完整显示图片；多余区域使用背景色或透明填充。",
      fill: "输出为指定画布尺寸，图片铺满画布，超出部分会从边缘裁切。",
      stretch: "强制拉伸到指定宽高，可能改变图片原有比例。"
    };
    els.resizeHelp.textContent = help[mode];
  }

  function syncQualityVisibility() {
    const format = els.outputFormat.value;
    els.qualitySetting.hidden = format === "image/png";
  }

  function removeItem(id) {
    if (state.busy) return;
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    revokeItemUrls(state.items[index]);
    state.items.splice(index, 1);
    renderFiles();
    updateResults();
  }

  function clearFiles() {
    if (state.busy) return;
    state.items.forEach(revokeItemUrls);
    state.items = [];
    renderFiles();
    els.resultsPanel.hidden = true;
    els.progressPanel.hidden = true;
    els.resultsList.innerHTML = "";
    els.downloadZip.disabled = true;
  }

  function getSettings() {
    const mode = els.resizeMode.value;
    const width = Number(els.targetWidth.value);
    const height = Number(els.targetHeight.value);
    if (["width", "fit", "fill", "stretch"].includes(mode) && (!Number.isInteger(width) || width < 1 || width > MAX_DIMENSION)) {
      throw new Error("目标宽度必须为 1–12000 px 的整数");
    }
    if (["height", "fit", "fill", "stretch"].includes(mode) && (!Number.isInteger(height) || height < 1 || height > MAX_DIMENSION)) {
      throw new Error("目标高度必须为 1–12000 px 的整数");
    }
    return {
      mode,
      width,
      height,
      format: els.outputFormat.value,
      quality: Number(els.quality.value) / 100,
      background: els.backgroundColor.value,
      transparent: els.transparentBackground.checked,
      addNumber: els.addNumber.checked,
      numberStart: Math.max(1, Number(els.numberStart.value) || 1),
      numberDigits: Number(els.numberDigits.value) || 2,
      prefix: els.namePrefix.value,
      suffix: els.nameSuffix.value,
      watermark: els.watermarkText.value.trim(),
      watermarkPosition: els.watermarkPosition.value,
      watermarkColor: els.watermarkColor.value,
      watermarkOpacity: Number(els.watermarkOpacity.value) / 100
    };
  }

  function getOutputDimensions(sourceWidth, sourceHeight, settings) {
    if (settings.mode === "width") {
      return { width: settings.width, height: Math.max(1, Math.round(sourceHeight * settings.width / sourceWidth)) };
    }
    if (settings.mode === "height") {
      return { width: Math.max(1, Math.round(sourceWidth * settings.height / sourceHeight)), height: settings.height };
    }
    if (settings.mode === "fit" || settings.mode === "fill" || settings.mode === "stretch") {
      return { width: settings.width, height: settings.height };
    }
    return { width: sourceWidth, height: sourceHeight };
  }

  function getOutputType(file, selectedFormat) {
    if (selectedFormat !== "original") return selectedFormat;
    if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) return file.type;
    return "image/png";
  }

  function getExtension(mime) {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/webp") return "webp";
    return "png";
  }

  function makeOutputName(item, index, settings, extension) {
    const originalBase = item.file.name.replace(/\.[^.]+$/, "");
    const serial = String(settings.numberStart + index).padStart(settings.numberDigits, "0");
    const prefix = settings.addNumber ? serial + "_" : "";
    const rawName = prefix + settings.prefix + originalBase + settings.suffix;
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_").trim() || ("image_" + serial);
    return safeName + "." + extension;
  }

  function decodeImage(file) {
    if ("createImageBitmap" in window) {
      return createImageBitmap(file).then((bitmap) => ({
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close()
      }));
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url)
      });
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("浏览器无法解码该图片"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片导出失败，请尝试降低尺寸"));
      }, mime, quality);
    });
  }

  function drawWatermark(context, canvas, settings) {
    if (!settings.watermark) return;
    const fontSize = Math.max(14, Math.min(96, Math.round(Math.min(canvas.width, canvas.height) * 0.035)));
    const padding = Math.max(16, Math.round(fontSize * 0.7));
    context.save();
    context.globalAlpha = settings.watermarkOpacity;
    context.fillStyle = settings.watermarkColor;
    context.font = "600 " + fontSize + 'px "Microsoft YaHei", Arial, sans-serif';
    context.textBaseline = "middle";
    const textWidth = context.measureText(settings.watermark).width;
    let x = canvas.width - padding;
    let y = canvas.height - padding;
    context.textAlign = "right";
    if (settings.watermarkPosition === "bottom-left") {
      x = padding;
      context.textAlign = "left";
    } else if (settings.watermarkPosition === "center") {
      x = canvas.width / 2;
      y = canvas.height / 2;
      context.textAlign = "center";
    } else if (settings.watermarkPosition === "top-right") {
      x = canvas.width - padding;
      y = padding;
    }
    if (textWidth > canvas.width - padding * 2) {
      context.font = "600 " + Math.max(10, Math.floor(fontSize * (canvas.width - padding * 2) / textWidth)) + 'px "Microsoft YaHei", Arial, sans-serif';
    }
    context.shadowColor = "rgba(0,0,0,.28)";
    context.shadowBlur = Math.max(1, fontSize * 0.12);
    context.fillText(settings.watermark, x, y, Math.max(20, canvas.width - padding * 2));
    context.restore();
  }

  async function processImage(item, index, settings) {
    if (!item.width || !item.height) throw new Error(item.error || "图片尺寸读取失败");
    const decoded = await decodeImage(item.file);
    let canvas;
    try {
      const dimensions = getOutputDimensions(decoded.width, decoded.height, settings);
      const width = dimensions.width;
      const height = dimensions.height;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
        throw new Error("输出尺寸过大（单张最多 4000 万像素），请降低尺寸");
      }

      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("当前浏览器无法创建图片画布");

      const mime = getOutputType(item.file, settings.format);
      const needsBackground = mime === "image/jpeg" || (
        ["fit", "fill", "stretch"].includes(settings.mode) && !settings.transparent
      );
      if (needsBackground) {
        context.fillStyle = settings.background;
        context.fillRect(0, 0, width, height);
      } else {
        context.clearRect(0, 0, width, height);
      }

      if (settings.mode === "fit") {
        const scale = Math.min(width / decoded.width, height / decoded.height);
        const drawWidth = decoded.width * scale;
        const drawHeight = decoded.height * scale;
        context.drawImage(decoded.image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      } else if (settings.mode === "fill") {
        const scale = Math.max(width / decoded.width, height / decoded.height);
        const drawWidth = decoded.width * scale;
        const drawHeight = decoded.height * scale;
        context.drawImage(decoded.image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      } else {
        context.drawImage(decoded.image, 0, 0, width, height);
      }

      drawWatermark(context, canvas, settings);
      const blob = await canvasToBlob(canvas, mime, settings.quality);
      const extension = getExtension(mime);
      return {
        blob,
        width,
        height,
        mime,
        name: makeOutputName(item, index, settings, extension)
      };
    } finally {
      decoded.close();
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
  }

  function setProgress(done, total, message) {
    const percent = total ? Math.round(done / total * 100) : 0;
    els.progressText.textContent = done + " / " + total;
    els.progressPercent.textContent = percent + "%";
    els.progressFill.style.width = percent + "%";
    els.progressMessage.textContent = message;
  }

  function updateResults() {
    const completed = state.items.filter((item) => item.outputBlob);
    const failed = state.items.filter((item) => item.status.startsWith("失败") || item.status === "无法读取");
    if (!completed.length && !failed.length) {
      els.resultsPanel.hidden = true;
      return;
    }
    els.resultsPanel.hidden = false;
    els.resultsSummary.textContent = "成功 " + completed.length + " 张" + (failed.length ? "，失败 " + failed.length + " 张" : "");
    els.resultsList.innerHTML = completed.map((item) =>
      '<div class="result-row"><div class="result-file"><strong title="' + escapeHtml(item.outputName) + '">' + escapeHtml(item.outputName) + '</strong><span>' + item.width + " × " + item.height + " px</span></div>" +
      '<span class="result-size">' + formatBytes(item.outputBlob.size) + '</span>' +
      '<a class="result-download" href="' + escapeHtml(item.outputUrl) + '" download="' + escapeHtml(item.outputName) + '">下载</a></div>'
    ).join("");
    els.downloadZip.disabled = completed.length === 0 || state.busy;
  }

  async function processAll() {
    if (state.busy || !state.items.length) return;
    let settings;
    try {
      settings = getSettings();
    } catch (error) {
      showToast(error.message, true);
      return;
    }

    state.busy = true;
    els.processButton.disabled = true;
    els.clearFiles.disabled = true;
    els.progressPanel.hidden = false;
    els.resultsPanel.hidden = true;
    els.progressTitle.textContent = "正在处理图片";
    els.progressMessage.textContent = "请保持此页面打开，处理过程在浏览器本地进行。";

    state.items.forEach((item) => {
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      item.outputUrl = "";
      item.outputBlob = null;
      item.outputName = "";
      item.status = item.width ? "等待处理" : "无法读取";
    });
    renderFiles();

    let success = 0;
    let failed = 0;
    const total = state.items.length;
    setProgress(0, total, "准备处理…");

    for (let index = 0; index < total; index += 1) {
      const item = state.items[index];
      if (!item.width || !item.height) {
        failed += 1;
        item.status = "失败 · 图片无法读取";
        renderFiles();
        setProgress(index + 1, total, "已跳过无法读取的图片");
        continue;
      }
      item.status = "处理中…";
      renderFiles();
      try {
        const result = await processImage(item, index, settings);
        item.outputBlob = result.blob;
        item.outputUrl = URL.createObjectURL(result.blob);
        item.outputName = result.name;
        item.width = result.width;
        item.height = result.height;
        item.status = "完成 · " + formatBytes(result.blob.size);
        success += 1;
      } catch (error) {
        item.status = "失败 · " + (error.message || "处理失败");
        item.error = error.message || "处理失败";
        failed += 1;
      }
      renderFiles();
      setProgress(index + 1, total, item.status);
    }

    state.busy = false;
    els.processButton.disabled = state.items.length === 0;
    els.clearFiles.disabled = state.items.length === 0;
    els.progressTitle.textContent = "批量处理完成";
    els.progressMessage.textContent = "成功处理 " + success + " 张" + (failed ? "，失败 " + failed + " 张" : "") + "。";
    updateResults();
    showToast("处理完成：成功 " + success + " 张" + (failed ? "，失败 " + failed + " 张" : ""));
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
  }

  function makeZip(entries) {
    return Promise.all(entries.map(async (entry) => ({
      name: new TextEncoder().encode(entry.name),
      data: new Uint8Array(await entry.blob.arrayBuffer())
    }))).then((prepared) => {
      const localParts = [];
      const centralParts = [];
      let offset = 0;
      let centralSize = 0;
      const stamp = zipDateTime(new Date());

      prepared.forEach((entry) => {
        const crc = crc32(entry.data);
        const local = new Uint8Array(30 + entry.name.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, stamp.dosTime, true);
        localView.setUint16(12, stamp.dosDate, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, entry.data.length, true);
        localView.setUint32(22, entry.data.length, true);
        localView.setUint16(26, entry.name.length, true);
        localView.setUint16(28, 0, true);
        local.set(entry.name, 30);
        localParts.push(local, entry.data);

        const central = new Uint8Array(46 + entry.name.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, stamp.dosTime, true);
        centralView.setUint16(14, stamp.dosDate, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, entry.data.length, true);
        centralView.setUint32(24, entry.data.length, true);
        centralView.setUint16(28, entry.name.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset, true);
        central.set(entry.name, 46);
        centralParts.push(central);
        centralSize += central.length;
        offset += local.length + entry.data.length;
      });

      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      endView.setUint32(0, 0x06054b50, true);
      endView.setUint16(4, 0, true);
      endView.setUint16(6, 0, true);
      endView.setUint16(8, prepared.length, true);
      endView.setUint16(10, prepared.length, true);
      endView.setUint32(12, centralSize, true);
      endView.setUint32(16, offset, true);
      endView.setUint16(20, 0, true);
      return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
    });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadZip() {
    const entries = state.items.filter((item) => item.outputBlob).map((item) => ({
      name: item.outputName,
      blob: item.outputBlob
    }));
    if (!entries.length) return;
    if (entries.length > 65535) {
      showToast("ZIP 单次最多打包 65535 个文件", true);
      return;
    }
    els.downloadZip.disabled = true;
    els.downloadZip.textContent = "正在打包…";
    try {
      const zip = await makeZip(entries);
      triggerDownload(zip, "Qualitell-图片批量处理结果.zip");
      showToast("ZIP 打包完成，开始下载");
    } catch (error) {
      showToast("打包失败：" + (error.message || "未知错误"), true);
    } finally {
      els.downloadZip.disabled = false;
      els.downloadZip.textContent = "打包下载 ZIP";
    }
  }

  function resetSettings() {
    els.resizeMode.value = "original";
    els.targetWidth.value = "1200";
    els.targetHeight.value = "1200";
    els.outputFormat.value = "original";
    els.quality.value = "90";
    els.qualityValue.textContent = "90%";
    els.backgroundColor.value = "#ffffff";
    els.transparentBackground.checked = true;
    els.addNumber.checked = false;
    els.numberStart.value = "1";
    els.numberDigits.value = "2";
    els.namePrefix.value = "";
    els.nameSuffix.value = "";
    els.watermarkText.value = "";
    els.watermarkPosition.value = "bottom-right";
    els.watermarkColor.value = "#ffffff";
    els.watermarkOpacity.value = "35";
    els.watermarkOpacityValue.textContent = "35%";
    syncResizeFields();
    syncQualityVisibility();
    showToast("已恢复默认设置");
  }

  function bindEvents() {
    els.chooseFiles.addEventListener("click", (event) => {
      event.stopPropagation();
      els.fileInput.click();
    });
    els.dropzone.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      els.fileInput.click();
    });
    els.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener("change", async () => {
      await addFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((type) => {
      els.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        els.dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      els.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        els.dropzone.classList.remove("is-dragover");
      });
    });
    els.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

    els.fileGrid.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove]");
      if (removeButton) removeItem(Number(removeButton.dataset.remove));
    });
    els.clearFiles.addEventListener("click", clearFiles);
    els.resizeMode.addEventListener("change", syncResizeFields);
    els.outputFormat.addEventListener("change", syncQualityVisibility);
    els.quality.addEventListener("input", () => {
      els.qualityValue.textContent = els.quality.value + "%";
    });
    els.watermarkOpacity.addEventListener("input", () => {
      els.watermarkOpacityValue.textContent = els.watermarkOpacity.value + "%";
    });
    els.resetSettings.addEventListener("click", resetSettings);
    els.processButton.addEventListener("click", processAll);
    els.downloadZip.addEventListener("click", downloadZip);
    window.addEventListener("beforeunload", () => state.items.forEach(revokeItemUrls));
  }

  function init() {
    syncResizeFields();
    syncQualityVisibility();
    updateQueueHeader();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();