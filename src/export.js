// Export implementation
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as CommonUtils from "./utils/common.js";
import * as FileUtils from "./utils/file.js";
import * as FontUtils from "./utils/font.js";

export async function exportFont(family, size, range, exportFormat) {
    const font = await FontUtils.loadFont(family, size, range)
    const fontKey = CommonUtils.capitalize(font.name);

    const placeholders = (str, glyph = null) => replacePlaceholders(str, font, fontKey, glyph)

    let result = placeholders(exportFormat.header);
    result += "\n";

    result += placeholders(exportFormat.declarationBitmaps);
    result += "\n";

    let rowSize = 0;
    for (let i = 0; i < font.buffer.byteLength; ++i) {
        const s = `${CommonUtils.toHex(font.buffer[i])}, `;
        if (rowSize + s.length >= exportFormat.maxRowSize) {
            result += "\n";
            rowSize = 0;
        }

        if (rowSize === 0) {
            result += exportFormat.align;
            rowSize += exportFormat.align.length;
        }

        rowSize += s.length;
        result += s;
    }

    if (rowSize > 0) {
        result += "\n";
    }

    result += `};\n\n`

    result += placeholders(exportFormat.declarationGlyphs);
    result += "\n";
    for (let i = 0; i < font.glyphs.length; i++) {
        const glyph = font.glyphs[i];

        result += exportFormat.align;
        result += placeholders(exportFormat.entryGlyph, glyph);
        result += placeholders(exportFormat.commentGlyph, glyph);
        result += "\n";
    }

    result += `};\n\n`

    result += placeholders(exportFormat.declarationsFont);
    result += "\n";

    const fontTotalSize = exportFormat.size(font)
    result += `\n// Total size: ${fontTotalSize} bytes\n`

    FileUtils.saveFile(result, `${fontKey}.h`, "text/x-c")
}


function replacePlaceholders(str, font, fontKey, glyph = null) {
    if (str instanceof Array) {
        const mapped = str.map(v => replacePlaceholders(v, font, fontKey, glyph));
        return mapped.join("\n");
    }

    let result = str.replaceAll("%fontKey%", fontKey)
        .replaceAll("%fontDisplayName%", font.name)
        .replaceAll("%codeFrom%", font.codeFrom)
        .replaceAll("%codeTo%", font.codeTo)
        .replaceAll("%advanceY%", font.advanceY);

    if (glyph) {
        result = result.replaceAll("%offset%", glyph.offset)
            .replaceAll("%width%", glyph.width)
            .replaceAll("%height%", glyph.height)
            .replaceAll("%advanceX%", glyph.advanceX)
            .replaceAll("%offsetX%", glyph.offsetX)
            .replaceAll("%offsetY%", glyph.offsetY)
            .replaceAll("%charCode%", glyph.charCode ? CommonUtils.toHex(glyph.charCode) : "")
            .replaceAll("%char%", glyph.char || "");
    }

    return result;
}