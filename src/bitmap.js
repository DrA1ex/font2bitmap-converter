// Bitmap generation
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import {PackedImageWriter} from "./misc/image_writer.js";
import * as GlyphUtils from "./utils/glyph.js";

class Font {
    name;
    bpp;
    buffer;
    glyphs;
    codeFrom;
    codeTo;
    advanceY;
}

/**
 * Converts given font with specified parameters to bitmap and stores glyphs & buffer data.
 *
 * @param {string} fontName - Name of the font.
 * @param {Object} fontSize - Font size in px
 * @param {string} charSet - String of characters in this font range.
 * @param {number} [bpp=1]- Bits per pixel (1, 2, 4, 8)
 * @param {number} [dpi=222]- Screen DPI
 * @returns {Font} - A Font object representing all glyphs with their bitmapped data.
 */
export function convertFontToBitmap(
    fontName, fontSize, {charSet, bpp = 1, dpi = 222}
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

    for (let charCode = codeFrom; charCode <= codeTo; charCode++) {
        if (!codesSet.has(charCode)) {
            glyphs.push(new GlyphUtils.Glyph());
            continue;
        }

        const char = String.fromCharCode(charCode);
        const metrics = context.measureText(char);

        const glyph = GlyphUtils.createGlyph(char, charCode, metrics, buffer.length);
        glyphs.push(glyph);

        configureCanvas(canvas, context, fontName, correctedFontSize, glyph);
        const {width: canvasWidth, height: canvasHeight} = canvas;

        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.fillText(char, 0, 0);

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

    document.body.removeChild(canvas);

    const result = new Font();
    result.name = `${fontName} ${fontSize}pt`;
    result.bpp = bpp;
    result.buffer = Uint8Array.from(buffer);
    result.glyphs = glyphs;
    result.codeFrom = codeFrom;
    result.codeTo = codeTo;
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

    return {canvas, context};
}

function configureCanvas(canvas, context, fontName, fontSize, glyph) {
    canvas.width = glyph.width;
    canvas.height = glyph.height;

    context.font = `${fontSize}px ${fontName}`;
    context.textBaseline = "top";
    context.textRendering = "geometricPrecision";
}
