// Bitmap generation
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import {PackedImageWriter} from "./misc/image_writer.js";
import * as GlyphUtils from "./utils/glyph.js";
import * as FontUtils from "./utils/font";
import * as CommonUtils from "./utils/common";

// opentype requires global exports object when enabling hinting.
// However, there is no exports in ES6 modules
// So, create empty object by hand
window.exports = {};

class Font {
    name;
    bpp;
    buffer;
    glyphs;
    codeFrom;
    codeTo;
    advanceY;
}


export class Glyph {
    char = null;
    charCode = null;
    name = null;
    offset = 0;
    width = 0;
    height = 0;
    advanceX = 0;
    offsetX = 0;
    offsetY = 0;
}


/**
 * Converts given font with specified parameters to bitmap and stores glyphs & buffer data.
 *
 * @typedef {import("opentype.js").Font} OpentypeFont
 *
 * @param {OpentypeFont} fontFace - Name of the font.
 * @param {string} fontName - Name of the font.
 * @param {Object} fontSize - Font size in px
 * @param {string} charSet - String of characters in this font range.
 * @param {number} [bpp=1]- Bits per pixel (1, 2, 4, 8)
 * @param {number} [dpi=222]- Screen DPI
 * @returns {Font} - A Font object representing all glyphs with their bitmapped data.
 */
export function convertFontToBitmap(
    fontFace, fontName, fontSize, {charSet, bpp = 1, dpi = 222}
) {
    bpp = Math.max(1, Math.min(8, bpp - bpp % 2));

    const glyphs = [];
    const buffer = [];

    const {canvas, context} = createCanvas();
    document.body.appendChild(canvas);

    const correctedFontSize = Math.floor((fontSize * dpi) / 96);

    const codes = Array.from(charSet).map(c => c.charCodeAt(0));
    codes.sort((a, b) => a - b);

    const codeFrom = codes[0];
    const codeTo = codes.at(-1);

    const codesSet = new Set(codes);

    let missingGlyphs = 0;

    for (let charCode = codeFrom; charCode <= codeTo; charCode++) {
        if (!codesSet.has(charCode)) {
            glyphs.push(new Glyph());
            continue;
        }

        const char = String.fromCharCode(charCode);
        const fontGlyph = fontFace.charToGlyph(char);

        const metrics = FontUtils.getMetrics(fontFace, char, correctedFontSize);
        if (!metrics) {
            ++missingGlyphs
            if (missingGlyphs < 50) {
                console.warn(`Symbol '${char}' (${CommonUtils.toHex(charCode)}) not supported by font "${fontName}"`);
            } else if (missingGlyphs === 50) {
                console.warn(`Too much missing glyphs. Next warnings will be skipped.`);
            }

            glyphs.push(new Glyph());
            continue;
        }

        const glyph = new Glyph();
        glyph.char = char;
        glyph.charCode = charCode;
        glyph.name = fontGlyph.name;
        glyph.offset = buffer.length;
        glyph.width = metrics.width;
        glyph.height = metrics.height;
        glyph.advanceX = metrics.advanceWidth;
        glyph.offsetX = metrics.xMin;
        glyph.offsetY = -metrics.yMax;
        glyphs.push(glyph);

        const canvasWidth = canvas.width = glyph.width;
        const canvasHeight = canvas.height = glyph.height;

        context.clearRect(0, 0, canvasWidth, canvasHeight);
        fontGlyph.getPath(
            0, metrics.yMax, correctedFontSize, {hinting: true}, fontFace
        ).draw(context);

        const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);

        const {
            emptyLeft, emptyRight,
            emptyTop, emptyBottom
        } = GlyphUtils.calculateEmptySpace(imageData, canvasWidth, canvasHeight, bpp);

        GlyphUtils.trimGlyph(glyph, emptyLeft, emptyRight, emptyTop, emptyBottom);

        const startX = emptyLeft;
        const endX = startX + glyph.width;

        const startY = emptyTop;
        const endY = startY + glyph.height;

        const writer = new PackedImageWriter(bpp);
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
                writer.write(alpha)
            }
        }

        // Align to 8 bits if glyph isn't complete
        writer.flush();

        const glyphBuffer = writer.byteArray();
        Array.prototype.push.apply(buffer, glyphBuffer);

        // Debug rendering
        context.fillStyle = "red";
        context.fillRect(glyph.offsetX, 0, 1, canvasHeight);
        context.fillRect(0, -glyph.offsetY, canvasWidth, 1);
    }

    if (missingGlyphs > 0) {
        console.warn(`Font ${fontName} missing ${missingGlyphs} glyph(s)!`);
    }

    document.body.removeChild(canvas);

    const firstGlyphIndex = glyphs.findIndex(g => g.charCode !== null);
    const lastGlyphIndex = glyphs.findLastIndex(g => g.charCode !== null);

    if (firstGlyphIndex === -1) {
        const msg = `Font "${fontName}" doesn't contains any glyphs from selected range!`
        alert(msg);
        throw new Error(msg);
    }

    const missingGlyphsFromStart = firstGlyphIndex;
    const missingGlyphsFromEnd = glyphs.length - lastGlyphIndex - 1;

    glyphs.splice(lastGlyphIndex + 1)
    glyphs.splice(0, firstGlyphIndex);

    const result = new Font();
    result.name = `${fontName} ${fontSize}pt`;
    result.bpp = bpp;
    result.buffer = Uint8Array.from(buffer);
    result.glyphs = glyphs;
    result.codeFrom = codeFrom + missingGlyphsFromStart;
    result.codeTo = codeTo - missingGlyphsFromEnd;
    result.advanceY = Math.ceil(correctedFontSize * 1.2);

    return result;
}

function createCanvas() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
        willReadFrequently: true
    });

    // For debugging
    canvas.style.position = "absolute";
    canvas.style.right = "10px"
    canvas.style.top = "10px"
    canvas.style.border = "1px solid black";
    canvas.style.imageRendering = "pixelated";
    canvas.style.width = "100px";
    canvas.style.height = "auto";
    canvas.style.zIndex = "999";

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    return {canvas, context};
}
