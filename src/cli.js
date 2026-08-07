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
import {
    BuiltinFonts,
    ExportFormats,
    NamedFontRangeNames,
    parseFontRangeExpression,
    resolveExportFormat,
} from "./defs.js";
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

    const charset = args.range !== undefined
        ? parseFontRangeExpression(args.range)
        : normalizeCharsetFile(await readFile(args.charsetFile, "utf8"));
    if (Array.from(charset).length === 0) {
        throw new Error(args.range !== undefined
            ? "--range does not select any Unicode code points"
            : "The charset file does not contain any Unicode code points");
    }

    const fontSource = resolveFontSource(args.font);
    const fontBytes = await readFile(fontSource.path);
    const fontBuffer = fontBytes.buffer.slice(
        fontBytes.byteOffset,
        fontBytes.byteOffset + fontBytes.byteLength
    );
    const fontFace = parseOpenType(fontBuffer);
    const format = resolveFormat(args);
    const rangeMode = normalizeRangeMode(args.layout);
    const fontName = args.name || localizedName(fontFace.names?.fullName)
        || fontSource.builtinName
        || basename(fontSource.path).replace(/\.(ttf|otf|woff2?)$/i, "");

    await configureHeadlessCanvas();
    const font = convertFontToBitmap(fontFace, fontName, args.size, {
        charSet: charset,
        rangeMode,
        bpp: format.bpp,
        dpi: args.dpi ?? format.dpi,
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
        profileExplicit: false,
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
            case "--range": result.range = value; break;
            case "--output": result.output = value; break;
            case "--format": result.format = value.toLowerCase(); break;
            case "--dpi": result.dpi = Number(value); break;
            case "--profile":
                result.profile = value.toLowerCase();
                result.profileExplicit = true;
                break;
            default: throw new Error(`Unknown argument: ${argument}`);
        }
    }

    if (result.format === "adafruit" && !result.layoutExplicit) {
        result.layout = RangeMode.DENSE;
    }
    return result;
}

function validateArguments(args) {
    for (const key of ["font", "size", "output"]) {
        if (args[key] === undefined || args[key] === null || args[key] === "") {
            throw new Error(`Missing required option: --${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`);
        }
    }
    const charsetSources = Number(args.charsetFile !== undefined) + Number(args.range !== undefined);
    if (charsetSources === 0) {
        throw new Error("Missing character selection: use either --range or --charset-file");
    }
    if (charsetSources > 1) {
        throw new Error("Use either --range or --charset-file, not both");
    }
    if (!Number.isFinite(args.size) || args.size <= 0) throw new Error("--size must be greater than zero");
    if (![1, 2, 4, 8].includes(args.bpp)) throw new Error("--bpp must be 1, 2, 4, or 8");
    if (!["custom", "custom-extended", "typer", "adafruit"].includes(args.format)) {
        throw new Error("--format must be custom, custom-extended, typer, or adafruit");
    }
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
    if (args.format === "adafruit" && args.profileExplicit) {
        throw new Error("--profile applies only to Custom formats; Adafruit has no Custom ABI profile");
    }
    if (args.profile === FontAbiProfile.COMPACT16 && args.layout !== RangeMode.COMPACT) {
        throw new Error("compact16 supports only --layout compact");
    }
    if (args.format === "typer" && args.layout !== RangeMode.COMPACT) {
        throw new Error("Typer export supports only the Compact layout");
    }
    if (args.format === "typer" && args.profileExplicit) {
        throw new Error("--profile applies only to Custom formats; Typer already uses fixed compact16/BMP ranges");
    }
}

function resolveFormat(args) {
    if (args.format === "adafruit") return ExportFormats.Adafruit;
    if (args.format === "typer") return {...ExportFormats.Typer, bpp: args.bpp};
    const baseFormat = args.format === "custom-extended"
        ? ExportFormats["Custom Extended"]
        : ExportFormats.Custom;
    return {...resolveExportFormat(baseFormat, args.profile), bpp: args.bpp};
}

function normalizeCharsetFile(value) {
    return value.replace(/^\uFEFF/, "").replace(/[\r\n]/g, "");
}

function localizedName(nameRecord) {
    if (!nameRecord || typeof nameRecord !== "object") return null;
    return nameRecord.en || Object.values(nameRecord).find(value => typeof value === "string") || null;
}

function resolveFontSource(value) {
    const requested = String(value);
    const builtinName = Object.keys(BuiltinFonts).find(
        name => name.toLowerCase() === requested.toLowerCase()
    );
    if (!builtinName) return {path: requested, builtinName: null};

    const relativePath = BuiltinFonts[builtinName].replace(/^\.\//, "");
    return {
        path: fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
        builtinName,
    };
}

function helpText() {
    const builtinFonts = Object.keys(BuiltinFonts).map(name => `    ${name}`).join("\n");
    const namedRanges = NamedFontRangeNames.map(name => `:${name}:`).join(", ");

    return `Usage:\n`
        + `  font2bitmap --font FONT --size PT (--range EXPR | --charset-file FILE) --output HEADER [options]\n\n`
        + `Required:\n`
        + `  --font FONT             Built-in font name or path to TTF/OTF/WOFF font\n`
        + `  --size NUMBER           Font size entered by the converter\n`
        + `  --output PATH           Generated header path, or - for stdout\n\n`
        + `Character selection (choose exactly one):\n`
        + `  --range EXPR            Glyph range expression using the web/custom syntax\n`
        + `  --charset-file PATH     UTF-8 characters to export; BOM/newlines are ignored\n\n`
        + `Options:\n`
        + `  --format FORMAT         custom, custom-extended, typer, or adafruit (default: custom)\n`
        + `  --bpp 1|2|4|8           Bitmap depth for Custom/Typer formats (default: 1)\n`
        + `  --layout MODE           dense, compact, or ascii-first (default: compact)\n`
        + `  --profile PROFILE       unicode32 or compact16 (Custom default: unicode32)\n`
        + `  --dpi NUMBER            Override the web-format DPI; omitted = same DPI as web UI\n`
        + `  --name NAME             Override the exported font name\n`
        + `  --strict                Fail when any selected code point is missing\n`
        + `  --allow-large-dense     Allow Dense spans above the safety limit\n`
        + `  --help                  Show this help\n\n`
        + `Formats:\n`
        + `  custom                  Legacy Custom ABI; layouts: dense, compact, ascii-first\n`
        + `  custom-extended         Custom ABI + ascent/descent/ink bounds; same layouts\n`
        + `  typer                   Typer ABI; fixed compact layout and compact16/BMP ranges\n`
        + `  adafruit                Adafruit GFX output; fixed dense layout and 1 bpp\n\n`
        + `Profiles (Custom formats):\n`
        + `  unicode32               Full Unicode code points/ranges\n`
        + `  compact16               BMP-only 16-bit ranges; requires compact layout\n\n`
        + `Layouts:\n`
        + `  dense                   One glyph slot for every code point in the selected span\n`
        + `  compact                 Store only selected glyphs and map them with GlyphRange\n`
        + `  ascii-first             Reserve glyph[0..127] for ASCII, then append extensions\n\n`
        + `DPI defaults (same as web UI):\n`
        + `  custom/custom-extended/typer: 222 DPI\n`
        + `  adafruit:                       141 DPI\n`
        + `  --dpi changes only this rasterization value.\n\n`
        + `Built-in fonts (case-insensitive; quote names containing spaces):\n`
        + `${builtinFonts}\n\n`
        + `Range syntax:\n`
        + `  Named ranges: ${namedRanges}\n`
        + `  Combine with semicolons, for example :russian:;:basic_european:\n`
        + `  Literal/hex forms are also accepted: A-Z;a-z;0x410-0x44f;0x20ac\n`
        + `  Escape special characters as \\;, \\-, and \\\\.\n\n`
        + `Examples:\n`
        + `  font2bitmap --font JetBrainsMono --size 8 --format typer --bpp 4 --range ':russian:;:basic_european:' --output JetBrainsMono8.h\n`
        + `  font2bitmap --font 'Roboto Bold' --size 20 --format custom-extended --layout compact --profile unicode32 --range ':default:' --output Roboto20.h\n`
        + `  font2bitmap --font ./font.ttf --size 14 --charset-file ./charset.txt --dpi 180 --output ./font.h\n`;
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
