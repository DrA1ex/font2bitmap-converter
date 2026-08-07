// Converter definitions
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import * as CommonUtils from "./utils/common.js";
import {
    CharsetSelection,
    FontAbiProfile,
    GLYPH_RANGE_ABI_SIZE,
    GLYPH_RANGE_COMPACT16_ABI_SIZE,
    RangeMode,
    RangeModeLabel,
    normalizeFontAbiProfile,
} from "./range.js";

export const BuiltinFonts = {
    "Roboto": "./fonts/Roboto-Regular.ttf",
    "Roboto Bold": "./fonts/Roboto-Bold.ttf",
    "Roboto Thin": "./fonts/Roboto-Thin.ttf",
    "JetBrainsMono": "./fonts/JetBrainsMono-Regular.ttf",
    "JetBrainsMono Bold": "./fonts/JetBrainsMono-Bold.ttf",
    "JetBrainsMono Thin": "./fonts/JetBrainsMono-Thin.ttf",
};

export const UserFonts = {};

function mergeCharsets(...charsets) {
    const characters = new Map();
    for (const charset of charsets) {
        for (const character of Array.from(charset)) {
            characters.set(character.codePointAt(0), character);
        }
    }
    return Array.from(characters.entries())
        .sort(([left], [right]) => left - right)
        .map(([, character]) => character)
        .join("");
}

const BasicLatin = CommonUtils.generateString(" ", "~");
const EuropeanPunctuation =
    "\u00a1\u00aa\u00ab\u00b7\u00ba\u00bb\u00bf"
    + "\u2010\u2011\u2012\u2013\u2014\u2018\u2019\u201a"
    + "\u201c\u201d\u201e\u2022\u2026\u2039\u203a\u20ac";
// Compact Western European coverage for common French, German, Italian,
// Spanish, Portuguese, Dutch, and related Latin-script localizations.
// Nordic and Central/Eastern European letters are intentionally reserved
// for Full European.
const BasicEuropeanLetters =
    "\u00c0\u00c1\u00c2\u00c3\u00c4\u00c7\u00c8\u00c9\u00ca\u00cb"
    + "\u00cc\u00cd\u00ce\u00cf\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6"
    + "\u00d9\u00da\u00db\u00dc\u00df"
    + "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e7\u00e8\u00e9\u00ea\u00eb"
    + "\u00ec\u00ed\u00ee\u00ef\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6"
    + "\u00f9\u00fa\u00fb\u00fc\u00ff"
    + "\u0152\u0153\u0178\u1e9e";
// Basic Slavic is deliberately Russian-first: add only the core Ukrainian
// and Belarusian letters needed by common localizations. Serbian and
// Macedonian-specific letters are reserved for Full Slavic.
const BasicSlavicLetters =
    "\u0404\u0406\u0407\u040e"
    + "\u0454\u0456\u0457\u045e"
    + "\u0490\u0491";

export const FontRanges = {
    default: BasicLatin,
    light: CommonUtils.generateString("A", "Z", "0", "9") + " ,.!?",
    russian: CommonUtils.generateString(" ", "~", "А", "Я", "а", "я") + "ёЁ",
    basicEuropean: mergeCharsets(
        BasicLatin,
        BasicEuropeanLetters,
        EuropeanPunctuation
    ),
    fullEuropean: mergeCharsets(
        BasicLatin,
        CommonUtils.generateString("\u00a0", "\u017f"),
        "\u0218\u0219\u021a\u021b\u1e9e",
        EuropeanPunctuation
    ),
    basicSlavic: mergeCharsets(
        CommonUtils.generateString(" ", "~", "А", "Я", "а", "я"),
        "ёЁ",
        BasicSlavicLetters
    ),
    fullSlavic: mergeCharsets(
        BasicLatin,
        CommonUtils.generateString("\u0400", "\u045f"),
        "\u0490\u0491"
    ),
    all: Object.freeze({kind: CharsetSelection.ALL_FONT_GLYPHS}),
};

export const FontRangeLabels = {
    default: "Default",
    light: "Light",
    russian: "Russian",
    basicEuropean: "Basic European",
    fullEuropean: "Full European",
    basicSlavic: "Basic Slavic",
    fullSlavic: "Full Slavic",
    all: "All",
    custom: "Custom",
};

export const RangeModeOptions = {
    [RangeModeLabel[RangeMode.DENSE]]: RangeMode.DENSE,
    [RangeModeLabel[RangeMode.COMPACT]]: RangeMode.COMPACT,
    [RangeModeLabel[RangeMode.ASCII_FIRST]]: RangeMode.ASCII_FIRST,
};

export const Scales = [1, 2, 3, 4];
export const PreviewSymbolsCount = 5;
export const FontBitmapAbiVersion = 2;
export const FontBitmapCompact16AbiVersion = 1;
export const FontBitmapExtendedAbiVersion = 1;
export const FontBitmapExtendedCompact16AbiVersion = 1;

export const AbiProfileOptions = {
    "Unicode32 (full Unicode)": FontAbiProfile.UNICODE32,
    "compact16 (BMP only)": FontAbiProfile.COMPACT16,
};

function memoryUsage(font, glyphAbiSize, rangeAbiSize = 0) {
    const bitmapBytes = Math.max(1, font.buffer.byteLength);
    const glyphBytes = font.glyphs.length * glyphAbiSize;
    const rangeBytes = (font.ranges?.length || 0) * rangeAbiSize;
    return {
        bitmapBytes,
        glyphCount: font.glyphs.length,
        glyphBytes,
        rangeCount: font.ranges?.length || 0,
        rangeBytes,
        dataBytes: bitmapBytes + glyphBytes + rangeBytes,
    };
}

const CustomFormatBase = {
    kind: "custom",
    extended: false,
    abiProfile: FontAbiProfile.UNICODE32,
    abiProfileLabel: "Unicode32",
    dpi: 222,
    // Preserve the converter's original Custom-size behavior:
    // floor(size * dpi / 96). Adafruit is also configured with a /96 base.
    dpiBase: 96,
    floorRasterSize: true,
    supportedRangeModes: [RangeMode.DENSE, RangeMode.COMPACT, RangeMode.ASCII_FIRST],
    glyphAbiSize: 16,
    rangeAbiSize: GLYPH_RANGE_ABI_SIZE,

    align: "    ",
    maxRowSize: 80,

    header: `#pragma once\n\n#include "./types.h"\n\n#if FONT_BITMAP_ABI_VERSION != ${FontBitmapAbiVersion}\n#error "Incompatible font bitmap ABI: expected version ${FontBitmapAbiVersion}"\n#endif\n`,
    declarationBitmaps: "static const uint8_t %fontKey%Bitmaps[] = {",
    declarationGlyphs: "static const Glyph %fontKey%Glyphs[] = {",
    declarationRanges: "static const GlyphRange %fontKey%Ranges[] = {",
    entryGlyph: "{ %offset%, %width%, %height%, %advanceX%, %offsetX%, %offsetY% },",
    commentGlyph: " // %charCode%\t'%char%'\t%name%",
    emptyGlyph: "{ 0, 0, 0, 0, 0, 0 },",
    entryRange: "{ %rangeCodeFrom%, %rangeCodeTo%, %glyphOffset% },",
    declarationsFont: [
        "static const Font %fontKey% = {",
        `    \"%fontDisplayName%\",`,
        `    %fontKey%Bitmaps,`,
        `    %fontKey%Glyphs,`,
        `    %rangePointer%,`,
        `    (uint32_t) sizeof(%fontKey%Bitmaps),`,
        `    %codeFrom%, %codeTo%,`,
        `    %rangeCount%, %glyphCount%,`,
        `    %advanceY%, %bpp%, %flags%, // %rangeModeName%`,
        "};",
    ],
    memory(font) {
        return memoryUsage(font, this.glyphAbiSize, this.rangeAbiSize);
    },
};

const CustomExtendedFormatBase = {
    ...CustomFormatBase,
    extended: true,
    header: `#pragma once\n\n#include "./types_extended.h"\n\n#if FONT_BITMAP_EXTENDED_ABI_VERSION != ${FontBitmapExtendedAbiVersion}\n#error "Incompatible extended font bitmap ABI: expected version ${FontBitmapExtendedAbiVersion}"\n#endif\n`,
    declarationsFont: [
        "static const Font %fontKey% = {",
        `    \"%fontDisplayName%\",`,
        `    %fontKey%Bitmaps,`,
        `    %fontKey%Glyphs,`,
        `    %rangePointer%,`,
        `    (uint32_t) sizeof(%fontKey%Bitmaps),`,
        `    %codeFrom%, %codeTo%,`,
        `    %rangeCount%, %glyphCount%,`,
        `    %advanceY%, %bpp%, %flags%, // %rangeModeName%`,
        `    { %ascent%, %descent%, %inkTop%, %inkBottom% },`,
        "};",
    ],
};

const Compact16Overrides = {
    abiProfile: FontAbiProfile.COMPACT16,
    abiProfileLabel: "compact16",
    supportedRangeModes: [RangeMode.COMPACT],
    rangeAbiSize: GLYPH_RANGE_COMPACT16_ABI_SIZE,
    header: `#pragma once\n\n#include "./types_compact16.h"\n\n#if FONT_BITMAP_COMPACT16_ABI_VERSION != ${FontBitmapCompact16AbiVersion}\n#error "Incompatible compact16 font bitmap ABI: expected version ${FontBitmapCompact16AbiVersion}"\n#endif\n`,
    declarationsFont: [
        "static const Font %fontKey% = {",
        `    "%fontDisplayName%",`,
        `    %fontKey%Bitmaps,`,
        `    %fontKey%Glyphs,`,
        `    %rangePointer%,`,
        `    (uint32_t) sizeof(%fontKey%Bitmaps),`,
        `    (uint16_t) %codeFrom%, (uint16_t) %codeTo%,`,
        `    (uint16_t) %rangeCount%, (uint16_t) %glyphCount%,`,
        `    %advanceY%, %bpp%, %flags%, // Compact / compact16`,
        "};",
    ],
};

const Compact16ExtendedOverrides = {
    ...Compact16Overrides,
    header: `#pragma once\n\n#include "./types_extended_compact16.h"\n\n#if FONT_BITMAP_EXTENDED_COMPACT16_ABI_VERSION != ${FontBitmapExtendedCompact16AbiVersion}\n#error "Incompatible extended compact16 font bitmap ABI: expected version ${FontBitmapExtendedCompact16AbiVersion}"\n#endif\n`,
    declarationsFont: [
        "static const Font %fontKey% = {",
        `    \"%fontDisplayName%\",`,
        `    %fontKey%Bitmaps,`,
        `    %fontKey%Glyphs,`,
        `    %rangePointer%,`,
        `    (uint32_t) sizeof(%fontKey%Bitmaps),`,
        `    (uint16_t) %codeFrom%, (uint16_t) %codeTo%,`,
        `    (uint16_t) %rangeCount%, (uint16_t) %glyphCount%,`,
        `    %advanceY%, %bpp%, %flags%, // Compact / compact16`,
        `    { %ascent%, %descent%, %inkTop%, %inkBottom% },`,
        "};",
    ],
};

export function resolveExportFormat(format, profile = FontAbiProfile.UNICODE32) {
    if (!format || format.kind !== "custom") return format;
    profile = normalizeFontAbiProfile(profile);
    if (profile === FontAbiProfile.UNICODE32) return format;
    return {
        ...format,
        ...(format.extended ? Compact16ExtendedOverrides : Compact16Overrides),
    };
}

export const ExportFormats = {
    Adafruit: {
        kind: "adafruit",
        bpp: 1,
        dpi: 141,
        dpiBase: 96,
        floorRasterSize: true,
        supportedRangeModes: [RangeMode.DENSE],
        glyphAbiSize: 7,
        rangeAbiSize: 0,

        align: "    ",
        maxRowSize: 80,

        header: "#pragma once\n#include <Adafruit_GFX.h>\n",
        declarationBitmaps: "static const uint8_t %fontKey%Bitmaps[] PROGMEM = {",
        declarationGlyphs: "static const GFXglyph %fontKey%Glyphs[] PROGMEM = {",
        entryGlyph: "{ %offset%, %width%, %height%, %advanceX%, %offsetX%, %offsetY% },",
        commentGlyph: " // %charCode% '%char%'",
        emptyGlyph: "{ 0, 0, 0, 0, 0, 0 },",
        declarationsFont: [
            "static const GFXfont %fontKey% PROGMEM = {",
            `    (uint8_t *) %fontKey%Bitmaps,`,
            `    (GFXglyph *) %fontKey%Glyphs,`,
            `    %codeFrom%, %codeTo%,`,
            `    %advanceY%,`,
            "};",
        ],
        memory(font) {
            return memoryUsage(font, this.glyphAbiSize, 0);
        },
    },

    Custom: {
        ...CustomFormatBase,
        bpp: 1,
    },
    "Custom Extended": {
        ...CustomExtendedFormatBase,
        bpp: 1,
    },
    Typer: {
        kind: "typer",
        extended: true,
        abiProfile: FontAbiProfile.COMPACT16,
        abiProfileLabel: "Typer",
        metricAbi: "full16",
        bpp: 1,
        dpi: 222,
        dpiBase: 96,
        floorRasterSize: true,
        supportedRangeModes: [RangeMode.COMPACT],
        glyphAbiSize: 16,
        rangeAbiSize: GLYPH_RANGE_COMPACT16_ABI_SIZE,

        align: "    ",
        maxRowSize: 80,

        header: `#pragma once\n\n#include "./types_typer.h"\n`,
        declarationBitmaps: "static const uint8_t %fontKey%Bitmaps[] = {",
        declarationGlyphs: "static const Glyph %fontKey%Glyphs[] = {",
        declarationRanges: "static const GlyphRange %fontKey%Ranges[] = {",
        entryGlyph: "{ %offset%, %width%, %height%, %advanceX%, %offsetX%, %offsetY% },",
        commentGlyph: " // %charCode%\t'%char%'\t%name%",
        emptyGlyph: "{ 0, 0, 0, 0, 0, 0 },",
        entryRange: "{ %rangeCodeFrom%, %rangeCodeTo%, %glyphOffset% },",
        declarationsFont: [
            "static const Font %fontKey% = {",
            `    "%fontDisplayName%",`,
            `    %fontKey%Bitmaps,`,
            `    %fontKey%Glyphs,`,
            `    %rangePointer%,`,
            `    %bpp%,`,
            `    (uint16_t) %codeFrom%, (uint16_t) %codeTo%,`,
            `    %advanceY%,`,
            `    (uint16_t) %rangeCount%, (uint16_t) %glyphCount%,`,
            `    { %ascent%, %descent%, %inkTop%, %inkBottom% },`,
            "};",
        ],
        memory(font) {
            return memoryUsage(font, this.glyphAbiSize, this.rangeAbiSize);
        },
    },
};

export const BppOptions = [1, 2, 4, 8];

// Keep the old programmatic format keys available without exposing them as
// separate UI choices. Existing callers can still request Custom 1/2/4/8bpp.
for (const bpp of BppOptions) {
    Object.defineProperty(ExportFormats, `Custom ${bpp}bpp`, {
        value: {...ExportFormats.Custom, bpp},
        enumerable: false,
    });
}
