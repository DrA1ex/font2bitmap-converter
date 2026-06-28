// Bitmap font drawer
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as CommonUtils from "./utils/common";

export class TextDrawer {
    /** @type {CanvasRenderingContext2D} **/
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

    /** @returns {import("./bitmap").Font} */
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

            const glyph = this._glyphByCode(ch.charCodeAt(0));
            if (!glyph) continue;

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

    drawMetrics(text, x, y) {
        const font = this.font();
        let offsetX = x;
        let offsetY = y;

        this.#ctx.save();

        let lineCharIndex = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const code = ch.charCodeAt(0);

            if (ch === '\n') {
                this.#ctx.fillStyle = "red";
                this.#ctx.fillRect(offsetX, offsetY - 2, 4, 4);

                offsetX = x;
                offsetY += font.advanceY * this.#scaleY;
                lineCharIndex = 0;
            } else {
                const glyph = this._glyphByCode(code);
                if (!glyph) continue;

                const scaleX = this.#scaleX;
                const scaleY = this.#scaleY;

                const glyphWidth = glyph.width * scaleX;
                const glyphHeight = glyph.height * scaleY;

                const glyphLeft = offsetX + glyph.offsetX * scaleX;
                const glyphRight = glyphLeft + glyphWidth;
                const glyphTop = offsetY + glyph.offsetY * scaleY;
                const glyphBottom = glyphTop + glyphHeight;

                this.#ctx.fillStyle = "red";
                this.#ctx.fillRect(glyphLeft, glyphTop, devicePixelRatio, glyphHeight);

                this.#ctx.fillStyle = "blue";
                this.#ctx.fillRect(glyphRight, glyphTop, devicePixelRatio, glyphHeight);

                this.#ctx.fillStyle = "green";
                this.#ctx.fillRect(offsetX, lineCharIndex % 2 === 0 ? glyphBottom : glyphTop,
                    glyph.advanceX * scaleX, devicePixelRatio);

                offsetX += glyph.advanceX * scaleX;
                ++lineCharIndex;
            }
        }

        this.#ctx.restore();
    }

    drawPixelGrid(originX, originY) {
        const left = 0;
        const top = 0;
        const right = this.#ctx.canvas.width;
        const bottom = this.#ctx.canvas.height;
        const dotStep = 10 * devicePixelRatio;
        const dashStep = 50 * devicePixelRatio;
        const firstDotX = originX + Math.floor((left - originX) / dotStep) * dotStep;
        const firstDotY = originY + Math.floor((top - originY) / dotStep) * dotStep;
        const firstDashX = originX + Math.floor((left - originX) / dashStep) * dashStep;
        const firstDashY = originY + Math.floor((top - originY) / dashStep) * dashStep;

        this.#ctx.save();

        this.#ctx.fillStyle = "rgba(255, 0, 0, 0.75)";
        for (let y = firstDotY; y <= bottom; y += dotStep) {
            for (let x = firstDotX; x <= right; x += dotStep) {
                this.#ctx.fillRect(Math.round(x), Math.round(y), devicePixelRatio, devicePixelRatio);
            }
        }

        this.#ctx.strokeStyle = "rgba(0, 64, 255, 0.65)";
        this.#ctx.lineWidth = devicePixelRatio;
        this.#ctx.setLineDash([3 * devicePixelRatio, 3 * devicePixelRatio]);

        for (let x = firstDashX; x <= right; x += dashStep) {
            this.#ctx.beginPath();
            this.#ctx.moveTo(Math.round(x) + 0.5, top);
            this.#ctx.lineTo(Math.round(x) + 0.5, bottom);
            this.#ctx.stroke();
        }

        for (let y = firstDashY; y <= bottom; y += dashStep) {
            this.#ctx.beginPath();
            this.#ctx.moveTo(left, Math.round(y) + 0.5);
            this.#ctx.lineTo(right, Math.round(y) + 0.5);
            this.#ctx.stroke();
        }

        this.#ctx.restore();
    }

    _drawChar(ch) {
        const glyph = this._glyphByCode(ch.charCodeAt(0));
        if (!glyph) return;

        const font = this.font();
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

    _glyphByCode(code) {
        const font = this.font();

        if (font.compact) {
            return font.glyphs.find(g => g.charCode === code) || null;
        }

        if (code < font.codeFrom || code > font.codeTo) return null;

        return font.glyphs[code - font.codeFrom] || null;
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
