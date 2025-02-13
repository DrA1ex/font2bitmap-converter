// Bitmap font drawer
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import {getColorComponents} from "./utils/common";
import * as CommonUtils from "./utils/common";

export class TextDrawer {
    #ctx = null;
    #color = 0xffffffff;
    #backgroundColor = 0x00000000;
    #font = null;
    #positionX = 0;
    #cursorX = 0;
    #cursorY = 0;
    #scaleX = 1;
    #scaleY = 1;

    #bpp = null;
    #glyphMask = null;

    constructor(ctx) {
        this.#ctx = ctx;
    }

    setFont(font) {
        this.#font = font;
        this.#glyphMask = (1 << font.bpp) - 1;
        this.#bpp = font.bpp || 1;
    }

    font() {
        if (!this.#font) throw new Error("Font not set");
        return this.#font;
    }

    setColor(color) {
        this.#color = color;
    }

    setBackgroundColor(color) {
        this.#backgroundColor = color;
    }

    setPosition(x, y) {
        this.#cursorX = this.#positionX = Math.trunc(x);
        this.#cursorY = Math.trunc(y);
    }

    setFontScale(scaleX, scaleY) {
        this.#scaleX = Math.max(1, scaleX);
        this.#scaleY = Math.max(1, scaleY);
    }

    print(text) {
        // Draw background if not transparent
        if ((this.#backgroundColor >>> 24) & 0xff) {
            const b = this.calcTextBoundaries(text);
            this._fillRect(
                b.left,
                b.top,
                b.right - b.left,
                b.bottom - b.top,
                this.#backgroundColor
            );
        }

        // Draw text
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\n') {
                this.breakLine();
            } else {
                this._drawChar(ch);
            }
        }
    }

    breakLine() {
        this.#cursorX = this.#positionX;
        this.#cursorY += this.font().advanceY * this.#scaleY;
    }

    calcTextBoundaries(text) {
        const boundary = {
            left: Infinity,
            top: Infinity,
            right: -Infinity,
            bottom: -Infinity
        };

        let cursorX = this.#cursorX;
        let cursorY = this.#cursorY;
        const font = this.font();
        const scaleX = this.#scaleX;
        const scaleY = this.#scaleY;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\n') {
                cursorY += font.advanceY * scaleY;
                cursorX = this.#positionX;
                continue;
            }

            const code = ch.charCodeAt(0);
            if (code < font.codeFrom || code > font.codeTo) continue;

            const glyph = font.glyphs[code - font.codeFrom];
            const left = cursorX + glyph.offsetX * scaleX;
            const top = cursorY + glyph.offsetY * scaleY;
            const right = left + glyph.width * scaleX;
            const bottom = top + glyph.height * scaleY;

            boundary.left = Math.min(boundary.left, left);
            boundary.top = Math.min(boundary.top, top);
            boundary.right = Math.max(boundary.right, right);
            boundary.bottom = Math.max(boundary.bottom, bottom);

            cursorX += glyph.advanceX * scaleX;
        }

        // Handle empty text case
        if (boundary.left === Infinity) {
            boundary.left = boundary.right = this.#cursorX;
            boundary.top = boundary.bottom = this.#cursorY;
        }


        boundary.width = boundary.right - boundary.left;
        boundary.height = boundary.bottom - boundary.top;

        return boundary;
    }

    _drawChar(ch) {
        const font = this.font();
        const code = ch.charCodeAt(0);
        if (code < font.codeFrom || code > font.codeTo) return;

        const glyph = font.glyphs[code - font.codeFrom];
        const scaleX = this.#scaleX;
        const scaleY = this.#scaleY;

        const offsetX = this.#cursorX + glyph.offsetX * scaleX;
        const offsetY = this.#cursorY + glyph.offsetY * scaleY;

        for (let gy = 0; gy < glyph.height; gy++) {
            for (let gx = 0; gx < glyph.width; gx++) {
                const index = (gy * glyph.width + gx) * this.#bpp;
                const byteOffset = glyph.offset + Math.floor(index / 8);
                const bitOffset = (8 - this.#bpp) - (index % 8);

                const pixel = (font.buffer[byteOffset] >> bitOffset) & this.#glyphMask;
                if (pixel) {
                    const x = offsetX + gx * scaleX;
                    const y = offsetY + gy * scaleY;
                    const color = this._mix(0xff00000000, this.#color, pixel / this.#glyphMask)
                    this._fillRect(x, y, scaleX, scaleY, color);
                }
            }
        }

        this.#cursorX += glyph.advanceX * scaleX;
    }

    _fillRect(x, y, w, h, color) {
        const alpha = (color >>> 24) & 0xff;
        if (alpha === 0) return;

        this.#ctx.fillStyle = this._toRGBA(color);
        this.#ctx.fillRect(x, y, w, h);
    }

    _toRGBA(color) {
        const [a, r, g, b] = CommonUtils.getColorComponents(color)
        return `rgba(${r},${g},${b},${a / 255})`;
    }

    _mix(colorA, colorB, factor) {
        if (factor === 0) return colorA;
        if (factor === 1) return colorB;

        const components1 = CommonUtils.getColorComponents(colorA);
        const components2 = CommonUtils.getColorComponents(colorB);

        const result = new Array(components1.length);
        for (let i = 0; i < components1.length; i++) {
            const a = components1[i];
            const b = components2[i];

            result[i] = a + (b - a) * factor;
        }

        return CommonUtils.toColor(result);
    }
}
