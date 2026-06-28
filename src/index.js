// Main application code
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as Export from "./export.js";
import {TextDrawer} from "./drawer.js";
import * as FileUtils from "./utils/file.js"
import * as FontUtils from "./utils/font";

import {BuiltinFonts, UserFonts, FontRanges, ExportFormats, Scales, PreviewSymbolsCount} from "./defs.js"
import * as CommonUtils from "./utils/common";

const Canvas = document.getElementById("preview");

const rect = Canvas.getBoundingClientRect();
Canvas.style.width = rect.width + "px";
Canvas.style.height = rect.height + "px"
Canvas.style.flex = "0";
Canvas.width = rect.width * devicePixelRatio;
Canvas.height = rect.height * devicePixelRatio;

const Context = Canvas.getContext("2d");
Context.imageSmoothingEnabled = false;

const Drawer = new TextDrawer(Context);
Drawer.setColor(0xff000000);
Drawer.setBackgroundColor(0);

let OverlayMode = 0;
const OverlayModesCount = 3;
let PreviewPointer = null;
let PreviewPointerFrame = null;


const queryParams = new URLSearchParams(window.location.search);

const DefaultText = queryParams.get("text");
const DefaultFontSize = Number.parseInt(queryParams.get("fontSize") || 0);
const DefaultFontFamily = queryParams.get("fontFamily");
const DefaultExportFormat = queryParams.get("exportFormat");
const ExportSizes = (queryParams.get("exportSizes") || "").split(",")
    .map(v => Number.parseInt(v))
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

async function uploadFont() {
    const file = await FileUtils.openFile("font/ttf", false)
    if (!file) return;

    const result = await FontUtils.importFont(file);
    if (!result) return;

    const {fontName} = result;
    addFont(fontName);
}

function addFont(fontName) {
    const option = document.createElement("option");
    option.setAttribute("value", fontName)
    option.textContent = fontName;

    const select = document.getElementById("font-select");
    select.appendChild(option);
    select.value = fontName;
    select.dispatchEvent(new Event("change"));
}

async function downloadFont() {
    const fontName = getSelectedFont();
    const size = Number.parseInt(document.getElementById('size-field').value);
    const options = getFontOptions();

    await Export.exportFont(fontName, size, options);
}

async function downloadAllFonts() {
    const options = getFontOptions();
    const exportSizes = ExportSizes.length > 0 ? ExportSizes :
        [Number.parseInt(document.getElementById('size-field').value)];

    for (const fontName of Object.keys(BuiltinFonts).concat(Object.keys(UserFonts))) {
        for (const size of exportSizes) {
            await Export.exportFont(fontName, size, options);
        }
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

    return FontRanges[range] || FontRanges.default
}

function getExportFormat() {
    const format = document.getElementById('format-select').value;
    return ExportFormats[format] || ExportFormats.Adafruit;
}

function getFontOptions() {
    const format = getExportFormat();
    return {
        format,
        charSet: getFontRange(),
        compact: document.getElementById("compact-field").checked,
        bpp: format.bpp,
        dpi: format.dpi,
    }
}

async function refreshPreview() {
    const block = document.getElementById("preview").parentNode;
    if (block.getAttribute("busy") === "true") {
        setTimeout(refreshPreview, 300);
        console.log("Already refreshing. Try again later...");
        return;
    }

    let text = document.getElementById("text-field").value;
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseInt(document.getElementById("size-field").value);
    const options = getFontOptions();

    block.setAttribute("busy", "true");

    try {
        const bitmapFont = await FontUtils.loadFont(selectedFont, fontSize, options);
        Drawer.setFont(bitmapFont);

        const includedChars = Array.from(text).filter(ch => bitmapFont.glyphs.find(g => g.char === ch));
        if (includedChars.length === 0) {
            text = "";
            const validGlyphs = bitmapFont.glyphs.filter(g => g.char !== null);
            const glyphCount = validGlyphs.length;
            for (let i = 0; i < glyphCount; i += glyphCount / PreviewSymbolsCount) {
                text += validGlyphs[Math.floor(i)].char;
            }
        }

        Context.clearRect(0, 0, Canvas.width, Canvas.height);

        Drawer.setFontScale(1, 1);
        const boundary = Drawer.calcTextBoundaries(text);

        const spacing = 1.2;

        let selectedScales = [...Scales];
        let totalHeight = Math.min(
            selectedScales.reduce((p, scale) => p + (scale + spacing) * boundary.height, 0)
        );

        if (totalHeight > Canvas.height) {
            for (let i = Scales.length - 1; i >= 1; i--) {
                totalHeight -= boundary.height * (Scales[i] + spacing);
                selectedScales.splice(i, 1);
                if (totalHeight < Canvas.height) break;
            }
        }

        let offsetY = -totalHeight / 2;
        let gridOrigin = null;
        const baseScale = selectedScales[0];
        const baseX = (Canvas.width - boundary.width * baseScale) / 2;
        const baseY = offsetY + Canvas.height / 2 + boundary.height * baseScale;

        if (OverlayMode === 2) {
            Drawer.setFontScale(baseScale, baseScale);
            Drawer.setPosition(baseX, baseY);
            const baseBoundary = Drawer.calcTextBoundaries(text);
            gridOrigin = {x: baseBoundary.left, y: baseBoundary.top};
            Drawer.drawPixelGrid(gridOrigin.x, gridOrigin.y);
        }

        for (const scale of selectedScales) {
            Drawer.setFontScale(scale, scale);
            const x = (Canvas.width - boundary.width * scale) / 2;
            const y = offsetY + Canvas.height / 2 + boundary.height * scale;

            Drawer.setPosition(x, y);
            const scaledBoundary = Drawer.calcTextBoundaries(text);
            Drawer.print(text);
            if (scale > 1) drawScaleLabel(scale, scaledBoundary);

            if (OverlayMode === 1) {
                Drawer.drawMetrics(text, x, y);
            }

            offsetY += boundary.height * (scale + spacing);
        }

        if (OverlayMode === 2 && PreviewPointer && gridOrigin) {
            drawGridPointer(PreviewPointer, gridOrigin);
        }


        document.getElementById("stats").textContent =
            `${bitmapFont.name}, Size: ${options.format.size(bitmapFont)}`
            + `, Glyphs: ${bitmapFont.glyphs.length}`
            + `, ${bitmapFont.bpp} bpp, ${options.dpi} dpi`;
    } finally {
        block.setAttribute("busy", "false");
    }
}

function drawGridPointer(pointer, origin) {
    const length = 50 * devicePixelRatio;
    const lineWidth = devicePixelRatio;
    const x = Math.round(pointer.x);
    const y = Math.round(pointer.y);
    const label = [
        Math.round((pointer.x - origin.x) / devicePixelRatio),
        Math.round((pointer.y - origin.y) / devicePixelRatio),
    ].join(", ");
    const padding = 4 * devicePixelRatio;
    const fontSize = 12 * devicePixelRatio;

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
    const labelX = Math.max(0, Math.min(Canvas.width - labelWidth, x + 8 * devicePixelRatio));
    const labelY = Math.max(0, Math.min(Canvas.height - labelHeight, y + 8 * devicePixelRatio));

    Context.fillStyle = "rgba(255, 255, 255, 0.85)";
    Context.fillRect(labelX, labelY, labelWidth, labelHeight);
    Context.fillStyle = "rgba(0, 120, 0, 0.95)";
    Context.fillText(label, labelX + padding, labelY + padding);

    Context.restore();
}

function drawScaleLabel(scale, boundary) {
    const padding = 4 * devicePixelRatio;
    const fontSize = 12 * devicePixelRatio;
    const label = `x${scale}`;

    Context.save();
    Context.font = `${fontSize}px Helvetica Neue, Lucida Grande, Arial, sans-serif`;
    Context.textBaseline = "middle";

    const metrics = Context.measureText(label);
    const width = metrics.width + padding * 2;
    const height = fontSize + padding;
    const x = Math.max(6 * devicePixelRatio, boundary.left - width - 6 * devicePixelRatio);
    const y = boundary.top + boundary.height / 2;

    Context.fillStyle = "rgba(255, 255, 255, 0.8)";
    Context.fillRect(x, y - height / 2, width, height);
    Context.fillStyle = "rgba(51, 51, 51, 0.85)";
    Context.fillText(label, x + padding, y);
    Context.restore();
}

function initSelect(id, keys, def = null) {
    const el = document.getElementById(id);
    for (const key of keys) {
        const option = document.createElement("option");
        option.setAttribute("value", key)
        option.textContent = key;
        el.appendChild(option);

        if (key === def) el.value = def;
    }
}

function updateCustomRangeField() {
    const range = document.getElementById("range-select").value;
    const hidden = range !== "custom";
    document.getElementById("custom-range-break").hidden = hidden;
    document.getElementById("custom-range-field").hidden = hidden;
}

initSelect("font-select", Object.keys(BuiltinFonts), DefaultFontFamily);
initSelect("range-select", Object.keys(FontRanges), DefaultExportRange);
initSelect("format-select", Object.keys(ExportFormats), DefaultExportFormat);

if (DefaultFontSize) document.getElementById("size-field").value = DefaultFontSize;
if (DefaultText) document.getElementById("text-field").value = DefaultText;
if (DefaultCustomRange) document.getElementById("custom-range-field").value = DefaultCustomRange;
updateCustomRangeField();

document.getElementById("text-field").addEventListener("keyup", () => refreshPreview());
document.getElementById("size-field").addEventListener("change", () => refreshPreview());
document.getElementById("font-select").addEventListener("change", () => refreshPreview());
document.getElementById("range-select").addEventListener("change", () => {
    updateCustomRangeField();
    refreshPreview();
});
document.getElementById("custom-range-field").addEventListener("input", () => refreshPreview());
document.getElementById("format-select").addEventListener("change", () => refreshPreview());
document.getElementById("compact-field").addEventListener("change", () => refreshPreview());

document.getElementById("upload-font").addEventListener("click", () => uploadFont());
document.getElementById("get-font").addEventListener("click", () => downloadFont());
document.getElementById("get-all-fonts").addEventListener("click", () => downloadAllFonts());

Canvas.addEventListener("mouseup", async () => {
    OverlayMode = (OverlayMode + 1) % OverlayModesCount;
    await refreshPreview();
})

Canvas.addEventListener("mousemove", async (e) => {
    const rect = Canvas.getBoundingClientRect();
    PreviewPointer = {
        x: (e.clientX - rect.left) * devicePixelRatio,
        y: (e.clientY - rect.top) * devicePixelRatio,
    };

    if (OverlayMode === 2 && PreviewPointerFrame === null) {
        PreviewPointerFrame = requestAnimationFrame(() => {
            PreviewPointerFrame = null;
            refreshPreview().catch((e) => console.error(e));
        });
    }
})

Canvas.addEventListener("mouseleave", async () => {
    PreviewPointer = null;

    if (OverlayMode === 2) {
        await refreshPreview();
    }
})

refreshPreview().catch((e) => console.error(e));
