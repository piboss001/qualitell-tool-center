(() => {
  "use strict";

  const MAX_CANVAS_DIM = 32767;
  const MAX_CANVAS_AREA = 268435456;
  const MAX_OUT_WIDTH = 10000;
  const MIN_OUT_WIDTH = 100;
  const MIN_SLICE_HEIGHT = 100;
  const MAX_SLICE_HEIGHT = 30000;
  const MAX_EQUAL_COUNT = 50;
  const MIN_SIZE_LIMIT = 10;
  const MAX_SIZE_LIMIT = 5000;
  const SETTINGS_KEY = "long-image-slicer.settings.v1";

  const DEFAULTS = Object.freeze({
    mode: "fixed",
    fixedHeight: 1000,
    equalCount: 3,
    widthMode: "original",
    outputWidth: 750,
    format: "png",
    quality: 0.92,
    sizeLimit: 0,
    prefix: "",
    start: 1
  });

  const FORMAT_INFO = {
    png: { mime: "image/png", ext: "png" },
    jpg: { mime: "image/jpeg", ext: "jpg" },
    webp: { mime: "image/webp", ext: "webp" }
  };

  const MODES = new Set(["fixed", "equal", "manual"]);
  const WIDTH_MODES = new Set(["original", "preset", "custom"]);
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  const IMAGE_TYPE_RE = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;

  const $ = (id) => document.getElementById(id);

  const els = {
    importBtn: $("import-btn"),
    emptyImportBtn: $("empty-import-btn"),
    fileInput: $("file-input"),
    removeImageBtn: $("remove-image-btn"),
    sourceMeta: $("source-meta"),
    sourceThumb: $("source-thumb"),
    sourceName: $("source-name"),
    sourceDetail: $("source-detail"),
    sliceCount: $("slice-count"),
    sliceList: $("slice-list"),
    sliceEmpty: $("slice-empty"),

    previewViewport: $("preview-viewport"),
    previewStage: $("preview-stage"),
    sliceCanvas: $("slice-canvas"),
    sourceImage: $("source-image"),
    sliceHighlight: $("slice-highlight"),
    cutLayer: $("cut-layer"),
    emptyState: $("empty-state"),
    previewDim: $("preview-dim"),
    cutCount: $("cut-count"),
    manualHint: $("manual-hint"),
    zoomOut: $("zoom-out"),
    zoomFit: $("zoom-fit"),
    zoomIn: $("zoom-in"),
    zoomLabel: $("zoom-label"),

    modeGroup: $("mode-group"),
    modeHint: $("mode-hint"),
    fixedBlock: $("fixed-block"),
    heightPreset: $("height-preset"),
    heightInput: $("height-input"),
    equalBlock: $("equal-block"),
    countInput: $("count-input"),
    countNumber: $("count-number"),
    countValue: $("count-value"),
    manualBlock: $("manual-block"),
    undoCut: $("undo-cut"),
    clearCuts: $("clear-cuts"),
    cutChips: $("cut-chips"),

    outputWidth: $("output-width"),
    outputWidthInput: $("output-width-input"),
    outputWidthHint: $("output-width-hint"),
    formatGroup: $("format-group"),
    formatHint: $("format-hint"),
    qualityWrap: $("quality-wrap"),
    qualityLabel: $("quality-label"),
    qualityInput: $("quality-input"),
    qualityValue: $("quality-value"),
    sizeLimitBadge: $("size-limit-badge"),
    sizeLimitPreset: $("size-limit-preset"),
    sizeLimitInput: $("size-limit-input"),
    sizeLimitHint: $("size-limit-hint"),

    prefixInput: $("prefix-input"),
    startInput: $("start-input"),
    namePreview: $("name-preview"),

    summarySource: $("summary-source"),
    summaryCount: $("summary-count"),
    summarySlice: $("summary-slice"),
    summaryTotal: $("summary-total"),
    summaryLimit: $("summary-limit"),
    limitWarning: $("limit-warning"),
    warningText: $("warning-text"),
    resetSettings: $("reset-settings"),
    exportAll: $("export-all"),
    exportLabel: $("export-label"),

    dropOverlay: $("drop-overlay"),
    exportOverlay: $("export-overlay"),
    exportStatus: $("export-status"),
    progressFill: $("progress-fill"),
    toastStack: $("toast-stack")
  };

  let settings = loadSettings();
  let source = null;
  let manualCuts = [];
  let currentSlices = [];
  let selectedIndex = -1;
  let loading = false;
  let exporting = false;
  let zoomMode = "fit";
  let zoomValue = 1;
  let dragDepth = 0;
  let resizeFrame = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatInt(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    const digits = value >= 10 || index === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[index]}`;
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && IMAGE_TYPE_RE.test(file.type)) return true;
    return IMAGE_EXT_RE.test(file.name || "");
  }

  function sanitizePrefix(value) {
    return String(value || "")
      .replace(/[\\:*?"<>|\u0000-\u001f]/g, "")
      .replace(/\//g, "")
      .trim()
      .slice(0, 30);
  }

  function loadSettings() {
    const result = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return result;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return result;

      if (MODES.has(parsed.mode)) result.mode = parsed.mode;

      const fixedHeight = Number(parsed.fixedHeight);
      if (Number.isFinite(fixedHeight)) {
        result.fixedHeight = clamp(Math.round(fixedHeight), MIN_SLICE_HEIGHT, MAX_SLICE_HEIGHT);
      }

      const equalCount = Number(parsed.equalCount);
      if (Number.isFinite(equalCount)) {
        result.equalCount = clamp(Math.round(equalCount), 2, MAX_EQUAL_COUNT);
      }

      if (WIDTH_MODES.has(parsed.widthMode)) result.widthMode = parsed.widthMode;

      const outputWidth = Number(parsed.outputWidth);
      if (Number.isFinite(outputWidth)) {
        result.outputWidth = clamp(Math.round(outputWidth), MIN_OUT_WIDTH, MAX_OUT_WIDTH);
      }

      if (FORMAT_INFO[parsed.format]) result.format = parsed.format;

      const quality = Number(parsed.quality);
      if (Number.isFinite(quality)) result.quality = clamp(quality, 0.5, 1);

      const sizeLimit = Number(parsed.sizeLimit);
      if (Number.isFinite(sizeLimit)) {
        result.sizeLimit =
          sizeLimit <= 0 ? 0 : clamp(Math.round(sizeLimit), MIN_SIZE_LIMIT, MAX_SIZE_LIMIT);
      }

      if (typeof parsed.prefix === "string") result.prefix = parsed.prefix.slice(0, 30);

      const start = Number(parsed.start);
      if (Number.isFinite(start)) result.start = clamp(Math.round(start), 1, 9999);
    } catch (error) {
      // 本地存储不可用时使用默认值。
    }
    return result;
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      // file:// 环境可能禁用 localStorage，不影响切图。
    }
  }

  function getOutputWidth() {
    if (settings.widthMode === "original" && source) {
      return Math.max(1, Math.min(source.width, MAX_OUT_WIDTH));
    }
    return clamp(Math.round(Number(settings.outputWidth) || 750), MIN_OUT_WIDTH, MAX_OUT_WIDTH);
  }

  function sliceTooLarge(slice, outWidth) {
    return (
      slice.outHeight > MAX_CANVAS_DIM ||
      outWidth * slice.outHeight > MAX_CANVAS_AREA
    );
  }

  function getSizeLimitKB() {
    const value = Math.round(Number(settings.sizeLimit) || 0);
    if (value <= 0) return 0;
    return clamp(value, MIN_SIZE_LIMIT, MAX_SIZE_LIMIT);
  }

  function extensionFromMime(mime) {
    if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
    if (mime === "image/webp") return "webp";
    return "png";
  }

  function normalizeCuts(cuts) {
    if (!source || source.height < 3) return [];
    const max = source.height - 1;
    const sorted = cuts
      .map((cut) => clamp(Math.round(cut), 1, max))
      .sort((a, b) => a - b);

    const result = [];
    for (const cut of sorted) {
      if (!result.length || cut - result[result.length - 1] > 1) result.push(cut);
    }
    return result;
  }

  function getCuts() {
    if (!source) return [];
    if (source.height < 3) return [];

    let cuts = [];
    if (settings.mode === "manual") {
      cuts = manualCuts.slice();
    } else if (settings.mode === "equal") {
      const count = clamp(settings.equalCount, 2, MAX_EQUAL_COUNT);
      for (let index = 1; index < count; index += 1) {
        cuts.push(Math.round((source.height * index) / count));
      }
    } else {
      const height = clamp(settings.fixedHeight, MIN_SLICE_HEIGHT, MAX_SLICE_HEIGHT);
      for (let y = height; y < source.height; y += height) {
        cuts.push(Math.round(y));
      }
    }

    return normalizeCuts(cuts);
  }

  function refreshSlices() {
    if (!source) {
      currentSlices = [];
      return;
    }

    const outWidth = getOutputWidth();
    const points = [0, ...getCuts(), source.height];
    const slices = [];

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const height = end - start;
      if (height <= 0) continue;
      slices.push({
        index: slices.length + 1,
        start,
        end,
        height,
        outHeight: Math.max(1, Math.round((height * outWidth) / source.width))
      });
    }

    currentSlices = slices;
  }

  function refreshAll() {
    refreshSlices();
    if (!currentSlices.length) {
      selectedIndex = -1;
    } else if (selectedIndex >= currentSlices.length) {
      selectedIndex = currentSlices.length - 1;
    }
    renderAll();
  }

  function renderAll() {
    const hasSource = Boolean(source);

    els.sliceCanvas.hidden = !hasSource;
    els.emptyState.hidden = hasSource;
    els.removeImageBtn.hidden = !hasSource;
    els.sourceMeta.hidden = !hasSource;
    els.manualHint.hidden = !(hasSource && settings.mode === "manual");
    els.sliceCanvas.classList.toggle("is-cutting", hasSource && settings.mode === "manual");

    if (!hasSource) {
      els.cutLayer.replaceChildren();
      els.sliceHighlight.hidden = true;
      els.manualHint.hidden = true;
      renderSliceList();
      updateSummary();
      return;
    }

    renderCutOverlays();
    renderSliceList();
    applyPreviewLayout();
    updateSummary();
  }

  function renderSliceList() {
    const count = currentSlices.length;
    const scrollTop = els.sliceList.scrollTop;
    els.sliceCount.textContent = String(count);
    els.sliceEmpty.hidden = count > 0;
    els.sliceList.hidden = count === 0;
    els.sliceList.replaceChildren();
    renderHighlight();
    renderCutChips();

    if (!count) return;

    const outWidth = getOutputWidth();
    const fragment = document.createDocumentFragment();

    currentSlices.forEach((slice, index) => {
      const li = document.createElement("li");
      li.className = "slice-item" + (index === selectedIndex ? " is-selected" : "");
      li.dataset.index = String(index);
      li.tabIndex = 0;
      li.setAttribute(
        "aria-label",
        `第 ${index + 1} 片，${formatInt(slice.start)} 到 ${formatInt(slice.end)} 像素`
      );
      li.title = "点击在预览中高亮这一片";

      li.innerHTML = `
        <span class="slice-index" aria-hidden="true"></span>
        <span class="slice-info">
          <strong></strong>
          <small></small>
        </span>
        <button type="button" class="slice-download" title="单独导出这一片">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2.4v7.2M5.2 6.8 8 9.6l2.8-2.8M3 11.4v1.1c0 .8.7 1.4 1.5 1.4h7c.8 0 1.5-.6 1.5-1.4v-1.1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      `;

      li.querySelector(".slice-index").textContent = String(index + 1).padStart(2, "0");
      li.querySelector(".slice-info strong").textContent =
        `${formatInt(slice.start)} – ${formatInt(slice.end)} px`;
      li.querySelector(".slice-info small").textContent =
        `${formatInt(outWidth)} × ${formatInt(slice.outHeight)} px`;

      const download = li.querySelector(".slice-download");
      download.dataset.index = String(index);
      download.setAttribute("aria-label", `导出第 ${index + 1} 片`);

      fragment.append(li);
    });

    els.sliceList.append(fragment);
    els.sliceList.scrollTop = scrollTop;
  }

  function renderCutOverlays() {
    els.cutLayer.replaceChildren();
    if (!source) return;

    const manual = settings.mode === "manual";
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < currentSlices.length - 1; index += 1) {
      const cut = currentSlices[index].end;
      const line = document.createElement("div");
      line.className = "cut-line" + (manual ? " is-manual" : "");
      line.style.top = `${(cut / source.height) * 100}%`;
      line.dataset.cut = String(cut);
      line.title = manual ? "拖动调整，双击删除" : `${formatInt(cut)} px 切点`;

      const tag = document.createElement("span");
      tag.className = "cut-tag";
      tag.textContent = `${formatInt(cut)} px`;
      line.append(tag);

      if (manual) makeCutInteractive(line, cut);
      fragment.append(line);
    }

    els.cutLayer.append(fragment);
  }

  function renderCutChips() {
    els.cutChips.replaceChildren();
    const cuts = settings.mode === "manual" ? normalizeCuts(manualCuts) : [];
    els.undoCut.disabled = cuts.length === 0;
    els.clearCuts.disabled = cuts.length === 0;

    for (const cut of cuts) {
      const chip = document.createElement("span");
      chip.className = "cut-chip-item";
      chip.append(document.createTextNode(`${formatInt(cut)} px`));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.cut = String(cut);
      remove.setAttribute("aria-label", `删除 ${cut} 像素切点`);
      remove.textContent = "×";
      chip.append(remove);
      els.cutChips.append(chip);
    }
  }

  function renderHighlight() {
    if (!source || selectedIndex < 0 || !currentSlices[selectedIndex]) {
      els.sliceHighlight.hidden = true;
      return;
    }

    const slice = currentSlices[selectedIndex];
    els.sliceHighlight.hidden = false;
    els.sliceHighlight.style.top = `${(slice.start / source.height) * 100}%`;
    els.sliceHighlight.style.height = `${(slice.height / source.height) * 100}%`;
  }

  function selectSlice(index) {
    if (!Number.isInteger(index) || index < 0 || index >= currentSlices.length) return;
    selectedIndex = index;
    renderSliceList();
  }

  function applyPreviewLayout() {
    if (!source) return;
    if (zoomMode === "fit") zoomValue = computeFitZoom();
    const width = Math.max(1, source.width * zoomValue);
    els.sliceCanvas.style.width = `${width}px`;
    updateZoomLabel();
  }

  function computeFitZoom() {
    if (!source) return 1;
    const style = getComputedStyle(els.previewStage);
    const horizontalPadding =
      (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const available = els.previewViewport.clientWidth - horizontalPadding - 4;
    if (available <= 0) return 0.1;
    return clamp(available / source.width, 0.05, 1);
  }

  function updateZoomLabel() {
    els.zoomLabel.textContent = `${Math.round(zoomValue * 100)}%`;
    els.zoomFit.classList.toggle("is-active", zoomMode === "fit");
  }

  function sourceYFromEvent(event) {
    if (!source) return 0;
    const rect = els.sourceImage.getBoundingClientRect();
    if (!rect.height) return 0;
    const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    return ratio * source.height;
  }

  function addCut(rawY) {
    if (!source || settings.mode !== "manual") return;
    const y = clamp(Math.round(rawY), 1, source.height - 1);
    if (manualCuts.some((cut) => Math.abs(cut - y) < 2)) return;

    manualCuts.push(y);
    manualCuts = normalizeCuts(manualCuts);
    refreshAll();

    const index = currentSlices.findIndex((slice) => y >= slice.start && y < slice.end);
    if (index >= 0 && index !== selectedIndex) {
      selectedIndex = index;
      renderSliceList();
    }
  }

  function removeCut(cut) {
    manualCuts = manualCuts.filter((value) => value !== cut);
    refreshAll();
  }

  function makeCutInteractive(line, originalCut) {
    let drag = null;

    line.addEventListener("pointerdown", (event) => {
      if (settings.mode !== "manual") return;
      if (event.button !== undefined && event.button !== 0) return;
      event.stopPropagation();

      drag = {
        pointerId: event.pointerId,
        original: originalCut,
        value: originalCut
      };
      line.classList.add("is-dragging");
      try {
        line.setPointerCapture(event.pointerId);
      } catch (error) {
        // 某些合成事件不支持 pointer capture。
      }
    });

    line.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId || !source) return;
      const y = clamp(Math.round(sourceYFromEvent(event)), 1, source.height - 1);
      drag.value = y;
      line.style.top = `${(y / source.height) * 100}%`;
      const tag = line.querySelector(".cut-tag");
      if (tag) tag.textContent = `${formatInt(y)} px`;
    });

    const finish = () => {
      if (!drag) return;
      const { original, value, pointerId } = drag;
      drag = null;
      line.classList.remove("is-dragging");
      try {
        line.releasePointerCapture(pointerId);
      } catch (error) {
        // 释放失败时不影响后续重绘。
      }

      if (value !== original && source) {
        manualCuts = manualCuts.filter((cut) => cut !== original);
        if (!manualCuts.some((cut) => Math.abs(cut - value) < 2)) manualCuts.push(value);
        manualCuts = normalizeCuts(manualCuts);
        refreshAll();
      }
    };

    line.addEventListener("pointerup", finish);
    line.addEventListener("pointercancel", finish);

    line.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeCut(originalCut);
    });
  }

  function handleCanvasClick(event) {
    if (!source) return;
    if (event.target.closest(".cut-line")) return;

    const y = sourceYFromEvent(event);
    if (settings.mode === "manual") {
      addCut(y);
      return;
    }

    const index = currentSlices.findIndex((slice) => y >= slice.start && y < slice.end);
    if (index >= 0) selectSlice(index);
  }

  function syncModeUI() {
    for (const button of els.modeGroup.querySelectorAll("button[data-mode]")) {
      const active = button.dataset.mode === settings.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    els.fixedBlock.hidden = settings.mode !== "fixed";
    els.equalBlock.hidden = settings.mode !== "equal";
    els.manualBlock.hidden = settings.mode !== "manual";
    els.manualHint.hidden = !(source && settings.mode === "manual");
    els.sliceCanvas.classList.toggle("is-cutting", Boolean(source) && settings.mode === "manual");

    if (settings.mode === "equal") {
      els.modeHint.textContent = "把整张长图平均切开，适合需要每片高度接近的场景。";
    } else if (settings.mode === "manual") {
      els.modeHint.textContent = "在预览图上单击添加切点；拖动切点调整；双击切点删除。";
    } else {
      els.modeHint.textContent = "按固定高度从上往下切，最后一片可能短一些。";
    }
  }

  function syncHeightUI() {
    els.heightInput.value = String(settings.fixedHeight);
    const value = String(settings.fixedHeight);
    const option = Array.from(els.heightPreset.options).find((entry) => entry.value === value);
    els.heightPreset.value = option ? value : "custom";
  }

  function syncCountUI() {
    settings.equalCount = clamp(settings.equalCount, 2, MAX_EQUAL_COUNT);
    els.countInput.value = String(settings.equalCount);
    els.countNumber.value = String(settings.equalCount);
    els.countValue.textContent = `${settings.equalCount} 片`;
  }

  function syncOutputWidthUI() {
    const original = settings.widthMode === "original";
    els.outputWidthInput.disabled = original;

    if (original) {
      els.outputWidth.value = "original";
      els.outputWidthInput.value = source ? String(Math.min(source.width, MAX_OUT_WIDTH)) : "";
      els.outputWidthHint.textContent = source
        ? `原图宽度 ${formatInt(source.width)} px，不缩放。`
        : "默认保持原图宽度，不缩放。";
      return;
    }

    const width = getOutputWidth();
    if (settings.widthMode === "custom") {
      els.outputWidth.value = "custom";
    } else {
      const option = Array.from(els.outputWidth.options).find(
        (entry) => entry.value === String(width) && entry.value !== "original" && entry.value !== "custom"
      );
      els.outputWidth.value = option ? String(width) : "custom";
    }

    els.outputWidthInput.value = String(width);
    els.outputWidthHint.textContent = `所有切片输出为 ${formatInt(width)} px 宽。`;
  }

  function syncFormatUI() {
    if (!FORMAT_INFO[settings.format]) settings.format = "png";

    for (const button of els.formatGroup.querySelectorAll("button[data-format]")) {
      const active = button.dataset.format === settings.format;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    els.qualityWrap.hidden = settings.format === "png";
    els.qualityLabel.textContent = settings.format === "jpg" ? "JPG 质量" : "WebP 质量";
    els.qualityInput.value = String(Math.round(settings.quality * 100));
    els.qualityValue.textContent = `${Math.round(settings.quality * 100)}%`;

    if (settings.format === "png") {
      els.formatHint.textContent = "PNG 无损，适合详情页，文件会稍大。";
    } else if (settings.format === "jpg") {
      els.formatHint.textContent = "JPG 体积更小，透明区域会输出白色。";
    } else {
      els.formatHint.textContent = "WebP 体积更小，部分平台支持有限。";
    }

    updateSizeLimitHint();
  }

  function updateSizeLimitHint() {
    const limit = getSizeLimitKB();
    if (!limit) {
      els.sizeLimitHint.textContent = "不限制单张大小；平台有要求时再开启。";
      els.sizeLimitHint.classList.remove("is-warning");
      return;
    }

    const target = Math.max(1, limit - 1);
    let text = `达到或超过 ${limit} KB 的切片会压到 ${target} KB 以内（按 1KB=1024B，预留 1KB 余量），尺寸不变。`;
    if (settings.format === "png") {
      text += " PNG 无法调质量，超限切片会自动转成 JPG（透明区域填白）。";
    }
    els.sizeLimitHint.textContent = text;
    els.sizeLimitHint.classList.toggle("is-warning", settings.format === "png");
  }

  function syncSizeLimitUI() {
    const limit = getSizeLimitKB();
    els.sizeLimitBadge.textContent = limit ? `${limit} KB` : "不限";
    els.sizeLimitInput.disabled = limit === 0;

    if (!limit) {
      els.sizeLimitPreset.value = "0";
      if (!els.sizeLimitInput.value) els.sizeLimitInput.value = "200";
    } else {
      els.sizeLimitInput.value = String(limit);
      const option = Array.from(els.sizeLimitPreset.options).find(
        (entry) => entry.value === String(limit) && entry.value !== "0" && entry.value !== "custom"
      );
      els.sizeLimitPreset.value = option ? String(limit) : "custom";
    }

    updateSizeLimitHint();
  }

  function syncSettingsUI() {
    syncModeUI();
    syncHeightUI();
    syncCountUI();
    syncOutputWidthUI();
    syncFormatUI();
    syncSizeLimitUI();
    els.prefixInput.value = settings.prefix;
    els.startInput.value = String(settings.start);
  }

  function updateSummary() {
    if (!source) {
      els.previewDim.textContent = "—";
      els.cutCount.textContent = "0 片";
      els.summarySource.textContent = "—";
      els.summaryCount.textContent = "—";
      els.summarySlice.textContent = "—";
      els.summaryTotal.textContent = "—";
      const emptyLimit = getSizeLimitKB();
      els.summaryLimit.textContent = emptyLimit
        ? `${emptyLimit} KB（压到 ${Math.max(1, emptyLimit - 1)} KB）`
        : "不限";
      const emptyExt = (FORMAT_INFO[settings.format] || FORMAT_INFO.png).ext;
      els.namePreview.textContent = buildNamePreview(0, emptyExt);
      els.limitWarning.hidden = true;
      els.exportAll.disabled = true;
      els.exportLabel.textContent = "导出全部切片（ZIP）";
      return;
    }

    const count = currentSlices.length;
    const outWidth = getOutputWidth();
    const heights = currentSlices.map((slice) => slice.outHeight);
    const minHeight = heights.length ? Math.min(...heights) : 0;
    const maxHeight = heights.length ? Math.max(...heights) : 0;
    const totalHeight = heights.reduce((sum, value) => sum + value, 0);
    const tooLarge = currentSlices.some((slice) => sliceTooLarge(slice, outWidth));
    const sourceTooWide = settings.widthMode === "original" && source.width > MAX_OUT_WIDTH;

    els.previewDim.textContent = `${formatInt(source.width)} × ${formatInt(source.height)} px`;
    els.cutCount.textContent = `${count} 片`;
    els.summarySource.textContent = `${formatInt(source.width)} × ${formatInt(source.height)} px`;
    els.summaryCount.textContent = `${count} 片`;
    els.summarySlice.textContent = count
      ? `${formatInt(outWidth)} × ${
          minHeight === maxHeight
            ? formatInt(minHeight)
            : `${formatInt(minHeight)}–${formatInt(maxHeight)}`
        } px`
      : "—";
    els.summaryTotal.textContent = `${formatInt(totalHeight)} px`;
    const limit = getSizeLimitKB();
    els.summaryLimit.textContent = limit
      ? `${limit} KB（压到 ${Math.max(1, limit - 1)} KB）`
      : "不限";

    const ext = (FORMAT_INFO[settings.format] || FORMAT_INFO.png).ext;
    els.namePreview.textContent = buildNamePreview(count, ext);

    if (tooLarge) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.add("is-error");
      els.warningText.textContent =
        "有切片的输出尺寸超过浏览器单图上限（高度 32,767px 或总面积 2.68 亿像素），无法导出。请减小「每片高度」或降低输出宽度。";
    } else if (sourceTooWide) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.remove("is-error");
      els.warningText.textContent =
        `原图宽度 ${formatInt(source.width)} px，超过单张画布建议宽度，将按 ${formatInt(MAX_OUT_WIDTH)} px 导出。`;
    } else if (count > 200) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.remove("is-error");
      els.warningText.textContent =
        `这次会导出 ${count} 张切片，生成 ZIP 可能需要较长时间，建议适当增大每片高度。`;
    } else if (count > 1 && currentSlices[count - 1].height < 10) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.remove("is-error");
      els.warningText.textContent =
        `最后一片只有 ${formatInt(currentSlices[count - 1].height)} px 高，可能需要调整切分高度。`;
    } else {
      els.limitWarning.hidden = true;
    }

    els.exportAll.disabled = exporting || loading || !count || tooLarge;
    els.exportLabel.textContent = exporting ? "正在导出…" : "导出全部切片（ZIP）";
  }

  function buildFilename(index, ext) {
    const total = Math.max(1, currentSlices.length);
    const start = clamp(Math.round(Number(settings.start) || 1), 1, 9999);
    const number = start + index;
    const digits = Math.max(2, String(start + total - 1).length);
    return `${sanitizePrefix(settings.prefix)}${String(number).padStart(digits, "0")}.${ext}`;
  }

  function buildNamePreview(count, ext) {
    const firstName = buildFilename(0, ext);
    const secondName = count > 1 ? buildFilename(1, ext) : "";
    let text = count > 1 ? `示例：${firstName}、${secondName}…` : `示例：${firstName}`;
    if (settings.format === "png" && getSizeLimitKB() > 0) {
      text += "（超限转 .jpg）";
    }
    return text;
  }

  function commitFixedHeight(value, normalizeInput) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      if (normalizeInput) els.heightInput.value = String(settings.fixedHeight);
      return;
    }

    const height = clamp(Math.round(parsed), MIN_SLICE_HEIGHT, MAX_SLICE_HEIGHT);
    settings.fixedHeight = height;
    saveSettings();
    syncHeightUI();
    if (normalizeInput) els.heightInput.value = String(height);
    refreshAll();
  }

  function setEqualCount(value) {
    const count = clamp(Math.round(Number(value) || settings.equalCount), 2, MAX_EQUAL_COUNT);
    settings.equalCount = count;
    saveSettings();
    syncCountUI();
    if (settings.mode === "equal") refreshAll();
  }

  function commitOutputWidth(value, normalizeInput) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      if (normalizeInput) els.outputWidthInput.value = String(getOutputWidth());
      return;
    }

    const width = clamp(Math.round(parsed), MIN_OUT_WIDTH, MAX_OUT_WIDTH);
    settings.widthMode = "custom";
    settings.outputWidth = width;
    saveSettings();
    syncOutputWidthUI();
    if (normalizeInput) els.outputWidthInput.value = String(width);
    refreshAll();
  }

  function commitSizeLimit(value, normalizeInput) {
    const text = String(value || "").trim();
    const parsed = Number(text);
    if (text === "" || !Number.isFinite(parsed)) {
      syncSizeLimitUI();
      return;
    }

    if (parsed <= 0) {
      settings.sizeLimit = 0;
      saveSettings();
      syncSizeLimitUI();
      updateSummary();
      return;
    }

    const limit = clamp(Math.round(parsed), MIN_SIZE_LIMIT, MAX_SIZE_LIMIT);
    settings.sizeLimit = limit;
    saveSettings();
    syncSizeLimitUI();
    if (normalizeInput) els.sizeLimitInput.value = String(limit);
    updateSummary();
  }

  function resetSettings() {
    settings = { ...DEFAULTS };
    saveSettings();
    syncSettingsUI();
    refreshAll();
  }

  function setLoading(busy) {
    loading = busy;
    els.importBtn.disabled = busy;
    els.emptyImportBtn.disabled = busy;
    els.importBtn.setAttribute("aria-busy", String(busy));
    updateSummary();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片无法解码"));
      image.src = url;
    });
  }

  async function handleFile(file) {
    if (loading) {
      toast("正在载入上一张长图，请稍候", "info", 1800);
      return;
    }
    if (exporting) {
      toast("正在导出，请稍后再载入新的长图", "warn");
      return;
    }
    if (!isImageFile(file)) {
      toast("请选择 PNG、JPG、WebP 等图片文件", "warn");
      return;
    }

    setLoading(true);
    let url = null;

    try {
      url = URL.createObjectURL(file);
      const image = await loadImage(url);
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) throw new Error("图片尺寸无效");

      const previous = source;
      source = {
        file,
        url,
        image,
        width,
        height,
        name: file.name || "未命名长图",
        size: file.size
      };
      manualCuts = [];
      selectedIndex = -1;
      zoomMode = "fit";

      els.sourceImage.src = url;
      els.sourceImage.alt = source.name;
      els.sourceThumb.src = url;
      els.sourceName.textContent = source.name;
      els.sourceName.title = source.name;
      els.sourceDetail.textContent =
        `${formatInt(width)} × ${formatInt(height)} px · ${formatBytes(file.size)}`;

      if (previous) {
        setTimeout(() => URL.revokeObjectURL(previous.url), 1000);
      }

      syncOutputWidthUI();
      refreshAll();
      els.sliceList.scrollTop = 0;
      els.previewViewport.scrollTo({ top: 0, left: 0 });
      toast(`已载入长图 · ${formatInt(width)} × ${formatInt(height)}`, "success");
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      console.error(error);
      toast(`长图载入失败：${error.message || "无法读取图片"}`, "error");
    } finally {
      setLoading(false);
    }
  }

  function removeSource() {
    if (!source || loading || exporting) return;
    const confirmed = window.confirm("移除当前长图？切点也会一起清空。");
    if (!confirmed) return;

    const previous = source;
    source = null;
    manualCuts = [];
    selectedIndex = -1;

    els.sourceImage.removeAttribute("src");
    els.sourceThumb.removeAttribute("src");
    els.sourceName.textContent = "";
    els.sourceDetail.textContent = "";
    URL.revokeObjectURL(previous.url);

    syncOutputWidthUI();
    refreshAll();
    els.previewViewport.scrollTo({ top: 0, left: 0 });
    toast("已移除长图", "info");
  }

  function showDropOverlay() {
    els.dropOverlay.hidden = false;
  }

  function hideDropOverlay() {
    els.dropOverlay.hidden = true;
    dragDepth = 0;
  }

  function hasFilePayload(event) {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types || []).indexOf("Files") !== -1;
  }

  function timestampForFile() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}`
    );
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("无法生成切片，可能是尺寸超出浏览器内存上限"));
          },
          mime,
          quality
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function showExportOverlay() {
    const layout = document.querySelector(".layout");
    const header = document.querySelector(".app-header");
    if (layout) layout.inert = true;
    if (header) header.inert = true;

    els.progressFill.style.width = "0%";
    els.exportStatus.textContent = "准备切图…";
    els.exportOverlay.hidden = false;
    els.exportOverlay.setAttribute("tabindex", "-1");
    els.exportOverlay.focus();
  }

  function hideExportOverlay() {
    const layout = document.querySelector(".layout");
    const header = document.querySelector(".app-header");
    if (layout) layout.inert = false;
    if (header) header.inert = false;
    els.exportOverlay.hidden = true;
  }

  function setExportProgress(done, total, message) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    els.progressFill.style.width = `${clamp(percent, 0, 100)}%`;
    els.exportStatus.textContent = message || `正在生成 ${done} / ${total} 片…`;
  }

  function createOpaqueCanvas(sourceCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;

    if (canvas.width !== sourceCanvas.width || canvas.height !== sourceCanvas.height) {
      throw new Error("浏览器无法创建这么大的切片画布");
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器不支持 Canvas");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceCanvas, 0, 0);
    return canvas;
  }

  async function encodeWithinLimit(canvas, mime, limitKB, startQuality) {
    const targetBytes = Math.max(512, limitKB * 1024 - 1024);
    let low = 0.01;
    let high = clamp(startQuality, 0.05, 0.98);
    let best = null;

    for (let index = 0; index < 9; index += 1) {
      const quality = (low + high) / 2;
      const blob = await canvasToBlob(canvas, mime, quality);
      if (blob.size <= targetBytes) {
        best = { blob, quality };
        low = quality;
      } else {
        high = quality;
      }
    }

    if (!best) {
      for (const quality of [0.02, 0.01, 0.005]) {
        const blob = await canvasToBlob(canvas, mime, quality);
        if (blob.size <= targetBytes) {
          best = { blob, quality };
          break;
        }
      }
    }

    if (!best) {
      throw new Error(`保持尺寸时无法压到 ${limitKB} KB 以内`);
    }
    return best;
  }

  async function renderSliceBlob(slice) {
    if (!source) throw new Error("还没有载入长图");

    const width = getOutputWidth();
    const height = slice.outHeight;
    if (width < 1 || height < 1) throw new Error("切片尺寸无效");
    if (height > MAX_CANVAS_DIM || width * height > MAX_CANVAS_AREA) {
      throw new Error(`第 ${slice.index} 片尺寸超过浏览器单图上限`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    if (canvas.width !== width || canvas.height !== height) {
      throw new Error("浏览器无法创建这么大的切片画布");
    }

    const canvases = [canvas];

    try {
      const format = FORMAT_INFO[settings.format] || FORMAT_INFO.png;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("浏览器不支持 Canvas");

      if (settings.format === "jpg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        source.image,
        0,
        slice.start,
        source.width,
        slice.height,
        0,
        0,
        width,
        height
      );

      let blob = await canvasToBlob(canvas, format.mime, settings.quality);
      let actualMime = (blob.type || format.mime).toLowerCase();
      let ext = extensionFromMime(actualMime);
      const originalSize = blob.size;
      let compressed = false;
      let quality = null;
      let convertedFromPng = false;

      const limitKB = getSizeLimitKB();
      if (limitKB > 0 && blob.size >= limitKB * 1024) {
        let encodeCanvas = canvas;
        let encodeMime = actualMime;

        if (actualMime !== "image/jpeg" && actualMime !== "image/webp") {
          encodeCanvas = createOpaqueCanvas(canvas);
          canvases.push(encodeCanvas);
          encodeMime = "image/jpeg";
          convertedFromPng = actualMime === "image/png";

          // 原透明画布已经复制到白底画布，及时释放，降低大图的峰值内存。
          canvas.width = 1;
          canvas.height = 1;
        }

        const encoded = await encodeWithinLimit(
          encodeCanvas,
          encodeMime,
          limitKB,
          settings.quality
        );

        blob = encoded.blob;
        actualMime = (blob.type || encodeMime).toLowerCase();
        ext = extensionFromMime(actualMime);
        compressed = true;
        quality = encoded.quality;
      }

      return { blob, ext, compressed, originalSize, quality, convertedFromPng };
    } finally {
      for (const item of canvases) {
        item.width = 1;
        item.height = 1;
      }
    }
  }

  async function exportSingle(index) {
    if (exporting || loading || !source) return;
    const slice = currentSlices[index];
    if (!slice) return;
    if (sliceTooLarge(slice, getOutputWidth())) {
      toast("这一片超出浏览器单图上限，请减小切分高度或输出宽度", "error");
      return;
    }

    exporting = true;
    updateSummary();
    toast(
      getSizeLimitKB() ? `正在压缩并导出第 ${index + 1} 片…` : `正在导出第 ${index + 1} 片…`,
      "info",
      1600
    );

    try {
      let result;
      try {
        result = await renderSliceBlob(slice);
      } catch (error) {
        throw new Error(`第 ${index + 1} 片：${error.message || "处理失败"}`);
      }
      const filename = buildFilename(index, result.ext);
      triggerDownload(result.blob, filename);

      let detail = formatBytes(result.blob.size);
      if (result.compressed) {
        detail =
          `已压缩至 ${formatBytes(result.blob.size)}` +
          `（原 ${formatBytes(result.originalSize)}，质量 ${Math.round(result.quality * 100)}%）` +
          (result.convertedFromPng ? "，PNG 转 JPG" : "");
      }
      toast(`已导出 ${filename} · ${detail}`, "success", 4600);
    } catch (error) {
      console.error(error);
      toast(`切片导出失败：${error.message || "未知错误"}`, "error");
    } finally {
      exporting = false;
      updateSummary();
    }
  }

  async function exportAllSlices() {
    if (exporting || loading || !source || !currentSlices.length) return;

    const outWidth = getOutputWidth();
    if (currentSlices.some((slice) => sliceTooLarge(slice, outWidth))) {
      toast("有切片超过浏览器单图上限，请先调整切分高度或输出宽度", "error");
      return;
    }

    exporting = true;
    updateSummary();
    showExportOverlay();

    try {
      const entries = [];
      const total = currentSlices.length;
      let compressedCount = 0;
      let convertedCount = 0;

      for (let index = 0; index < total; index += 1) {
        setExportProgress(index, total, `正在生成第 ${index + 1} / ${total} 片…`);
        await nextTick();

        const slice = currentSlices[index];
        let result;
        try {
          result = await renderSliceBlob(slice);
        } catch (error) {
          throw new Error(`第 ${index + 1} 片：${error.message || "处理失败"}`);
        }
        const data = new Uint8Array(await result.blob.arrayBuffer());
        entries.push({ name: buildFilename(index, result.ext), data });

        if (result.compressed) compressedCount += 1;
        if (result.convertedFromPng) convertedCount += 1;

        setExportProgress(index + 1, total);
        await nextTick();
      }

      setExportProgress(total, total, "正在打包 ZIP…");
      await nextTick();

      const zipBlob = buildZip(entries);
      const zipName = `长图切图_${total}片_${timestampForFile()}.zip`;
      const extra = compressedCount
        ? ` · ${compressedCount} 张已压缩${convertedCount ? `（${convertedCount} 张转 JPG）` : ""}`
        : "";
      triggerDownload(zipBlob, zipName);
      toast(
        `已导出 ${total} 张切片 · ${zipName} · ${formatBytes(zipBlob.size)}${extra}`,
        "success",
        5600
      );
    } catch (error) {
      console.error(error);
      toast(`切图失败：${error.message || "未知错误"}`, "error", 6200);
    } finally {
      exporting = false;
      hideExportOverlay();
      updateSummary();
    }
  }

  // ---- ZIP（store 模式，无外部依赖） ----

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time =
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day =
      ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();
    return { time: time & 0xffff, date: day & 0xffff };
  }

  function buildZip(entries) {
    if (!entries.length) throw new Error("没有可打包的切片");
    if (entries.length > 65535) throw new Error("切片数量超过 ZIP 上限");

    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const parts = [];
    const centralHeaders = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = entry.data;
      const size = data.byteLength;
      if (size > 0xffffffff || offset > 0xffffffff) {
        throw new Error("ZIP 文件过大，请减少切片数量");
      }

      const checksum = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, time, true);
      localView.setUint16(12, date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, size, true);
      localView.setUint32(22, size, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, time, true);
      centralView.setUint16(14, date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, size, true);
      centralView.setUint32(24, size, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      parts.push(local, data);
      centralHeaders.push(central);
      offset += local.length + data.length;
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const header of centralHeaders) {
      parts.push(header);
      centralSize += header.length;
    }

    if (centralOffset > 0xffffffff || centralSize > 0xffffffff) {
      throw new Error("ZIP 文件过大，请减少切片数量");
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);
    parts.push(end);

    return new Blob(parts, { type: "application/zip" });
  }

  function toast(message, type = "info", duration = 3200) {
    const node = document.createElement("div");
    node.className = `toast is-${type}`;
    const icon = type === "error" || type === "warn" ? "!" : "✓";
    node.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-text"></span>`;
    node.querySelector(".toast-text").textContent = message;

    while (els.toastStack.children.length >= 4) {
      els.toastStack.firstElementChild.remove();
    }

    els.toastStack.append(node);
    requestAnimationFrame(() => node.classList.add("is-visible"));

    setTimeout(() => {
      node.classList.remove("is-visible");
      setTimeout(() => node.remove(), 230);
    }, duration);
  }

  function bindEvents() {
    els.importBtn.addEventListener("click", () => els.fileInput.click());
    els.emptyImportBtn.addEventListener("click", () => els.fileInput.click());
    els.removeImageBtn.addEventListener("click", removeSource);
    els.exportAll.addEventListener("click", exportAllSlices);

    els.fileInput.addEventListener("change", () => {
      const file = (els.fileInput.files || [])[0];
      els.fileInput.value = "";
      if (file) handleFile(file);
    });

    els.modeGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      const mode = button.dataset.mode;
      if (!MODES.has(mode)) return;
      settings.mode = mode;
      saveSettings();
      syncModeUI();
      refreshAll();
    });

    els.heightPreset.addEventListener("change", () => {
      if (els.heightPreset.value === "custom") {
        els.heightInput.focus();
        els.heightInput.select();
        return;
      }
      commitFixedHeight(els.heightPreset.value, true);
    });

    els.heightInput.addEventListener("change", () => {
      commitFixedHeight(els.heightInput.value, true);
    });

    els.heightInput.addEventListener("blur", () => {
      commitFixedHeight(els.heightInput.value, true);
    });

    els.countInput.addEventListener("input", () => {
      setEqualCount(els.countInput.value);
    });

    els.countNumber.addEventListener("change", () => {
      setEqualCount(els.countNumber.value);
    });

    els.countNumber.addEventListener("blur", () => {
      setEqualCount(els.countNumber.value);
    });

    els.undoCut.addEventListener("click", () => {
      if (!manualCuts.length) return;
      manualCuts = normalizeCuts(manualCuts);
      manualCuts.pop();
      refreshAll();
    });

    els.clearCuts.addEventListener("click", () => {
      if (!manualCuts.length) return;
      if (!window.confirm("清空所有手动切点？")) return;
      manualCuts = [];
      refreshAll();
    });

    els.cutChips.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-cut]");
      if (!button) return;
      removeCut(Number(button.dataset.cut));
    });

    els.outputWidth.addEventListener("change", () => {
      const value = els.outputWidth.value;
      if (value === "original") {
        settings.widthMode = "original";
        saveSettings();
        syncOutputWidthUI();
        refreshAll();
        return;
      }
      if (value === "custom") {
        settings.widthMode = "custom";
        saveSettings();
        syncOutputWidthUI();
        els.outputWidthInput.focus();
        els.outputWidthInput.select();
        return;
      }
      settings.widthMode = "preset";
      settings.outputWidth = clamp(Number(value), MIN_OUT_WIDTH, MAX_OUT_WIDTH);
      saveSettings();
      syncOutputWidthUI();
      refreshAll();
    });

    els.outputWidthInput.addEventListener("change", () => {
      commitOutputWidth(els.outputWidthInput.value, true);
    });

    els.outputWidthInput.addEventListener("blur", () => {
      commitOutputWidth(els.outputWidthInput.value, true);
    });

    els.formatGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-format]");
      if (!button) return;
      const format = button.dataset.format;
      if (!FORMAT_INFO[format]) return;
      settings.format = format;
      saveSettings();
      syncFormatUI();
      updateSummary();
    });

    els.qualityInput.addEventListener("input", () => {
      settings.quality = clamp(Number(els.qualityInput.value) / 100, 0.5, 1);
      els.qualityValue.textContent = `${Math.round(settings.quality * 100)}%`;
      saveSettings();
    });

    els.sizeLimitPreset.addEventListener("change", () => {
      const value = els.sizeLimitPreset.value;
      if (value === "custom") {
        if (getSizeLimitKB() === 0) {
          settings.sizeLimit = 200;
          saveSettings();
        }
        syncSizeLimitUI();
        els.sizeLimitPreset.value = "custom";
        updateSummary();
        els.sizeLimitInput.focus();
        els.sizeLimitInput.select();
        return;
      }

      settings.sizeLimit = Number(value) || 0;
      saveSettings();
      syncSizeLimitUI();
      updateSummary();
    });

    els.sizeLimitInput.addEventListener("input", () => {
      const text = els.sizeLimitInput.value;
      const value = Number(text);
      if (text === "" || !Number.isFinite(value) || value < MIN_SIZE_LIMIT) return;

      settings.sizeLimit = clamp(Math.round(value), MIN_SIZE_LIMIT, MAX_SIZE_LIMIT);
      saveSettings();
      syncSizeLimitUI();
      updateSummary();
    });

    els.sizeLimitInput.addEventListener("change", () => {
      commitSizeLimit(els.sizeLimitInput.value, true);
    });

    els.sizeLimitInput.addEventListener("blur", () => {
      commitSizeLimit(els.sizeLimitInput.value, true);
    });

    els.prefixInput.addEventListener("input", () => {
      settings.prefix = els.prefixInput.value.slice(0, 30);
      saveSettings();
      updateSummary();
    });

    els.startInput.addEventListener("input", () => {
      const value = Number(els.startInput.value);
      if (Number.isFinite(value) && value >= 1) {
        settings.start = clamp(Math.round(value), 1, 9999);
        saveSettings();
        updateSummary();
      }
    });

    els.startInput.addEventListener("change", () => {
      settings.start = clamp(Math.round(Number(els.startInput.value) || 1), 1, 9999);
      els.startInput.value = String(settings.start);
      saveSettings();
      updateSummary();
    });

    els.startInput.addEventListener("blur", () => {
      settings.start = clamp(Math.round(Number(els.startInput.value) || 1), 1, 9999);
      els.startInput.value = String(settings.start);
      saveSettings();
      updateSummary();
    });

    els.resetSettings.addEventListener("click", resetSettings);

    els.sliceList.addEventListener("click", (event) => {
      const download = event.target.closest(".slice-download");
      if (download) {
        event.stopPropagation();
        exportSingle(Number(download.dataset.index));
        return;
      }
      const row = event.target.closest(".slice-item");
      if (row) selectSlice(Number(row.dataset.index));
    });

    els.sliceList.addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      const row = event.target.closest(".slice-item");
      if (!row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectSlice(Number(row.dataset.index));
      }
    });

    els.sliceCanvas.addEventListener("click", handleCanvasClick);

    els.zoomOut.addEventListener("click", () => {
      zoomMode = "manual";
      zoomValue = clamp(zoomValue / 1.15, 0.05, 1);
      applyPreviewLayout();
    });

    els.zoomIn.addEventListener("click", () => {
      zoomMode = "manual";
      zoomValue = clamp(zoomValue * 1.15, 0.05, 2);
      applyPreviewLayout();
    });

    els.zoomFit.addEventListener("click", () => {
      zoomMode = "fit";
      zoomValue = computeFitZoom();
      applyPreviewLayout();
    });

    window.addEventListener("dragenter", (event) => {
      if (!hasFilePayload(event)) return;
      dragDepth += 1;
      showDropOverlay();
    });

    window.addEventListener("dragleave", (event) => {
      if (!hasFilePayload(event)) {
        if (!event.relatedTarget) hideDropOverlay();
        return;
      }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 || !event.relatedTarget) hideDropOverlay();
    });

    window.addEventListener("dragover", (event) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });

    window.addEventListener("drop", (event) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      hideDropOverlay();

      const files = Array.from(event.dataTransfer.files || []).filter(isImageFile);
      if (!files.length) {
        toast("没有找到可用的图片，请拖入单张长图", "warn");
        return;
      }
      if (files.length > 1) {
        toast("一次只载入一张长图，已使用第一张", "warn");
      }
      handleFile(files[0]);
    });

    document.addEventListener("paste", (event) => {
      if (event.target && event.target.closest && event.target.closest("input, textarea, select")) {
        return;
      }
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const files = Array.from(clipboard.files || []).filter(isImageFile);
      if (!files.length && clipboard.items) {
        for (const item of Array.from(clipboard.items)) {
          if (item.kind !== "file") continue;
          const file = item.getAsFile();
          if (file && isImageFile(file)) files.push(file);
        }
      }
      if (!files.length) return;
      event.preventDefault();
      handleFile(files[0]);
    });

    document.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === "o") {
        if (exporting || loading) return;
        event.preventDefault();
        els.fileInput.click();
        return;
      }

      if (modifier && event.key === "Enter") {
        if (!els.exportAll.disabled) {
          event.preventDefault();
          exportAllSlices();
        }
        return;
      }

      if (event.key === "Escape") {
        hideDropOverlay();
      }
    });

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        if (zoomMode !== "fit" || !source) return;
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          zoomValue = computeFitZoom();
          applyPreviewLayout();
        });
      });
      observer.observe(els.previewViewport);
    } else {
      window.addEventListener("resize", () => {
        if (zoomMode !== "fit" || !source) return;
        zoomValue = computeFitZoom();
        applyPreviewLayout();
      });
    }

    window.addEventListener("beforeunload", () => {
      if (source) URL.revokeObjectURL(source.url);
    });
  }

  function init() {
    syncSettingsUI();
    renderAll();
    bindEvents();

    window.requestAnimationFrame(() => {
      if (source && zoomMode === "fit") {
        zoomValue = computeFitZoom();
        applyPreviewLayout();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
