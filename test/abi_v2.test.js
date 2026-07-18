// ABI v2 contract and malformed-font regression tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

import {FontBitmapAbiVersion} from "../src/defs.js";
import {renderFontHeader} from "../src/export.js";
import {ExportFormats} from "../src/defs.js";
import {
    ASCII_GLYPH_COUNT,
    FontFlags,
    RangeMode,
    glyphForCode,
    glyphIndexForCode,
    rangeModeFromFlags,
    validateFontAbi,
} from "../src/range.js";

const presentGlyph = (charCode, offset = 0) => ({
    present: true,
    char: String.fromCodePoint(charCode),
    charCode,
    name: `u${charCode.toString(16)}`,
    offset,
    width: 1,
    height: 1,
    advanceX: 1,
    offsetX: 0,
    offsetY: 0,
});

const placeholderGlyph = charCode => ({
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
});

function compactFont() {
    return {
        name: "ABI Compact",
        bpp: 1,
        buffer: Uint8Array.of(0x80, 0x80),
        bitmapSize: 2,
        glyphs: [presentGlyph(0x41, 0), presentGlyph(0x43, 1)],
        ranges: [
            {codeFrom: 0x41, codeTo: 0x41, glyphOffset: 0},
            {codeFrom: 0x43, codeTo: 0x43, glyphOffset: 1},
        ],
        flags: FontFlags.COMPACT | FontFlags.RANGE_COMPACT,
        rangeMode: RangeMode.DENSE, // Intentionally stale: flags must win.
        rangeModeLabel: "Dense",
        rangeCount: 2,
        glyphCount: 2,
        codeFrom: 0x41,
        codeTo: 0x43,
        advanceY: 12,
    };
}

function denseFont() {
    return {
        name: "ABI Dense",
        bpp: 1,
        buffer: Uint8Array.of(0x80, 0x80),
        bitmapSize: 2,
        glyphs: [presentGlyph(0x41, 0), placeholderGlyph(0x42), presentGlyph(0x43, 1)],
        ranges: [],
        flags: FontFlags.RANGE_DENSE,
        rangeCount: 0,
        glyphCount: 3,
        codeFrom: 0x41,
        codeTo: 0x43,
        advanceY: 12,
    };
}

function asciiFirstFont({extensions = true} = {}) {
    const glyphs = Array.from({length: ASCII_GLYPH_COUNT}, (_, code) => placeholderGlyph(code));
    glyphs[0x41] = presentGlyph(0x41, 0);
    const ranges = [];
    const buffer = [0x80];
    if (extensions) {
        glyphs.push(presentGlyph(0x410, 1), presentGlyph(0x411, 2));
        ranges.push({codeFrom: 0x410, codeTo: 0x411, glyphOffset: 128});
        buffer.push(0x80, 0x80);
    }
    return {
        name: "ABI ASCII",
        bpp: 1,
        buffer: Uint8Array.from(buffer),
        bitmapSize: buffer.length,
        glyphs,
        ranges,
        flags: FontFlags.COMPACT | FontFlags.RANGE_ASCII_FIRST,
        rangeCount: ranges.length,
        glyphCount: glyphs.length,
        codeFrom: 0x41,
        codeTo: extensions ? 0x411 : 0x41,
        advanceY: 12,
    };
}

function cloneFont(font) {
    return {
        ...font,
        buffer: Uint8Array.from(font.buffer),
        glyphs: font.glyphs.map(glyph => ({...glyph})),
        ranges: font.ranges.map(range => ({...range})),
    };
}

test("generated Font initializer stores the actual bitmap array sizeof", () => {
    const font = compactFont();
    const {content, fontKey} = renderFontHeader(font, {
        format: ExportFormats["Custom 1bpp"],
        bpp: 1,
    });
    assert.match(content, new RegExp(`\\(uint32_t\\) sizeof\\(${fontKey}Bitmaps\\),`));
    assert.equal(font.bitmapSize, font.buffer.byteLength);
});

test("flags are the sole JS lookup source and malformed flags are rejected", () => {
    const font = compactFont();
    assert.equal(glyphIndexForCode(font, 0x41), 0);
    assert.equal(glyphIndexForCode(font, 0x42), -1);
    assert.equal(rangeModeFromFlags(font.flags), RangeMode.COMPACT);

    font.flags = 0x06;
    assert.equal(glyphIndexForCode(font, 0x41), -1);
    assert.throws(() => rangeModeFromFlags(font.flags), /Unsupported font flags/);
    assert.throws(() => validateFontAbi(font), /Unsupported font flags/);
});

test("slot lookup and glyph lookup distinguish zero placeholders", () => {
    const dense = denseFont();
    validateFontAbi(dense);
    assert.equal(glyphIndexForCode(dense, 0x42), 1);
    assert.equal(glyphForCode(dense, 0x42), null);
    assert.equal(glyphForCode(dense, 0x41), dense.glyphs[0]);

    const ascii = asciiFirstFont();
    validateFontAbi(ascii);
    assert.equal(glyphIndexForCode(ascii, 0x20), 0x20);
    assert.equal(glyphForCode(ascii, 0x20), null);
    assert.equal(glyphForCode(ascii, 0x410), ascii.glyphs[128]);
});

test("mode-aware JS validator rejects malformed Dense, Compact, and ASCII-first mappings", () => {
    const denseRanges = cloneFont(denseFont());
    denseRanges.ranges = [{codeFrom: 0x41, codeTo: 0x41, glyphOffset: 0}];
    denseRanges.rangeCount = 1;
    assert.throws(() => validateFontAbi(denseRanges), /Dense layout must not contain/);

    const denseCount = cloneFont(denseFont());
    denseCount.codeTo = 0x44;
    assert.throws(() => validateFontAbi(denseCount), /Dense glyphCount/);

    const compactMissingZero = cloneFont(compactFont());
    compactMissingZero.ranges = [{codeFrom: 0x43, codeTo: 0x43, glyphOffset: 1}];
    compactMissingZero.rangeCount = 1;
    compactMissingZero.codeFrom = 0x43;
    assert.throws(() => validateFontAbi(compactMissingZero), /without gaps/);

    const compactGap = cloneFont(compactFont());
    compactGap.ranges[1].glyphOffset = 2;
    assert.throws(() => validateFontAbi(compactGap), /exceeds glyphCount|without gaps/);

    const compactBounds = cloneFont(compactFont());
    compactBounds.codeFrom = 0x40;
    assert.throws(() => validateFontAbi(compactBounds), /first and last range/);

    const asciiCodeCollision = cloneFont(asciiFirstFont());
    asciiCodeCollision.ranges = [{codeFrom: 0x41, codeTo: 0x41, glyphOffset: 128}];
    asciiCodeCollision.rangeCount = 1;
    asciiCodeCollision.glyphs.length = 129;
    asciiCodeCollision.glyphCount = 129;
    asciiCodeCollision.codeTo = 0x41;
    assert.throws(() => validateFontAbi(asciiCodeCollision), /may not contain ASCII/);

    const asciiGap = cloneFont(asciiFirstFont());
    asciiGap.ranges[0].glyphOffset = 129;
    assert.throws(() => validateFontAbi(asciiGap), /without gaps|exceeds glyphCount/);

    const asciiMissingTable = cloneFont(asciiFirstFont());
    asciiMissingTable.ranges = [];
    asciiMissingTable.rangeCount = 0;
    assert.throws(() => validateFontAbi(asciiMissingTable), /extensions require/);

    assert.equal(validateFontAbi(asciiFirstFont({extensions: false})), true);
});


test("JS ABI validator rejects common metadata contract violations", () => {
    const invalidBpp = cloneFont(compactFont());
    invalidBpp.bpp = 3;
    assert.throws(() => validateFontAbi(invalidBpp), /Unsupported bits-per-pixel/);

    const missingBitmapPointer = cloneFont(compactFont());
    missingBitmapPointer.buffer = null;
    assert.throws(() => validateFontAbi(missingBitmapPointer), /Font.buffer/);

    const missingGlyphPointer = cloneFont(compactFont());
    missingGlyphPointer.glyphs = null;
    assert.throws(() => validateFontAbi(missingGlyphPointer), /Font.glyphs/);

    const missingRangePointer = cloneFont(compactFont());
    missingRangePointer.ranges = null;
    assert.throws(() => validateFontAbi(missingRangePointer), /Font.ranges/);

    const invalidUnicode = cloneFont(compactFont());
    invalidUnicode.codeTo = 0x110000;
    assert.throws(() => validateFontAbi(invalidUnicode), /Unicode/);

    const inconsistentCompactBit = cloneFont(compactFont());
    inconsistentCompactBit.flags = FontFlags.RANGE_COMPACT;
    assert.throws(() => validateFontAbi(inconsistentCompactBit), /Unsupported font flags/);
});

test("JS ABI validator rejects bitmap overflow and numeric truncation", () => {
    const bitmapOverflow = cloneFont(compactFont());
    bitmapOverflow.glyphs[1].offset = 2;
    assert.throws(() => validateFontAbi(bitmapOverflow), /bitmap exceeds bitmapSize/);

    for (const [field, value, pattern] of [
        ["offset", 0x1_0000_0000, /offset/],
        ["width", 70000, /width/],
        ["height", 70000, /height/],
        ["advanceX", 70000, /advanceX/],
        ["offsetX", -40000, /offsetX/],
        ["offsetY", 40000, /offsetY/],
    ]) {
        const malformed = cloneFont(compactFont());
        malformed.glyphs[0][field] = value;
        assert.throws(() => validateFontAbi(malformed), pattern, field);
    }

    const bitmapSize = cloneFont(compactFont());
    bitmapSize.bitmapSize = 0x1_0000_0000;
    assert.throws(() => validateFontAbi(bitmapSize), /bitmapSize/);

    const advanceY = cloneFont(compactFont());
    advanceY.advanceY = 70000;
    assert.throws(() => validateFontAbi(advanceY), /advanceY/);

    const glyphCount = cloneFont(compactFont());
    glyphCount.glyphCount = 0x1_0000_0000;
    assert.throws(() => validateFontAbi(glyphCount), /glyphCount/);

    const rangeCount = cloneFont(compactFont());
    rangeCount.rangeCount = 0x1_0000_0000;
    assert.throws(() => validateFontAbi(rangeCount), /rangeCount/);

    const glyphOffset = cloneFont(compactFont());
    glyphOffset.ranges[0].glyphOffset = 0x1_0000_0000;
    assert.throws(() => validateFontAbi(glyphOffset), /glyphOffset/);
});

test("JavaScript ABI constants stay synchronized with canonical types.h", async () => {
    const types = await readFile(new URL("../types.h", import.meta.url), "utf8");
    const definitions = await readFile(new URL("../src/defs.js", import.meta.url), "utf8");
    const version = Number(types.match(/#define\s+FONT_BITMAP_ABI_VERSION\s+(\d+)/)?.[1]);
    assert.equal(version, FontBitmapAbiVersion);
    assert.match(definitions, /FONT_BITMAP_ABI_VERSION != \$\{FontBitmapAbiVersion\}/);
    assert.doesNotMatch(definitions, /FONT_BITMAP_ABI_VERSION != 2/);

    const cNames = {
        COMPACT: "FONT_FLAG_COMPACT",
        RANGE_DENSE: "FONT_RANGE_DENSE",
        RANGE_COMPACT: "FONT_RANGE_COMPACT",
        RANGE_ASCII_FIRST: "FONT_RANGE_ASCII_FIRST",
        RANGE_MODE_MASK: "FONT_RANGE_MODE_MASK",
        FLAGS_MASK: "FONT_FLAGS_MASK",
    };
    for (const [jsName, cName] of Object.entries(cNames)) {
        const match = types.match(new RegExp(`${cName}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+)`));
        assert.ok(match, `${cName} must exist in types.h`);
        assert.equal(Number(match[1]), FontFlags[jsName], `${jsName} must match ${cName}`);
    }
});

test("C validator rejects malformed mode contracts and C/JS lookup results match", async t => {
    if (!compilerAvailable("cc")) {
        t.skip("cc is not installed");
        return;
    }

    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-abi-v2-"));
    try {
        await writeFile(join(directory, "types.h"), await readFile(new URL("../types.h", import.meta.url)));
        await writeFile(join(directory, "main.c"), cContractProgram());
        const executable = join(directory, "check");
        const compile = spawnSync("cc", ["-std=c11", "main.c", "-o", executable], {
            cwd: directory,
            encoding: "utf8",
        });
        assert.equal(compile.status, 0, compile.stderr || compile.stdout);
        const run = spawnSync(executable, [], {encoding: "utf8"});
        assert.equal(run.status, 0, run.stderr || run.stdout);

        const actual = run.stdout.trim().split(/\s+/).map(Number);
        const dense = denseFont();
        const compact = compactFont();
        const ascii = asciiFirstFont();
        const invalid = {...compact, flags: 0x06};
        const expected = [
            ...[0x40, 0x41, 0x42, 0x43, 0x44].map(code => glyphIndexForCode(dense, code)),
            ...[0x41, 0x42, 0x43].map(code => glyphIndexForCode(compact, code)),
            ...[0x20, 0x41, 0x410, 0x411, 0x412].map(code => glyphIndexForCode(ascii, code)),
            glyphIndexForCode(invalid, 0x41),
        ];
        assert.deepEqual(actual, expected);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

function compilerAvailable(command) {
    return spawnSync(command, ["--version"], {stdio: "ignore"}).status === 0;
}

function cContractProgram() {
    return String.raw`
#include <stdio.h>
#include "types.h"

static const uint8_t bitmap2[] = { 0x80, 0x80 };
static const uint8_t bitmap3[] = { 0x80, 0x80, 0x80 };
static const Glyph denseGlyphs[] = {
    { 0, 1, 1, 1, 0, 0 },
    { 0, 0, 0, 0, 0, 0 },
    { 1, 1, 1, 1, 0, 0 },
};
static const Font dense = {
    "dense", bitmap2, denseGlyphs, NULL, sizeof(bitmap2),
    0x41, 0x43, 0, 3, 12, 1, FONT_RANGE_DENSE
};

static const Glyph compactGlyphs[] = {
    { 0, 1, 1, 1, 0, 0 },
    { 1, 1, 1, 1, 0, 0 },
};
static const GlyphRange compactRanges[] = {
    { 0x41, 0x41, 0 },
    { 0x43, 0x43, 1 },
};
static const Font compact = {
    "compact", bitmap2, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 2, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};
static const GlyphRange compactMissingZeroRanges[] = { { 0x43, 0x43, 1 } };
static const Font compactMissingZero = {
    "bad", bitmap2, compactGlyphs, compactMissingZeroRanges, sizeof(bitmap2),
    0x43, 0x43, 1, 2, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};
static const Font compactBadBounds = {
    "bad", bitmap2, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x40, 0x43, 2, 2, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};

static const Glyph asciiGlyphs[130] = {
    [0x41] = { 0, 1, 1, 1, 0, 0 },
    [128] = { 1, 1, 1, 1, 0, 0 },
    [129] = { 2, 1, 1, 1, 0, 0 },
};
static const GlyphRange asciiRanges[] = { { 0x410, 0x411, 128 } };
static const Font ascii = {
    "ascii", bitmap3, asciiGlyphs, asciiRanges, sizeof(bitmap3),
    0x41, 0x411, 1, 130, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_ASCII_FIRST
};
static const GlyphRange asciiCollisionRanges[] = { { 0x41, 0x41, 128 } };
static const Font asciiCollision = {
    "bad", bitmap3, asciiGlyphs, asciiCollisionRanges, sizeof(bitmap3),
    0x41, 0x41, 1, 129, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_ASCII_FIRST
};
static const Font asciiMissingTable = {
    "bad", bitmap3, asciiGlyphs, NULL, sizeof(bitmap3),
    0x41, 0x411, 0, 130, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_ASCII_FIRST
};
static const GlyphRange asciiGapRanges[] = { { 0x410, 0x411, 129 } };
static const Font asciiGap = {
    "bad", bitmap3, asciiGlyphs, asciiGapRanges, sizeof(bitmap3),
    0x41, 0x411, 1, 130, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_ASCII_FIRST
};

static const Glyph overflowGlyphs[] = { { 0, 16, 1, 1, 0, 0 } };
static const Font bitmapOverflow = {
    "bad", bitmap2, overflowGlyphs, NULL, 1,
    0x41, 0x41, 0, 1, 12, 1, FONT_RANGE_DENSE
};
static const Font denseWithRanges = {
    "bad", bitmap2, denseGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 3, 12, 1, FONT_RANGE_DENSE
};
static const Font invalidFlags = {
    "bad", bitmap2, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 2, 12, 1, 0x06
};
static const Font invalidCompactBit = {
    "bad", bitmap2, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 2, 12, 1, FONT_RANGE_COMPACT
};
static const Font invalidBpp = {
    "bad", bitmap2, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 2, 12, 3, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};
static const Font nullBitmap = {
    "bad", NULL, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 2, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};
static const Font nullGlyphs = {
    "bad", bitmap2, NULL, compactRanges, sizeof(bitmap2),
    0x41, 0x43, 2, 2, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};
static const Font invalidUnicode = {
    "bad", bitmap2, compactGlyphs, compactRanges, sizeof(bitmap2),
    0x41, 0x110000, 2, 2, 12, 1, FONT_FLAG_COMPACT | FONT_RANGE_COMPACT
};
static const Font denseBadCount = {
    "bad", bitmap2, denseGlyphs, NULL, sizeof(bitmap2),
    0x41, 0x44, 0, 3, 12, 1, FONT_RANGE_DENSE
};

int main(void) {
    if (!fontValid(&dense) || !fontValid(&compact) || !fontValid(&ascii)) return 1;
    if (fontValid(&compactMissingZero)) return 2;
    if (fontValid(&compactBadBounds)) return 3;
    if (fontValid(&asciiCollision)) return 4;
    if (fontValid(&asciiMissingTable)) return 5;
    if (fontValid(&asciiGap)) return 6;
    if (fontValid(&bitmapOverflow)) return 7;
    if (fontValid(&denseWithRanges)) return 8;
    if (fontValid(&denseBadCount)) return 9;
    if (fontValid(&invalidFlags)) return 10;
    if (fontValid(&invalidCompactBit)) return 11;
    if (fontValid(&invalidBpp)) return 12;
    if (fontValid(&nullBitmap)) return 13;
    if (fontValid(&nullGlyphs)) return 14;
    if (fontValid(&invalidUnicode)) return 15;
    if (fontGlyphForCode(&dense, 0x42) != NULL) return 16;
    if (fontGlyphForCode(&dense, 0x41) == NULL) return 17;

    const uint32_t denseCodes[] = { 0x40, 0x41, 0x42, 0x43, 0x44 };
    const uint32_t compactCodes[] = { 0x41, 0x42, 0x43 };
    const uint32_t asciiCodes[] = { 0x20, 0x41, 0x410, 0x411, 0x412 };
    for (size_t i = 0; i < sizeof(denseCodes) / sizeof(denseCodes[0]); ++i)
        printf("%d ", fontGlyphIndex(&dense, denseCodes[i]));
    for (size_t i = 0; i < sizeof(compactCodes) / sizeof(compactCodes[0]); ++i)
        printf("%d ", fontGlyphIndex(&compact, compactCodes[i]));
    for (size_t i = 0; i < sizeof(asciiCodes) / sizeof(asciiCodes[0]); ++i)
        printf("%d ", fontGlyphIndex(&ascii, asciiCodes[i]));
    printf("%d\n", fontGlyphIndex(&invalidFlags, 0x41));
    return 0;
}
`;
}
