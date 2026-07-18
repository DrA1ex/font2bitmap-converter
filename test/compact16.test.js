// compact16 export profile regression tests
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

import {convertFontToBitmap} from "../src/bitmap.js";
import {
    ExportFormats,
    FontBitmapCompact16AbiVersion,
    resolveExportFormat,
} from "../src/defs.js";
import {renderFontHeader} from "../src/export.js";
import {
    FontAbiProfile,
    FontFlags,
    RangeMode,
    validateFontAbi,
} from "../src/range.js";

const compact16Format = resolveExportFormat(
    ExportFormats["Custom 1bpp"],
    FontAbiProfile.COMPACT16
);

test("compact16 ABI version stays synchronized with its canonical header", async () => {
    const types = await readFile(new URL("../types_compact16.h", import.meta.url), "utf8");
    const version = Number(types.match(/#define\s+FONT_BITMAP_COMPACT16_ABI_VERSION\s+(\d+)/)?.[1]);
    assert.equal(version, FontBitmapCompact16AbiVersion);
});

test("compact16 exports a 6-byte BMP range ABI and resolves glyphs", async t => {
    if (!compilerAvailable("cc")) {
        t.skip("cc is not installed");
        return;
    }

    const font = createCompact16Font();
    const {content, fontKey} = renderFontHeader(font, {format: compact16Format, bpp: 1});
    assert.match(content, /types_compact16\.h/);
    assert.match(content, /FONT_BITMAP_COMPACT16_ABI_VERSION != 1/);
    assert.match(content, /sizeof\(GlyphRange\) = 6/);
    assert.match(content, /Total size: 69 bytes/);

    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-compact16-"));
    try {
        await writeFile(
            join(directory, "types_compact16.h"),
            await readFile(new URL("../types_compact16.h", import.meta.url))
        );
        await writeFile(join(directory, "font.h"), content);
        await writeFile(join(directory, "main.c"), `
#include "font.h"
int main(void) {
    if (FONT_BITMAP_COMPACT16_ABI_VERSION != 1) return 1;
    if (sizeof(GlyphRange) != 6) return 2;
    if (!fontValid(&${fontKey})) return 3;
    if (fontGlyphIndex(&${fontKey}, 0x20u) != 0) return 4;
    if (fontGlyphIndex(&${fontKey}, 0x41u) != 1) return 5;
    if (fontGlyphIndex(&${fontKey}, 0x410u) != 2) return 6;
    if (fontGlyphIndex(&${fontKey}, 0x411u) != -1) return 7;
    return 0;
}
`);
        const executable = join(directory, "check");
        const compile = spawnSync("cc", ["-std=c11", "main.c", "-o", executable], {
            cwd: directory,
            encoding: "utf8",
        });
        assert.equal(compile.status, 0, compile.stderr || compile.stdout);
        const run = spawnSync(executable, [], {encoding: "utf8"});
        assert.equal(run.status, 0, run.stderr || run.stdout);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("compact16 C validator rejects malformed ranges and bitmap bounds", async t => {
    if (!compilerAvailable("cc")) {
        t.skip("cc is not installed");
        return;
    }

    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-compact16-validator-"));
    try {
        await writeFile(
            join(directory, "types_compact16.h"),
            await readFile(new URL("../types_compact16.h", import.meta.url))
        );
        await writeFile(join(directory, "main.c"), String.raw`
#include "types_compact16.h"

static const uint8_t bitmap[] = { 0x80, 0x80 };
static const Glyph glyphs[] = {
    { 0, 1, 1, 1, 0, 0 },
    { 1, 1, 1, 1, 0, 0 },
};
static const Glyph overflowGlyphs[] = {
    { 0, 1, 1, 1, 0, 0 },
    { 2, 1, 1, 1, 0, 0 },
};
static const GlyphRange validRanges[] = { { 0x41, 0x42, 0 } };
static const GlyphRange gapRanges[] = { { 0x41, 0x42, 1 } };
static const GlyphRange overlapRanges[] = {
    { 0x41, 0x41, 0 },
    { 0x41, 0x41, 1 },
};
static const GlyphRange surrogateRanges[] = { { 0xd800, 0xd801, 0 } };

static const Font valid = {
    "valid", bitmap, glyphs, validRanges, sizeof(bitmap),
    0x41, 0x42, 1, 2, 12, 1, FONT_COMPACT16_FLAGS
};
static const Font gap = {
    "gap", bitmap, glyphs, gapRanges, sizeof(bitmap),
    0x41, 0x42, 1, 2, 12, 1, FONT_COMPACT16_FLAGS
};
static const Font overlap = {
    "overlap", bitmap, glyphs, overlapRanges, sizeof(bitmap),
    0x41, 0x41, 2, 2, 12, 1, FONT_COMPACT16_FLAGS
};
static const Font surrogate = {
    "surrogate", bitmap, glyphs, surrogateRanges, sizeof(bitmap),
    0xd800, 0xd801, 1, 2, 12, 1, FONT_COMPACT16_FLAGS
};
static const Font overflow = {
    "overflow", bitmap, overflowGlyphs, validRanges, sizeof(bitmap),
    0x41, 0x42, 1, 2, 12, 1, FONT_COMPACT16_FLAGS
};
static const Font badFlags = {
    "flags", bitmap, glyphs, validRanges, sizeof(bitmap),
    0x41, 0x42, 1, 2, 12, 1, 0
};

int main(void) {
    if (!fontValid(&valid)) return 1;
    if (fontValid(&gap)) return 2;
    if (fontValid(&overlap)) return 3;
    if (fontValid(&surrogate)) return 4;
    if (fontValid(&overflow)) return 5;
    if (fontValid(&badFlags)) return 6;
    if (fontGlyphIndex(&valid, 0x41u) != 0) return 7;
    if (fontGlyphIndex(&valid, 0x42u) != 1) return 8;
    if (fontGlyphIndex(&valid, 0x10000u) != -1) return 9;
    return 0;
}
`);
        const executable = join(directory, "check");
        const compile = spawnSync("cc", ["-std=c11", "main.c", "-o", executable], {
            cwd: directory,
            encoding: "utf8",
        });
        assert.equal(compile.status, 0, compile.stderr || compile.stdout);
        const run = spawnSync(executable, [], {encoding: "utf8"});
        assert.equal(run.status, 0, run.stderr || run.stdout);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("compact16 rejects supplementary Unicode and non-Compact layouts", () => {
    const font = createCompact16Font();
    validateFontAbi(font, FontAbiProfile.COMPACT16);

    const supplementary = structuredClone(font);
    supplementary.buffer = Uint8Array.from(font.buffer);
    supplementary.codeTo = 0x1f600;
    supplementary.ranges.at(-1).codeTo = 0x1f600;
    assert.throws(
        () => validateFontAbi(supplementary, FontAbiProfile.COMPACT16),
        /BMP code points only|supplementary/
    );

    const dense = structuredClone(font);
    dense.buffer = Uint8Array.from(font.buffer);
    dense.flags = FontFlags.RANGE_DENSE;
    assert.throws(
        () => validateFontAbi(dense, FontAbiProfile.COMPACT16),
        /supports only the Compact glyph layout/
    );

    assert.throws(() => convertFontToBitmap({unitsPerEm: 1000, charToGlyphIndex() { return 0; }}, "Bad", 12, {
        charSet: String.fromCodePoint(0x1f600),
        rangeMode: RangeMode.COMPACT,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
        abiProfile: FontAbiProfile.COMPACT16,
    }), /compact16 supports BMP code points only/);
});

test("compact16 validates 16-bit counts and glyph offsets", () => {
    const tooManyGlyphs = createCompact16Font();
    tooManyGlyphs.glyphCount = 65536;
    assert.throws(
        () => validateFontAbi(tooManyGlyphs, FontAbiProfile.COMPACT16),
        /glyphCount must be an integer in \[0, 65535\]/
    );

    const largeOffset = createCompact16Font();
    largeOffset.ranges[0].glyphOffset = 65536;
    assert.throws(
        () => validateFontAbi(largeOffset, FontAbiProfile.COMPACT16),
        /glyphOffset/
    );
});

test("Strict export help, Total size, and warning summary tooltip are present in the UI", async () => {
    const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
    const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
    const style = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
    assert.match(html, /Stops export if any selected code point is missing/);
    assert.match(index, /\["Total size", `\$\{formatStatNumber\(memory\.dataBytes\)\} bytes`\]/);
    assert.match(index, /stats\.prepend\(warning\)/);
    assert.match(index, /warning\.dataset\.tooltip = filtered\.join\("\\n"\)/);
    assert.match(style, /\.warning-triangle/);
    assert.match(style, /\.stat-warning:hover::after/);
});

function createCompact16Font() {
    const codes = [0x20, 0x41, 0x410];
    return {
        name: "Compact16 12pt",
        bpp: 1,
        buffer: Uint8Array.of(0x80, 0x80, 0x80),
        bitmapSize: 3,
        glyphs: codes.map((charCode, offset) => ({
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
        })),
        ranges: [
            {codeFrom: 0x20, codeTo: 0x20, glyphOffset: 0},
            {codeFrom: 0x41, codeTo: 0x41, glyphOffset: 1},
            {codeFrom: 0x410, codeTo: 0x410, glyphOffset: 2},
        ],
        flags: FontFlags.COMPACT | FontFlags.RANGE_COMPACT,
        rangeMode: RangeMode.COMPACT,
        rangeModeLabel: "Compact",
        rangeCount: 3,
        glyphCount: 3,
        codeFrom: 0x20,
        codeTo: 0x410,
        advanceY: 14,
        missingCodePoints: [],
    };
}

function compilerAvailable(command) {
    return spawnSync(command, ["--version"], {stdio: "ignore"}).status === 0;
}
