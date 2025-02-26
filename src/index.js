// Main application code
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as Export from "./export.js";
import {TextDrawer} from "./drawer.js";
import * as FileUtils from "./utils/file.js"
import * as FontUtils from "./utils/font";

import {BuiltinFonts, UserFonts, FontRanges, ExportFormats, Scales} from "./defs.js"
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

let DrawMetrics = false;


const queryParams = new URLSearchParams(window.location.search);

const DefaultText = queryParams.get("text");
const DefaultFontSize = Number.parseInt(queryParams.get("fontSize") || 0);
const DefaultFontFamily = queryParams.get("fontFamily");
const DefaultExportFormat = queryParams.get("exportFormat");
const ExportSizes = (queryParams.get("exportSizes") || "").split(",")
    .map(v => Number.parseInt(v))
    .filter(v => !Number.isNaN(v));

let DefaultExportRange = queryParams.get("exportRange");
if (DefaultExportRange && !FontRanges[DefaultExportRange]) {
    const parsedRange = CommonUtils.parseRange(DefaultExportRange);
    if (parsedRange.length > 0) {
        DefaultExportRange = "custom";
        FontRanges[DefaultExportRange] = parsedRange;
    }
}

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

    const text = document.getElementById("text-field").value;
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseInt(document.getElementById("size-field").value);
    const options = getFontOptions();

    block.setAttribute("busy", "true");

    try {
        const bitmapFont = await FontUtils.loadFont(selectedFont, fontSize, options);
        Drawer.setFont(bitmapFont);

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
        for (const scale of selectedScales) {
            Drawer.setFontScale(scale, scale);
            const x = (Canvas.width - boundary.width * scale) / 2;
            const y = offsetY + Canvas.height / 2 + boundary.height * scale;

            Drawer.setPosition(x, y);
            Drawer.print(text);
            if (DrawMetrics) Drawer.drawMetrics(text, x, y);

            offsetY += boundary.height * (scale + spacing);
        }


        document.getElementById("stats").textContent =
            `${bitmapFont.name}, Size: ${options.format.size(bitmapFont)}`
            + `, Glyphs: ${bitmapFont.glyphs.length}`
            + `, ${bitmapFont.bpp} bpp, ${options.dpi} dpi`;
    } finally {
        block.setAttribute("busy", "false");
    }
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

initSelect("font-select", Object.keys(BuiltinFonts), DefaultFontFamily);
initSelect("range-select", Object.keys(FontRanges), DefaultExportRange);
initSelect("format-select", Object.keys(ExportFormats), DefaultExportFormat);

if (DefaultFontSize) document.getElementById("size-field").value = DefaultFontSize;
if (DefaultText) document.getElementById("text-field").value = DefaultText;

document.getElementById("text-field").addEventListener("keyup", () => refreshPreview());
document.getElementById("size-field").addEventListener("change", () => refreshPreview());
document.getElementById("font-select").addEventListener("change", () => refreshPreview());
document.getElementById("range-select").addEventListener("change", () => refreshPreview());
document.getElementById("format-select").addEventListener("change", () => refreshPreview());

document.getElementById("upload-font").addEventListener("click", () => uploadFont());
document.getElementById("get-font").addEventListener("click", () => downloadFont());
document.getElementById("get-all-fonts").addEventListener("click", () => downloadAllFonts());

Canvas.addEventListener("mouseup", async () => {
    DrawMetrics = !DrawMetrics;
    await refreshPreview();
})

refreshPreview().catch((e) => console.error(e));
