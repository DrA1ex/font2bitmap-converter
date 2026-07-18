// Bitmap font converter regression tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import opentype from "opentype.js";
import {createCanvas} from "@napi-rs/canvas";

import {MissingGlyphsError, convertFontToBitmap, resolveSelectedCodePoints} from "../src/bitmap.js";
import {ASCII_GLYPH_COUNT, RangeMode, glyphIndexForCode} from "../src/range.js";
import {FontRanges} from "../src/defs.js";

const {parse: parseOpenType} = opentype;

globalThis.document = {
    createElement(name) {
        if (name !== "canvas") throw new Error(`Unexpected element: ${name}`);
        return createCanvas(1, 1);
    },
};
globalThis.alert = message => { throw new Error(message); };

const fontBytes = await readFile(new URL("../fonts/Roboto-Regular.ttf", import.meta.url));
const fontBuffer = fontBytes.buffer.slice(
    fontBytes.byteOffset,
    fontBytes.byteOffset + fontBytes.byteLength
);
const face = parseOpenType(fontBuffer);
const jetBrainsBytes = await readFile(new URL("../fonts/JetBrainsMono-Regular.ttf", import.meta.url));
const jetBrainsBuffer = jetBrainsBytes.buffer.slice(
    jetBrainsBytes.byteOffset,
    jetBrainsBytes.byteOffset + jetBrainsBytes.byteLength
);
const jetBrainsFace = parseOpenType(jetBrainsBuffer);

test("all range resolves only representable cmap entries", () => {
    const codes = resolveSelectedCodePoints(face, FontRanges.all);
    assert.ok(codes.length > 500 && codes.length < 5000);
    assert.equal(codes.includes(0x0000), false);
    assert.equal(codes.includes(0x200b), false);
    assert.equal(codes.includes(0xfeff), false);
    assert.equal(codes.includes(0x0041), true);
});

test("all range remains available with Dense across large and surrogate gaps", () => {
    const selectedCodes = resolveSelectedCodePoints(jetBrainsFace, FontRanges.all);
    const font = convertFontToBitmap(jetBrainsFace, "JetBrainsMono", 6, {
        charSet: FontRanges.all,
        rangeMode: RangeMode.DENSE,
        bpp: 1,
        dpi: 96,
        dpiBase: 96,
        floorRasterSize: true,
    });

    assert.equal(font.codeFrom, selectedCodes[0]);
    assert.equal(font.codeTo, selectedCodes.at(-1));
    assert.equal(font.glyphCount, font.codeTo - font.codeFrom + 1);
    assert.ok(font.glyphCount > 65536);
    assert.match(font.warnings.join("\n"), /surrogate block/);

    const surrogateIndex = 0xd800 - font.codeFrom;
    assert.ok(surrogateIndex >= 0 && surrogateIndex < font.glyphCount);
    assert.equal(font.glyphs[surrogateIndex].present, false);
    assert.equal(font.glyphs[surrogateIndex].charCode, 0xd800);
});

test("Custom conversion preserves the original DPI sizing behavior", () => {
    const font = convertFontToBitmap(face, "Roboto", 12, {
        charSet: " fjÁ_",
        rangeMode: RangeMode.DENSE,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
    });

    const space = font.glyphs[0x20 - font.codeFrom];
    assert.equal(space.present, true);
    assert.equal(space.width, 0);
    assert.equal(space.height, 0);
    assert.ok(space.advanceX > 0);
    assert.equal(font.rasterSize, Math.floor(12 * 222 / 96));

    for (let index = 0; index < font.glyphs.length; ++index) {
        const glyph = font.glyphs[index];
        if (!glyph.present || glyph.width === 0 || glyph.height === 0) continue;

        const next = font.glyphs.slice(index + 1)
            .find(candidate => candidate.present && candidate.offset > glyph.offset);
        const end = next ? next.offset : font.buffer.byteLength;
        const expected = Math.ceil(glyph.width * glyph.height * font.bpp / 8);
        assert.equal(end - glyph.offset, expected, `packed size for ${glyph.char}`);
    }
});

test("Adafruit conversion preserves the original preview sizing behavior", () => {
    const font = convertFontToBitmap(face, "Roboto", 12, {
        charSet: "A",
        rangeMode: RangeMode.DENSE,
        bpp: 1,
        dpi: 141,
        dpiBase: 96,
        floorRasterSize: true,
    });
    assert.equal(font.rasterSize, Math.floor(12 * 141 / 96));
});

test("hinted path bounds preserve negative bearings instead of clipping", () => {
    const font = convertFontToBitmap(face, "Roboto", 9, {
        charSet: "fj",
        rangeMode: RangeMode.COMPACT,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
    });

    const j = font.glyphs.find(glyph => glyph.char === "j");
    assert.ok(j);
    assert.ok(j.width > 0 && j.height > 0);
    assert.ok(j.offsetX <= 0, `expected a non-positive j bearing, got ${j.offsetX}`);

    for (const glyph of font.glyphs) {
        assert.ok(glyph.offset >= 0 && glyph.offset <= font.buffer.byteLength);
        assert.ok(glyph.width >= 0 && glyph.height >= 0);
    }
});

test("ASCII first keeps direct ASCII indices and range-mapped extensions", () => {
    const chars = " !AZ~ЁАБВабвё";
    const font = convertFontToBitmap(face, "Roboto", 12, {
        charSet: chars,
        rangeMode: RangeMode.ASCII_FIRST,
        bpp: 2,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
    });

    assert.equal(font.rangeMode, RangeMode.ASCII_FIRST);
    assert.equal(font.glyphs.length, ASCII_GLYPH_COUNT + 8);
    assert.equal(font.glyphCount, font.glyphs.length);
    assert.equal(font.codeFrom, 0x20);
    assert.equal(font.codeTo, 0x451);
    assert.equal(font.rangeCount, 4);
    assert.deepEqual(font.ranges, [
        {codeFrom: 0x401, codeTo: 0x401, glyphOffset: 128},
        {codeFrom: 0x410, codeTo: 0x412, glyphOffset: 129},
        {codeFrom: 0x430, codeTo: 0x432, glyphOffset: 132},
        {codeFrom: 0x451, codeTo: 0x451, glyphOffset: 135},
    ]);

    for (const ch of chars) {
        const index = glyphIndexForCode(font, ch.codePointAt(0));
        assert.ok(index >= 0 && index < font.glyphs.length, `lookup for ${ch}`);
        assert.equal(font.glyphs[index].char, ch);
    }
});

test("fully compact mode emits supported glyphs and deterministic ranges", () => {
    const font = convertFontToBitmap(face, "Roboto", 12, {
        charSet: "AЖё",
        rangeMode: RangeMode.COMPACT,
        bpp: 4,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
    });

    assert.equal(font.glyphs.length, 3);
    assert.deepEqual(font.ranges, [
        {codeFrom: 0x41, codeTo: 0x41, glyphOffset: 0},
        {codeFrom: 0x416, codeTo: 0x416, glyphOffset: 1},
        {codeFrom: 0x451, codeTo: 0x451, glyphOffset: 2},
    ]);
    assert.equal(glyphIndexForCode(font, "A".codePointAt(0)), 0);
    assert.equal(glyphIndexForCode(font, "Ж".codePointAt(0)), 1);
    assert.equal(glyphIndexForCode(font, "ё".codePointAt(0)), 2);
});

test("Dense trims unsupported edge glyphs and stores real code-point bounds", () => {
    const font = convertFontToBitmap(face, "Roboto", 12, {
        charSet: "\u0001A\u007f",
        rangeMode: RangeMode.DENSE,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
    });

    assert.equal(font.codeFrom, 0x41);
    assert.equal(font.codeTo, 0x41);
    assert.equal(font.glyphCount, 1);
    assert.equal(font.glyphs[0].charCode, 0x41);
});


test("strict conversion reports every missing code point in deterministic order", () => {
    const charset = String.fromCodePoint(0x10ffff) + "A" + String.fromCodePoint(0x1f600);
    const nonStrict = convertFontToBitmap(face, "Roboto", 12, {
        charSet: charset,
        rangeMode: RangeMode.COMPACT,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
        strict: false,
    });
    assert.deepEqual(nonStrict.missingCodePoints, [0x1f600, 0x10ffff]);
    assert.equal(nonStrict.glyphs.length, 1);
    assert.equal(nonStrict.glyphs[0].char, "A");

    assert.throws(() => convertFontToBitmap(face, "Roboto", 12, {
        charSet: charset,
        rangeMode: RangeMode.COMPACT,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
        strict: true,
    }), error => {
        assert.ok(error instanceof MissingGlyphsError);
        assert.deepEqual(error.missingCodePoints, [0x1f600, 0x10ffff]);
        assert.equal(error.font.glyphs.length, 1);
        return true;
    });
});
