// Extended Custom font metrics tests
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

import {calculateFontMetrics} from "../src/bitmap.js";
import {BppOptions, ExportFormats, resolveExportFormat} from "../src/defs.js";
import {renderFontHeader} from "../src/export.js";
import {FontAbiProfile, FontFlags} from "../src/range.js";

test("UI format model exposes four formats while preserving legacy Custom aliases", () => {
    assert.deepEqual(Object.keys(ExportFormats), ["Adafruit", "Custom", "Custom Extended", "Typer"]);
    assert.deepEqual(BppOptions, [1, 2, 4, 8]);
    assert.equal(ExportFormats["Custom 4bpp"].bpp, 4);
    assert.equal(ExportFormats["Custom 4bpp"].extended, false);
});

test("font metrics combine typographic distances with exported ink bounds", () => {
    const metrics = calculateFontMetrics(
        {unitsPerEm: 1000, ascender: 800, descender: -200},
        20,
        [
            {present: true, width: 8, height: 15, offsetY: -15},
            {present: true, width: 7, height: 14, offsetY: -10},
            // Whitespace is present but has no painted pixels and must not
            // expand the ink envelope to the baseline.
            {present: true, width: 0, height: 0, offsetY: 0},
        ]
    );

    assert.deepEqual(metrics, {
        ascent: 16,
        descent: 4,
        inkTop: -15,
        inkBottom: 4,
    });
});

test("Custom Extended emits 16-bit FontMetrics", () => {
    const format = ExportFormats["Custom Extended"];
    const {content, fontKey} = renderFontHeader(createDenseFont(), {format, bpp: 1});

    assert.match(content, /#include "\.\/types_extended\.h"/);
    assert.match(content, /FONT_BITMAP_EXTENDED_ABI_VERSION != 1/);
    assert.match(content, /\{ 24, 6, -21, 5 \},/);
    assert.match(fontKey, /Extended/);
});

test("compact16 Custom Extended uses compact metric ABI and rejects overflow", () => {
    const format = resolveExportFormat(
        ExportFormats["Custom Extended"],
        FontAbiProfile.COMPACT16
    );
    const font = createCompact16Font();
    const {content} = renderFontHeader(font, {format, bpp: 1});

    assert.match(content, /#include "\.\/types_extended_compact16\.h"/);
    assert.match(content, /FONT_BITMAP_EXTENDED_COMPACT16_ABI_VERSION != 1/);
    assert.match(content, /\{ 24, 6, -21, 5 \},/);

    font.metrics.inkTop = -129;
    assert.throws(
        () => renderFontHeader(font, {format, bpp: 1}),
        /inkTop=-129 does not fit int8_t Extended ABI/
    );

    font.metrics.inkTop = -21;
    font.metrics.ascent = 256;
    assert.throws(
        () => renderFontHeader(font, {format, bpp: 1}),
        /ascent=256 does not fit uint8_t Extended ABI/
    );
});


test("generated Extended headers compile as C and C++", async t => {
    const compilers = [
        {command: "cc", standard: "c11", source: "main.c"},
        {command: "c++", standard: "c++17", source: "main.cpp"},
    ];

    for (const compiler of compilers) {
        if (spawnSync(compiler.command, ["--version"], {stdio: "ignore"}).status !== 0) {
            t.diagnostic(`${compiler.command} is not installed`);
            continue;
        }

        const directory = await mkdtemp(join(tmpdir(), "font2bitmap-extended-"));
        try {
            const format = ExportFormats["Custom Extended"];
            const full = renderFontHeader(createDenseFont(), {format, bpp: 1});
            await writeFile(join(directory, "font.h"), full.content);
            await writeFile(
                join(directory, "types_extended.h"),
                await readFile(new URL("../types_extended.h", import.meta.url))
            );
            await writeFile(join(directory, compiler.source), `
#include "font.h"
int main(void) {
    if (!fontValid(&${full.fontKey})) return 1;
    if (sizeof(FontMetrics) != 8) return 2;
    if (${full.fontKey}.metrics.ascent != 24u) return 3;
    if (${full.fontKey}.metrics.inkTop != -21) return 4;
    return 0;
}
`);

            const executable = join(directory, "check");
            const compile = spawnSync(
                compiler.command,
                [`-std=${compiler.standard}`, compiler.source, "-o", executable],
                {cwd: directory, encoding: "utf8"}
            );
            assert.equal(compile.status, 0, compile.stderr || compile.stdout);
            const run = spawnSync(executable, [], {encoding: "utf8"});
            assert.equal(run.status, 0, run.stderr || run.stdout);
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
    }
});

function createDenseFont() {
    return {
        name: "Extended 12pt",
        bpp: 1,
        buffer: Uint8Array.of(0x80),
        glyphs: [{
            present: true,
            char: "A",
            charCode: 0x41,
            name: "A",
            offset: 0,
            width: 1,
            height: 1,
            advanceX: 1,
            offsetX: 0,
            offsetY: -1,
        }],
        ranges: [],
        flags: FontFlags.RANGE_DENSE,
        codeFrom: 0x41,
        codeTo: 0x41,
        advanceY: 30,
        metrics: {ascent: 24, descent: 6, inkTop: -21, inkBottom: 5},
    };
}

function createCompact16Font() {
    return {
        ...createDenseFont(),
        ranges: [{codeFrom: 0x41, codeTo: 0x41, glyphOffset: 0}],
        flags: FontFlags.COMPACT | FontFlags.RANGE_COMPACT,
    };
}
