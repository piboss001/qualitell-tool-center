(() => {
  "use strict";

  const MAX_CANVAS_DIM = 32767;
  const MAX_CANVAS_AREA = 268435456;
  const MIN_WIDTH = 100;
  const MAX_WIDTH = 4000;
  const MAX_GAP = 64;
  const SETTINGS_KEY = "detail-long-image.settings.v1";

  const DEFAULTS = Object.freeze({
    width: 750,
    gap: 0,
    background: "#ffffff",
    transparent: false,
    format: "png",
    quality: 0.92,
    autoFit: true,
    noUpscale: false,
    sortMode: "name-asc"
  });

  const FORMAT_INFO = {
    png: { mime: "image/png", ext: "png", label: "PNG" },
    jpg: { mime: "image/jpeg", ext: "jpg", label: "JPG" },
    webp: { mime: "image/webp", ext: "webp", label: "WebP" }
  };

  const SORT_MODES = new Set(["name-asc", "name-desc", "mtime-desc", "mtime-asc", "manual"]);
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  const IMAGE_TYPE_RE = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const $ = (id) => document.getElementById(id);

  const els = {
    addBtn: $("add-btn"),
    folderBtn: $("folder-btn"),
    helpBtn: $("help-btn"),
    clearBtn: $("clear-btn"),
    fileInput: $("file-input"),
    folderInput: $("folder-input"),
    sortSelect: $("sort-select"),
    queueList: $("queue-list"),
    queueEmpty: $("queue-empty"),
    queueCount: $("queue-count"),

    previewViewport: $("preview-viewport"),
    previewStage: $("preview-stage"),
    previewPage: $("preview-page"),
    emptyState: $("empty-state"),
    previewDim: $("preview-dim"),
    guidesBtn: $("guides-btn"),
    zoomOut: $("zoom-out"),
    zoomFit: $("zoom-fit"),
    zoomIn: $("zoom-in"),
    zoomLabel: $("zoom-label"),

    widthPreset: $("width-preset"),
    widthInput: $("width-input"),
    gapInput: $("gap-input"),
    gapValue: $("gap-value"),
    bgColor: $("bg-color"),
    bgHex: $("bg-hex"),
    transparentBg: $("transparent-bg"),
    formatGroup: $("format-group"),
    formatHint: $("format-hint"),
    qualityWrap: $("quality-wrap"),
    qualityLabel: $("quality-label"),
    qualityInput: $("quality-input"),
    qualityValue: $("quality-value"),
    summarySize: $("summary-size"),
    summaryMp: $("summary-mp"),
    summaryCount: $("summary-count"),
    summaryScale: $("summary-scale"),
    limitWarning: $("limit-warning"),
    warningText: $("warning-text"),
    autoFit: $("auto-fit"),
    noUpscale: $("no-upscale"),
    resetSettings: $("reset-settings"),
    exportBtn: $("export-btn"),
    exportLabel: $("export-label"),

    emptyAddBtn: $("empty-add-btn"),
    emptyFolderBtn: $("empty-folder-btn"),
    dropOverlay: $("drop-overlay"),
    exportOverlay: $("export-overlay"),
    exportStatus: $("export-status"),
    progressFill: $("progress-fill"),
    helpDialog: $("help-dialog"),
    toastStack: $("toast-stack")
  };

  let settings = loadSettings();
  let items = [];
  let nextId = 1;
  let importBusy = false;
  let exporting = false;
  let dragId = null;
  let dragDepth = 0;
  let zoomMode = "fit";
  let zoomValue = 1;
  let guidesOn = false;
  let resizeFrame = 0;
  let widthTimer = 0;

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

  function normalizeHex(value) {
    let text = String(value || "").trim();
    if (!text) return null;
    if (!text.startsWith("#")) text = `#${text}`;
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      text = `#${text.slice(1).split("").map((char) => char + char).join("")}`;
    }
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : null;
  }

  function loadSettings() {
    const result = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return result;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return result;

      const width = Number(parsed.width);
      if (Number.isFinite(width)) result.width = clamp(Math.round(width), MIN_WIDTH, MAX_WIDTH);

      const gap = Number(parsed.gap);
      if (Number.isFinite(gap)) result.gap = clamp(Math.round(gap), 0, MAX_GAP);

      const background = normalizeHex(parsed.background);
      if (background) result.background = background;

      if (typeof parsed.transparent === "boolean") result.transparent = parsed.transparent;
      if (FORMAT_INFO[parsed.format]) result.format = parsed.format;
      if (result.format === "jpg") result.transparent = false;

      const quality = Number(parsed.quality);
      if (Number.isFinite(quality)) result.quality = clamp(quality, 0.5, 1);

      if (typeof parsed.autoFit === "boolean") result.autoFit = parsed.autoFit;
      if (typeof parsed.noUpscale === "boolean") result.noUpscale = parsed.noUpscale;
      if (SORT_MODES.has(parsed.sortMode)) result.sortMode = parsed.sortMode;
    } catch (error) {
      // 本地存储不可用时使用默认值。
    }
    return result;
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      // 某些 file:// 环境会禁用 localStorage，不影响导出。
    }
  }

  function getTargetWidth() {
    return clamp(Math.round(Number(settings.width) || DEFAULTS.width), MIN_WIDTH, MAX_WIDTH);
  }

  function itemDrawWidth(item, targetWidth) {
    return settings.noUpscale ? Math.min(targetWidth, item.width) : targetWidth;
  }

  function estimateLayout(scale, targetWidth) {
    const widths = [];
    const heights = [];
    let totalHeight = 0;

    for (const item of items) {
      const width = Math.max(1, Math.round(itemDrawWidth(item, targetWidth) * scale));
      const height = Math.max(1, Math.round((item.height * width) / item.width));
      widths.push(width);
      heights.push(height);
      totalHeight += height;
    }

    const gap = Math.max(0, Math.round(settings.gap * scale));
    if (items.length > 1) totalHeight += gap * (items.length - 1);

    return {
      width: Math.max(1, Math.round(targetWidth * scale)),
      height: Math.max(1, totalHeight),
      widths,
      heights,
      gap,
      scale
    };
  }

  function getExportPlan() {
    const targetWidth = getTargetWidth();
    if (!items.length) {
      return {
        width: targetWidth,
        height: 0,
        widths: [],
        heights: [],
        gap: 0,
        scale: 1,
        limited: false,
        exportable: false
      };
    }

    const base = estimateLayout(1, targetWidth);
    const isLimited =
      base.height > MAX_CANVAS_DIM || base.width * base.height > MAX_CANVAS_AREA;

    if (!isLimited) {
      return { ...base, limited: false, exportable: true };
    }

    if (!settings.autoFit) {
      return { ...base, limited: true, exportable: false };
    }

    let scale = Math.min(
      1,
      (MAX_CANVAS_DIM - 2) / base.height,
      Math.sqrt((MAX_CANVAS_AREA - 1) / (base.width * base.height))
    );
    scale = Math.max(0.0001, Math.min(scale, 0.9999));

    let estimated = estimateLayout(scale, targetWidth);
    let guard = 0;
    while (
      (estimated.height > MAX_CANVAS_DIM ||
        estimated.width * estimated.height > MAX_CANVAS_AREA) &&
      guard < 60
    ) {
      scale *= 0.995;
      estimated = estimateLayout(scale, targetWidth);
      guard += 1;
    }

    return {
      ...estimated,
      limited: true,
      exportable:
        estimated.height <= MAX_CANVAS_DIM &&
        estimated.width * estimated.height <= MAX_CANVAS_AREA
    };
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && IMAGE_TYPE_RE.test(file.type)) return true;
    return IMAGE_EXT_RE.test(file.name || "");
  }

  function itemKey(file) {
    const path = file.webkitRelativePath || file.name || "";
    return `${path}|${file.size}|${file.lastModified}`;
  }

  function readImageDimensions(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        } else {
          reject(new Error("图片尺寸无效"));
        }
      };
      image.onerror = () => reject(new Error("图片无法解码"));
      image.src = url;
    });
  }

  function sortItemsInPlace(mode) {
    if (mode === "manual") return;

    items.sort((a, b) => {
      if (mode === "name-asc" || mode === "name-desc") {
        const result =
          collator.compare(a.name, b.name) ||
          collator.compare(a.path || a.name, b.path || b.name);
        return mode === "name-asc" ? result : -result;
      }

      if (mode === "mtime-desc" || mode === "mtime-asc") {
        const result = (a.lastModified || 0) - (b.lastModified || 0);
        if (result !== 0) return mode === "mtime-desc" ? -result : result;
        return collator.compare(a.name, b.name);
      }

      return 0;
    });
  }

  function setSortMode(mode, shouldSort = true) {
    settings.sortMode = SORT_MODES.has(mode) ? mode : "name-asc";
    if (shouldSort && settings.sortMode !== "manual") {
      sortItemsInPlace(settings.sortMode);
    }
    els.sortSelect.value = settings.sortMode;
    saveSettings();
  }

  function revokeItem(item) {
    try {
      URL.revokeObjectURL(item.url);
    } catch (error) {
      // 忽略已经释放的 URL。
    }
  }

  function renderQueue() {
    const scrollTop = els.queueList.scrollTop;
    els.queueList.replaceChildren();
    els.queueEmpty.hidden = items.length > 0;
    els.queueList.hidden = items.length === 0;
    els.queueCount.textContent = String(items.length);

    const fragment = document.createDocumentFragment();

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "queue-item";
      li.draggable = true;
      li.dataset.id = String(item.id);
      li.setAttribute("aria-label", `${index + 1}. ${item.name}`);

      li.innerHTML = `
        <span class="drag-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <span class="thumb"></span>
        <span class="item-info">
          <span class="item-name"></span>
          <span class="item-meta"></span>
        </span>
        <span class="item-actions">
          <button type="button" class="item-action" data-action="up" aria-label="上移" title="上移">
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 9.6V2.6M3.2 5.4 6 2.6l2.8 2.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="item-action" data-action="down" aria-label="下移" title="下移">
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 2.4v7M3.2 6.6 6 9.4l2.8-2.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="item-action" data-action="remove" aria-label="移除" title="移除">
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>
          </button>
        </span>
        <span class="item-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      `;

      const image = document.createElement("img");
      image.src = item.url;
      image.alt = item.name;
      image.loading = "lazy";
      image.decoding = "async";
      image.draggable = false;
      li.querySelector(".thumb").append(image);

      const name = li.querySelector(".item-name");
      name.textContent = item.name;
      name.title = item.path || item.name;

      li.querySelector(".item-meta").textContent =
        `${formatInt(item.width)} × ${formatInt(item.height)} · ${formatBytes(item.size)}`;

      const up = li.querySelector('[data-action="up"]');
      const down = li.querySelector('[data-action="down"]');
      up.disabled = index === 0;
      down.disabled = index === items.length - 1;

      fragment.append(li);
    });

    els.queueList.append(fragment);
    els.queueList.scrollTop = scrollTop;
  }

  function renderPreview() {
    const pageWasHidden = els.previewPage.hidden;
    const scrollTop = els.previewViewport.scrollTop;
    const scrollLeft = els.previewViewport.scrollLeft;
    const fragment = document.createDocumentFragment();

    items.forEach((item, index) => {
      const slice = document.createElement("div");
      slice.className = "preview-slice";
      slice.dataset.index = String(index + 1).padStart(2, "0");

      const image = document.createElement("img");
      image.src = item.url;
      image.alt = item.name;
      image.loading = "lazy";
      image.decoding = "async";
      image.draggable = false;
      image.width = item.width;
      image.height = item.height;

      slice.append(image);
      fragment.append(slice);
    });

    els.previewPage.replaceChildren(fragment);
    const hasItems = items.length > 0;
    els.previewPage.hidden = !hasItems;
    els.emptyState.hidden = hasItems;

    if (pageWasHidden && hasItems) {
      zoomMode = "fit";
      zoomValue = computeFitZoom();
    }

    els.previewPage.classList.toggle("show-guides", guidesOn);
    applyPreviewLayout();

    if (!pageWasHidden) {
      els.previewViewport.scrollTop = scrollTop;
      els.previewViewport.scrollLeft = scrollLeft;
    }
  }

  function applyPreviewLayout() {
    const targetWidth = getTargetWidth();
    if (zoomMode === "fit") zoomValue = computeFitZoom();
    const pageWidth = Math.max(1, targetWidth * zoomValue);
    const previewTransparent = settings.transparent && settings.format !== "jpg";

    els.previewPage.style.width = `${pageWidth}px`;
    els.previewPage.style.gap = `${settings.gap * zoomValue}px`;
    els.previewPage.classList.toggle("is-transparent", previewTransparent);
    els.previewPage.style.backgroundColor = previewTransparent
      ? ""
      : settings.transparent
        ? "#ffffff"
        : settings.background;

    const slices = els.previewPage.children;
    for (let index = 0; index < slices.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      const slice = slices[index];
      const drawWidth = itemDrawWidth(item, targetWidth);
      slice.style.width = `${drawWidth * zoomValue}px`;
      const centered = drawWidth < targetWidth;
      slice.style.marginLeft = centered ? "auto" : "0";
      slice.style.marginRight = centered ? "auto" : "0";
    }

    updateZoomLabel();
    updateSummary();
  }

  function computeFitZoom() {
    const targetWidth = getTargetWidth();
    const style = getComputedStyle(els.previewStage);
    const horizontalPadding =
      (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const available = els.previewViewport.clientWidth - horizontalPadding - 4;
    if (available <= 0) return 0.1;
    return clamp(available / targetWidth, 0.05, 1);
  }

  function updateZoomLabel() {
    els.zoomLabel.textContent = `${Math.round(zoomValue * 100)}%`;
    els.zoomFit.classList.toggle("is-active", zoomMode === "fit");
  }

  function updateSummary() {
    const count = items.length;
    els.queueCount.textContent = String(count);
    els.summaryCount.textContent = `${count} 张`;

    if (!count) {
      els.previewDim.textContent = "—";
      els.summarySize.textContent = "—";
      els.summaryMp.textContent = "—";
      els.summaryScale.hidden = true;
      els.limitWarning.hidden = true;
      els.exportBtn.disabled = true;
      els.exportLabel.textContent = "导出长图";
      return;
    }

    const plan = getExportPlan();
    const pixels = plan.width * plan.height;

    els.previewDim.textContent = `${formatInt(plan.width)} × ${formatInt(plan.height)} px`;
    els.summarySize.textContent = `${formatInt(plan.width)} × ${formatInt(plan.height)} px`;
    els.summaryMp.textContent = `${(pixels / 1000000).toFixed(1)} MP`;

    if (plan.limited && plan.scale < 0.999) {
      els.summaryScale.hidden = false;
      els.summaryScale.textContent =
        `已自动等比缩放至 ${Math.round(plan.scale * 100)}%，避免超出浏览器单图上限。`;
    } else {
      els.summaryScale.hidden = true;
    }

    if (plan.limited && !plan.exportable) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.add("is-error");
      els.warningText.textContent =
        "当前长图超过浏览器单图上限，无法导出。请减小输出宽度、开启「超限时自动缩小」，或把切图拆成两张。";
    } else if (plan.limited) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.remove("is-error");
      els.warningText.textContent =
        `长图超过 Chrome 单图上限，导出时会自动缩小为 ${formatInt(plan.width)} × ${formatInt(plan.height)} px。想保留更高清晰度，可减小输出宽度。`;
    } else if (pixels > 80000000) {
      els.limitWarning.hidden = false;
      els.limitWarning.classList.remove("is-error");
      els.warningText.textContent =
        `这张长图约 ${(pixels / 1000000).toFixed(1)} MP，生成和下载可能需要几秒，请保持页面打开。`;
    } else {
      els.limitWarning.hidden = true;
    }

    els.exportBtn.disabled = exporting || importBusy || !plan.exportable;
    els.exportLabel.textContent = exporting ? "正在导出…" : "导出长图";
  }

  function syncWidthPreset() {
    const value = String(getTargetWidth());
    const option = Array.from(els.widthPreset.options).find(
      (entry) => entry.value === value
    );
    els.widthPreset.value = option ? value : "custom";
  }

  function syncBackgroundUI() {
    els.bgColor.value = settings.background;
    els.bgHex.value = settings.background;
    els.transparentBg.checked = settings.transparent;
    els.transparentBg.disabled = settings.format === "jpg";
    els.transparentBg.title = settings.format === "jpg" ? "JPG 不支持透明背景" : "";
    els.bgColor.disabled = settings.transparent;
    els.bgHex.disabled = settings.transparent;
  }

  function syncFormatUI() {
    const info = FORMAT_INFO[settings.format] || FORMAT_INFO.png;
    settings.format = FORMAT_INFO[settings.format] ? settings.format : "png";

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
      els.formatHint.textContent = "JPG 体积更小，不支持透明背景。";
    } else {
      els.formatHint.textContent = "WebP 体积更小，部分平台支持有限。";
    }

    els.formatHint.title = info.label;
  }

  function syncSettingsUI() {
    els.widthInput.value = String(getTargetWidth());
    syncWidthPreset();
    els.gapInput.value = String(settings.gap);
    els.gapValue.textContent = `${settings.gap} px`;
    syncBackgroundUI();
    syncFormatUI();
    els.autoFit.checked = settings.autoFit;
    els.noUpscale.checked = settings.noUpscale;
    els.sortSelect.value = settings.sortMode;
  }

  function commitWidth(value, normalizeInput) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      if (normalizeInput) els.widthInput.value = String(settings.width);
      return;
    }

    const width = clamp(Math.round(parsed), MIN_WIDTH, MAX_WIDTH);
    settings.width = width;
    saveSettings();
    syncWidthPreset();
    if (normalizeInput) els.widthInput.value = String(width);
    applyPreviewLayout();
  }

  function removeItem(id) {
    const index = items.findIndex((item) => String(item.id) === String(id));
    if (index < 0) return;
    const [removed] = items.splice(index, 1);
    renderQueue();
    renderPreview();
    if (removed) revokeItem(removed);
  }

  function moveItem(id, delta) {
    const index = items.findIndex((item) => String(item.id) === String(id));
    const target = index + delta;
    if (index < 0 || target < 0 || target >= items.length) return;

    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    setSortMode("manual", false);
    renderQueue();
    renderPreview();
  }

  function clearQueue() {
    if (!items.length || importBusy || exporting) return;
    const confirmed = window.confirm(`确定清空 ${items.length} 张切图吗？`);
    if (!confirmed) return;

    const removed = items;
    items = [];
    renderQueue();
    renderPreview();
    removed.forEach(revokeItem);
    toast("已清空切图队列", "info");
  }

  async function importFiles(fileList) {
    if (importBusy) {
      toast("上一批切图还在导入，请稍候", "info", 1800);
      return;
    }
    if (exporting) {
      toast("正在导出长图，请稍后再导入", "warn");
      return;
    }

    const candidates = Array.from(fileList || []).filter(isImageFile);
    if (!candidates.length) {
      toast("没有找到支持的图片文件", "warn");
      return;
    }

    importBusy = true;
    setImportBusy(true);

    try {
      const existing = new Set(items.map((item) => item.key));
      const unique = [];
      let duplicateCount = 0;

      for (const file of candidates) {
        const key = itemKey(file);
        if (existing.has(key)) {
          duplicateCount += 1;
          continue;
        }
        existing.add(key);
        unique.push(file);
      }

      if (!unique.length) {
        toast(`这 ${candidates.length} 张切图已经在队列里了`, "warn");
        return;
      }

      const results = new Array(unique.length);
      let cursor = 0;
      let failed = 0;

      const worker = async () => {
        while (cursor < unique.length) {
          const index = cursor;
          cursor += 1;
          const file = unique[index];
          const url = URL.createObjectURL(file);

          try {
            const dimensions = await readImageDimensions(url);
            results[index] = {
              id: nextId,
              key: itemKey(file),
              file,
              name: file.name || "未命名图片",
              path: file.webkitRelativePath || file.name || "未命名图片",
              url,
              width: dimensions.width,
              height: dimensions.height,
              size: file.size,
              lastModified: file.lastModified || 0
            };
            nextId += 1;
          } catch (error) {
            failed += 1;
            URL.revokeObjectURL(url);
          }
        }
      };

      const workers = Array.from(
        { length: Math.min(6, unique.length) },
        () => worker()
      );
      await Promise.all(workers);

      const added = results.filter(Boolean);
      if (!added.length) {
        toast("图片读取失败，请确认文件完整且格式受支持", "error");
        return;
      }

      const wasEmpty = items.length === 0;
      items.push(...added);
      if (settings.sortMode !== "manual") sortItemsInPlace(settings.sortMode);

      renderQueue();
      renderPreview();

      if (wasEmpty) {
        els.previewViewport.scrollTo({ top: 0, left: 0 });
      }

      const messages = [`已添加 ${added.length} 张切图`];
      if (duplicateCount) messages.push(`跳过 ${duplicateCount} 张重复`);
      if (failed) messages.push(`${failed} 张读取失败`);
      toast(messages.join("，"), failed ? "warn" : "success");
    } catch (error) {
      console.error(error);
      toast(`导入失败：${error.message || "未知错误"}`, "error");
    } finally {
      importBusy = false;
      setImportBusy(false);
    }
  }

  function setImportBusy(busy) {
    els.addBtn.disabled = busy;
    els.folderBtn.disabled = busy;
    els.emptyAddBtn.disabled = busy;
    els.emptyFolderBtn.disabled = busy;
    els.addBtn.setAttribute("aria-busy", String(busy));
    els.folderBtn.setAttribute("aria-busy", String(busy));
    if (busy) {
      els.exportBtn.disabled = true;
    } else {
      updateSummary();
    }
  }

  async function walkEntry(entry, output, depth) {
    if (!entry || depth > 12) return;

    if (entry.isFile) {
      const file = await new Promise((resolve) => {
        try {
          entry.file(resolve, () => resolve(null));
        } catch (error) {
          resolve(null);
        }
      });
      if (file && isImageFile(file)) output.push(file);
      return;
    }

    if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise((resolve) => {
          try {
            reader.readEntries(resolve, () => resolve([]));
          } catch (error) {
            resolve([]);
          }
        });
        if (!batch || !batch.length) break;
        for (const child of batch) {
          await walkEntry(child, output, depth + 1);
        }
      }
    }
  }

  async function filesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];

    const entries = [];
    if (dataTransfer.items && dataTransfer.items.length) {
      for (const item of Array.from(dataTransfer.items)) {
        if (item.kind === "file" && typeof item.webkitGetAsEntry === "function") {
          const entry = item.webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }
    }

    if (entries.length) {
      const files = [];
      for (const entry of entries) {
        await walkEntry(entry, files, 0);
      }
      return files;
    }

    return Array.from(dataTransfer.files || []);
  }

  function hasFilePayload(event) {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types || []).indexOf("Files") !== -1;
  }

  function showDropOverlay() {
    els.dropOverlay.hidden = false;
  }

  function hideDropOverlay() {
    els.dropOverlay.hidden = true;
    dragDepth = 0;
  }

  function clearDropMarkers() {
    for (const element of els.queueList.querySelectorAll(".queue-item")) {
      element.classList.remove("drop-before", "drop-after");
    }
  }

  function reorderFromDrag(targetElement, clientY) {
    if (!dragId) return;
    if (targetElement && targetElement.dataset.id === dragId) return;

    const fromIndex = items.findIndex((item) => String(item.id) === String(dragId));
    if (fromIndex < 0) return;

    let toIndex = items.length;
    if (targetElement && targetElement.dataset.id !== dragId) {
      const targetIndex = items.findIndex(
        (item) => String(item.id) === String(targetElement.dataset.id)
      );
      if (targetIndex >= 0) {
        const rect = targetElement.getBoundingClientRect();
        toIndex = clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
      }
    }

    const [moved] = items.splice(fromIndex, 1);
    if (toIndex > fromIndex) toIndex -= 1;
    toIndex = clamp(toIndex, 0, items.length);
    items.splice(toIndex, 0, moved);

    setSortMode("manual", false);
    renderQueue();
    renderPreview();
  }

  function showExportOverlay() {
    els.progressFill.style.width = "0%";
    els.exportStatus.textContent = "正在读取切图…";
    els.exportOverlay.hidden = false;
    els.exportOverlay.setAttribute("tabindex", "-1");
    els.exportOverlay.focus();
  }

  function hideExportOverlay() {
    els.exportOverlay.hidden = true;
  }

  function setExportProgress(done, total, message) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    els.progressFill.style.width = `${clamp(percent, 0, 100)}%`;
    els.exportStatus.textContent = message || `正在拼接 ${done} / ${total} 张…`;
  }

  function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function createDrawable(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (error) {
        try {
          return await createImageBitmap(file);
        } catch (fallbackError) {
          // 继续使用 Image 兜底。
        }
      }
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("图片无法解码"));
        element.src = url;
      });
      return {
        source: image,
        isWrapper: true,
        close: () => URL.revokeObjectURL(url)
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function drawableSource(drawable) {
    return drawable && drawable.isWrapper ? drawable.source : drawable;
  }

  function closeDrawable(drawable) {
    if (!drawable) return;
    try {
      if (typeof drawable.close === "function") drawable.close();
    } catch (error) {
      // 忽略释放失败。
    }
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("无法生成图片，可能是长图尺寸超出浏览器内存上限"));
            }
          },
          mime,
          quality
        );
      } catch (error) {
        reject(error);
      }
    });
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

  async function exportLongImage() {
    if (importBusy) {
      toast("正在读取切图，请稍候再导出", "warn");
      return;
    }
    if (exporting || !items.length) return;

    const plan = getExportPlan();
    if (!plan.exportable) {
      toast("当前尺寸超出浏览器上限，请调整设置后再导出", "error");
      return;
    }

    exporting = true;
    updateSummary();
    showExportOverlay();

    const canvas = document.createElement("canvas");
    let activeDrawable = null;

    try {
      canvas.width = plan.width;
      canvas.height = plan.height;

      if (canvas.width !== plan.width || canvas.height !== plan.height) {
        throw new Error("浏览器无法创建这么大的画布，请减小输出宽度");
      }

      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("浏览器不支持 Canvas");

      const useTransparent = settings.transparent && settings.format !== "jpg";
      if (!useTransparent) {
        const fill = settings.transparent ? "#ffffff" : settings.background;
        context.fillStyle = fill;
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      let y = 0;

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setExportProgress(index, items.length, `正在拼接 ${index + 1} / ${items.length} 张…`);
        await nextTick();

        activeDrawable = await createDrawable(item.file);
        const source = drawableSource(activeDrawable);
        const width = plan.widths[index];
        const height = plan.heights[index];
        const x = Math.round((plan.width - width) / 2);

        context.drawImage(source, x, y, width, height);

        closeDrawable(activeDrawable);
        activeDrawable = null;

        y += height;
        if (index < items.length - 1) y += plan.gap;
      }

      setExportProgress(items.length, items.length, "正在编码文件…");
      await nextTick();

      const format = FORMAT_INFO[settings.format] || FORMAT_INFO.png;
      const blob = await canvasToBlob(canvas, format.mime, settings.quality);
      const actualMime = (blob.type || format.mime).toLowerCase();
      const actualFormat =
        actualMime === "image/jpeg"
          ? FORMAT_INFO.jpg
          : actualMime === "image/webp"
            ? FORMAT_INFO.webp
            : FORMAT_INFO.png;
      const filename =
        `详情页长图_${plan.width}x${plan.height}_${timestampForFile()}.${actualFormat.ext}`;

      triggerDownload(blob, filename);
      toast(`已导出 ${filename} · ${formatBytes(blob.size)}`, "success", 5200);
    } catch (error) {
      console.error(error);
      toast(`导出失败：${error.message || "未知错误"}`, "error", 6200);
    } finally {
      closeDrawable(activeDrawable);
      canvas.width = 1;
      canvas.height = 1;
      exporting = false;
      hideExportOverlay();
      updateSummary();
    }
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

  function resetSettings() {
    const sortMode = settings.sortMode;
    settings = { ...DEFAULTS, sortMode };
    saveSettings();
    syncSettingsUI();
    applyPreviewLayout();
  }

  function handlePaste(event) {
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
    importFiles(files);
  }

  function handleKeydown(event) {
    if (event.isComposing) return;
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier && event.key.toLowerCase() === "o") {
      event.preventDefault();
      els.fileInput.click();
      return;
    }

    if (modifier && event.key === "Enter") {
      if (els.helpDialog.open) return;
      if (!els.exportBtn.disabled) {
        event.preventDefault();
        exportLongImage();
      }
      return;
    }

    if (event.key === "Escape") {
      hideDropOverlay();
      clearDropMarkers();
    }
  }

  function bindEvents() {
    els.addBtn.addEventListener("click", () => els.fileInput.click());
    els.folderBtn.addEventListener("click", () => els.folderInput.click());
    els.emptyAddBtn.addEventListener("click", () => els.fileInput.click());
    els.emptyFolderBtn.addEventListener("click", () => els.folderInput.click());
    els.clearBtn.addEventListener("click", clearQueue);
    els.exportBtn.addEventListener("click", exportLongImage);

    els.fileInput.addEventListener("change", () => {
      const files = Array.from(els.fileInput.files || []);
      els.fileInput.value = "";
      if (files.length) importFiles(files);
    });

    els.folderInput.addEventListener("change", () => {
      const files = Array.from(els.folderInput.files || []);
      els.folderInput.value = "";
      if (files.length) importFiles(files);
    });

    els.sortSelect.addEventListener("change", () => {
      setSortMode(els.sortSelect.value, true);
      renderQueue();
      renderPreview();
    });

    els.guidesBtn.addEventListener("click", () => {
      guidesOn = !guidesOn;
      els.previewPage.classList.toggle("show-guides", guidesOn);
      els.guidesBtn.classList.toggle("is-active", guidesOn);
      els.guidesBtn.setAttribute("aria-pressed", String(guidesOn));
    });

    els.zoomOut.addEventListener("click", () => {
      zoomMode = "manual";
      zoomValue = clamp(zoomValue / 1.15, 0.05, 2);
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

    els.widthPreset.addEventListener("change", () => {
      if (els.widthPreset.value === "custom") {
        els.widthInput.focus();
        els.widthInput.select();
        return;
      }
      commitWidth(els.widthPreset.value, true);
    });

    els.widthInput.addEventListener("input", () => {
      window.clearTimeout(widthTimer);
      const value = els.widthInput.value;
      const parsed = Number(value);
      if (value === "" || !Number.isFinite(parsed) || parsed < MIN_WIDTH) return;
      widthTimer = window.setTimeout(() => commitWidth(value, parsed > MAX_WIDTH), 220);
    });

    els.widthInput.addEventListener("change", () => {
      window.clearTimeout(widthTimer);
      commitWidth(els.widthInput.value, true);
    });

    els.widthInput.addEventListener("blur", () => {
      window.clearTimeout(widthTimer);
      commitWidth(els.widthInput.value, true);
    });

    els.gapInput.addEventListener("input", () => {
      const gap = clamp(Math.round(Number(els.gapInput.value) || 0), 0, MAX_GAP);
      settings.gap = gap;
      els.gapValue.textContent = `${gap} px`;
      saveSettings();
      applyPreviewLayout();
    });

    els.bgColor.addEventListener("input", () => {
      settings.background = normalizeHex(els.bgColor.value) || "#ffffff";
      settings.transparent = false;
      saveSettings();
      syncBackgroundUI();
      applyPreviewLayout();
    });

    els.bgHex.addEventListener("change", () => {
      const normalized = normalizeHex(els.bgHex.value);
      if (!normalized) {
        els.bgHex.value = settings.background;
        toast("请输入有效的颜色值，例如 #ffffff", "warn");
        return;
      }
      settings.background = normalized;
      settings.transparent = false;
      saveSettings();
      syncBackgroundUI();
      applyPreviewLayout();
    });

    els.transparentBg.addEventListener("change", () => {
      settings.transparent = els.transparentBg.checked;
      saveSettings();
      syncBackgroundUI();
      applyPreviewLayout();
    });

    els.formatGroup.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-format]");
      if (!button) return;
      const format = button.dataset.format;
      if (!FORMAT_INFO[format]) return;
      settings.format = format;
      if (format === "jpg") settings.transparent = false;
      saveSettings();
      syncFormatUI();
      syncBackgroundUI();
      applyPreviewLayout();
    });

    els.qualityInput.addEventListener("input", () => {
      settings.quality = clamp(Number(els.qualityInput.value) / 100, 0.5, 1);
      els.qualityValue.textContent = `${Math.round(settings.quality * 100)}%`;
      saveSettings();
    });

    els.autoFit.addEventListener("change", () => {
      settings.autoFit = els.autoFit.checked;
      saveSettings();
      updateSummary();
    });

    els.noUpscale.addEventListener("change", () => {
      settings.noUpscale = els.noUpscale.checked;
      saveSettings();
      applyPreviewLayout();
    });

    els.resetSettings.addEventListener("click", resetSettings);

    els.helpBtn.addEventListener("click", () => {
      if (typeof els.helpDialog.showModal === "function") {
        els.helpDialog.showModal();
      } else {
        window.alert("把切图拖进窗口，按文件名排序后选择宽度，点「导出长图」即可。");
      }
    });

    els.helpDialog.addEventListener("click", (event) => {
      if (event.target === els.helpDialog) els.helpDialog.close();
    });

    els.queueList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const row = button.closest(".queue-item");
      if (!row) return;
      const action = button.dataset.action;
      if (action === "remove") removeItem(row.dataset.id);
      else if (action === "up") moveItem(row.dataset.id, -1);
      else if (action === "down") moveItem(row.dataset.id, 1);
    });

    els.queueList.addEventListener("dragstart", (event) => {
      const row = event.target.closest(".queue-item");
      if (!row) return;
      dragId = row.dataset.id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", dragId);
      }
      window.requestAnimationFrame(() => row.classList.add("is-dragging"));
    });

    els.queueList.addEventListener("dragover", (event) => {
      if (!dragId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      clearDropMarkers();
      const row = event.target.closest(".queue-item");
      if (!row || row.dataset.id === dragId) return;
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
    });

    els.queueList.addEventListener("drop", (event) => {
      if (!dragId) return;
      event.preventDefault();
      event.stopPropagation();
      const row = event.target.closest(".queue-item");
      reorderFromDrag(row, event.clientY);
      dragId = null;
      clearDropMarkers();
    });

    els.queueList.addEventListener("dragend", () => {
      dragId = null;
      clearDropMarkers();
      for (const row of els.queueList.querySelectorAll(".is-dragging")) {
        row.classList.remove("is-dragging");
      }
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
      if (dragId) return;
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      hideDropOverlay();

      filesFromDataTransfer(event.dataTransfer)
        .then((files) => {
          if (!files.length) {
            toast("没有找到可导入的图片", "warn");
            return;
          }
          importFiles(files);
        })
        .catch((error) => {
          console.error(error);
          toast("读取拖入的文件失败", "error");
        });
    });

    document.addEventListener("paste", handlePaste);
    document.addEventListener("keydown", handleKeydown);

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        if (zoomMode !== "fit") return;
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          zoomValue = computeFitZoom();
          applyPreviewLayout();
        });
      });
      observer.observe(els.previewViewport);
    } else {
      window.addEventListener("resize", () => {
        if (zoomMode !== "fit") return;
        zoomValue = computeFitZoom();
        applyPreviewLayout();
      });
    }
  }

  function init() {
    syncSettingsUI();
    renderQueue();
    renderPreview();
    bindEvents();
    updateSummary();

    window.requestAnimationFrame(() => {
      if (zoomMode === "fit") {
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
