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
    if (exportFormat.extended) {
        validateExtendedFontMetrics(font, exportFormat.metricAbi || exportFormat.abiProfile);
    }
    if (exportFormat.kind === "typer") validateTyperFont(font);
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
    result += renderGlyphTable(font, exportFormat, placeholders);
    result += "};\n\n";

    if (exportFormat.kind === "custom" || exportFormat.kind === "typer") {
        result += renderRangeMetadata(font, exportFormat, placeholders);
    }

    result += placeholders(exportFormat.declarationsFont) + "\n";
    result += renderMemorySummary(font, exportFormat);

    return {content: result, fontKey};
}


function renderGlyphTable(font, exportFormat, placeholders) {
    const includeName = exportFormat.commentGlyph?.includes("%name%") ?? false;
    const rows = font.glyphs.map((glyph, glyphIndex) => {
        const present = glyphPresent(font, glyphIndex);
        const initializer = present
            ? placeholders(exportFormat.entryGlyph, glyph)
            : placeholders(exportFormat.emptyGlyph, glyph);
        const code = CommonUtils.toHex(glyph.charCode);
        const char = `'${escapeCommentChar(glyph.char)}'`;
        const name = present ? (glyph.name || "n/a") : "not exported";
        return {initializer, code, char, name};
    });

    const initializerWidth = Math.max(0, ...rows.map(row => row.initializer.length));
    const codeWidth = Math.max(0, ...rows.map(row => row.code.length));
    const charWidth = Math.max(0, ...rows.map(row => row.char.length));

    let result = "";
    for (const row of rows) {
        result += exportFormat.align;
        result += row.initializer.padEnd(initializerWidth);
        result += ` // ${row.code.padEnd(codeWidth)}  ${row.char.padEnd(charWidth)}`;
        if (includeName) result += `  ${row.name}`;
        else if (row.name === "not exported") result += `  ${row.name}`;
        result += "\n";
    }
    return result;
}

function renderRangeMetadata(font, exportFormat, placeholders) {
    let result = "";
    if (exportFormat.kind === "custom") {
        result += "// Font.flags stores the exact glyph layout type.\n";
    }
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
    if (exportFormat.kind === "custom" || exportFormat.kind === "typer") result += ", sizeof(Glyph) = 16";
    result += ")\n";
    result += `// Ranges: ${memory.rangeCount} (${memory.rangeBytes} bytes`;
    if (exportFormat.kind === "custom" || exportFormat.kind === "typer") result += `, sizeof(GlyphRange) = ${exportFormat.rangeAbiSize}`;
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
    if (exportFormat.kind === "typer") fontKey += "Typer";
    else if (exportFormat.extended) fontKey += "Extended";

    const mode = rangeModeFromFlags(font.flags);
    if (exportFormat.kind === "typer") {
        // Typer is intrinsically a compact BMP ABI; repeating Compact16 in the
        // exported symbol/file name would add no useful information.
    } else if (exportFormat.abiProfile === "compact16") {
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
        .replaceAll("%advanceY%", font.advanceY)
        .replaceAll("%ascent%", font.metrics?.ascent ?? 0)
        .replaceAll("%descent%", font.metrics?.descent ?? 0)
        .replaceAll("%inkTop%", font.metrics?.inkTop ?? 0)
        .replaceAll("%inkBottom%", font.metrics?.inkBottom ?? 0);

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


function validateExtendedFontMetrics(font, metricAbi) {
    const metrics = font.metrics;
    if (!metrics) throw new RangeError("Extended export requires font metrics");

    const compact = metricAbi === "compact16";
    const unsignedMax = compact ? 0xff : 0xffff;
    const signedMin = compact ? -0x80 : -0x8000;
    const signedMax = compact ? 0x7f : 0x7fff;

    for (const name of ["ascent", "descent"]) {
        const value = metrics[name];
        if (!Number.isInteger(value) || value < 0 || value > unsignedMax) {
            const type = compact ? "uint8_t" : "uint16_t";
            throw new RangeError(`Font metric ${name}=${value} does not fit ${type} Extended ABI`);
        }
    }
    for (const name of ["inkTop", "inkBottom"]) {
        const value = metrics[name];
        if (!Number.isInteger(value) || value < signedMin || value > signedMax) {
            const type = compact ? "int8_t" : "int16_t";
            throw new RangeError(`Font metric ${name}=${value} does not fit ${type} Extended ABI`);
        }
    }
    if (metrics.inkTop > metrics.inkBottom) {
        throw new RangeError("Font metric inkTop must not exceed inkBottom");
    }
}


function validateTyperFont(font) {
    const assertInt = (value, min, max, label) => {
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new RangeError(`${label}=${value} does not fit Typer ABI range ${min}..${max}`);
        }
    };

    assertInt(font.codeFrom, 0, 0xffff, "codeFrom");
    assertInt(font.codeTo, 0, 0xffff, "codeTo");
    assertInt(font.rangeCount, 0, 0xffff, "rangeCount");
    assertInt(font.glyphCount, 0, 0xffff, "glyphCount");
    assertInt(font.advanceY, -0x8000, 0x7fff, "advanceY");

    for (let index = 0; index < font.glyphs.length; ++index) {
        const glyph = font.glyphs[index];
        assertInt(glyph.advanceX, -0x8000, 0x7fff, `glyph[${index}].advanceX`);
    }
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

    let result = "";
    for (const char of value) {
        const code = char.codePointAt(0);
        if (char === "\\") result += "\\\\";
        else if (char === "'") result += "\\'";
        else if (char === "\n") result += "\\n";
        else if (char === "\r") result += "\\r";
        else if (char === "\t") result += "\\t";
        else if (code < 0x20 || code === 0x7f) {
            result += `\\x${code.toString(16).padStart(2, "0")}`;
        } else result += char;
    }
    return result;
}
