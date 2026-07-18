#!/usr/bin/env node
// Headless bitmap font generator
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import {realpathSync} from "node:fs";
import {readFile, writeFile} from "node:fs/promises";
import {basename} from "node:path";
import {fileURLToPath} from "node:url";
import process from "node:process";

import opentype from "opentype.js";

import {
    MissingGlyphsError,
    convertFontToBitmap,
    setCanvasFactory,
} from "./bitmap.js";
import {ExportFormats, resolveExportFormat} from "./defs.js";
import {renderFontHeader} from "./export.js";
import {
    DenseSpanError,
    FontAbiProfile,
    RangeMode,
    formatCodePoint,
    normalizeFontAbiProfile,
    normalizeRangeMode,
} from "./range.js";

const {parse: parseOpenType} = opentype;

async function configureHeadlessCanvas() {
    let canvasModule;
    try {
        canvasModule = await import("@napi-rs/canvas");
    } catch (error) {
        if (error?.code !== "ERR_MODULE_NOT_FOUND"
            && !String(error?.message || error).includes("@napi-rs/canvas")) {
            throw error;
        }
        throw new Error(
            "The headless CLI requires the optional @napi-rs/canvas package. "
            + "Install optional dependencies with `npm install --include=optional`, "
            + "or install it directly with `npm install @napi-rs/canvas`. "
            + "The browser converter does not require this package."
        );
    }

    if (typeof canvasModule.createCanvas !== "function") {
        throw new Error("The installed @napi-rs/canvas package does not export createCanvas()");
    }
    setCanvasFactory(() => canvasModule.createCanvas(1, 1));
}

export async function runCli(argv = process.argv.slice(2)) {
    const args = parseArguments(argv);
    if (args.help) {
        process.stdout.write(helpText());
        return 0;
    }

    validateArguments(args);
    await configureHeadlessCanvas();

    const fontBytes = await readFile(args.font);
    const fontBuffer = fontBytes.buffer.slice(
        fontBytes.byteOffset,
        fontBytes.byteOffset + fontBytes.byteLength
    );
    const fontFace = parseOpenType(fontBuffer);
    const charset = normalizeCharsetFile(await readFile(args.charsetFile, "utf8"));
    if (Array.from(charset).length === 0) {
        throw new Error("The charset file does not contain any Unicode code points");
    }

    const format = resolveFormat(args);
    const rangeMode = normalizeRangeMode(args.layout);
    const fontName = args.name || localizedName(fontFace.names?.fullName)
        || basename(args.font).replace(/\.(ttf|otf|woff2?)$/i, "");

    const font = convertFontToBitmap(fontFace, fontName, args.size, {
        charSet: charset,
        rangeMode,
        bpp: format.bpp,
        dpi: args.dpi || format.dpi,
        dpiBase: format.dpiBase,
        floorRasterSize: format.floorRasterSize,
        strict: args.strict,
        allowLargeDense: args.allowLargeDense,
        abiProfile: format.abiProfile || FontAbiProfile.UNICODE32,
    });

    const {content} = renderFontHeader(font, {format, bpp: format.bpp});
    if (args.output === "-") {
        process.stdout.write(content);
    } else {
        await writeFile(args.output, content, "utf8");
    }

    for (const warning of font.warnings || []) process.stderr.write(`warning: ${warning}\n`);
    if (font.missingCodePoints.length > 0) {
        process.stderr.write(
            `warning: missing code points: ${font.missingCodePoints.map(formatCodePoint).join(", ")}\n`
        );
    }

    return 0;
}

function parseArguments(argv) {
    const result = {
        format: "custom",
        bpp: 1,
        layout: RangeMode.COMPACT,
        layoutExplicit: false,
        strict: false,
        allowLargeDense: false,
        dpi: null,
        profile: FontAbiProfile.UNICODE32,
        help: false,
    };

    for (let index = 0; index < argv.length; ++index) {
        const argument = argv[index];
        if (argument === "--strict") {
            result.strict = true;
            continue;
        }
        if (argument === "--allow-large-dense") {
            result.allowLargeDense = true;
            continue;
        }
        if (argument === "--help" || argument === "-h") {
            result.help = true;
            continue;
        }

        const value = argv[++index];
        if (value === undefined) throw new Error(`Missing value for ${argument}`);
        switch (argument) {
            case "--font": result.font = value; break;
            case "--name": result.name = value; break;
            case "--size": result.size = Number(value); break;
            case "--bpp": result.bpp = Number(value); break;
            case "--layout":
                result.layout = value;
                result.layoutExplicit = true;
                break;
            case "--charset-file": result.charsetFile = value; break;
            case "--output": result.output = value; break;
            case "--format": result.format = value.toLowerCase(); break;
            case "--dpi": result.dpi = Number(value); break;
            case "--profile": result.profile = value.toLowerCase(); break;
            default: throw new Error(`Unknown argument: ${argument}`);
        }
    }

    if (result.format === "adafruit" && !result.layoutExplicit) {
        result.layout = RangeMode.DENSE;
    }
    return result;
}

function validateArguments(args) {
    for (const key of ["font", "size", "charsetFile", "output"]) {
        if (args[key] === undefined || args[key] === null || args[key] === "") {
            throw new Error(`Missing required option: --${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`);
        }
    }
    if (!Number.isFinite(args.size) || args.size <= 0) throw new Error("--size must be greater than zero");
    if (![1, 2, 4, 8].includes(args.bpp)) throw new Error("--bpp must be 1, 2, 4, or 8");
    if (!["custom", "adafruit"].includes(args.format)) throw new Error("--format must be custom or adafruit");
    args.profile = normalizeFontAbiProfile(args.profile);
    if (!Object.values(RangeMode).includes(args.layout)) {
        throw new Error("--layout must be dense, compact, or ascii-first");
    }
    if (args.dpi !== null && (!Number.isFinite(args.dpi) || args.dpi <= 0)) {
        throw new Error("--dpi must be greater than zero");
    }
    if (args.format === "adafruit" && args.bpp !== 1) {
        throw new Error("Adafruit export supports only 1 bpp");
    }
    if (args.format === "adafruit" && args.layout !== RangeMode.DENSE) {
        throw new Error("Adafruit export supports only the Dense layout");
    }
    if (args.format === "adafruit" && args.profile !== FontAbiProfile.UNICODE32) {
        throw new Error("Adafruit export does not use a Custom ABI profile");
    }
    if (args.profile === FontAbiProfile.COMPACT16 && args.layout !== RangeMode.COMPACT) {
        throw new Error("compact16 supports only --layout compact");
    }
}

function resolveFormat(args) {
    if (args.format === "adafruit") return ExportFormats.Adafruit;
    const format = ExportFormats[`Custom ${args.bpp}bpp`];
    if (!format) throw new Error(`No Custom export format for ${args.bpp} bpp`);
    return resolveExportFormat(format, args.profile);
}

function normalizeCharsetFile(value) {
    return value.replace(/^\uFEFF/, "").replace(/[\r\n]/g, "");
}

function localizedName(nameRecord) {
    if (!nameRecord || typeof nameRecord !== "object") return null;
    return nameRecord.en || Object.values(nameRecord).find(value => typeof value === "string") || null;
}

function helpText() {
    return `Usage: font2bitmap --font FONT --size PT --charset-file FILE --output HEADER [options]\n\n`
        + `Required:\n`
        + `  --font PATH             Input TTF/OTF/WOFF font\n`
        + `  --size NUMBER           Font size entered by the converter\n`
        + `  --charset-file PATH     UTF-8 characters to export; BOM and line breaks are ignored\n`
        + `  --output PATH           Generated header path, or - for stdout\n\n`
        + `Options:\n`
        + `  --bpp 1|2|4|8           Custom output depth (default: 1)\n`
        + `  --layout MODE           dense, compact, or ascii-first (default: compact)\n`
        + `  --profile PROFILE       unicode32 or compact16 (default: unicode32)\n`
        + `  --strict                Fail when any selected code point is missing\n`
        + `  --format FORMAT         custom or adafruit (default: custom)\n`
        + `  --dpi NUMBER            Override the selected format DPI\n`
        + `  --name NAME             Override the exported font name\n`
        + `  --allow-large-dense     Allow Dense spans above the safety limit\n`
        + `  --help                   Show this help\n`;
}

function isDirectExecution() {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isDirectExecution()) {
    runCli().then(
        code => { process.exitCode = code; },
        error => {
            if (error instanceof MissingGlyphsError) {
                process.stderr.write(`error: ${error.message}\n`);
            } else if (error instanceof DenseSpanError) {
                process.stderr.write(`error: ${error.message}\n`);
            } else {
                process.stderr.write(`error: ${error?.message || error}\n`);
            }
            process.exitCode = 1;
        }
    );
}
