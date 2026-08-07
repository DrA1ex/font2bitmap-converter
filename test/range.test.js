// Bitmap font converter regression tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";

import {
    ASCII_GLYPH_COUNT,
    FontFlags,
    RangeMode,
    buildGlyphRanges,
    buildRangePlan,
    glyphIndexForCode,
    rangeModeFlags,
    normalizeRangeMode,
    validateGlyphRanges,
    analyzeDenseSpan,
    DENSE_MAX_GLYPH_COUNT,
    DenseSpanError,
    DenseSurrogateSpanError,
    CharsetSelection,
} from "../src/range.js";
import {PackedImageWriter} from "../src/misc/image_writer.js";
import * as CommonUtils from "../src/utils/common.js";
import {renderFontHeader} from "../src/export.js";
import {ExportFormats, FontRanges, FontRangeLabels} from "../src/defs.js";
import {resolveSelectedCodePoints} from "../src/bitmap.js";

test("all range is lazy and resolves only actual font Unicode mappings", () => {
    assert.deepEqual(FontRanges.all, {kind: CharsetSelection.ALL_FONT_GLYPHS});

    const fontFace = {
        charToGlyphIndex() { return 0; },
        tables: {
            cmap: {
                glyphIndexMap: {
                    [0x1f600]: 4,
                    [0xd800]: 3,
                    [0xe000]: 2,
                    [0x41]: 1,
                    [0x42]: 0,
                },
            },
        },
    };

    assert.deepEqual(
        resolveSelectedCodePoints(fontFace, FontRanges.all),
        [0x41, 0xe000, 0x1f600]
    );
});


test("language presets are split into basic and full sets", () => {
    assert.deepEqual(FontRangeLabels, {
        default: "Default",
        light: "Light",
        russian: "Russian",
        basicEuropean: "Basic European",
        fullEuropean: "Full European",
        basicSlavic: "Basic Slavic",
        fullSlavic: "Full Slavic",
        all: "All",
        custom: "Custom",
    });

    assert.equal("europeanLatin" in FontRanges, false);
    assert.equal("slavicCyrillic" in FontRanges, false);

    // Basic European intentionally targets compact Western European coverage.
    for (const character of "A0 z!?ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜŸàáâãäçèéêëìíîïñòóôõöùúûüÿßẞŒœ¡¿«»€") {
        if (character === " ") continue;
        assert.ok(FontRanges.basicEuropean.includes(character), `Basic European includes ${character}`);
    }
    for (const character of "ÅåÆæØøÐðÞþĄąĆćČčŁłŃńŘřŠšŽžĂăȘșȚțŐőŰűĞğİıŞşЖ") {
        assert.equal(
            FontRanges.basicEuropean.includes(character),
            false,
            `Basic European excludes Nordic, Central/Eastern European, and Cyrillic character ${character}`
        );
    }

    for (const character of "ÅåÆæØøÐðÞþĄąĆćČčŁłŃńŘřŠšŽžĂăȘșȚțŐőŰűĞğİıŞş") {
        assert.ok(FontRanges.fullEuropean.includes(character), `Full European includes ${character}`);
    }
    for (const character of Array.from(FontRanges.basicEuropean)) {
        assert.ok(FontRanges.fullEuropean.includes(character), `Full European contains Basic European character ${character}`);
    }

    for (const character of "A0 z!?АБЯабяЁёЄєІіЇїҐґЎў") {
        if (character === " ") continue;
        assert.ok(FontRanges.basicSlavic.includes(character), `Basic Slavic includes ${character}`);
    }
    for (const character of "ЂђЉљЊњЋћЏџЃѓЅѕЌќ") {
        assert.equal(
            FontRanges.basicSlavic.includes(character),
            false,
            `Basic Slavic excludes Serbian and Macedonian-specific character ${character}`
        );
        assert.ok(FontRanges.fullSlavic.includes(character), `Full Slavic includes ${character}`);
    }
    assert.equal(FontRanges.basicSlavic.includes("ä"), false);

    for (const character of "ЀѐЍѝ") {
        assert.ok(FontRanges.fullSlavic.includes(character), `Full Slavic includes ${character}`);
        assert.equal(FontRanges.basicSlavic.includes(character), false);
    }
    assert.equal(Array.from(FontRanges.basicSlavic).length, 171);
    assert.equal(Array.from(FontRanges.fullSlavic).length, 193);
    for (const character of Array.from(FontRanges.basicSlavic)) {
        assert.ok(FontRanges.fullSlavic.includes(character), `Full Slavic contains Basic Slavic character ${character}`);
    }

    assert.equal(FontRanges.default, CommonUtils.generateString(" ", "~"));
    assert.equal(FontRanges.light, CommonUtils.generateString("A", "Z", "0", "9") + " ,.!?");
    assert.equal(
        FontRanges.russian,
        CommonUtils.generateString(" ", "~", "А", "Я", "а", "я") + "ёЁ"
    );

    // Every language preset is exactly Default plus its language-specific additions.
    for (const [name, charset] of Object.entries({
        Russian: FontRanges.russian,
        "Basic European": FontRanges.basicEuropean,
        "Full European": FontRanges.fullEuropean,
        "Basic Slavic": FontRanges.basicSlavic,
        "Full Slavic": FontRanges.fullSlavic,
    })) {
        for (const character of Array.from(FontRanges.default)) {
            assert.ok(charset.includes(character), `${name} contains Default character ${character}`);
        }
    }

    for (const charset of [
        FontRanges.basicEuropean,
        FontRanges.fullEuropean,
        FontRanges.basicSlavic,
        FontRanges.fullSlavic,
    ]) {
        const codePoints = Array.from(charset, character => character.codePointAt(0));
        assert.deepEqual(codePoints, Array.from(new Set(codePoints)).sort((a, b) => a - b));
    }
});

test("range modes accept only canonical names", () => {
    assert.equal(normalizeRangeMode(null), RangeMode.DENSE);
    assert.equal(normalizeRangeMode(RangeMode.COMPACT), RangeMode.COMPACT);
    assert.throws(() => normalizeRangeMode("ascii-extended"), /Unsupported glyph range mode/);
    assert.throws(() => buildRangePlan([0x41], "ascii-extended"), /Unsupported glyph range mode/);
});

test("quantization rounds coverage to the nearest output level", () => {
    assert.equal(PackedImageWriter.convertPixel(127, 1), 0);
    assert.equal(PackedImageWriter.convertPixel(128, 1), 1);
    assert.equal(PackedImageWriter.convertPixel(42, 2), 0);
    assert.equal(PackedImageWriter.convertPixel(43, 2), 1);
    assert.equal(PackedImageWriter.convertPixel(212, 2), 2);
    assert.equal(PackedImageWriter.convertPixel(213, 2), 3);
    assert.equal(PackedImageWriter.convertPixel(8, 4), 0);
    assert.equal(PackedImageWriter.convertPixel(9, 4), 1);
    assert.equal(PackedImageWriter.convertPixel(255, 8), 255);
});

test("packed writer keeps a continuous glyph bitstream", () => {
    const writer = new PackedImageWriter(2);
    for (const alpha of [0, 85, 170, 255, 255]) writer.write(alpha);
    writer.flush();
    assert.deepEqual(Array.from(writer.byteArray()), [0x1b, 0xc0]);
});

test("sparse mappings become deterministic continuous and singleton ranges", () => {
    const ranges = buildGlyphRanges([
        {codePoint: 0x451, glyphOffset: 66},
        {codePoint: 0x411, glyphOffset: 2},
        {codePoint: 0x401, glyphOffset: 0},
        {codePoint: 0x410, glyphOffset: 1},
        {codePoint: 0x450, glyphOffset: 65},
    ]);

    assert.deepEqual(ranges, [
        {codeFrom: 0x401, codeTo: 0x401, glyphOffset: 0},
        {codeFrom: 0x410, codeTo: 0x411, glyphOffset: 1},
        {codeFrom: 0x450, codeTo: 0x451, glyphOffset: 65},
    ]);
    assert.equal(validateGlyphRanges(ranges, 67), true);
});

test("range validation rejects duplicates, overlaps and invalid glyph offsets", () => {
    assert.throws(() => buildGlyphRanges([
        {codePoint: 0x41, glyphOffset: 0},
        {codePoint: 0x41, glyphOffset: 1},
    ]), /Duplicate code point/);

    assert.throws(() => buildGlyphRanges([
        {codePoint: 0x41, glyphOffset: 0},
        {codePoint: 0x42, glyphOffset: 1},
        {codePoint: 0x50, glyphOffset: 0},
    ]), /Duplicate glyph offset/);

    assert.throws(() => validateGlyphRanges([
        {codeFrom: 0x41, codeTo: 0x43, glyphOffset: 0},
        {codeFrom: 0x43, codeTo: 0x44, glyphOffset: 3},
    ], 5), /overlap|duplicates/);

    assert.throws(() => validateGlyphRanges([
        {codeFrom: 0x410, codeTo: 0x412, glyphOffset: 4},
    ], 6), /exceeds glyphCount/);

    assert.throws(() => validateGlyphRanges([
        {codeFrom: 0x41, codeTo: 0x42, glyphOffset: 0},
        {codeFrom: 0x50, codeTo: 0x51, glyphOffset: 1},
    ], 4), /Glyph-offset ranges overlap/);
});

test("ASCII first reserves indices 0..127 and appends extensions", () => {
    const selected = [0x20, 0x41, 0x7e, 0x401, 0x410, 0x411, 0x451];
    const plan = buildRangePlan(selected, RangeMode.ASCII_FIRST);
    const ranges = buildGlyphRanges([
        {codePoint: 0x401, glyphOffset: ASCII_GLYPH_COUNT},
        {codePoint: 0x410, glyphOffset: ASCII_GLYPH_COUNT + 1},
        {codePoint: 0x411, glyphOffset: ASCII_GLYPH_COUNT + 2},
        {codePoint: 0x451, glyphOffset: ASCII_GLYPH_COUNT + 3},
    ]);
    const font = {
        rangeMode: plan.mode,
        flags: rangeModeFlags(plan.mode),
        ranges,
        glyphCount: ASCII_GLYPH_COUNT + 4,
        codeFrom: 0x20,
        codeTo: 0x451,
    };

    assert.equal(plan.baseCodes.length, ASCII_GLYPH_COUNT);
    assert.equal(glyphIndexForCode(font, 0x00), 0);
    assert.equal(glyphIndexForCode(font, 0x41), 0x41);
    assert.equal(glyphIndexForCode(font, 0x7f), 0x7f);
    assert.equal(glyphIndexForCode(font, 0x401), 128);
    assert.equal(glyphIndexForCode(font, 0x410), 129);
    assert.equal(glyphIndexForCode(font, 0x411), 130);
    assert.equal(glyphIndexForCode(font, 0x451), 131);
    assert.equal(glyphIndexForCode(font, 0x400), -1);
    assert.equal(font.flags, FontFlags.COMPACT | FontFlags.RANGE_ASCII_FIRST);
});


test("Dense span analysis warns and blocks pathological sparse spans", () => {
    const codes = [0x10000, 0x20001];
    const analysis = analyzeDenseSpan(codes);
    assert.ok(analysis.glyphCount > DENSE_MAX_GLYPH_COUNT);
    assert.match(analysis.warning, /Compact is recommended/);
    assert.throws(() => buildRangePlan(codes, RangeMode.DENSE), DenseSpanError);

    const plan = buildRangePlan(codes, RangeMode.DENSE, {allowLargeDense: true});
    assert.equal(plan.baseCodes.length, analysis.glyphCount);
    assert.equal(plan.warnings.length, 1);
});

test("Dense rejects a span crossing the Unicode surrogate block", () => {
    const chars = CommonUtils.parseRange("0xd7ff-0xe000");
    const codes = Array.from(chars, char => char.codePointAt(0));
    assert.deepEqual(codes, [0xd7ff, 0xe000]);

    assert.throws(
        () => buildRangePlan(codes, RangeMode.DENSE, {allowLargeDense: true}),
        error => error instanceof DenseSurrogateSpanError
            && /U\+D800-U\+DFFF/.test(error.message)
            && /Choose Compact instead/.test(error.message)
    );

    const allFontPlan = buildRangePlan(codes, RangeMode.DENSE, {
        allowLargeDense: true,
        allowSurrogateDense: true,
    });
    assert.equal(allFontPlan.baseCodes.length, 0xe000 - 0xd7ff + 1);
    assert.match(allFontPlan.warnings.join("\n"), /2,048 unreachable placeholder slots/);

    const compact = buildRangePlan(codes, RangeMode.COMPACT);
    assert.deepEqual(compact.extensionCodes, [0xd7ff, 0xe000]);
});

test("range parser accepts supplementary Unicode code points", () => {
    assert.equal(CommonUtils.parseRange("0x1f600-0x1f602"), "😀😁😂");
});

test("custom export writes explicit sorted GlyphRange records and unambiguous comments", () => {
    const glyphs = Array.from({length: 194}, (_, charCode) => ({
        present: false,
        char: String.fromCodePoint(charCode),
        charCode,
        name: null,
        offset: 0,
        width: 0,
        height: 0,
        advanceX: 0,
        offsetX: 0,
        offsetY: 0,
    }));
    glyphs[0x20] = {
        ...glyphs[0x20],
        present: true,
        name: "space",
        advanceX: 5,
    };
    glyphs[128] = {
        ...glyphs[128],
        present: true,
        char: "Ё",
        charCode: 0x401,
        name: "uni0401",
        width: 1,
        height: 1,
    };
    for (let charCode = 0x410; charCode <= 0x44f; ++charCode) {
        const glyphIndex = 129 + charCode - 0x410;
        glyphs[glyphIndex] = {
            ...glyphs[glyphIndex],
            present: true,
            char: String.fromCodePoint(charCode),
            charCode,
            name: `uni${charCode.toString(16).toUpperCase()}`,
            width: 1,
            height: 1,
        };
    }
    glyphs[193] = {
        ...glyphs[193],
        present: true,
        char: "ё",
        charCode: 0x451,
        name: "uni0451",
        width: 1,
        height: 1,
    };

    const font = {
        name: "Example 12pt",
        bpp: 1,
        buffer: Uint8Array.from([0xaa]),
        glyphs,
        ranges: [
            {codeFrom: 0x401, codeTo: 0x401, glyphOffset: 128},
            {codeFrom: 0x410, codeTo: 0x44f, glyphOffset: 129},
            {codeFrom: 0x451, codeTo: 0x451, glyphOffset: 193},
        ],
        flags: FontFlags.COMPACT | FontFlags.RANGE_ASCII_FIRST,
        rangeMode: RangeMode.ASCII_FIRST,
        rangeModeLabel: "ASCII first",
        codeFrom: 0x20,
        codeTo: 0x451,
        advanceY: 14,
    };
    const format = ExportFormats["Custom 1bpp"];
    const {content} = renderFontHeader(font, {format, bpp: 1});

    assert.match(content, /static const GlyphRange Example12ptAsciiFirstRanges\[\]/);
    assert.ok(content.includes("    { 0x0401, 0x0401, 128 }, // U+0401         -> glyph[128]        (1 glyph)"));
    assert.ok(content.includes("    { 0x0410, 0x044f, 129 }, // U+0410-U+044F  -> glyphs[129..192]  (64 glyphs)"));
    assert.ok(content.includes("    { 0x0451, 0x0451, 193 }, // U+0451         -> glyph[193]        (1 glyph)"));
    assert.match(content, /Example12ptAsciiFirstRanges,/);
    assert.match(content, /3, 194,/);
    assert.match(content, /14, 1, 0x05, \/\/ ASCII first/);
    assert.match(content, /0x0401\s+'Ё'\s+uni0401/);
    assert.match(content, /0x7f.*not exported/);
    assert.match(content, /Ranges: 3 \(36 bytes, sizeof\(GlyphRange\) = 12\)/);
    assert.match(content, /Glyphs: 194 \(3104 bytes, sizeof\(Glyph\) = 16\)/);
});

test("custom export emits a portable bitmap sentinel for an empty bitmap stream", () => {
    const font = {
        name: "Spaces 12pt",
        bpp: 1,
        buffer: new Uint8Array(),
        glyphs: [{
            present: true,
            char: " ",
            charCode: 0x20,
            name: "space",
            offset: 0,
            width: 0,
            height: 0,
            advanceX: 5,
            offsetX: 0,
            offsetY: 0,
        }],
        ranges: [],
        flags: FontFlags.RANGE_DENSE,
        rangeMode: RangeMode.DENSE,
        rangeModeLabel: "Dense",
        codeFrom: 0x20,
        codeTo: 0x20,
        advanceY: 14,
    };

    const {content} = renderFontHeader(font, {
        format: ExportFormats["Custom 1bpp"],
        bpp: 1,
    });

    assert.match(content, /Spaces12ptBitmaps\[\] = \{\s+0x00,/s);
    assert.match(content, /\{ 0, 0, 0, 5, 0, 0 \}/);
    assert.match(content, /NULL,/);
    assert.match(content, /0, 1,/);
});
