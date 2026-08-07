// Typer export and glyph-comment formatting regression tests
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

import {ExportFormats} from "../src/defs.js";
import {renderFontHeader} from "../src/export.js";
import {FontFlags} from "../src/range.js";

test("Typer exposes the requested compact BMP ABI", () => {
    const format = ExportFormats.Typer;
    assert.equal(format.kind, "typer");
    assert.deepEqual(format.supportedRangeModes, ["compact"]);

    const font = createFont();
    font.bpp = 4;
    const {content, fontKey} = renderFontHeader(font, {format: {...format, bpp: 4}, bpp: 4});
    assert.match(content, /#include "\.\/types_typer\.h"/);
    assert.match(content, /static const Font .*Typer = \{/);
    assert.match(content, /\{ 300, 40, -118, 31 \},/);
    assert.match(fontKey, /b4Typer$/);
    assert.doesNotMatch(fontKey, /Compact16/);
});

test("Typer uses 16-bit metrics but rejects values outside its signed fields", () => {
    const format = ExportFormats.Typer;
    const font = createFont();

    // Typer intentionally keeps full 16-bit metrics even though its Unicode
    // range/count ABI is compact BMP-only.
    font.metrics.ascent = 300;
    assert.doesNotThrow(() => renderFontHeader(font, {format, bpp: 1}));

    font.glyphs[0].advanceX = 40000;
    assert.throws(
        () => renderFontHeader(font, {format, bpp: 1}),
        /glyph\[0\]\.advanceX=40000 does not fit Typer ABI/
    );
});

test("glyph comments form aligned initializer, code, character, and name columns", () => {
    const {content} = renderFontHeader(createFont(), {format: ExportFormats.Typer, bpp: 1});
    const lines = content.split("\n").filter(line => /\/\/ 0x/.test(line));
    assert.equal(lines.length, 4);

    const commentColumns = lines.map(line => line.indexOf("//"));
    assert.equal(new Set(commentColumns).size, 1, lines.join("\n"));

    const parsed = lines.map(line => {
        const match = /^(.*)\/\/\s+(0x[0-9a-f]+)(\s+)'([^']*)'(\s+)(.*)$/.exec(line);
        assert.ok(match, line);
        return {
            codeColumn: line.indexOf(match[2]),
            charColumn: line.indexOf(`'${match[4]}'`),
            nameColumn: line.lastIndexOf(match[6]),
        };
    });
    assert.equal(new Set(parsed.map(row => row.codeColumn)).size, 1);
    assert.equal(new Set(parsed.map(row => row.charColumn)).size, 1);
    assert.equal(new Set(parsed.map(row => row.nameColumn)).size, 1);
});

test("GlyphRange rows form aligned initializer and comment columns", () => {
    const {content} = renderFontHeader(createFont(), {format: ExportFormats.Typer, bpp: 1});
    const lines = content.split("\n").filter(line => /\/\/ U\+/.test(line));
    assert.equal(lines.length, 2);

    assert.equal(new Set(lines.map(line => line.indexOf("//"))).size, 1, lines.join("\n"));
    assert.equal(new Set(lines.map(line => line.indexOf("->"))).size, 1, lines.join("\n"));
    assert.equal(new Set(lines.map(line => line.indexOf("glyph"))).size, 1, lines.join("\n"));
    assert.equal(new Set(lines.map(line => line.indexOf("("))).size, 1, lines.join("\n"));
});


test("Typer generated header compiles as C++17", async t => {
    if (spawnSync("c++", ["--version"], {stdio: "ignore"}).status !== 0) {
        t.skip("c++ is not installed");
        return;
    }

    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-typer-"));
    try {
        const generated = renderFontHeader(createFont(), {format: ExportFormats.Typer, bpp: 1});
        await writeFile(join(directory, "font.h"), generated.content);
        await writeFile(
            join(directory, "types_typer.h"),
            await readFile(new URL("../types_typer.h", import.meta.url))
        );
        await writeFile(join(directory, "main.cpp"), `
#include "font.h"
static_assert(sizeof(Glyph) == 16, "Glyph ABI");
static_assert(sizeof(GlyphRange) == 6, "GlyphRange ABI");
static_assert(sizeof(FontMetrics) == 8, "FontMetrics ABI");
int main() {
    if (${generated.fontKey}.bpp != 1) return 1;
    if (${generated.fontKey}.rangeCount != 2) return 2;
    if (${generated.fontKey}.metrics.ascent != 300) return 3;
    if (${generated.fontKey}.glyphs[0].advanceX != 11) return 4;
    return 0;
}
`);
        const executable = join(directory, "check");
        const compile = spawnSync("c++", ["-std=c++17", "main.cpp", "-o", executable], {
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

function createFont() {
    const entries = [
        [0x20, " ", "space", 0, 1, 1, 11, 11, 1],
        [0x21, "!", "exclam", 1, 3, 14, 11, 8, -14],
        [0x22, '"', "quotedbl", 22, 7, 7, 11, 4, -14],
        [0x1234, "ሴ", "uni1234-long-name", 124, 9, 19, 11, 2, -16],
    ];
    const glyphs = entries.map(([charCode, char, name, offset, width, height, advanceX, offsetX, offsetY]) => ({
        present: true,
        charCode,
        char,
        name,
        offset,
        width,
        height,
        advanceX,
        offsetX,
        offsetY,
    }));
    return {
        name: "Typer 16pt",
        bpp: 1,
        buffer: new Uint8Array(1024),
        bitmapSize: 1024,
        glyphs,
        ranges: [
            {codeFrom: 0x20, codeTo: 0x22, glyphOffset: 0},
            {codeFrom: 0x1234, codeTo: 0x1234, glyphOffset: 3},
        ],
        flags: FontFlags.COMPACT | FontFlags.RANGE_COMPACT,
        codeFrom: 0x20,
        codeTo: 0x1234,
        rangeCount: 2,
        glyphCount: 4,
        advanceY: 340,
        metrics: {ascent: 300, descent: 40, inkTop: -118, inkBottom: 31},
        missingCodePoints: [],
    };
}
