// Consts
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import * as CommonUtils from "./utils/common";

export const BuiltinFonts = {
    "Roboto": "./fonts/Roboto-Regular.ttf",
    "Roboto Bold": "./fonts/Roboto-Bold.ttf",
    "Roboto Thin": "./fonts/Roboto-Thin.ttf",
    "JetBrainsMono": "./fonts/JetBrainsMono-Regular.ttf",
    "JetBrainsMono Bold": "./fonts/JetBrainsMono-Bold.ttf",
    "JetBrainsMono Thin": "./fonts/JetBrainsMono-Thin.ttf",
}

export const UserFonts = {};

export const FontRanges = {
    "default": CommonUtils.generateString(' ', '~'),
    "light": CommonUtils.generateString('a', 'z', 'A', 'Z', '0', '9') + " ,.!?",
    "russian": CommonUtils.generateString(' ', '~', 'А', 'Я', 'а', 'я') + "ёЁ",
}

export const ExportSizes = [12, 16, 20, 28]

const CustomFormatBase = {
    dpi: 222,

    align: "    ",
    maxRowSize: 80,

    header: `#pragma once\n\n#include "./types.h"\n`,
    declarationBitmaps: "const uint8_t %fontKey%Bitmaps[] = {",
    declarationGlyphs: "const Glyph %fontKey%Glyphs[] = {",
    entryGlyph: "{ %offset%, %width%, %height%, %advanceX%, %offsetX%, %offsetY% },",
    commentGlyph: " // %charCode% '%char%'",
    declarationsFont: [
        "const Font %fontKey% = {",
        `    "%fontDisplayName%",`,
        `    (uint8_t *) %fontKey%Bitmaps,`,
        `    (Glyph *) %fontKey%Glyphs,`,
        `    %codeFrom%, %codeTo%,`,
        `    %advanceY%,`,
        "};"
    ],
    size(font) {
        return font.buffer.byteLength
            + 9 * font.glyphs.length // Glyphs structs total size
            + font.name.length
            + 15; // Font struct size
    }
};

export const ExportFormats = {
    Adafruit: {
        bpp: 1,
        dpi: 141,

        align: "    ",
        maxRowSize: 80,

        header: "#pragma once\n#include <Adafruit_GFX.h>\n",
        declarationBitmaps: "const uint8_t %fontKey%Bitmaps[] PROGMEM = {",
        declarationGlyphs: "const GFXglyph %fontKey%Glyphs[] PROGMEM = {",
        entryGlyph: "{ %offset%, %width%, %height%, %advanceX%, %offsetX%, %offsetY% },",
        commentGlyph: " // %charCode% '%char%'",
        declarationsFont: [
            "const GFXfont %fontKey% = {",
            `    (uint8_t *) %fontKey%Bitmaps,`,
            `    (GFXglyph *) %fontKey%Glyphs,`,
            `    %codeFrom%, %codeTo%,`,
            `    %advanceY%,`,
            "};"
        ],
        size(font) {
            return font.buffer.byteLength
                + 7 * font.glyphs.length // Glyphs structs total size
                + 10; // Font struct size
        }
    },

    "Custom 1bpp": {
        bpp: 1,
        ...CustomFormatBase
    },
    "Custom 2bpp": {
        bpp: 2,
        ...CustomFormatBase
    },
    "Custom 4bpp": {
        bpp: 4,
        ...CustomFormatBase
    },
    "Custom 8bpp": {
        bpp: 8,
        ...CustomFormatBase
    }
}