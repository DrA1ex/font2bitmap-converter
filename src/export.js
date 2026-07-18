// C/C++ header export
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import * as CommonUtils from "./utils/common.js";
import * as FileUtils from "./utils/file.js";
import * as FontUtils from "./utils/font.js";
import {
    RangeMode,
    RangeModeLabel,
    rangeModeFromFlags,
    glyphPresent,
    formatCodePoint,
    validateFontAbi,
} from "./range.js";

export async function exportFont(family, size, options) {
    const font = await FontUtils.loadFont(family, size, options);
    const {content, fontKey} = renderFontHeader(font, options);
    FileUtils.saveFile(content, `${fontKey}.h`, "text/x-c");
    return {font, content, fontKey};
}

export function renderFontHeader(font, options) {
    const {format: exportFormat} = options;
    normalizeFontMetadata(font);
    validateFontAbi(font, exportFormat.abiProfile);
    const fontKey = createFontKey(font, options, exportFormat);

    const placeholders = (str, glyph = null, range = null) => replacePlaceholders(
        str,
        font,
        fontKey,
        glyph,
        range
    );

    let result = placeholders(exportFormat.header) + "\n";
    result += renderByteArray(
        placeholders(exportFormat.declarationBitmaps),
        font.buffer,
        exportFormat,
        {emptySentinel: true}
    );
    result += "\n";

    result += placeholders(exportFormat.declarationGlyphs) + "\n";
    for (let glyphIndex = 0; glyphIndex < font.glyphs.length; ++glyphIndex) {
        const glyph = font.glyphs[glyphIndex];
        result += exportFormat.align;
        if (glyphPresent(font, glyphIndex)) {
            result += placeholders(exportFormat.entryGlyph, glyph);
            result += placeholders(exportFormat.commentGlyph, glyph);
        } else {
            result += placeholders(exportFormat.emptyGlyph, glyph);
            result += ` // ${CommonUtils.toHex(glyph.charCode)} not exported`;
        }
        result += "\n";
    }
    result += "};\n\n";

    if (exportFormat.kind === "custom") {
        result += renderRangeMetadata(font, exportFormat, placeholders);
    }

    result += placeholders(exportFormat.declarationsFont) + "\n";
    result += renderMemorySummary(font, exportFormat);

    return {content: result, fontKey};
}

function renderRangeMetadata(font, exportFormat, placeholders) {
    let result = "// Font.flags stores the exact glyph layout type.\n";
    result += "// Each sorted record maps an inclusive Unicode range to a contiguous glyph-index interval.\n";

    if (font.ranges.length === 0) {
        result += "// This layout does not require an extension range table.\n\n";
        return result;
    }

    result += placeholders(exportFormat.declarationRanges) + "\n";
    for (const range of font.ranges) {
        result += exportFormat.align;
        result += placeholders(exportFormat.entryRange, null, range);
        result += renderRangeComment(range) + "\n";
    }
    result += "};\n\n";
    return result;
}

function renderRangeComment(range) {
    const glyphCount = range.codeTo - range.codeFrom + 1;
    const glyphTo = range.glyphOffset + glyphCount - 1;
    const codeSpan = range.codeFrom === range.codeTo
        ? formatCodePoint(range.codeFrom)
        : `${formatCodePoint(range.codeFrom)}-${formatCodePoint(range.codeTo)}`;
    const glyphSpan = glyphCount === 1
        ? `glyph[${range.glyphOffset}]`
        : `glyphs[${range.glyphOffset}..${glyphTo}]`;
    return ` // ${codeSpan} -> ${glyphSpan} (${glyphCount} ${glyphCount === 1 ? "glyph" : "glyphs"})`;
}

function renderMemorySummary(font, exportFormat) {
    const memory = exportFormat.memory(font);
    let result = "\n";
    result += `// Bitmap bytes: ${memory.bitmapBytes}\n`;
    result += `// Glyphs: ${memory.glyphCount} (${memory.glyphBytes} bytes`;
    if (exportFormat.kind === "custom") result += ", sizeof(Glyph) = 16";
    result += ")\n";
    result += `// Ranges: ${memory.rangeCount} (${memory.rangeBytes} bytes`;
    if (exportFormat.kind === "custom") result += `, sizeof(GlyphRange) = ${exportFormat.rangeAbiSize}`;
    result += ")\n";
    result += `// Total size: ${memory.dataBytes} bytes (bitmap + glyphs + ranges)\n`;
    if (font.missingCodePoints?.length > 0) {
        const missing = font.missingCodePoints.map(code => CommonUtils.toHex(code)).join(", ");
        result += `// Missing selected code points: ${missing}\n`;
    }
    return result;
}

function renderByteArray(declaration, bytes, format, {emptySentinel = false} = {}) {
    let result = declaration + "\n";
    let rowSize = 0;
    const exportedBytes = bytes.length === 0 && emptySentinel
        ? Uint8Array.of(0)
        : bytes;

    for (const byte of exportedBytes) {
        const value = `${CommonUtils.toHex(byte)}, `;
        if (rowSize > 0 && rowSize + value.length >= format.maxRowSize) {
            result += "\n";
            rowSize = 0;
        }

        if (rowSize === 0) {
            result += format.align;
            rowSize = format.align.length;
        }

        result += value;
        rowSize += value.length;
    }

    if (rowSize > 0) result += "\n";
    result += "};\n";
    return result;
}

function createFontKey(font, options, exportFormat) {
    let fontKey = CommonUtils.capitalize(font.name);
    if (options.bpp > 1) fontKey += `b${options.bpp}`;

    const mode = rangeModeFromFlags(font.flags);
    if (exportFormat.abiProfile === "compact16") {
        fontKey += "Compact16";
    } else if (mode === RangeMode.COMPACT) {
        fontKey += "Compact";
    } else if (mode === RangeMode.ASCII_FIRST) {
        fontKey += "AsciiFirst";
    }

    return fontKey;
}

function normalizeFontMetadata(font) {
    font.ranges ??= [];
    font.rangeCount = font.ranges.length;
    font.glyphCount = font.glyphs.length;
    font.bitmapSize = Math.max(1, font.buffer.byteLength);

    const mode = rangeModeFromFlags(font.flags);
    font.rangeMode = mode;
    font.rangeModeLabel = RangeModeLabel[mode];
}

function replacePlaceholders(str, font, fontKey, glyph = null, range = null) {
    if (Array.isArray(str)) {
        return str.map(value => replacePlaceholders(value, font, fontKey, glyph, range)).join("\n");
    }

    const rangePointer = font.ranges.length > 0 ? `${fontKey}Ranges` : "NULL";

    let result = str.replaceAll("%fontKey%", fontKey)
        .replaceAll("%fontDisplayName%", escapeCString(font.name))
        .replaceAll("%bpp%", font.bpp)
        .replaceAll("%flags%", CommonUtils.toHex(font.flags))
        .replaceAll("%rangeModeName%", font.rangeModeLabel)
        .replaceAll("%rangePointer%", rangePointer)
        .replaceAll("%rangeCount%", font.rangeCount)
        .replaceAll("%glyphCount%", font.glyphCount)
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
            .replaceAll("%charCode%", CommonUtils.toHex(glyph.charCode))
            .replaceAll("%char%", escapeCommentChar(glyph.char))
            .replaceAll("%name%", glyph.name || "n/a");
    }

    if (range) {
        result = result.replaceAll("%rangeCodeFrom%", CommonUtils.toHex(range.codeFrom))
            .replaceAll("%rangeCodeTo%", CommonUtils.toHex(range.codeTo))
            .replaceAll("%glyphOffset%", range.glyphOffset);
    }

    return result;
}

function escapeCString(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r");
}

function escapeCommentChar(value) {
    if (!value) return "";
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll("\t", "\\t");
}
