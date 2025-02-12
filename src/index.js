// Main application code
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as FileUtils from "./utils/file.js"
import * as Bitmap from "./bitmap.js"

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
    "default": generateString(' ', '~'),
    "russian": generateString(' ', '~') + generateString('А', 'Я') + generateString('а', 'я') + "ёЁ",
}

function generateString(from, to) {
    return new Array(to.charCodeAt() - from.charCodeAt() + 1)
        .fill(0)
        .map((_, i) => String.fromCharCode(from.charCodeAt() + i))
        .join("");
}

function capitalize(str) {
    function isDigit(char) {
        return char >= '0' && char <= '9';
    }

    return str.split(" ")
        .map(s => s.replaceAll(/[^A-Za-z0-9]/g, ""))
        .filter(s => s.length)
        .map(s => /\d+/.test(s) ? s : `${s[0].toUpperCase()}${s.slice(1)}`)
        .reduce((prev, cur) => {
            if ((!prev || isDigit(prev.at(-1))) && isDigit(cur[0])) {
                prev += "_";
            }
            prev += cur;

            return prev;
        }, "")
}

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
    }

    document.fonts.add(font);

    UserFonts.push(font.family);
    document.getElementById("upload-font").file = undefined;


    const fontRadio = document.createElement('input');
    fontRadio.type = 'radio';
    fontRadio.name = 'font';
    fontRadio.value = font.family;

    const fontLabel = document.createElement('label');
    fontLabel.textContent = font.family;

    const fontForm = document.getElementById("fontForm");
    fontForm.appendChild(fontRadio);
    fontForm.appendChild(fontLabel);
    fontForm.appendChild(document.createElement('br'));
}

function downloadFont() {
    const selectedFont = getSelectedFont();
    const fontSize = Number.parseInt(document.getElementById('sizefield').value);

    downloadFontImpl(selectedFont, fontSize);
}

function downloadAllFonts() {
    for (const fontName of BuiltinFonts.concat(UserFonts))
        for (const size of [9, 12, 18, 24]) {
            downloadFontImpl(fontName, size);
        }
}

function downloadFontImpl(selectedFont, fontSize) {
    const font = Bitmap.convertFontToBitmap(selectedFont, fontSize, FontRanges.default);
    const fontName = capitalize(font.name);

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

    FileUtils.saveFile(result, `${fontName}.h`)
}

function getSelectedFont() {
    return document.getElementById("fontForm").elements["font"].value;
}

function refreshPreview() {
    const text = document.getElementById("textfield").value;
    const size = Number.parseInt(document.getElementById("sizefield").value);
    const font = getSelectedFont();


    const preview = document.getElementById("preview");
    preview.style.fontFamily = font;
    preview.style.fontSize = `${size}px`;
    preview.textContent = text;
}

document.getElementById("textfield").addEventListener("keyup", () => refreshPreview());
document.getElementById("sizefield").addEventListener("change", () => refreshPreview());
document.getElementById("fontForm").addEventListener("change", () => refreshPreview());

document.getElementById("upload-font").addEventListener("click", () => uploadFont());
document.getElementById("get-font").addEventListener("click", () => downloadFont());
document.getElementById("get-all-fonts").addEventListener("click", () => downloadAllFonts());

refreshPreview();