// Bitmap generation
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


class Glyph {
    char = null;
    charCode = null;
    offset = 0;
    width = 0;
    height = 0;
    advanceX = 0;
    offsetX = 0;
    offsetY = 0;
}

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
    let bytesOffset = 0;

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

    document.body.appendChild(canvas);

    const correctedFontSize = Math.floor((fontSize * dpi) / 96);

    const codes = Array.from(charSet).map(c => c.charCodeAt(0));
    codes.sort((a, b) => a - b);

    const codeFrom = codes[0];
    const codeTo = codes.at(-1);

    const codesSet = new Set(codes);

    for (let charCode = codeFrom; charCode <= codeTo; charCode++) {
        if (!codesSet.has(charCode)) {
            glyphs.push(new Glyph());
            continue;
        }

        const char = String.fromCharCode(charCode);

        // Measure character dimensions
        const metrics = context.measureText(char);

        const width = Math.max(1, Math.ceil(metrics.width));
        const height = Math.max(1, Math.ceil(Math.abs(metrics.actualBoundingBoxAscent)
            + Math.abs(metrics.actualBoundingBoxDescent)));

        // Adjust the canvas size
        canvas.width = width;
        canvas.height = height;

        context.font = `${correctedFontSize}px ${fontName}`;
        context.textBaseline = "top";
        context.textRendering = "geometricPrecision";

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillText(char, 0, 0);

        const imageData = context.getImageData(0, 0, width, height);

        const state = {
            bpp,
            bits: [],
            rowByte: 0,
            bitIndex: 0
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];

                writePixel(alpha, state);
            }
        }

        // Align to 8 bits if glyph isn't complete
        if (state.bitIndex > 0) {
            state.bits.push(state.rowByte);
            state.rowByte = 0;
            state.bitIndex = 0;
        }

        const glyphBuffer = Uint8Array.from(state.bits);
        buffer.push(...glyphBuffer);

        const glyph = new Glyph();
        glyph.char = char;
        glyph.charCode = charCode;
        glyph.offset = bytesOffset;
        glyph.width = width;
        glyph.height = height;
        glyph.advanceX = Math.ceil(metrics.width);
        glyph.offsetX = Math.floor(metrics.actualBoundingBoxLeft);
        glyph.offsetY = Math.floor(metrics.alphabeticBaseline);

        // Debug rendering
        context.fillStyle = "red";
        context.fillRect(glyph.offsetX, 0, 1, height);
        context.fillRect(0, -glyph.offsetY, width, 1);

        glyphs.push(glyph)


        bytesOffset += glyphBuffer.length;
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

function writePixel(input, state) {
    const k = state.bpp > 1 ? Math.floor(0xff / 2 ** state.bpp + 1) : 128;
    const value = Math.floor(input / k);

    state.rowByte |= value << ((8 - state.bpp) - state.bitIndex);

    // TODO: To support 'odd' bpp need to handle bitIndex >= 8 with carry additional bits
    state.bitIndex += state.bpp;
    if (state.bitIndex === 8) {
        state.bits.push(state.rowByte);
        state.rowByte = 0;
        state.bitIndex = 0;
    }
}
