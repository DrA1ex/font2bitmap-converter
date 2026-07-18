// Headless CLI integration tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

import opentype from "opentype.js";

import {convertFontToBitmap, setCanvasFactory} from "../src/bitmap.js";
import {ExportFormats} from "../src/defs.js";
import {renderFontHeader} from "../src/export.js";
import {RangeMode} from "../src/range.js";
import {loadOptionalCanvas, nativeCanvasSkipReason} from "./helpers/optional_canvas.js";

const {parse: parseOpenType} = opentype;
const canvasModule = await loadOptionalCanvas();
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const canvasTest = (name, callback) => test(
    name,
    {skip: nativeCanvasSkipReason(canvasModule)},
    callback
);


test("native canvas is optional and loaded only by the headless CLI", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(packageJson.dependencies?.["@napi-rs/canvas"], undefined);
    assert.equal(packageJson.optionalDependencies?.["@napi-rs/canvas"], "^1.0.2");

    const cliSource = await readFile(new URL("../src/cli.js", import.meta.url), "utf8");
    assert.doesNotMatch(cliSource, /import\s+[^;]+from\s+["']@napi-rs\/canvas["']/);
    assert.match(cliSource, /await import\("@napi-rs\/canvas"\)/);
    assert.match(cliSource, /browser converter does not require this package/i);
});

canvasTest("CLI generates a strict Compact header from a UTF-8 charset file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-cli-"));
    try {
        const fontPath = join(directory, "astral.ttf");
        const charsetPath = join(directory, "charset.txt");
        const outputPath = join(directory, "astral.h");
        await writeFile(fontPath, Buffer.from(createFont().toArrayBuffer()));
        await writeFile(charsetPath, `\uFEFF${String.fromCodePoint(0x1f600)}\n`, "utf8");

        const run = spawnSync(process.execPath, [
            cliPath,
            "--font", fontPath,
            "--size", "12",
            "--bpp", "1",
            "--layout", "compact",
            "--charset-file", charsetPath,
            "--strict",
            "--output", outputPath,
        ], {encoding: "utf8"});
        assert.equal(run.status, 0, run.stderr || run.stdout);

        const content = await readFile(outputPath, "utf8");
        assert.match(content, /FONT_BITMAP_ABI_VERSION != 2/);
        assert.match(content, /0x01f600/);
        assert.match(content, /static const Font/);

        await writeFile(
            charsetPath,
            String.fromCodePoint(0x1f600) + String.fromCodePoint(0x1f601),
            "utf8"
        );
        const strictFailure = spawnSync(process.execPath, [
            cliPath,
            "--font", fontPath,
            "--size", "12",
            "--bpp", "1",
            "--layout", "compact",
            "--charset-file", charsetPath,
            "--strict",
            "--output", outputPath,
        ], {encoding: "utf8"});
        assert.equal(strictFailure.status, 1);
        assert.match(strictFailure.stderr, /U\+1F601/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

canvasTest("CLI generates compact16 BMP headers and rejects supplementary Unicode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "font2bitmap-cli-compact16-"));
    try {
        const fontPath = join(directory, "font.ttf");
        const charsetPath = join(directory, "charset.txt");
        const outputPath = join(directory, "font.h");
        await writeFile(fontPath, Buffer.from(createFont().toArrayBuffer()));
        await writeFile(charsetPath, "A", "utf8");

        const success = spawnSync(process.execPath, [
            cliPath,
            "--font", fontPath,
            "--size", "12",
            "--bpp", "1",
            "--layout", "compact",
            "--profile", "compact16",
            "--charset-file", charsetPath,
            "--strict",
            "--output", outputPath,
        ], {encoding: "utf8"});
        assert.equal(success.status, 0, success.stderr || success.stdout);
        const content = await readFile(outputPath, "utf8");
        assert.match(content, /types_compact16\.h/);
        assert.match(content, /sizeof\(GlyphRange\) = 6/);

        await writeFile(charsetPath, String.fromCodePoint(0x1f600), "utf8");
        const failure = spawnSync(process.execPath, [
            cliPath,
            "--font", fontPath,
            "--size", "12",
            "--layout", "compact",
            "--profile", "compact16",
            "--charset-file", charsetPath,
            "--output", outputPath,
        ], {encoding: "utf8"});
        assert.equal(failure.status, 1);
        assert.match(failure.stderr, /compact16 supports BMP code points only/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

canvasTest("CLI output matches the desktop golden fixtures", async t => {
    setCanvasFactory(() => canvasModule.createCanvas(1, 1));

    const fixtureDirectory = new URL("./fixtures/cli-desktop-parity/", import.meta.url);
    const fontPath = fileURLToPath(new URL("../fonts/JetBrainsMono-Regular.ttf", import.meta.url));
    const charsetPath = fileURLToPath(new URL("charset.txt", fixtureDirectory));
    const charset = await readFile(new URL("charset.txt", fixtureDirectory), "utf8");
    const fontBytes = await readFile(fontPath);
    const fontBuffer = fontBytes.buffer.slice(
        fontBytes.byteOffset,
        fontBytes.byteOffset + fontBytes.byteLength
    );
    const fontFace = parseOpenType(fontBuffer);

    const cases = [
        {bpp: 1, fixture: "JetBrainsMono14ptCompact.h"},
        {bpp: 4, fixture: "JetBrainsMono14ptb4Compact.h"},
        {bpp: 8, fixture: "JetBrainsMono14ptb8Compact.h"},
    ];

    for (const fixtureCase of cases) {
        await t.test(`${fixtureCase.bpp} bpp`, async () => {
            const expected = await readFile(new URL(fixtureCase.fixture, fixtureDirectory), "utf8");
            const format = ExportFormats[`Custom ${fixtureCase.bpp}bpp`];
            const desktopFont = convertFontToBitmap(fontFace, "JetBrainsMono", 14, {
                charSet: charset,
                rangeMode: RangeMode.COMPACT,
                bpp: fixtureCase.bpp,
                dpi: format.dpi,
                dpiBase: format.dpiBase,
                floorRasterSize: format.floorRasterSize,
                strict: true,
                abiProfile: format.abiProfile,
            });
            const desktop = renderFontHeader(desktopFont, {
                format,
                bpp: fixtureCase.bpp,
            }).content;
            assert.equal(desktop, expected, "desktop fixture no longer matches the browser/core generator");

            const directory = await mkdtemp(join(tmpdir(), "font2bitmap-cli-parity-"));
            try {
                const outputPath = join(directory, fixtureCase.fixture);
                const run = spawnSync(process.execPath, [
                    cliPath,
                    "--font", fontPath,
                    "--name", "JetBrainsMono",
                    "--size", "14",
                    "--bpp", String(fixtureCase.bpp),
                    "--layout", "compact",
                    "--charset-file", charsetPath,
                    "--strict",
                    "--output", outputPath,
                ], {encoding: "utf8"});
                assert.equal(run.status, 0, run.stderr || run.stdout);
                assert.equal(await readFile(outputPath, "utf8"), expected);
            } finally {
                await rm(directory, {recursive: true, force: true});
            }
        });
    }
});

function createFont() {
    const path = new opentype.Path();
    path.moveTo(80, 0);
    path.lineTo(520, 0);
    path.lineTo(520, 700);
    path.lineTo(80, 700);
    path.close();

    return new opentype.Font({
        familyName: "Astral CLI",
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
                name: "A",
                unicode: 0x41,
                advanceWidth: 600,
                path,
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
