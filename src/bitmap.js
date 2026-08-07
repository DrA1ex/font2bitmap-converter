// Bitmap generation
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import {PackedImageWriter} from "./misc/image_writer.js";
import * as GlyphUtils from "./utils/glyph.js";
import {
    ASCII_TO,
    CharsetSelection,
    GLYPH_RANGE_ABI_SIZE,
    GLYPH_RANGE_COMPACT16_ABI_SIZE,
    FontAbiProfile,
    RangeMode,
    RangeModeLabel,
    SURROGATE_FROM,
    SURROGATE_TO,
    buildGlyphRanges,
    buildRangePlan,
    rangeModeFlags,
    validateGlyphRanges,
    validateFontAbi,
    normalizeFontAbiProfile,
    validateCompact16CodePoints,
    formatCodePoint,
} from "./range.js";

const SupportedBpp = new Set([1, 2, 4, 8]);
const RasterPadding = 1;
const SupersampleScale = 4;

let CanvasFactory = null;

export class Font {
    name = "";
    bpp = 1;
    buffer = new Uint8Array();
    bitmapSize = 1;
    glyphs = [];
    ranges = [];
    flags = 0;
    rangeMode = RangeMode.DENSE;
    rangeModeLabel = RangeModeLabel[RangeMode.DENSE];
    rangeCount = 0;
    glyphCount = 0;
    rangeBytes = 0;
    codeFrom = 0;
    codeTo = 0;
    advanceY = 0;
    metrics = {
        ascent: 0,
        descent: 0,
        inkTop: 0,
        inkBottom: 0,
    };
    pointSize = 0;
    rasterSize = 0;
    dpi = 0;
    missingCodePoints = [];
    warnings = [];
}

export class MissingGlyphsError extends Error {
    constructor(fontName, missingCodePoints, font = null, message = null) {
        const codes = Array.from(new Set(missingCodePoints)).sort((a, b) => a - b);
        super(message || `Font "${fontName}" is missing ${codes.length} selected glyph(s): ${codes.map(formatCodePoint).join(", ")}`);
        this.name = "MissingGlyphsError";
        this.fontName = fontName;
        this.missingCodePoints = codes;
        this.font = font;
    }
}

export function setCanvasFactory(factory) {
    if (factory !== null && typeof factory !== "function") {
        throw new TypeError("Canvas factory must be a function or null");
    }
    CanvasFactory = factory;
}

export class Glyph {
    char = null;
    charCode = null;
    name = null;
    present = false;
    offset = 0;
    width = 0;
    height = 0;
    advanceX = 0;
    offsetX = 0;
    offsetY = 0;
}

/**
 * Converts a parsed OpenType font to a packed bitmap font.
 *
 * @typedef {import("opentype.js").Font} OpentypeFont
 *
 * @param {OpentypeFont} fontFace Parsed OpenType font.
 * @param {string} fontName Display name.
 * @param {number} fontSize Size entered in the UI.
 * @param {object} options Conversion options.
 * @param {string|{kind: string}} options.charSet Characters selected for export.
 * @param {string} [options.rangeMode="dense"] Glyph range layout.
 * @param {number} [options.bpp=1] Bits per pixel: 1, 2, 4, or 8.
 * @param {number} [options.dpi=222] Target display DPI.
 * @param {number} [options.dpiBase=96] Size conversion denominator.
 * @param {boolean} [options.floorRasterSize=false] Floor converted pixel size.
 * @param {boolean} [options.strict=false] Reject selected code points missing from the font.
 * @param {boolean} [options.allowLargeDense=false] Allow Dense spans above the safety limit.
 * @param {string} [options.abiProfile="unicode32"] Export ABI profile.
 * @returns {Font}
 */
export function convertFontToBitmap(
    fontFace,
    fontName,
    fontSize,
    {
        charSet,
        rangeMode = RangeMode.DENSE,
        bpp = 1,
        dpi = 222,
        dpiBase = 96,
        floorRasterSize = false,
        strict = false,
        allowLargeDense = false,
        abiProfile = FontAbiProfile.UNICODE32,
    }
) {
    validateConversionArguments(fontFace, fontSize, charSet, bpp, dpi, dpiBase);

    const pointSize = Number(fontSize);
    const rawRasterSize = pointSize * Number(dpi) / Number(dpiBase);
    const rasterSize = floorRasterSize ? Math.floor(rawRasterSize) : rawRasterSize;
    if (!(rasterSize > 0)) throw new RangeError(`Invalid raster size: ${rasterSize}`);

    abiProfile = normalizeFontAbiProfile(abiProfile);
    const selectedCodes = resolveSelectedCodePoints(fontFace, charSet);
    const isAllFontGlyphs = charSet?.kind === CharsetSelection.ALL_FONT_GLYPHS;
    if (abiProfile === FontAbiProfile.COMPACT16) {
        if (rangeMode !== RangeMode.COMPACT) {
            throw new RangeError("compact16 supports only the Compact glyph layout");
        }
        validateCompact16CodePoints(selectedCodes);
    }
    const plan = buildRangePlan(selectedCodes, rangeMode, {
        // Selecting "all" is already the user's explicit decision to export the
        // entire cmap. Keep Dense available even when that produces a large span.
        allowLargeDense: allowLargeDense || isAllFontGlyphs,
        // A Dense cmap span may numerically cross the surrogate block. Those
        // values are emitted only as unreachable zero-placeholder slots.
        allowSurrogateDense: isAllFontGlyphs,
    });
    const glyphs = [];
    const buffer = [];
    const {canvas, context} = createCanvas();

    const missingCodePoints = [];
    const reportMissingGlyph = charCode => {
        missingCodePoints.push(charCode);
    };

    if (plan.mode === RangeMode.DENSE) {
        for (const charCode of plan.baseCodes) {
            if (!plan.selectedSet.has(charCode)) {
                glyphs.push(createPlaceholderGlyph(charCode));
                continue;
            }

            const glyph = renderGlyph(fontFace, charCode, rasterSize, bpp, buffer, canvas, context);
            if (!glyph) {
                reportMissingGlyph(charCode);
                glyphs.push(createPlaceholderGlyph(charCode));
            } else {
                glyphs.push(glyph);
            }
        }
        trimDenseGlyphEdges(glyphs);
    } else if (plan.mode === RangeMode.COMPACT) {
        for (const charCode of plan.extensionCodes) {
            const glyph = renderGlyph(fontFace, charCode, rasterSize, bpp, buffer, canvas, context);
            if (!glyph) {
                reportMissingGlyph(charCode);
                continue;
            }
            glyphs.push(glyph);
        }
    } else {
        for (const charCode of plan.baseCodes) {
            if (!plan.selectedSet.has(charCode)) {
                glyphs.push(createPlaceholderGlyph(charCode));
                continue;
            }

            const glyph = renderGlyph(fontFace, charCode, rasterSize, bpp, buffer, canvas, context);
            if (!glyph) {
                reportMissingGlyph(charCode);
                glyphs.push(createPlaceholderGlyph(charCode));
            } else {
                glyphs.push(glyph);
            }
        }

        for (const charCode of plan.extensionCodes) {
            const glyph = renderGlyph(fontFace, charCode, rasterSize, bpp, buffer, canvas, context);
            if (!glyph) {
                reportMissingGlyph(charCode);
                continue;
            }
            glyphs.push(glyph);
        }
    }

    const presentEntries = glyphs
        .map((glyph, glyphOffset) => ({glyph, glyphOffset}))
        .filter(({glyph}) => glyph.present);

    const normalizedMissingCodePoints = Array.from(new Set(missingCodePoints)).sort((a, b) => a - b);
    if (presentEntries.length === 0) {
        throw new MissingGlyphsError(
            fontName,
            normalizedMissingCodePoints.length > 0 ? normalizedMissingCodePoints : plan.selectedCodes,
            null,
            `Font "${fontName}" does not contain any glyphs from the selected range`
        );
    }

    const rangeEntries = presentEntries
        .filter(({glyph}) => {
            if (plan.mode === RangeMode.COMPACT) return true;
            if (plan.mode === RangeMode.ASCII_FIRST) return glyph.charCode > ASCII_TO;
            return false;
        })
        .map(({glyph, glyphOffset}) => ({codePoint: glyph.charCode, glyphOffset}));
    const ranges = buildGlyphRanges(rangeEntries);
    validateGlyphRanges(ranges, glyphs.length);

    const actualCodes = presentEntries.map(({glyph}) => glyph.charCode).sort((a, b) => a - b);
    const result = new Font();
    result.name = `${fontName} ${pointSize}pt`;
    result.bpp = bpp;
    result.buffer = Uint8Array.from(buffer);
    result.bitmapSize = Math.max(1, result.buffer.byteLength);
    result.glyphs = glyphs;
    result.ranges = ranges;
    result.rangeMode = plan.mode;
    result.rangeModeLabel = RangeModeLabel[plan.mode];
    result.flags = rangeModeFlags(plan.mode);
    result.rangeCount = ranges.length;
    result.glyphCount = glyphs.length;
    result.rangeBytes = ranges.length * (
        abiProfile === FontAbiProfile.COMPACT16
            ? GLYPH_RANGE_COMPACT16_ABI_SIZE
            : GLYPH_RANGE_ABI_SIZE
    );
    result.codeFrom = actualCodes[0];
    result.codeTo = actualCodes.at(-1);
    result.pointSize = pointSize;
    result.rasterSize = rasterSize;
    result.dpi = Number(dpi);
    result.advanceY = calculateLineAdvance(fontFace, rasterSize);
    result.metrics = calculateFontMetrics(fontFace, rasterSize, glyphs);
    result.missingCodePoints = normalizedMissingCodePoints;
    result.warnings = [...(plan.warnings || [])];

    validateFontAbi(result, abiProfile);

    if (strict && normalizedMissingCodePoints.length > 0) {
        throw new MissingGlyphsError(fontName, normalizedMissingCodePoints, result);
    }

    return result;
}

function renderGlyph(fontFace, charCode, rasterSize, bpp, buffer, canvas, context) {
    const char = String.fromCodePoint(charCode);
    const glyphIndex = fontFace.charToGlyphIndex(char);
    if (!glyphIndex) return null;

    const fontGlyph = fontFace.glyphs.get(glyphIndex);
    if (!fontGlyph) return null;

    const glyph = new Glyph();
    glyph.char = char;
    glyph.charCode = charCode;
    glyph.name = fontGlyph.name;
    glyph.present = true;
    glyph.offset = buffer.length;
    glyph.advanceX = Math.max(
        0,
        Math.round((fontGlyph.advanceWidth || 0) * rasterSize / fontFace.unitsPerEm)
    );

    const path = fontGlyph.getPath(0, 0, rasterSize, {hinting: true}, fontFace);
    if (!path.commands || path.commands.length === 0) {
        return glyph.advanceX > 0 ? glyph : null;
    }

    const bbox = path.getBoundingBox();
    const left = Math.floor(bbox.x1) - RasterPadding;
    const top = Math.floor(bbox.y1) - RasterPadding;
    const right = Math.ceil(bbox.x2) + RasterPadding;
    const bottom = Math.ceil(bbox.y2) + RasterPadding;
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    if (width === 0 || height === 0) return glyph;

    const alpha = rasterizePath(path, left, top, width, height, canvas, context);
    const bounds = GlyphUtils.calculateContentBounds(alpha, width, height);

    glyph.offsetX = left;
    glyph.offsetY = top;
    GlyphUtils.applyContentBounds(glyph, bounds);
    if (!bounds) return glyph;

    const writer = new PackedImageWriter(bpp);
    for (let y = bounds.top; y <= bounds.bottom; ++y) {
        for (let x = bounds.left; x <= bounds.right; ++x) {
            writer.write(alpha[y * width + x]);
        }
    }
    writer.flush();
    buffer.push(...writer.byteArray());
    return glyph;
}

function rasterizePath(path, left, top, width, height, canvas, context) {
    const scale = SupersampleScale;
    const highWidth = width * scale;
    const highHeight = height * scale;

    canvas.width = highWidth;
    canvas.height = highHeight;
    context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    context.clearRect(left, top, width, height);
    path.draw(context);

    const source = context.getImageData(0, 0, highWidth, highHeight).data;
    const result = new Uint8Array(width * height);
    const samplesPerPixel = scale * scale;

    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            let alphaSum = 0;
            const sourceY = y * scale;
            const sourceX = x * scale;

            for (let sy = 0; sy < scale; ++sy) {
                let offset = ((sourceY + sy) * highWidth + sourceX) * 4 + 3;
                for (let sx = 0; sx < scale; ++sx) {
                    alphaSum += source[offset];
                    offset += 4;
                }
            }

            result[y * width + x] = Math.round(alphaSum / samplesPerPixel);
        }
    }

    return result;
}

function createPlaceholderGlyph(charCode) {
    const glyph = new Glyph();
    glyph.char = charCode >= SURROGATE_FROM && charCode <= SURROGATE_TO
        ? ""
        : String.fromCodePoint(charCode);
    glyph.charCode = charCode;
    return glyph;
}

function trimDenseGlyphEdges(glyphs) {
    const first = glyphs.findIndex(glyph => glyph.present);
    const last = glyphs.findLastIndex(glyph => glyph.present);
    if (first < 0) return;
    glyphs.splice(last + 1);
    glyphs.splice(0, first);
}

function calculateLineAdvance(fontFace, rasterSize) {
    const unitsPerEm = fontFace.unitsPerEm || 1000;
    const ascender = fontFace.ascender ?? fontFace.tables?.hhea?.ascender ?? unitsPerEm;
    const descender = fontFace.descender ?? fontFace.tables?.hhea?.descender ?? 0;
    const lineGap = fontFace.tables?.hhea?.lineGap ?? 0;
    return Math.max(1, Math.ceil((ascender - descender + lineGap) * rasterSize / unitsPerEm));
}

export function calculateFontMetrics(fontFace, rasterSize, glyphs) {
    const unitsPerEm = fontFace.unitsPerEm || 1000;
    const ascender = fontFace.ascender ?? fontFace.tables?.hhea?.ascender ?? unitsPerEm;
    const descender = fontFace.descender ?? fontFace.tables?.hhea?.descender ?? 0;

    let hasInk = false;
    let inkTop = 0;
    let inkBottom = 0;
    for (const glyph of glyphs) {
        if (!glyph.present || glyph.width <= 0 || glyph.height <= 0) continue;
        const glyphTop = glyph.offsetY;
        const glyphBottom = glyph.offsetY + glyph.height;
        if (!hasInk) {
            inkTop = glyphTop;
            inkBottom = glyphBottom;
            hasInk = true;
            continue;
        }
        inkTop = Math.min(inkTop, glyphTop);
        inkBottom = Math.max(inkBottom, glyphBottom);
    }

    return {
        // Store ascent/descent as positive baseline distances. Ink bounds stay
        // baseline-relative in the same +Y-down coordinate system as Glyph.offsetY.
        ascent: Math.max(0, Math.ceil(ascender * rasterSize / unitsPerEm)),
        descent: Math.max(0, Math.ceil(-descender * rasterSize / unitsPerEm)),
        inkTop,
        inkBottom,
    };
}

export function resolveSelectedCodePoints(fontFace, charSet) {
    if (typeof charSet === "string") {
        return Array.from(charSet, char => char.codePointAt(0));
    }

    if (charSet?.kind === CharsetSelection.ALL_FONT_GLYPHS) {
        return collectMappedCodePoints(fontFace);
    }

    throw new TypeError("Character selection must be a string or the all-font-glyphs selector");
}

function collectMappedCodePoints(fontFace) {
    const codes = [];
    const glyphIndexMap = fontFace?.tables?.cmap?.glyphIndexMap
        || fontFace?.encoding?.cmap?.glyphIndexMap;

    if (glyphIndexMap && typeof glyphIndexMap === "object") {
        for (const [rawCodePoint, rawGlyphIndex] of Object.entries(glyphIndexMap)) {
            const codePoint = Number(rawCodePoint);
            const glyphIndex = Number(rawGlyphIndex);
            if (
                glyphIndex > 0
                && Number.isInteger(codePoint)
                && mappedGlyphCanBeRepresented(fontFace, glyphIndex)
            ) {
                codes.push(codePoint);
            }
        }
    } else {
        const glyphCount = Number(fontFace?.glyphs?.length) || 0;
        for (let glyphIndex = 1; glyphIndex < glyphCount; ++glyphIndex) {
            const glyph = fontFace.glyphs.get?.(glyphIndex);
            if (!glyph || !mappedGlyphCanBeRepresented(fontFace, glyphIndex)) continue;
            if (Array.isArray(glyph.unicodes)) codes.push(...glyph.unicodes);
            else if (Number.isInteger(glyph.unicode)) codes.push(glyph.unicode);
        }
    }

    return Array.from(new Set(codes))
        .filter(codePoint => Number.isInteger(codePoint)
            && codePoint >= 0
            && codePoint <= 0x10ffff
            && !(codePoint >= 0xd800 && codePoint <= 0xdfff))
        .sort((a, b) => a - b);
}

function mappedGlyphCanBeRepresented(fontFace, glyphIndex) {
    if (!fontFace?.glyphs?.get) return true;
    const glyph = fontFace.glyphs.get(glyphIndex);
    if (!glyph) return false;
    if (Number(glyph.advanceWidth) !== 0) return true;
    return (glyph.path?.commands?.length || 0) > 0;
}

function validateConversionArguments(fontFace, fontSize, charSet, bpp, dpi, dpiBase) {
    if (!fontFace || typeof fontFace.charToGlyphIndex !== "function") {
        throw new TypeError("A parsed OpenType font is required");
    }
    if (!Number.isFinite(Number(fontSize)) || Number(fontSize) <= 0) {
        throw new RangeError(`Invalid font size: ${fontSize}`);
    }
    if (!Number.isFinite(Number(dpi)) || Number(dpi) <= 0) {
        throw new RangeError(`Invalid DPI: ${dpi}`);
    }
    if (!Number.isFinite(Number(dpiBase)) || Number(dpiBase) <= 0) {
        throw new RangeError(`Invalid DPI base: ${dpiBase}`);
    }
    if (!SupportedBpp.has(bpp)) {
        throw new RangeError(`Unsupported bits-per-pixel value: ${bpp}`);
    }
    const isExplicitCharset = typeof charSet === "string" && Array.from(charSet).length > 0;
    const isAllFontGlyphs = charSet?.kind === CharsetSelection.ALL_FONT_GLYPHS;
    if (!isExplicitCharset && !isAllFontGlyphs) {
        throw new RangeError("The selected character range is empty or unsupported");
    }
}

function createCanvas() {
    let canvas;
    let context;

    if (CanvasFactory) {
        const created = CanvasFactory();
        if (created?.canvas && created?.context) {
            ({canvas, context} = created);
        } else {
            canvas = created;
        }
    } else if (globalThis.document?.createElement) {
        canvas = document.createElement("canvas");
    } else {
        throw new Error("No canvas implementation is available; configure setCanvasFactory() in headless mode");
    }

    context ??= canvas?.getContext?.("2d", {
        alpha: true,
        willReadFrequently: true,
    });

    if (!canvas || !context) throw new Error("Unable to create a 2D canvas context");
    return {canvas, context};
}
