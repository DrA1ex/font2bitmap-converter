// Font loading utilities
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import opentype from "opentype.js";

const {parse: parseOpenType} = opentype;
import * as Bitmap from "../bitmap.js";
import * as defs from "../defs.js";

const FontCache = {
    fontName: null,
    fontSize: null,
    optionsKey: null,
    bitmapFont: null,
};

export async function loadFont(family, size, options = {}) {
    const optionsKey = stableOptionsKey(options);
    if (
        FontCache.fontName !== family
        || FontCache.fontSize !== size
        || FontCache.optionsKey !== optionsKey
        || !FontCache.bitmapFont
    ) {
        const source = defs.UserFonts[family] || defs.BuiltinFonts[family];
        if (!source) throw new Error(`Unknown font: ${family}`);

        let fontFace = source;
        if (typeof source === "string") {
            fontFace = await loadOpenTypeUrl(source);
            defs.BuiltinFonts[family] = fontFace;
        }

        const bitmapFont = Bitmap.convertFontToBitmap(fontFace, family, size, options);
        FontCache.fontName = family;
        FontCache.fontSize = size;
        FontCache.optionsKey = optionsKey;
        FontCache.bitmapFont = bitmapFont;
    }

    return FontCache.bitmapFont;
}

export async function importFont(file) {
    const buffer = await file.arrayBuffer();

    try {
        const font = parseOpenType(buffer);
        const fontName = localizedName(font.names?.fullName)
            || file.name.replace(/\.(ttf|otf|woff)$/i, "");

        if (defs.UserFonts[fontName] === undefined) {
            defs.UserFonts[fontName] = font;
            return {fontName, font};
        }
    } catch (error) {
        console.error(error);
        alert("Unable to load font!");
    }

    return null;
}

async function loadOpenTypeUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load font ${url}: HTTP ${response.status}`);
    }

    return parseOpenType(await response.arrayBuffer());
}

function localizedName(nameRecord) {
    if (!nameRecord || typeof nameRecord !== "object") return null;
    return nameRecord.en || Object.values(nameRecord).find(value => typeof value === "string") || null;
}

function stableOptionsKey(options) {
    return JSON.stringify({
        charSet: options.charSet,
        rangeMode: options.rangeMode,
        bpp: options.bpp,
        dpi: options.dpi,
        dpiBase: options.dpiBase,
        floorRasterSize: options.floorRasterSize,
        abiProfile: options.abiProfile,
        strict: options.strict,
        allowLargeDense: options.allowLargeDense,
    });
}
