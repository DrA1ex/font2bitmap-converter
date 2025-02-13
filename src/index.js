// Main application code
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as Export from "./export.js";
import {TextDrawer} from "./drawer.js";
import * as FileUtils from "./utils/file.js"
import * as FontUtils from "./utils/font";

import {BuiltinFonts, FontRanges, ExportSizes, ExportFormats} from "./defs.js"

const UserFonts = [];

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


async function uploadFont() {
    const file = await FileUtils.openFile("font/ttf", false)
    if (!file) return;

    const font = FontUtils.importFont(file);
    UserFonts.push(font.family);

    addFont(font.family);
}

function addFont(fontName) {
    const option = document.createElement("option");
    option.setAttribute("value", fontName)
    option.textContent = fontName;

    document.getElementById("font-select").appendChild(option);
}

async function downloadFont() {
    const fontNmae = getSelectedFont();
    const size = Number.parseInt(document.getElementById('size-field').value);
    const range = getFontRange();
    const format = getExportFormat();

    await Export.exportFont(fontNmae, size, range, format);
}

async function downloadAllFonts() {
    const range = getFontRange();
    const format = getExportFormat();

    for (const fontName of BuiltinFonts.concat(UserFonts)) {
        for (const size of ExportSizes) {
            await Export.exportFont(fontName, size, range, format);
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

async function refreshPreview() {
    const text = document.getElementById("text-field").value;
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseInt(document.getElementById("size-field").value);

    const bitmapFont = await FontUtils.loadFont(selectedFont, fontSize, getFontRange());
    Drawer.setFont(bitmapFont);

    Context.clearRect(0, 0, Canvas.width, Canvas.height);

    const boundary = Drawer.calcTextBoundaries(text);
    Drawer.setPosition((Canvas.width - boundary.width) / 2, Canvas.height / 2);
    Drawer.print(text);
}

function initSelect(id, keys) {
    const el = document.getElementById(id);
    for (const key of keys) {
        const option = document.createElement("option");
        option.setAttribute("value", key)
        option.textContent = key;
        el.appendChild(option);
    }
}

initSelect("font-select", BuiltinFonts);
initSelect("range-select", Object.keys(FontRanges));
initSelect("format-select", Object.keys(ExportFormats));

document.getElementById("text-field").addEventListener("keyup", () => refreshPreview());
document.getElementById("size-field").addEventListener("change", () => refreshPreview());
document.getElementById("font-select").addEventListener("change", () => refreshPreview());
document.getElementById("range-select").addEventListener("change", () => refreshPreview());

document.getElementById("upload-font").addEventListener("click", () => uploadFont());
document.getElementById("get-font").addEventListener("click", () => downloadFont());
document.getElementById("get-all-fonts").addEventListener("click", () => downloadAllFonts());

refreshPreview().catch((e) => console.error(e));
