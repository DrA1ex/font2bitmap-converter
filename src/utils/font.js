// Font utils
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import * as Bitmap from "../bitmap";

const FontCache = {
    fontName: null,
    fontSize: null,
    range: null,
    bitmapFont: null,
}

export async function loadFont(family, size, range) {
    if (FontCache.fontName !== family
        || FontCache.fontSize !== size
        || FontCache.range !== range
        || !FontCache.bitmapFont
    ) {
        const fontFace = document.fonts.values().find(f => f.family === family);
        if (!fontFace) throw new Error(`Unknown font ${family}`)

        await fontFace.load();

        FontCache.fontName = family;
        FontCache.fontSize = size;
        FontCache.range = range;
        FontCache.bitmapFont = Bitmap.convertFontToBitmap(family, size, range);
    }

    return FontCache.bitmapFont
}

export async function importFont(file) {
    const buffer = await file.arrayBuffer();
    const fontName = file.name.split(".ttf").join("");
    const font = new FontFace(fontName, buffer);

    try {
        await font.load()
    } catch (e) {
        console.error(e);
        alert("Unable to load font!");
        return;
    }

    document.fonts.add(font);
    return font;
}