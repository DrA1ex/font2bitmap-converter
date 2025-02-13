// Main application code
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as CommonUtils from "./utils/common.js"
import * as FileUtils from "./utils/file.js"
import * as Bitmap from "./bitmap.js"
import {TextDrawer} from "./drawer.js";

const BuiltinFonts = [
    "Roboto",
    "Roboto Bold",
    "Roboto Thin",
    "JetBrainsMono",
    "JetBrainsMono Bold",
    "JetBrainsMono Thin",
]

const UserFonts = [];

const FontRanges = {
    "default": CommonUtils.generateString(' ', '~'),
    "light": CommonUtils.generateString('a', 'z', 'A', 'Z', '0', '9') + " ,.!?",
    "russian": CommonUtils.generateString(' ', '~', 'А', 'Я', 'а', 'я') + "ёЁ",
}

const ExportSizes = [12, 16, 20, 28]

const Cache = {
    fontName: null,
    fontSize: null,
    range: null,
    bitmapFont: null,
}

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

    const buffer = await file.arrayBuffer();
    const fontName = file.name.split(".ttf").join("");
    const font = new FontFace(fontName, buffer);

    try {
        await font.load()
    } catch (e) {
        console.error(e);
        alert("Unable to load font!");
        return;
    }

    document.fonts.add(font);
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
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseInt(document.getElementById('size-field').value);

    await downloadFontImpl(selectedFont, fontSize);
}

async function downloadAllFonts() {
    for (const fontName of BuiltinFonts.concat(UserFonts))
        for (const size of ExportSizes) {
            await downloadFontImpl(fontName, size);
        }
}

async function downloadFontImpl(selectedFont, fontSize, range = FontRanges.default) {
    const font = await loadFont(selectedFont, fontSize, range)
    const fontName = CommonUtils.capitalize(font.name);

    let result = `#pragma once\n\n`
        + `#include "./types.h"\n\n`

    const maxRowSize = 80;
    const align = "    ";

    result += `const uint8_t ${fontName}Bitmaps[] = {\n`

    let rowSize = 0;
    for (let i = 0; i < font.buffer.byteLength; ++i) {
        const s = `0x${font.buffer[i].toString(16).padStart(2, "0")}, `;
        if (rowSize + s.length >= maxRowSize) {
            result += "\n";
            rowSize = 0;
        }

        if (rowSize === 0) {
            result += align;
            rowSize += align.length;
        }

        rowSize += s.length;
        result += s;
    }

    if (rowSize > 0) {
        result += "\n";
    }

    result += `};\n\n`

    result += `const Glyph ${fontName}Glyphs[] = {\n`;
    for (let i = 0; i < font.glyphs.length; i++) {
        const glyph = font.glyphs[i];

        result += align;
        if (glyph.height > 0 && glyph.width > 0) {
            result += `{ ${glyph.offset}, ${glyph.width}, ${glyph.height}, ${glyph.advanceX}, ${glyph.offsetX}, ${glyph.offsetY} },`
        } else {
            result += `{ 0, 0, 0, 0, 0, 0 }`
        }

        result += ` // '${String.fromCharCode(font.codeFrom + i)}'\n`
    }

    result += `};\n\n`

    result += `const Font ${fontName} = {\n`
    result += align + `"${font.name}",\n`
    result += align + `(uint8_t *) ${fontName}Bitmaps,\n`
    result += align + `(Glyph *) ${fontName}Glyphs,\n`
    result += align + `0x${font.codeFrom.toString(16)}, 0x${font.codeTo.toString(16)},\n`
    result += align + `${font.advanceY},\n`
    result += "};\n"

    const fontTotalSize = font.buffer.byteLength
        + 9 * font.glyphs.length // Glyphs structs total size
        + font.name.length
        + 14; // Font struct size

    result += `\n// Total size: ${fontTotalSize} bytes\n`

    FileUtils.saveFile(result, `${fontName}.h`, "text/x-c")
}

function getSelectedFont() {
    return document.getElementById("font-select").value;
}

async function loadFont(selectedFont, fontSize, range = FontRanges.default) {
    if (Cache.fontName !== selectedFont || Cache.fontSize !== fontSize || Cache.range !== range || !Cache.bitmapFont) {
        const fontFace = document.fonts.values().find(f => f.family === selectedFont);
        if (!fontFace) throw new Error(`Unknown font ${selectedFont}`)

        await fontFace.load();

        Cache.fontName = selectedFont;
        Cache.fontSize = fontSize;
        Cache.range = range;
        Cache.bitmapFont = Bitmap.convertFontToBitmap(selectedFont, fontSize, range);
    }

    return Cache.bitmapFont
}

async function refreshPreview() {
    const text = document.getElementById("text-field").value;
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseInt(document.getElementById("size-field").value);
    const range = document.getElementById("range-select").value;

    const bitmapFont = await loadFont(selectedFont, fontSize, FontRanges[range] || FontRanges.default);
    Drawer.setFont(bitmapFont);

    Context.clearRect(0, 0, Canvas.width, Canvas.height);

    const boundary = Drawer.calcTextBoundaries(text);
    Drawer.setPosition((Canvas.width - boundary.width) / 2, Canvas.height / 2);
    Drawer.print(text);
}

for (const fontName of BuiltinFonts) {
    addFont(fontName);
}

for (const key of Object.keys(FontRanges)) {
    const option = document.createElement("option");
    option.setAttribute("value", key)
    option.textContent = key;
    document.getElementById("range-select").appendChild(option);
}


document.getElementById("text-field").addEventListener("keyup", () => refreshPreview());
document.getElementById("size-field").addEventListener("change", () => refreshPreview());
document.getElementById("font-select").addEventListener("change", () => refreshPreview());
document.getElementById("range-select").addEventListener("change", () => refreshPreview());

document.getElementById("upload-font").addEventListener("click", () => uploadFont());
document.getElementById("get-font").addEventListener("click", () => downloadFont());
document.getElementById("get-all-fonts").addEventListener("click", () => downloadAllFonts());

refreshPreview().catch((e) => console.error(e));
