// Generated-header ABI, compile, and linkage tests
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

import opentype from "opentype.js";

import {convertFontToBitmap, setCanvasFactory} from "../src/bitmap.js";
import {renderFontHeader} from "../src/export.js";
import {ExportFormats} from "../src/defs.js";
import {FontFlags, RangeMode} from "../src/range.js";
import {loadOptionalCanvas, nativeCanvasSkipReason} from "./helpers/optional_canvas.js";

const canvasModule = await loadOptionalCanvas();

const compilers = [
    {command: "cc", standard: "c11", source: "main.c"},
    {command: "c++", standard: "c++17", source: "main.cpp"},
];

for (const compiler of compilers) {
    test(`generated custom header compiles and resolves ranges as ${compiler.standard}`, async t => {
        if (!compilerAvailable(compiler.command)) {
            t.skip(`${compiler.command} is not installed`);
            return;
        }

        const directory = await createFixtureDirectory();
        try {
            const font = createCompactFont();
            const options = {format: ExportFormats["Custom 1bpp"], bpp: 1};
            const {content, fontKey} = renderFontHeader(font, options);
            assert.match(content, /#if FONT_BITMAP_ABI_VERSION != 2/);
            assert.match(content, /static const uint8_t .*Bitmaps\[\]/);
            assert.match(content, /static const Glyph .*Glyphs\[\]/);
            assert.match(content, /static const GlyphRange .*Ranges\[\]/);
            assert.match(content, /static const Font /);

            await writeFile(join(directory, "font.h"), content);
            await writeFile(join(directory, compiler.source), `
#include "font.h"
int main(void) {
    if (FONT_BITMAP_ABI_VERSION != 2) return 1;
    if (sizeof(Glyph) != 16 || sizeof(GlyphRange) != 12) return 2;
    if (!fontValid(&${fontKey})) return 3;
    if (fontGlyphIndex(&${fontKey}, 0x41u) != 0) return 4;
    if (fontGlyphIndex(&${fontKey}, 0x410u) != 1) return 5;
    if (fontGlyphIndex(&${fontKey}, 0x451u) != 2) return 6;
    if (fontGlyphIndex(&${fontKey}, 0x411u) != -1) return 7;
    return 0;
}
`);

            const executable = join(directory, "check");
            compileAndRun(compiler.command, compiler.standard, [compiler.source], executable, directory);
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
    });
}

test("generated header rejects an incompatible ABI version", async t => {
    if (!compilerAvailable("cc")) {
        t.skip("cc is not installed");
        return;
    }

    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-abi-"));
    try {
        const canonicalTypes = await readFile(new URL("../types.h", import.meta.url), "utf8");
        await writeFile(
            join(directory, "types.h"),
            canonicalTypes.replace("#define FONT_BITMAP_ABI_VERSION 2", "#define FONT_BITMAP_ABI_VERSION 1")
        );
        const {content} = renderFontHeader(createCompactFont(), {
            format: ExportFormats["Custom 1bpp"],
            bpp: 1,
        });
        await writeFile(join(directory, "font.h"), content);
        await writeFile(join(directory, "main.c"), `
#include "font.h"
int main(void) { return 0; }
`);

        const compile = spawnSync("cc", ["-std=c11", "main.c", "-o", "check"], {
            cwd: directory,
            encoding: "utf8",
        });
        assert.notEqual(compile.status, 0);
        assert.match(compile.stderr, /Incompatible font bitmap ABI/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("generated C header links when included by two translation units", async t => {
    if (!compilerAvailable("cc")) {
        t.skip("cc is not installed");
        return;
    }

    const directory = await createFixtureDirectory();
    try {
        const {content, fontKey} = renderFontHeader(createCompactFont(), {
            format: ExportFormats["Custom 1bpp"],
            bpp: 1,
        });
        await writeFile(join(directory, "font.h"), content);
        await writeFile(join(directory, "first.c"), `
#include "font.h"
int first_lookup(void) { return fontGlyphIndex(&${fontKey}, 0x41u); }
`);
        await writeFile(join(directory, "second.c"), `
#include "font.h"
int second_lookup(void) { return fontGlyphIndex(&${fontKey}, 0x451u); }
`);
        await writeFile(join(directory, "main.c"), `
int first_lookup(void);
int second_lookup(void);
int main(void) { return first_lookup() == 0 && second_lookup() == 2 ? 0 : 1; }
`);

        compileAndRun("cc", "c11", ["first.c", "second.c", "main.c"], join(directory, "check"), directory);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test("supplementary Unicode glyph rasterizes, exports, compiles, and resolves", {
    skip: nativeCanvasSkipReason(canvasModule),
}, async t => {
    if (!compilerAvailable("cc")) {
        t.skip("cc is not installed");
        return;
    }

    setCanvasFactory(() => canvasModule.createCanvas(1, 1));
    const codePoint = 0x1f600;
    const font = convertFontToBitmap(createSupplementaryFont(), "Astral", 12, {
        charSet: String.fromCodePoint(codePoint),
        rangeMode: RangeMode.COMPACT,
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
        strict: true,
    });
    assert.equal(font.glyphs.length, 1);
    assert.equal(font.glyphs[0].charCode, codePoint);
    assert.ok(font.glyphs[0].width > 0);

    const directory = await createFixtureDirectory();
    try {
        const {content, fontKey} = renderFontHeader(font, {
            format: ExportFormats["Custom 1bpp"],
            bpp: 1,
        });
        assert.match(content, /0x01f600/);
        await writeFile(join(directory, "font.h"), content);
        await writeFile(join(directory, "main.c"), `
#include "font.h"
int main(void) {
    return fontGlyphIndex(&${fontKey}, 0x1f600u) == 0 ? 0 : 1;
}
`);
        compileAndRun("cc", "c11", ["main.c"], join(directory, "check"), directory);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

async function createFixtureDirectory() {
    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-header-"));
    await writeFile(join(directory, "types.h"), await readFile(new URL("../types.h", import.meta.url)));
    return directory;
}

function compilerAvailable(command) {
    return spawnSync(command, ["--version"], {stdio: "ignore"}).status === 0;
}

function compileAndRun(command, standard, sources, executable, directory) {
    const compile = spawnSync(
        command,
        [`-std=${standard}`, ...sources, "-o", executable],
        {cwd: directory, encoding: "utf8"}
    );
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);

    const run = spawnSync(executable, [], {encoding: "utf8"});
    assert.equal(run.status, 0, run.stderr || run.stdout);
}

function createCompactFont() {
    const codes = [0x41, 0x410, 0x451];
    return {
        name: "Compile 12pt",
        bpp: 1,
        buffer: Uint8Array.of(0x80, 0x80, 0x80),
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
            {codeFrom: 0x41, codeTo: 0x41, glyphOffset: 0},
            {codeFrom: 0x410, codeTo: 0x410, glyphOffset: 1},
            {codeFrom: 0x451, codeTo: 0x451, glyphOffset: 2},
        ],
        flags: FontFlags.COMPACT | FontFlags.RANGE_COMPACT,
        rangeMode: RangeMode.COMPACT,
        rangeModeLabel: "Compact",
        codeFrom: 0x41,
        codeTo: 0x451,
        advanceY: 14,
        missingCodePoints: [],
    };
}

function createSupplementaryFont() {
    const path = new opentype.Path();
    path.moveTo(80, 0);
    path.lineTo(520, 0);
    path.lineTo(520, 700);
    path.lineTo(80, 700);
    path.close();

    return new opentype.Font({
        familyName: "Astral",
        styleName: "Regular",
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs: [
            new opentype.Glyph({
                name: ".notdef",
                unicode: 0,
                advanceWidth: 600,
                path: new opentype.Path(),
            }),
            new opentype.Glyph({
                name: "u1F600",
                unicode: 0x1f600,
                advanceWidth: 600,
                path,
            }),
        ],
    });
}
