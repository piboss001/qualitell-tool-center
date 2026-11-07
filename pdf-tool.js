import { getDocument, GlobalWorkerOptions } from "./vendor/pdfjs/pdf.mjs";

(() => {
  "use strict";

  GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
  const $ = (id) => document.getElementById(id);
  const { PDFDocument } = globalThis.PDFLib || {};
  const imageItems = [];
  let selectedPdf = null;
  let busy = false;
  let resultUrl = "";
  let nextId = 1;

  const MM_TO_PT = 72 / 25.4;
  const MAX_PAGE_PT = 14400;
  const MAX_IMAGE_SIZE = 80 * 1024 * 1024;
  const MAX_PDF_SIZE = 100 * 1024 * 1024;
  const MAX_PIXELS = 18000000;
  const MAX_IMAGE_FILES = 120;
  const MAX_PAGES = 180;
  const SIZES = {
    a4: [595.28, 841.89],
    a3: [841.89, 1190.55],
    letter: [612, 792]
  };

  const bytesLabel = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  };
  const safe = (str) => String(str).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const pdfName = (text) => (text.trim() || "Qualitell-document")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100).replace(/\.pdf$/i, "") + ".pdf";
  const yieldNow = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  function showProgress(title, done, total, detail) {
    $("progress-card").hidden = false;
    $("progress-title").textContent = title;
    const fraction = total ? Math.min(1, done / total) : 0;
    $("progress-text").textContent = Math.round(fraction * 100) + "%";
    $("progress-bar").style.width = (fraction * 100) + "%";
    $("progress-detail").textContent = detail || "正在浏览器本地处理";
  }

  function closeOutput() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = "";
    $("result-card").hidden = true;
  }

  function setOutput(blob, filename, notice, originalBytes) {
    closeOutput();
    resultUrl = URL.createObjectURL(blob);
    const anchor = $("download-result");
    anchor.href = resultUrl;
    anchor.download = pdfName(filename);
    $("result-title").textContent = "PDF 已生成";
    $("result-size").textContent = bytesLabel(blob.size) +
      (Number.isFinite(originalBytes) ? (" · 原文件 " + bytesLabel(originalBytes)) : "");
    $("result-notice").textContent = notice;
    $("result-card").hidden = false;
    $("progress-card").hidden = true;
    $("result-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function alertError(error) {
    const msg = error && error.message ? error.message : String(error || "未知错误");
    showProgress("操作未完成", 0, 1, "错误：" + msg);
    $("progress-title").style.color = "#a14d3c";
  }

  function setBusy(value) {
    busy = value;
    for (const id of ["make-pdf", "compress-pdf", "choose-images", "choose-pdf", "clear-images", "clear-pdf"]) {
      $(id).disabled = value || (
        id === "make-pdf" ? imageItems.length === 0 :
        id === "compress-pdf" ? !selectedPdf : false
      );
    }
  }

  function decodeUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) reject(new Error("无效图片"));
        else resolve(image);
      };
      image.onerror = () => reject(new Error("浏览器无法读取图片"));
      image.src = url;
    });
  }

  function renderQueue() {
    $("image-count").textContent = String(imageItems.length);
    $("image-summary").textContent = imageItems.length ? ("已导入 " + imageItems.length + " 张图片") : "暂无图片";
    $("image-queue").innerHTML = imageItems.length ? imageItems.map((it, i) =>
      '<article class="item"><div class="thumb"><img src="' + safe(it.url) + '" alt=""></div>' +
      '<div><h3 title="' + safe(it.file.name) + '">' + safe(it.file.name) + '</h3><p>' +
      it.width + " × " + it.height + " px<br>" + bytesLabel(it.file.size) +
      '</p></div><div class="ops">' +
      '<button type="button" data-action="up" data-index="' + i + '" ' + (i === 0 ? "disabled" : "") + '>↑ 上移</button>' +
      '<button type="button" data-action="down" data-index="' + i + '" ' + (i === imageItems.length - 1 ? "disabled" : "") + '>↓ 下移</button>' +
      '<button type="button" data-action="remove" data-index="' + i + '">移除</button></div></article>'
    ).join("") : '<div class="empty">添加图片后显示缩略图与尺寸</div>';
    setBusy(busy);
  }

  async function addImages(fileList) {
    if (busy) return;
    const files = [...fileList].filter((f) => /^image\/(png|jpeg|webp|bmp)$/i.test(f.type) || /\.(png|jpe?g|webp|bmp)$/i.test(f.name));
    if (!files.length) return;
    const errors = [];
    for (const file of files) {
      if (imageItems.length >= MAX_IMAGE_FILES) { errors.push("最多添加 " + MAX_IMAGE_FILES + " 张图片"); break; }
      if (file.size > MAX_IMAGE_SIZE) { errors.push(file.name + " 超过 80 MB"); continue; }
      const url = URL.createObjectURL(file);
      try {
        const im = await decodeUrl(url);
        imageItems.push({ id: nextId++, file, url, width: im.naturalWidth, height: im.naturalHeight });
      } catch (error) {
        URL.revokeObjectURL(url);
        errors.push(file.name + " 无法解码");
      }
    }
    renderQueue();
    if (errors.length) window.alert(errors.slice(0, 6).join("\n"));
  }

  function cropCanvas(image, sy, sh, outW, outH) {
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, outW * outH)), 12000 / Math.max(1, outW), 12000 / Math.max(1, outH));
    const width = Math.max(1, Math.floor(outW * scale));
    const height = Math.max(1, Math.floor(outH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("无法创建画布，请降低输出分辨率");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, sy, image.naturalWidth, sh, 0, 0, width, height);
    return canvas;
  }

  function jpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => {
      if (blob && blob.type === "image/jpeg") resolve(blob);
      else reject(new Error("JPEG 图片编码失败，请降低分辨率"));
    }, "image/jpeg", quality));
  }

  async function addPicture(doc, page, image, sourceStart, sourceHeight, rect, dpi, quality) {
    if (!(rect.width > 0 && rect.height > 0 && sourceHeight > 0)) return;
    const pxWidth = rect.width * dpi / 72;
    const pxHeight = rect.height * dpi / 72;
    const maxStrip = Math.max(256, Math.min(2800, MAX_PIXELS / Math.max(1, pxWidth)));
    const count = Math.ceil(pxHeight / maxStrip);
    for (let part = 0; part < count; part++) {
      const topFraction = part / count;
      const bottomFraction = (part + 1) / count;
      const sourceY = sourceStart + sourceHeight * topFraction;
      const sourceH = sourceHeight * (bottomFraction - topFraction);
      const partHeight = rect.height * (bottomFraction - topFraction);
      const canvas = cropCanvas(image, sourceY, sourceH, pxWidth, pxHeight / count);
      const blob = await jpegBlob(canvas, quality);
      canvas.width = canvas.height = 1;
      const embedded = await doc.embedJpg(await blob.arrayBuffer());
      page.drawImage(embedded, {
        x: rect.x, y: rect.y + rect.height * (1 - bottomFraction),
        width: rect.width, height: partHeight
      });
    }
  }

  function imageSettings() {
    const mode = $("image-mode").value;
    const size = $("page-size").value;
    const margin = Number($("page-margin").value);
    const targetMb = Number($("image-target").value);
    const sliceHeight = Number($("slice-height").value);
    if (!Number.isFinite(margin) || margin < 0 || margin > 30) throw new Error("页边距应为 0–30 mm");
    if (mode === "slice" && (!Number.isInteger(sliceHeight) || sliceHeight < 100 || sliceHeight > 12000)) throw new Error("切图高度应为 100–12000 px");
    if ($("image-target").value && (!(targetMb > 0) || targetMb > 500)) throw new Error("目标大小应为 0.1–500 MB");
    return {
      mode, size, marginPt: margin * MM_TO_PT, target: $("image-target").value ? targetMb * 1048576 : 0,
      sliceHeight, dpi: Number($("image-dpi").value), quality: Number($("image-quality").value) / 100
    };
  }

  function naturalPageSize(w, h) {
    const factor = Math.min(72 / 96, MAX_PAGE_PT / Math.max(w, h));
    return [Math.max(1, w * factor), Math.max(1, h * factor)];
  }

  function paper(size) {
    return SIZES[size] || SIZES.a4;
  }

  function validatePageCount(number) {
    if (number > MAX_PAGES) throw new Error("此次将生成超过 " + MAX_PAGES + " 页，请减少图片或增大切图高度");
  }

  async function createImageDocument(settings, update) {
    const doc = await PDFDocument.create();
    doc.setTitle("Qualitell PDF Tools");
    const margin = settings.marginPt;
    let pages = 0;

    if (settings.mode === "long") {
      const selectedWidth = settings.size === "auto" ? 595.28 : paper(settings.size)[0];
      const contentWidth = Math.max(40, selectedWidth - 2 * margin);
      const originalTotal = imageItems.reduce((sum, it) => sum + contentWidth * it.height / it.width, 0);
      let pageHeight = originalTotal + 2 * margin;
      const shrink = pageHeight > MAX_PAGE_PT ? (MAX_PAGE_PT - 2 * margin) / originalTotal : 1;
      pageHeight = Math.min(MAX_PAGE_PT, pageHeight);
      const actualWidth = contentWidth * shrink;
      const x = (selectedWidth - actualWidth) / 2;
      const page = doc.addPage([selectedWidth, Math.max(1, pageHeight)]);
      let y = pageHeight - margin;
      for (let i = 0; i < imageItems.length; i++) {
        const it = imageItems[i];
        const image = await decodeUrl(it.url);
        const heightPt = actualWidth * it.height / it.width;
        y -= heightPt;
        await addPicture(doc, page, image, 0, it.height, { x, y, width: actualWidth, height: heightPt }, settings.dpi, settings.quality);
        update(i + 1, imageItems.length);
      }
      return doc.save({ useObjectStreams: true });
    }

    for (let i = 0; i < imageItems.length; i++) {
      const it = imageItems[i];
      const image = await decodeUrl(it.url);
      const w = it.width, h = it.height;

      if (settings.mode === "auto") {
        const [pageW, pageH] = settings.size === "auto" ? paper("a4") : paper(settings.size);
        const contentW = pageW - margin * 2, contentH = pageH - margin * 2;
        if (contentW < 20 || contentH < 20) throw new Error("页边距过大");
        const sourcePartH = contentH * w / contentW;
        const count = Math.ceil(h / sourcePartH);
        validatePageCount(pages + count);
        for (let part = 0; part < count; part++) {
          const sourceY = part * sourcePartH;
          const sourceH = Math.min(h - sourceY, sourcePartH);
          const displayH = sourceH * contentW / w;
          const page = doc.addPage([pageW, pageH]);
          await addPicture(doc, page, image, sourceY, sourceH, {
            x: margin, y: pageH - margin - displayH,
            width: contentW, height: displayH
          }, settings.dpi, settings.quality);
          pages++;
        }
      } else {
        const segments = settings.mode === "slice" ? Math.ceil(h / settings.sliceHeight) : 1;
        validatePageCount(pages + segments);
        for (let part = 0; part < segments; part++) {
          const sy = settings.mode === "slice" ? part * settings.sliceHeight : 0;
          const sh = settings.mode === "slice" ? Math.min(settings.sliceHeight, h - sy) : h;
          let pageW, pageH;
          if (settings.size === "auto") {
            [pageW, pageH] = naturalPageSize(w, sh);
            pageW += margin * 2;
            pageH += margin * 2;
            if (pageW > MAX_PAGE_PT || pageH > MAX_PAGE_PT) {
              const factor = Math.min(
                (MAX_PAGE_PT - margin * 2) / (pageW - margin * 2),
                (MAX_PAGE_PT - margin * 2) / (pageH - margin * 2)
              );
              pageW = (pageW - margin * 2) * factor + margin * 2;
              pageH = (pageH - margin * 2) * factor + margin * 2;
            }
          } else {
            [pageW, pageH] = paper(settings.size);
          }
          const contentW = pageW - margin * 2, contentH = pageH - margin * 2;
          const ratio = Math.min(contentW / w, contentH / sh);
          if (!(ratio > 0)) throw new Error("页边距过大，页面没有足够空间");
          const displayW = w * ratio, displayH = sh * ratio;
          const page = doc.addPage([pageW, pageH]);
          await addPicture(doc, page, image, sy, sh, {
            x: (pageW - displayW) / 2, y: (pageH - displayH) / 2,
            width: displayW, height: displayH
          }, settings.dpi, settings.quality);
          pages++;
        }
      }
      update(i + 1, imageItems.length);
      await yieldNow();
    }
    return doc.save({ useObjectStreams: true });
  }

  function attempts(dpi, quality, target) {
    if (!target) return [{ dpi, quality }];
    const result = [];
    for (let i = 0; i < 5; i++) {
      result.push({
        dpi: Math.max(65, Math.round(dpi * Math.pow(.83, i))),
        quality: Math.max(.35, quality - i * .115)
      });
    }
    return result;
  }

  async function handleMake() {
    if (busy || !imageItems.length || !PDFDocument) return;
    let initial;
    try { initial = imageSettings(); }
    catch (e) { window.alert(e.message); return; }
    closeOutput();
    setBusy(true);
    $("progress-title").style.color = "";
    try {
      let smallest = null;
      const list = attempts(initial.dpi, initial.quality, initial.target);
      for (let k = 0; k < list.length; k++) {
        const params = { ...initial, ...list[k] };
        showProgress("正在生成图片 PDF", 0, imageItems.length, "质量尝试 " + (k + 1) + " / " + list.length);
        const bytes = await createImageDocument(params, (done, total) => showProgress(
          "正在生成图片 PDF", done, total, "质量尝试 " + (k + 1) + " / " + list.length
        ));
        if (!smallest || bytes.length < smallest.length) smallest = bytes;
        if (!initial.target || smallest.length <= initial.target) break;
      }
      const message = initial.target && smallest.length > initial.target
        ? "已尽量压缩，但未达到设定目标大小。进一步减小体积可能需要降低图片分辨率，或拆分 PDF。"
        : "生成成功。图片按所选模式合并，所有文件均在浏览器本地处理。";
      setOutput(new Blob([smallest], { type: "application/pdf" }), $("image-name").value, message);
    } catch (error) {
      alertError(error);
    } finally {
      setBusy(false);
    }
  }

  async function selectPdf(file) {
    if (busy || !file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      window.alert("请上传 PDF 文件"); return;
    }
    if (file.size > MAX_PDF_SIZE) {
      window.alert("当前支持最大 100 MB 的 PDF"); return;
    }
    closeOutput();
    selectedPdf = file;
    $("pdf-file-info").textContent = file.name + " · " + bytesLabel(file.size);
    $("pdf-page-count").textContent = "读取页数…";
    $("pdf-name").value = file.name.replace(/\.pdf$/i, "") + "-压缩";
    setBusy(true);
    let task;
    try {
      task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      const doc = await task.promise;
      $("pdf-page-count").textContent = doc.numPages + " 页";
      if (doc.numPages > MAX_PAGES) {
        $("pdf-file-info").textContent += " · 页数超过本工具上限";
        $("pdf-page-count").textContent += "（最多 180 页）";
      }
    } catch (error) {
      selectedPdf = null;
      $("pdf-page-count").textContent = "解析失败";
      $("pdf-file-info").textContent = error?.name === "PasswordException"
        ? "加密 PDF 暂不支持，请先解锁原文件"
        : "PDF 读取失败：" + (error?.message || "无法解析");
    } finally {
      if (task) await task.destroy().catch(() => {});
      setBusy(false);
    }
  }

  function pdfSettings() {
    const value = $("pdf-target").value;
    const number = Number(value);
    if (value && (!(number > 0) || number > 500)) throw new Error("目标大小应为 0.1–500 MB");
    return {
      mode: $("pdf-mode").value,
      dpi: Number($("pdf-dpi").value),
      quality: Number($("pdf-quality").value) / 100,
      target: value ? number * 1048576 : 0
    };
  }

  async function compressRaster(file, dpi, quality, update) {
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const source = await task.promise;
      if (source.numPages > MAX_PAGES) throw new Error("PDF 超过 180 页，请分拆后再压缩");
      const output = await PDFDocument.create();
      output.setTitle("Qualitell - Compressed PDF");
      for (let i = 1; i <= source.numPages; i++) {
        const page = await source.getPage(i);
        const logical = page.getViewport({ scale: 1 });
        const desiredScale = dpi / 72;
        const cap = Math.min(
          1,
          Math.sqrt(MAX_PIXELS / Math.max(1, logical.width * logical.height * desiredScale * desiredScale)),
          12000 / Math.max(1, logical.width * desiredScale),
          12000 / Math.max(1, logical.height * desiredScale)
        );
        const viewport = page.getViewport({ scale: desiredScale * cap });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("浏览器无法创建 PDF 画布");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, canvas, viewport, background: "rgb(255,255,255)" }).promise;
        const blob = await jpegBlob(canvas, quality);
        canvas.width = canvas.height = 1;
        const embed = await output.embedJpg(await blob.arrayBuffer());
        const newPage = output.addPage([logical.width, logical.height]);
        newPage.drawImage(embed, { x: 0, y: 0, width: logical.width, height: logical.height });
        page.cleanup();
        update(i, source.numPages);
        await yieldNow();
      }
      return await output.save({ useObjectStreams: true });
    } finally {
      await task.destroy().catch(() => {});
    }
  }

  async function handleCompress() {
    if (busy || !selectedPdf || !PDFDocument) return;
    let settings;
    try { settings = pdfSettings(); }
    catch (error) { window.alert(error.message); return; }
    closeOutput();
    setBusy(true);
    $("progress-title").style.color = "";
    const sourcePdf = selectedPdf;
    try {
      const inputBytes = new Uint8Array(await sourcePdf.arrayBuffer());
      let smallest;
      if (settings.mode === "lossless") {
        showProgress("尝试无损优化 PDF", 0, 1, "正在保留文字和页面元素");
        const source = await PDFDocument.load(inputBytes, { ignoreEncryption: false });
        smallest = await source.save({ useObjectStreams: true });
        showProgress("尝试无损优化 PDF", 1, 1, "无损优化完成");
      } else {
        const list = attempts(settings.dpi, settings.quality, settings.target);
        for (let k = 0; k < list.length; k++) {
          showProgress("正在压缩 PDF", 0, 1, "压缩尝试 " + (k + 1) + " / " + list.length);
          const result = await compressRaster(sourcePdf, list[k].dpi, list[k].quality, (done, total) =>
            showProgress("正在压缩 PDF", done, total, "压缩尝试 " + (k + 1) + " / " + list.length));
          if (!smallest || result.length < smallest.length) smallest = result;
          if (!settings.target || smallest.length <= settings.target) break;
        }
      }

      if (!smallest || smallest.length >= inputBytes.length) {
        setOutput(new Blob([inputBytes], { type: "application/pdf" }),
          $("pdf-name").value + "-原文件",
          "压缩结果没有比原文件更小，已保留原版 PDF，避免输出文件反而变大。若需进一步压缩，可尝试更低 DPI、画质或切换压缩模式。",
          inputBytes.length);
      } else {
        const reduction = Math.round(100 * (1 - smallest.length / inputBytes.length));
        const note = settings.mode === "lossless"
          ? "已完成无损结构整理，文件减小约 " + reduction + "%。"
          : "图片化压缩完成，文件减小约 " + reduction + "%；文字可能无法搜索、复制。";
        const more = settings.target && smallest.length > settings.target ? " 未达到目标 MB 大小。" : "";
        setOutput(new Blob([smallest], { type: "application/pdf" }),
          $("pdf-name").value, note + more, inputBytes.length);
      }
    } catch (error) {
      alertError(error);
    } finally {
      setBusy(false);
    }
  }

  function syncMode() {
    const mode = $("image-mode").value;
    $("slice-field").hidden = mode !== "slice";
    $("page-size").disabled = false;
    if (mode === "auto" && $("page-size").value === "auto") $("page-size").value = "a4";
    $("mode-help").textContent = ({
      each: "每张图片独立一页；选「按原图尺寸」时，长图可以是一张很高的 PDF 页面。",
      long: "所有图片按队列顺序上下拼成同一个 PDF 页面；过长时自动缩小比例以保证兼容性。",
      auto: "按选择的纸张尺寸逐页裁切长图，适合打印详情页、截图或扫描图片。",
      slice: "每张图按指定像素高度分段，每段生成一页 PDF，适合精确切图。"
    })[mode];
  }

  function init() {
    if (!PDFDocument) {
      $("make-pdf").textContent = "PDF 组件未加载";
      $("compress-pdf").textContent = "PDF 组件未加载";
      $("progress-card").hidden = false;
      $("progress-title").textContent = "依赖库尚未就绪";
      $("progress-detail").textContent = "请确认 Cloudflare 已部署 vendor/pdf-lib.min.js 和 vendor/pdfjs/";
      return;
    }

    $("tab-image").addEventListener("click", () => switchTab("image"));
    $("tab-pdf").addEventListener("click", () => switchTab("pdf"));
    $("image-mode").addEventListener("change", syncMode);
    ["image-quality", "pdf-quality"].forEach((id) => {
      $(id).addEventListener("input", () => $(id + "-val").textContent = $(id).value + "%");
    });

    $("choose-images").addEventListener("click", (event) => { event.stopPropagation(); $("image-input").click(); });
    $("image-drop").addEventListener("click", (event) => {
      if (!event.target.closest("button")) $("image-input").click();
    });
    $("image-drop").addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("image-input").click(); }
    });
    $("image-input").addEventListener("change", async (event) => {
      await addImages(event.target.files);
      event.target.value = "";
    });
    enableDrop($("image-drop"), (files) => addImages(files));

    $("image-queue").addEventListener("click", (event) => {
      if (busy) return;
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const index = Number(button.dataset.index), action = button.dataset.action;
      if (action === "remove") {
        URL.revokeObjectURL(imageItems[index].url);
        imageItems.splice(index, 1);
      } else if (action === "up" && index > 0) {
        [imageItems[index - 1], imageItems[index]] = [imageItems[index], imageItems[index - 1]];
      } else if (action === "down" && index < imageItems.length - 1) {
        [imageItems[index], imageItems[index + 1]] = [imageItems[index + 1], imageItems[index]];
      }
      closeOutput();
      renderQueue();
    });
    $("clear-images").addEventListener("click", () => {
      if (busy) return;
      imageItems.splice(0).forEach((it) => URL.revokeObjectURL(it.url));
      renderQueue();
      closeOutput();
    });

    $("choose-pdf").addEventListener("click", (event) => { event.stopPropagation(); $("pdf-input").click(); });
    $("pdf-drop").addEventListener("click", (event) => {
      if (!event.target.closest("button")) $("pdf-input").click();
    });
    $("pdf-drop").addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("pdf-input").click(); }
    });
    $("pdf-input").addEventListener("change", async (event) => {
      await selectPdf(event.target.files[0]);
      event.target.value = "";
    });
    enableDrop($("pdf-drop"), (files) => selectPdf(files[0]));
    $("clear-pdf").addEventListener("click", () => {
      if (busy) return;
      selectedPdf = null;
      $("pdf-file-info").textContent = "尚未选择 PDF";
      $("pdf-page-count").textContent = "";
      closeOutput(); setBusy(false);
    });

    $("make-pdf").addEventListener("click", handleMake);
    $("compress-pdf").addEventListener("click", handleCompress);
    syncMode();
    renderQueue();
    setBusy(false);
    window.addEventListener("beforeunload", () => {
      imageItems.forEach((it) => URL.revokeObjectURL(it.url));
      closeOutput();
    });
  }

  function enableDrop(element, onFiles) {
    for (const name of ["dragenter", "dragover"]) element.addEventListener(name, (event) => {
      event.preventDefault(); element.classList.add("over");
    });
    for (const name of ["dragleave", "drop"]) element.addEventListener(name, (event) => {
      event.preventDefault(); element.classList.remove("over");
    });
    element.addEventListener("drop", (event) => {
      if (!busy) onFiles(event.dataTransfer.files);
    });
  }

  function switchTab(tab) {
    $("tab-image").setAttribute("aria-selected", String(tab === "image"));
    $("tab-pdf").setAttribute("aria-selected", String(tab === "pdf"));
    $("panel-image").hidden = tab !== "image";
    $("panel-pdf").hidden = tab !== "pdf";
    $("progress-card").hidden = true;
    $("result-card").hidden = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();