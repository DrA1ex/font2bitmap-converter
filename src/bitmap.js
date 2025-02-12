
// Bitmap generation
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


class Glyph {
    offset = 0;
    width = 0;
    height = 0;
    advanceX = 0;
    offsetX = 0;
    offsetY = 0;
}

class Font {
    name;
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
 * @param {Object} fontParameters - Details about the font properties (e.g., input font size).
 * @param {string} charSet - String of characters in this font range.
 * @returns {Font} - A Font object representing all glyphs with their bitmapped data.
 */
export function convertFontToBitmap(fontName, fontSize, charSet, dpi = 222) {
    const glyphs = [];
    const buffer = [];
    let bufferOffset = 0;

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

    const correctedFontSize = (fontSize * dpi) / 96;

    const codes = Array.from(charSet).map(c => c.charCodeAt(0))
        .sort((a, b) => a > b);

    const codeFrom = codes[0];
    const codeTo = codes.at(-1);

    const codesSet = new Set(codes);

    for (let i = codeFrom; i <= codeTo; i++) {
        if (!codesSet.has(i)) {
            glyphs.push(new Glyph());
            continue;
        }

        const char = String.fromCharCode(i);

        // Measure character dimensions
        const metrics = context.measureText(char);

        const width = Math.max(1, Math.ceil(metrics.width));
        const height = Math.max(1, Math.ceil(Math.abs(metrics.actualBoundingBoxAscent)
            + Math.abs(metrics.actualBoundingBoxDescent)));

        // Adjust the canvas size if necessary
        canvas.width = width;
        canvas.height = height;

        context.imageSmoothingEnabled = false;
        context.font = `${correctedFontSize}px ${fontName}`;
        context.textBaseline = "top";
        context.textRendering = "geometricPrecision";

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillText(char, 0, 0);

        const imageData = context.getImageData(0, 0, width, height);
        const bits = [];
        let rowByte = 0;
        let bitIndex = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];

                if (alpha > 0) {
                    rowByte |= 1 << (7 - bitIndex);
                }

                bitIndex++;
                if (bitIndex === 8) {
                    bits.push(rowByte);
                    rowByte = 0;
                    bitIndex = 0;
                }
            }
        }

        // Align to 8 bits if glyph isn't complete
        if (bitIndex > 0) {
            bits.push(rowByte);
            rowByte = 0;
            bitIndex = 0;
        }

        const glyphBuffer = Uint8Array.from(bits);
        buffer.push(...glyphBuffer);

        const glyph = new Glyph();
        glyph.offset = bufferOffset;
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


        bufferOffset += glyphBuffer.length;
    }

    document.body.removeChild(canvas);

    const result = new Font();
    result.name = `${fontName} ${fontSize}pt`;
    result.buffer = Uint8Array.from(buffer);
    result.glyphs = glyphs;
    result.codeFrom = codeFrom;
    result.codeTo = codeTo;
    result.advanceY = Math.ceil(correctedFontSize * 1.2);

    return result;
}
