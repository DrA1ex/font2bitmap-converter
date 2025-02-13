// Font utils
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import opentype from 'opentype.js'

import * as Bitmap from "../bitmap.js";

import * as defs from "../defs.js";

const FontCache = {
    fontName: null,
    fontSize: null,
    options: {},
    bitmapFont: null,
}

export async function loadFont(family, size, options = {}) {
    if (FontCache.fontName !== family
        || FontCache.fontSize !== size
        || JSON.stringify(FontCache.options) !== JSON.stringify(options)
        || !FontCache.bitmapFont
    ) {
        //const fontFace = document.fonts.values().find(f => f.family === family);
        //if (!fontFace) throw new Error(`Unknown font ${family}`)

        //await fontFace.load();

        const font = defs.UserFonts[family] || defs.BuiltinFonts[family];
        if (!font) throw new Error("Unknown font: " + family);

        const fontFace = typeof font === "string"
                         ? (await opentype.load(font)) : font;

        FontCache.fontName = family;
        FontCache.fontSize = size;
        FontCache.options = options;
        FontCache.fontFace = fontFace;
        FontCache.bitmapFont = Bitmap.convertFontToBitmap(fontFace, family, size, options);
    }

    return FontCache.bitmapFont
}

export async function importFont(file) {
    const buffer = await file.arrayBuffer();
    const fontName = file.name.split(".ttf").join("");

    try {
        const font = opentype.parse(buffer, null);
        defs.UserFonts[fontName] = font;

        return {fontName, font};
    } catch (e) {
        console.error(e);
        alert("Unable to load font!");
    }

    return null;
}

export function getMetrics(fontFace, char, fontSize) {
    const fontGlyph = fontFace.charToGlyph(char);
    const fontScale = fontSize / fontFace.glyphs.get(0).path.unitsPerEm;
    const metrics = fontGlyph.getMetrics();

    const result = {
        xMin: Math.floor(metrics.xMin * fontScale),
        xMax: Math.ceil(metrics.xMax * fontScale),
        yMin: Math.floor(metrics.yMin * fontScale),
        yMax: Math.ceil(metrics.yMax * fontScale),
        leftSideBearing: Math.floor(metrics.leftSideBearing * fontScale),
        advanceWidth: Math.round(fontGlyph.advanceWidth * fontScale)
    };

    result.width = Math.max(1, Math.abs(result.xMax) + Math.abs(result.xMin));
    result.height = Math.max(1, Math.abs(result.yMax) + Math.abs(result.yMin));

    return result;
}