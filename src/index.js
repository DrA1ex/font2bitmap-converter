// Main application code
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import * as Export from "./export.js";
import {TextDrawer} from "./drawer.js";
import * as FileUtils from "./utils/file.js";
import * as FontUtils from "./utils/font.js";

import {
    BuiltinFonts,
    UserFonts,
    FontRanges,
    FontRangeLabels,
    ExportFormats,
    BppOptions,
    AbiProfileOptions,
    RangeModeOptions,
    resolveExportFormat,
    Scales,
    PreviewSymbolsCount,
} from "./defs.js";
import * as CommonUtils from "./utils/common.js";
import {
    DenseSpanError,
    FontAbiProfile,
    RangeMode,
    formatCodePoint,
    normalizeFontAbiProfile,
    normalizeRangeMode,
} from "./range.js";
import {MissingGlyphsError} from "./bitmap.js";

const Canvas = document.getElementById("preview");
const PreviewBlock = Canvas.parentNode;
const Context = Canvas.getContext("2d");
Context.imageSmoothingEnabled = false;

const Drawer = new TextDrawer(Context);
Drawer.setColor(0xff000000);
Drawer.setBackgroundColor(0);

const OverlayMode = Object.freeze({
    NONE: 0,
    METRICS: 1,
    GRID: 2,
    MAGNIFIER: 3,
});
const OverlayModesCount = Object.keys(OverlayMode).length;
const MagnifierDefaultZoom = 5;
const MagnifierBoostZoom = 10;

let ActiveOverlayMode = OverlayMode.NONE;
let PreviewPointer = null;
let PreviewPointerFrame = null;
let RefreshFrame = null;
let MagnifierBoost = false;

const SnapshotCanvas = document.createElement("canvas");
const SnapshotContext = SnapshotCanvas.getContext("2d");
SnapshotContext.imageSmoothingEnabled = false;

const queryParams = new URLSearchParams(window.location.search);

const DefaultText = queryParams.get("text");
const DefaultFontSize = Number.parseFloat(queryParams.get("fontSize") || 0);
const DefaultFontFamily = queryParams.get("fontFamily");
let DefaultExportFormat = queryParams.get("exportFormat");
let DefaultBpp = Number.parseInt(queryParams.get("bpp") || "1", 10);
const LegacyCustomFormat = /^Custom ([1248])bpp$/.exec(DefaultExportFormat || "");
if (LegacyCustomFormat) {
    DefaultExportFormat = "Custom";
    DefaultBpp = Number.parseInt(LegacyCustomFormat[1], 10);
}
if (!BppOptions.includes(DefaultBpp)) DefaultBpp = 1;
const DefaultRangeMode = normalizeRangeMode(queryParams.get("rangeMode"));
const DefaultAbiProfile = normalizeFontAbiProfile(queryParams.get("abiProfile"));
const ExportSizes = (queryParams.get("exportSizes") || "").split(",")
    .map(v => Number.parseFloat(v))
    .filter(v => !Number.isNaN(v));

let DefaultExportRange = queryParams.get("exportRange");
let DefaultCustomRange = "";
if (DefaultExportRange && !FontRanges[DefaultExportRange]) {
    const parsedRange = CommonUtils.parseRange(DefaultExportRange);
    if (parsedRange.length > 0) {
        DefaultExportRange = "custom";
        DefaultCustomRange = queryParams.get("exportRange");
        FontRanges[DefaultExportRange] = parsedRange;
    }
}
FontRanges.custom ??= "";

function scheduleRefresh() {
    if (RefreshFrame !== null) return;
    RefreshFrame = requestAnimationFrame(() => {
        RefreshFrame = null;
        refreshPreview().catch(error => console.error(error));
    });
}

function resizePreviewCanvas(force = false) {
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.floor(Canvas.clientWidth || PreviewBlock.clientWidth || 1));
    const cssHeight = Math.max(1, Math.floor(Canvas.clientHeight || PreviewBlock.clientHeight || 1));
    const width = Math.max(1, cssWidth * ratio);
    const height = Math.max(1, cssHeight * ratio);

    if (!force && Canvas.width === width && Canvas.height === height) return false;

    Canvas.width = width;
    Canvas.height = height;
    Context.imageSmoothingEnabled = false;
    return true;
}

function capturePreviewSnapshot() {
    if (SnapshotCanvas.width !== Canvas.width || SnapshotCanvas.height !== Canvas.height) {
        SnapshotCanvas.width = Canvas.width;
        SnapshotCanvas.height = Canvas.height;
    }
    SnapshotContext.clearRect(0, 0, SnapshotCanvas.width, SnapshotCanvas.height);
    SnapshotContext.drawImage(Canvas, 0, 0);
}

function pointerFromEvent(event) {
    const rect = Canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return {
        x: (event.clientX - rect.left) * ratio,
        y: (event.clientY - rect.top) * ratio,
    };
}

function hasMagnifierBoost(event) {
    return Boolean(event && (event.ctrlKey || event.altKey || event.shiftKey));
}

async function uploadFont() {
    const file = await FileUtils.openFile("font/ttf", false);
    if (!file) return;

    const result = await FontUtils.importFont(file);
    if (!result) return;

    const {fontName} = result;
    addFont(fontName);
}

function addFont(fontName) {
    const option = document.createElement("option");
    option.setAttribute("value", fontName);
    option.textContent = fontName;

    const select = document.getElementById("font-select");
    select.appendChild(option);
    select.value = fontName;
    select.dispatchEvent(new Event("change"));
}

async function downloadFont() {
    const fontName = getSelectedFont();
    const size = Number.parseFloat(document.getElementById("size-field").value);
    const options = getFontOptions();

    try {
        const {font} = await Export.exportFont(fontName, size, options);
        updateIssues(font);
    } catch (error) {
        showIssueError(error);
        console.error(error);
    }
}

async function downloadAllFonts() {
    const options = getFontOptions();
    const exportSizes = ExportSizes.length > 0 ? ExportSizes :
        [Number.parseFloat(document.getElementById("size-field").value)];

    try {
        for (const fontName of Object.keys(BuiltinFonts).concat(Object.keys(UserFonts))) {
            for (const size of exportSizes) {
                const {font} = await Export.exportFont(fontName, size, options);
                updateIssues(font);
            }
        }
    } catch (error) {
        showIssueError(error);
        console.error(error);
    }
}

function getSelectedFont() {
    return document.getElementById("font-select").value;
}

function getFontRange() {
    const range = document.getElementById("range-select").value;
    if (range === "custom") {
        const customRange = document.getElementById("custom-range-field").value;
        const parsedRange = CommonUtils.parseRange(customRange);
        FontRanges.custom = parsedRange;
        return parsedRange || FontRanges.default;
    }

    return FontRanges[range] || FontRanges.default;
}

function getBaseExportFormat() {
    const format = document.getElementById("format-select").value;
    return ExportFormats[format] || ExportFormats.Adafruit;
}

function getExportFormat() {
    const baseFormat = getBaseExportFormat();
    const profile = document.getElementById("abi-profile-select").value;
    const format = resolveExportFormat(baseFormat, profile);
    const usesBpp = baseFormat.kind === "custom" || baseFormat.kind === "typer";
    const bpp = usesBpp
        ? Number.parseInt(document.getElementById("bpp-select").value, 10)
        : baseFormat.bpp;
    return {...format, bpp};
}

function getFontOptions() {
    const format = getExportFormat();
    const selectedMode = document.getElementById("range-mode-select").value;
    const rangeMode = format.supportedRangeModes.includes(selectedMode)
        ? selectedMode
        : format.supportedRangeModes[0];

    return {
        format,
        charSet: getFontRange(),
        rangeMode,
        bpp: format.bpp,
        dpi: format.dpi,
        dpiBase: format.dpiBase,
        floorRasterSize: format.floorRasterSize,
        abiProfile: format.abiProfile || FontAbiProfile.UNICODE32,
        strict: document.getElementById("strict-field").checked,
        allowLargeDense: false,
    };
}

async function refreshPreview() {
    if (PreviewBlock.getAttribute("busy") === "true") {
        setTimeout(scheduleRefresh, 120);
        return;
    }

    resizePreviewCanvas();

    let text = document.getElementById("text-field").value;
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseFloat(document.getElementById("size-field").value);
    const options = getFontOptions();
    const previewOptions = {...options, strict: false};

    PreviewBlock.setAttribute("busy", "true");

    try {
        const bitmapFont = await FontUtils.loadFont(selectedFont, fontSize, previewOptions);
        Drawer.setFont(bitmapFont);

        const includedChars = Array.from(text).filter(ch => bitmapFont.glyphs.find(g => g.present && g.char === ch));
        if (includedChars.length === 0) {
            text = "";
            const validGlyphs = bitmapFont.glyphs.filter(g => g.present);
            const glyphCount = validGlyphs.length;
            for (let i = 0; i < glyphCount; i += glyphCount / PreviewSymbolsCount) {
                text += validGlyphs[Math.floor(i)].char;
            }
        }

        Context.clearRect(0, 0, Canvas.width, Canvas.height);

        Drawer.setFontScale(window.devicePixelRatio, window.devicePixelRatio);
        const boundary = Drawer.calcTextBoundaries(text);
        const spacing = 0.85;

        const selectedScales = choosePreviewScales(boundary.height);
        const totalHeight = selectedScales.reduce((sum, scale, index) => {
            const scaledHeight = boundary.height * scale;
            const gap = index === 0 ? 0 : boundary.height * spacing;
            return sum + gap + scaledHeight;
        }, 0);

        let offsetY = (Canvas.height - totalHeight) / 2;
        let gridOrigin = null;

        for (const [index, scale] of selectedScales.entries()) {
            const renderScale = scale * window.devicePixelRatio;
            Drawer.setFontScale(renderScale, renderScale);
            const x = (Canvas.width - boundary.width * scale) / 2;
            const baselineY = offsetY + boundary.height * scale;

            Drawer.setPosition(x, baselineY);
            const scaledBoundary = Drawer.calcTextBoundaries(text);
            if (ActiveOverlayMode === OverlayMode.GRID && index === 0) {
                gridOrigin = {x: scaledBoundary.left, y: scaledBoundary.top};
                Drawer.drawPixelGrid(gridOrigin.x, gridOrigin.y);
            }

            Drawer.print(text);
            if (scale > 1) drawScaleLabel(scale, scaledBoundary);
            if (ActiveOverlayMode === OverlayMode.METRICS) {
                Drawer.drawMetrics(text, x, baselineY);
            }

            offsetY += boundary.height * scale + boundary.height * spacing;
        }

        if (ActiveOverlayMode === OverlayMode.GRID && PreviewPointer && gridOrigin) {
            drawGridPointer(PreviewPointer, gridOrigin);
        }

        if (ActiveOverlayMode === OverlayMode.MAGNIFIER && PreviewPointer) {
            capturePreviewSnapshot();
            drawMagnifierOverlay(PreviewPointer, MagnifierBoost ? MagnifierBoostZoom : MagnifierDefaultZoom);
        }

        const memory = options.format.memory(bitmapFont);
        renderStats(bitmapFont, memory, options);
        updateIssues(bitmapFont);
    } catch (error) {
        Context.clearRect(0, 0, Canvas.width, Canvas.height);
        document.getElementById("stats").textContent = "Preview unavailable";
        showIssueError(error);
        throw error;
    } finally {
        PreviewBlock.setAttribute("busy", "false");
    }
}


function renderStats(font, memory, options) {
    const groups = [
        ["Font", font.name],
        ["Render", `${font.bpp} bpp, ${options.dpi} DPI`],
    ];
    if (options.format.kind === "custom") {
        groups.push(["ABI", options.format.abiProfileLabel]);
    }
    groups.push(
        ["Layout", font.rangeModeLabel],
        ["Bitmap", `${formatStatNumber(memory.bitmapBytes)} bytes`],
        ["Glyphs", `${formatStatNumber(memory.glyphCount)} (${formatStatNumber(memory.glyphBytes)} bytes)`],
        ["Ranges", `${formatStatNumber(memory.rangeCount)} (${formatStatNumber(memory.rangeBytes)} bytes)`],
        ["Total size", `${formatStatNumber(memory.dataBytes)} bytes`],
    );

    const stats = document.getElementById("stats");
    stats.replaceChildren(...groups.map(([label, value]) => {
        const item = document.createElement("span");
        item.className = "stat-item";

        const labelElement = document.createElement("span");
        labelElement.className = "stat-label";
        labelElement.textContent = label;

        const valueElement = document.createElement("span");
        valueElement.className = "stat-value";
        valueElement.textContent = value;

        item.append(labelElement, valueElement);
        return item;
    }));
}

function formatStatNumber(value) {
    return Number(value).toLocaleString("en-US");
}

function updateIssues(font) {
    const messages = [];
    if (font?.missingCodePoints?.length > 0) {
        messages.push(`Missing ${font.missingCodePoints.length}: ${formatCodePointList(font.missingCodePoints)}`);
    }
    for (const warning of font?.warnings || []) messages.push(warning);
    setWarnings(messages);
    setIssues([]);
}

function showIssueError(error) {
    setWarnings([]);
    if (error instanceof MissingGlyphsError) {
        setIssues([error.message]);
        return;
    }
    if (error instanceof DenseSpanError) {
        setIssues([error.message]);
        return;
    }
    setIssues([error?.message || String(error)]);
}

function setWarnings(messages) {
    const stats = document.getElementById("stats");
    stats.querySelector(".stat-warning")?.remove();

    const filtered = messages.filter(Boolean);
    if (filtered.length === 0) return;

    const warning = document.createElement("button");
    warning.type = "button";
    warning.className = "stat-warning";
    warning.dataset.tooltip = filtered.join("\n");
    warning.setAttribute("aria-label", `Warnings: ${filtered.join(" ")}`);

    const triangle = document.createElement("span");
    triangle.className = "warning-triangle";
    triangle.setAttribute("aria-hidden", "true");
    triangle.textContent = "!";

    warning.appendChild(triangle);
    stats.prepend(warning);
}

function setIssues(messages) {
    const element = document.getElementById("issues");
    const filtered = messages.filter(Boolean);
    element.textContent = filtered.join("\n");
    element.hidden = filtered.length === 0;
}

function formatCodePointList(codes) {
    return codes.map(code => {
        const char = String.fromCodePoint(code);
        const printable = /[\p{C}\p{Zl}\p{Zp}]/u.test(char) ? "" : ` '${char}'`;
        return `${formatCodePoint(code)}${printable}`;
    }).join(", ");
}

function choosePreviewScales(boundaryHeight) {
    if (boundaryHeight <= 0) return [1];

    const maxAvailableHeight = Math.max(boundaryHeight, Canvas.height * 0.92);
    const selected = [];
    let usedHeight = 0;

    for (const scale of Scales) {
        const scaledHeight = boundaryHeight * scale;
        const gap = selected.length === 0 ? 0 : boundaryHeight * 0.85;

        if (selected.length > 0 && usedHeight + gap + scaledHeight > maxAvailableHeight) break;
        selected.push(scale);
        usedHeight += gap + scaledHeight;
    }

    return selected.length > 0 ? selected : [Scales[0]];
}

function drawGridPointer(pointer, origin) {
    const ratio = window.devicePixelRatio || 1;
    const length = 50 * ratio;
    const lineWidth = ratio;
    const x = Math.round(pointer.x);
    const y = Math.round(pointer.y);
    const label = [
        Math.round((pointer.x - origin.x) / ratio),
        Math.round((pointer.y - origin.y) / ratio),
    ].join(", ");
    const padding = 4 * ratio;
    const fontSize = 12 * ratio;

    Context.save();
    Context.strokeStyle = "rgba(0, 160, 0, 0.9)";
    Context.lineWidth = lineWidth;
    Context.beginPath();
    Context.moveTo(Math.max(0, x - length), y + 0.5);
    Context.lineTo(Math.min(Canvas.width, x + length), y + 0.5);
    Context.moveTo(x + 0.5, Math.max(0, y - length));
    Context.lineTo(x + 0.5, Math.min(Canvas.height, y + length));
    Context.stroke();

    Context.font = `${fontSize}px Helvetica Neue, Lucida Grande, Arial, sans-serif`;
    Context.textBaseline = "top";

    const metrics = Context.measureText(label);
    const labelWidth = metrics.width + padding * 2;
    const labelHeight = fontSize + padding * 2;
    const labelX = Math.max(0, Math.min(Canvas.width - labelWidth, x + 8 * ratio));
    const labelY = Math.max(0, Math.min(Canvas.height - labelHeight, y + 8 * ratio));

    Context.fillStyle = "rgba(255, 255, 255, 0.85)";
    Context.fillRect(labelX, labelY, labelWidth, labelHeight);
    Context.fillStyle = "rgba(0, 120, 0, 0.95)";
    Context.fillText(label, labelX + padding, labelY + padding);

    Context.restore();
}

function drawMagnifierOverlay(pointer, zoom) {
    const ratio = window.devicePixelRatio || 1;
    const lensSize = 160 * ratio;
    const padding = 8 * ratio;
    const innerSize = lensSize - padding * 2;
    const sampleSize = Math.max(8, Math.floor(innerSize / zoom));

    const sourceX = clamp(Math.round(pointer.x - sampleSize / 2), 0, Math.max(0, SnapshotCanvas.width - sampleSize));
    const sourceY = clamp(Math.round(pointer.y - sampleSize / 2), 0, Math.max(0, SnapshotCanvas.height - sampleSize));

    const defaultX = pointer.x + 20 * ratio;
    const defaultY = pointer.y + 20 * ratio;
    let lensX = clamp(defaultX, 8 * ratio, Math.max(8 * ratio, Canvas.width - lensSize - 8 * ratio));
    let lensY = clamp(defaultY, 8 * ratio, Math.max(8 * ratio, Canvas.height - lensSize - 8 * ratio));

    if (lensX + lensSize > Canvas.width - 8 * ratio) {
        lensX = clamp(pointer.x - lensSize - 20 * ratio, 8 * ratio, Math.max(8 * ratio, Canvas.width - lensSize - 8 * ratio));
    }
    if (lensY + lensSize > Canvas.height - 8 * ratio) {
        lensY = clamp(pointer.y - lensSize - 20 * ratio, 8 * ratio, Math.max(8 * ratio, Canvas.height - lensSize - 8 * ratio));
    }

    Context.save();
    Context.fillStyle = "rgba(255, 255, 255, 0.94)";
    Context.strokeStyle = "rgba(0, 0, 0, 0.15)";
    Context.lineWidth = ratio;
    Context.fillRect(lensX, lensY, lensSize, lensSize);
    Context.strokeRect(lensX + 0.5, lensY + 0.5, lensSize - ratio, lensSize - ratio);

    Context.imageSmoothingEnabled = false;
    Context.drawImage(
        SnapshotCanvas,
        sourceX,
        sourceY,
        sampleSize,
        sampleSize,
        lensX + padding,
        lensY + padding,
        innerSize,
        innerSize,
    );

    drawMagnifierGrid(lensX + padding, lensY + padding, innerSize, sampleSize, zoom, ratio);

    const centerX = lensX + padding + innerSize / 2;
    const centerY = lensY + padding + innerSize / 2;
    Context.strokeStyle = "rgba(0, 128, 0, 0.85)";
    Context.lineWidth = ratio;
    Context.beginPath();
    Context.moveTo(centerX, lensY + padding);
    Context.lineTo(centerX, lensY + padding + innerSize);
    Context.moveTo(lensX + padding, centerY);
    Context.lineTo(lensX + padding + innerSize, centerY);
    Context.stroke();

    const label = `Lens x${zoom} · ${Math.round(pointer.x / ratio)}, ${Math.round(pointer.y / ratio)}`;
    const fontSize = 12 * ratio;
    const labelPadding = 4 * ratio;
    Context.font = `${fontSize}px Helvetica Neue, Lucida Grande, Arial, sans-serif`;
    Context.textBaseline = "top";
    const metrics = Context.measureText(label);
    const labelWidth = metrics.width + labelPadding * 2;
    const labelHeight = fontSize + labelPadding * 2;

    Context.fillStyle = "rgba(51, 51, 51, 0.9)";
    Context.fillRect(lensX, lensY - labelHeight - 4 * ratio, labelWidth, labelHeight);
    Context.fillStyle = "rgba(255, 255, 255, 0.95)";
    Context.fillText(label, lensX + labelPadding, lensY - labelHeight - 4 * ratio + labelPadding);
    Context.restore();
}

function drawMagnifierGrid(x, y, size, sampleSize, zoom, ratio) {
    const step = size / sampleSize;
    if (step < 4 * ratio) return;

    Context.save();
    Context.strokeStyle = "rgba(0, 0, 0, 0.12)";
    Context.lineWidth = ratio;

    for (let index = 0; index <= sampleSize; ++index) {
        const vertical = Math.round(x + index * step) + 0.5;
        const horizontal = Math.round(y + index * step) + 0.5;
        Context.beginPath();
        Context.moveTo(vertical, y);
        Context.lineTo(vertical, y + size);
        Context.stroke();

        Context.beginPath();
        Context.moveTo(x, horizontal);
        Context.lineTo(x + size, horizontal);
        Context.stroke();
    }
    Context.restore();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function drawScaleLabel(scale, boundary) {
    const ratio = window.devicePixelRatio || 1;
    const padding = 4 * ratio;
    const fontSize = 12 * ratio;
    const label = `x${scale}`;

    Context.save();
    Context.font = `${fontSize}px Helvetica Neue, Lucida Grande, Arial, sans-serif`;
    Context.textBaseline = "middle";

    const metrics = Context.measureText(label);
    const width = metrics.width + padding * 2;
    const height = fontSize + padding;
    const x = Math.max(6 * ratio, boundary.left - width - 6 * ratio);
    const y = boundary.top + boundary.height / 2;

    Context.fillStyle = "rgba(255, 255, 255, 0.8)";
    Context.fillRect(x, y - height / 2, width, height);
    Context.fillStyle = "rgba(51, 51, 51, 0.85)";
    Context.fillText(label, x + padding, y);
    Context.restore();
}

function updateBppAvailability() {
    const baseFormat = getBaseExportFormat();
    const field = document.getElementById("bpp-field");
    const select = document.getElementById("bpp-select");
    const usesBpp = baseFormat.kind === "custom" || baseFormat.kind === "typer";
    field.hidden = !usesBpp;
    select.disabled = !usesBpp;
}

function updateAbiProfileAvailability() {
    const baseFormat = getBaseExportFormat();
    const field = document.getElementById("abi-profile-field");
    const select = document.getElementById("abi-profile-select");
    const isCustom = baseFormat.kind === "custom";
    field.hidden = !isCustom;
    select.disabled = !isCustom;
}

function updateRangeModeAvailability() {
    const format = getExportFormat();
    const select = document.getElementById("range-mode-select");

    for (const option of select.options) {
        option.disabled = !format.supportedRangeModes.includes(option.value);
    }

    if (!format.supportedRangeModes.includes(select.value)) {
        select.value = format.supportedRangeModes[0];
    }

    select.disabled = format.supportedRangeModes.length === 1;
}

function initMappedSelect(id, entries, def = null) {
    const el = document.getElementById(id);
    for (const [label, value] of Object.entries(entries)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        el.appendChild(option);
        if (value === def) el.value = value;
    }
}

function initSelect(id, keys, def = null, labels = {}) {
    const el = document.getElementById(id);
    for (const key of keys) {
        const option = document.createElement("option");
        option.setAttribute("value", key);
        option.textContent = labels[key] || key;
        el.appendChild(option);

        if (key === def) el.value = def;
    }
}

function updateCustomRangeField() {
    const range = document.getElementById("range-select").value;
    const hidden = range !== "custom";
    document.getElementById("custom-range-field").hidden = hidden;
}

initSelect("font-select", Object.keys(BuiltinFonts), DefaultFontFamily);
initSelect("range-select", Object.keys(FontRanges), DefaultExportRange, FontRangeLabels);
initSelect("format-select", Object.keys(ExportFormats), DefaultExportFormat);
initSelect("bpp-select", BppOptions.map(String), String(DefaultBpp), {
    "1": "1 bpp",
    "2": "2 bpp",
    "4": "4 bpp",
    "8": "8 bpp",
});
initMappedSelect("abi-profile-select", AbiProfileOptions, DefaultAbiProfile);
initMappedSelect("range-mode-select", RangeModeOptions, DefaultRangeMode || RangeMode.DENSE);

if (DefaultFontSize) document.getElementById("size-field").value = DefaultFontSize;
if (DefaultText) document.getElementById("text-field").value = DefaultText;
if (DefaultCustomRange) document.getElementById("custom-range-field").value = DefaultCustomRange;
updateCustomRangeField();
updateBppAvailability();
updateAbiProfileAvailability();
updateRangeModeAvailability();
resizePreviewCanvas(true);

document.getElementById("text-field").addEventListener("keyup", () => scheduleRefresh());
document.getElementById("size-field").addEventListener("change", () => scheduleRefresh());
document.getElementById("font-select").addEventListener("change", () => scheduleRefresh());
document.getElementById("range-select").addEventListener("change", () => {
    updateCustomRangeField();
    scheduleRefresh();
});
document.getElementById("custom-range-field").addEventListener("input", () => scheduleRefresh());
document.getElementById("format-select").addEventListener("change", () => {
    updateBppAvailability();
    updateAbiProfileAvailability();
    updateRangeModeAvailability();
    scheduleRefresh();
});

document.getElementById("bpp-select").addEventListener("change", scheduleRefresh);
document.getElementById("abi-profile-select").addEventListener("change", () => {
    updateRangeModeAvailability();
    scheduleRefresh();
});
document.getElementById("range-mode-select").addEventListener("change", () => scheduleRefresh());
document.getElementById("strict-field").addEventListener("change", () => scheduleRefresh());

document.getElementById("upload-font").addEventListener("click", () => uploadFont());
document.getElementById("get-font").addEventListener("click", () => downloadFont());
document.getElementById("get-all-fonts").addEventListener("click", () => downloadAllFonts());

Canvas.addEventListener("mouseup", async event => {
    ActiveOverlayMode = (ActiveOverlayMode + 1) % OverlayModesCount;
    PreviewPointer = pointerFromEvent(event);
    MagnifierBoost = hasMagnifierBoost(event);
    await refreshPreview();
});

Canvas.addEventListener("mousemove", event => {
    PreviewPointer = pointerFromEvent(event);
    MagnifierBoost = hasMagnifierBoost(event);

    if (
        (ActiveOverlayMode === OverlayMode.GRID || ActiveOverlayMode === OverlayMode.MAGNIFIER)
        && PreviewPointerFrame === null
    ) {
        PreviewPointerFrame = requestAnimationFrame(() => {
            PreviewPointerFrame = null;
            refreshPreview().catch(error => console.error(error));
        });
    }
});

Canvas.addEventListener("mouseleave", async () => {
    PreviewPointer = null;
    MagnifierBoost = false;

    if (ActiveOverlayMode === OverlayMode.GRID || ActiveOverlayMode === OverlayMode.MAGNIFIER) {
        await refreshPreview();
    }
});

window.addEventListener("keydown", event => {
    const nextBoost = hasMagnifierBoost(event);
    if (MagnifierBoost === nextBoost) return;
    MagnifierBoost = nextBoost;
    if (ActiveOverlayMode === OverlayMode.MAGNIFIER && PreviewPointer) scheduleRefresh();
});

window.addEventListener("keyup", event => {
    const nextBoost = hasMagnifierBoost(event);
    if (MagnifierBoost === nextBoost) return;
    MagnifierBoost = nextBoost;
    if (ActiveOverlayMode === OverlayMode.MAGNIFIER && PreviewPointer) scheduleRefresh();
});

if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => scheduleRefresh()).observe(PreviewBlock);
} else {
    window.addEventListener("resize", () => scheduleRefresh());
}

refreshPreview().catch(error => console.error(error));
