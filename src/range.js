// Glyph range planning, ABI validation, and lookup metadata
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

export const RangeMode = Object.freeze({
    DENSE: "dense",
    COMPACT: "compact",
    ASCII_FIRST: "ascii-first",
});

export const RangeModeLabel = Object.freeze({
    [RangeMode.DENSE]: "Dense",
    [RangeMode.COMPACT]: "Compact",
    [RangeMode.ASCII_FIRST]: "ASCII first",
});

export const CharsetSelection = Object.freeze({
    ALL_FONT_GLYPHS: "all-font-glyphs",
});

export const FontFlags = Object.freeze({
    COMPACT: 0x01,
    RANGE_MODE_MASK: 0x06,
    RANGE_DENSE: 0x00,
    RANGE_COMPACT: 0x02,
    RANGE_ASCII_FIRST: 0x04,
    FLAGS_MASK: 0x07,
});

export const ASCII_FROM = 0x00;
export const ASCII_TO = 0x7f;
export const ASCII_GLYPH_COUNT = ASCII_TO - ASCII_FROM + 1;
export const GLYPH_RANGE_ABI_SIZE = 12;
export const GLYPH_RANGE_COMPACT16_ABI_SIZE = 6;

export const FontAbiProfile = Object.freeze({
    UNICODE32: "unicode32",
    COMPACT16: "compact16",
});
export const DENSE_WARNING_GLYPH_COUNT = 4096;
export const DENSE_MAX_GLYPH_COUNT = 65536;
export const SURROGATE_FROM = 0xd800;
export const SURROGATE_TO = 0xdfff;
export const UINT32_MAX = 0xffffffff;
export const UINT16_MAX = 0xffff;
export const INT16_MIN = -0x8000;
export const INT16_MAX = 0x7fff;

const SupportedBpp = new Set([1, 2, 4, 8]);

export class DenseSpanError extends RangeError {
    constructor(analysis) {
        super(
            `Dense layout would allocate ${analysis.glyphCount} glyph slots for `
            + `${analysis.selectedCount} selected code point(s). Use Compact or ASCII first, `
            + `or explicitly allow a large Dense span.`
        );
        this.name = "DenseSpanError";
        this.analysis = analysis;
    }
}

export class DenseSurrogateSpanError extends RangeError {
    constructor(analysis) {
        super(
            `Dense layout cannot span the invalid Unicode surrogate block U+D800-U+DFFF. `
            + `The selected bounds ${formatCodePoint(analysis.codeFrom)}-${formatCodePoint(analysis.codeTo)} `
            + `would allocate surrogate slots. Choose Compact instead.`
        );
        this.name = "DenseSurrogateSpanError";
        this.analysis = analysis;
    }
}

export function normalizeRangeMode(mode) {
    if (mode === null || mode === undefined || mode === "") return RangeMode.DENSE;
    if (Object.values(RangeMode).includes(mode)) return mode;
    throw new RangeError(`Unsupported glyph range mode: ${mode}`);
}

export function rangeModeFlags(mode) {
    switch (normalizeRangeMode(mode)) {
        case RangeMode.COMPACT:
            return FontFlags.COMPACT | FontFlags.RANGE_COMPACT;
        case RangeMode.ASCII_FIRST:
            return FontFlags.COMPACT | FontFlags.RANGE_ASCII_FIRST;
        default:
            return FontFlags.RANGE_DENSE;
    }
}

// Flags are the sole source of the runtime lookup mode. Only exact canonical
// flag combinations are accepted; malformed values such as 0x06 are rejected.
export function rangeModeFromFlags(flags) {
    assertIntegerInRange(flags, 0, 0xff, "flags");
    switch (flags) {
        case FontFlags.RANGE_DENSE:
            return RangeMode.DENSE;
        case FontFlags.COMPACT | FontFlags.RANGE_COMPACT:
            return RangeMode.COMPACT;
        case FontFlags.COMPACT | FontFlags.RANGE_ASCII_FIRST:
            return RangeMode.ASCII_FIRST;
        default:
            throw new RangeError(`Unsupported font flags: 0x${flags.toString(16).padStart(2, "0")}`);
    }
}


export function normalizeFontAbiProfile(profile) {
    if (profile === null || profile === undefined || profile === "") {
        return FontAbiProfile.UNICODE32;
    }
    if (Object.values(FontAbiProfile).includes(profile)) return profile;
    throw new RangeError(`Unsupported font ABI profile: ${profile}`);
}

export function validateCompact16CodePoints(codes) {
    const supplementary = normalizeCodePoints(codes).filter(code => code > UINT16_MAX);
    if (supplementary.length > 0) {
        const preview = supplementary.slice(0, 8).map(formatCodePoint).join(", ");
        const suffix = supplementary.length > 8 ? ` and ${supplementary.length - 8} more` : "";
        throw new RangeError(
            `compact16 supports BMP code points only (U+0000-U+FFFF); `
            + `supplementary code point(s) selected: ${preview}${suffix}`
        );
    }
    return true;
}

export function analyzeDenseSpan(codes) {
    const selectedCodes = normalizeCodePoints(codes);
    if (selectedCodes.length === 0) {
        return {
            codeFrom: 0,
            codeTo: 0,
            glyphCount: 0,
            selectedCount: 0,
            density: 0,
            warning: null,
        };
    }

    const codeFrom = selectedCodes[0];
    const codeTo = selectedCodes.at(-1);
    const glyphCount = codeTo - codeFrom + 1;
    const selectedCount = selectedCodes.length;
    const density = selectedCount / glyphCount;
    let warning = null;

    if (glyphCount > DENSE_WARNING_GLYPH_COUNT) {
        const sparse = density < 0.5;
        warning = `Dense layout uses ${glyphCount} glyph slots for ${selectedCount} selected code point(s)`
            + (sparse ? "; Compact is recommended for this sparse Unicode set." : ".");
    }

    return {codeFrom, codeTo, glyphCount, selectedCount, density, warning};
}

/**
 * Builds a deterministic glyph-array plan.
 *
 * Dense stores every code point between the selected minimum and maximum.
 * Compact stores selected code points only.
 * ASCII first reserves glyph indices 0..127 for the corresponding ASCII code
 * points and appends selected non-ASCII glyphs after them.
 */
export function buildRangePlan(
    codes,
    requestedMode,
    {allowLargeDense = false, allowSurrogateDense = false} = {}
) {
    const selectedCodes = normalizeCodePoints(codes);
    if (selectedCodes.length === 0) {
        throw new Error("The selected range does not contain valid Unicode code points");
    }

    const selectedSet = new Set(selectedCodes);
    const mode = normalizeRangeMode(requestedMode);

    if (mode === RangeMode.COMPACT) {
        return {
            mode,
            selectedCodes,
            selectedSet,
            baseCodes: [],
            extensionCodes: selectedCodes,
            warnings: [],
            denseSpan: null,
        };
    }

    if (mode === RangeMode.ASCII_FIRST) {
        return {
            mode,
            selectedCodes,
            selectedSet,
            baseCodes: sequence(ASCII_FROM, ASCII_TO),
            extensionCodes: selectedCodes.filter(code => code > ASCII_TO),
            warnings: [],
            denseSpan: null,
        };
    }

    const denseSpan = analyzeDenseSpan(selectedCodes);
    const crossesSurrogateBlock = denseSpan.codeFrom <= SURROGATE_TO
        && denseSpan.codeTo >= SURROGATE_FROM;
    if (crossesSurrogateBlock && !allowSurrogateDense) {
        throw new DenseSurrogateSpanError(denseSpan);
    }
    if (denseSpan.glyphCount > DENSE_MAX_GLYPH_COUNT && !allowLargeDense) {
        throw new DenseSpanError(denseSpan);
    }

    return {
        mode: RangeMode.DENSE,
        selectedCodes,
        selectedSet,
        baseCodes: sequence(denseSpan.codeFrom, denseSpan.codeTo),
        extensionCodes: [],
        warnings: [
            ...(denseSpan.warning ? [denseSpan.warning] : []),
            ...(crossesSurrogateBlock ? [
                "Dense layout reserves 2,048 unreachable placeholder slots for the Unicode surrogate block U+D800-U+DFFF.",
            ] : []),
        ],
        denseSpan,
    };
}

/**
 * Converts an arbitrary sparse mapping into sorted continuous ranges.
 * A range is extended only when both code points and glyph offsets are
 * consecutive. Isolated entries become singleton ranges.
 */
export function buildGlyphRanges(entries) {
    const sorted = entries.map(normalizeRangeEntry).sort((a, b) =>
        a.codePoint - b.codePoint || a.glyphOffset - b.glyphOffset
    );

    const seenCodes = new Set();
    const seenOffsets = new Set();
    for (const entry of sorted) {
        if (seenCodes.has(entry.codePoint)) {
            throw new Error(`Duplicate code point in glyph ranges: ${formatCodePoint(entry.codePoint)}`);
        }
        if (seenOffsets.has(entry.glyphOffset)) {
            throw new Error(`Duplicate glyph offset in glyph ranges: ${entry.glyphOffset}`);
        }
        seenCodes.add(entry.codePoint);
        seenOffsets.add(entry.glyphOffset);
    }

    const ranges = [];
    for (const entry of sorted) {
        const previous = ranges.at(-1);
        const previousLength = previous ? previous.codeTo - previous.codeFrom + 1 : 0;
        const expectedOffset = previous ? previous.glyphOffset + previousLength : -1;

        if (
            previous
            && entry.codePoint === previous.codeTo + 1
            && entry.glyphOffset === expectedOffset
        ) {
            previous.codeTo = entry.codePoint;
        } else {
            ranges.push({
                codeFrom: entry.codePoint,
                codeTo: entry.codePoint,
                glyphOffset: entry.glyphOffset,
            });
        }
    }

    return ranges;
}

/**
 * Validates basic sorted range records. Mode-aware coverage is enforced by
 * validateFontAbi().
 */
export function validateGlyphRanges(ranges, glyphCount) {
    if (!Array.isArray(ranges)) throw new TypeError("Glyph ranges must be an array");
    assertUint32(glyphCount, "glyphCount");

    let previousCodeTo = -1;
    const mappedIntervals = [];
    for (let index = 0; index < ranges.length; ++index) {
        const range = ranges[index];
        validateRangeRecord(range, index);
        if (range.codeFrom <= previousCodeTo) {
            throw new Error(`Glyph ranges overlap or contain duplicates at ${formatCodePoint(range.codeFrom)}`);
        }
        const length = range.codeTo - range.codeFrom + 1;
        const glyphEnd = range.glyphOffset + length;
        if (glyphEnd > glyphCount) {
            throw new Error(
                `Glyph range ${formatCodePoint(range.codeFrom)}-${formatCodePoint(range.codeTo)} `
                + `exceeds glyphCount (${glyphEnd} > ${glyphCount})`
            );
        }
        for (const interval of mappedIntervals) {
            if (range.glyphOffset < interval.end && glyphEnd > interval.start) {
                throw new Error(`Glyph-offset ranges overlap at offset ${range.glyphOffset}`);
            }
        }
        mappedIntervals.push({start: range.glyphOffset, end: glyphEnd});
        previousCodeTo = range.codeTo;
    }
    return true;
}

export function validateFontAbi(font, profile = FontAbiProfile.UNICODE32) {
    profile = normalizeFontAbiProfile(profile);
    if (!font || typeof font !== "object") throw new TypeError("Font metadata is required");
    if (typeof font.name !== "string" || font.name.length === 0) {
        throw new TypeError("Font.name must be a non-empty string");
    }
    if (!(font.buffer instanceof Uint8Array)) {
        throw new TypeError("Font.buffer must be a Uint8Array");
    }
    if (!Array.isArray(font.glyphs) || font.glyphs.length === 0) {
        throw new TypeError("Font.glyphs must be a non-empty array");
    }
    if (!Array.isArray(font.ranges)) throw new TypeError("Font.ranges must be an array");
    if (!SupportedBpp.has(font.bpp)) throw new RangeError(`Unsupported bits-per-pixel value: ${font.bpp}`);

    const mode = rangeModeFromFlags(font.flags);
    if (profile === FontAbiProfile.COMPACT16 && mode !== RangeMode.COMPACT) {
        throw new Error("compact16 supports only the Compact glyph layout");
    }
    assertUint32(font.bitmapSize, "bitmapSize");
    const expectedBitmapSize = Math.max(1, font.buffer.byteLength);
    if (font.bitmapSize !== expectedBitmapSize) {
        throw new Error(`bitmapSize must equal exported bitmap array size (${expectedBitmapSize})`);
    }

    if (profile === FontAbiProfile.COMPACT16) {
        assertUint16(font.glyphCount, "glyphCount");
        assertUint16(font.rangeCount, "rangeCount");
    } else {
        assertUint32(font.glyphCount, "glyphCount");
        assertUint32(font.rangeCount, "rangeCount");
    }
    if (font.glyphCount !== font.glyphs.length) {
        throw new Error(`glyphCount (${font.glyphCount}) does not match glyph array length (${font.glyphs.length})`);
    }
    if (font.rangeCount !== font.ranges.length) {
        throw new Error(`rangeCount (${font.rangeCount}) does not match range array length (${font.ranges.length})`);
    }
    assertUint16(font.advanceY, "advanceY");
    if (!isValidCodePoint(font.codeFrom) || !isValidCodePoint(font.codeTo) || font.codeFrom > font.codeTo) {
        throw new RangeError("Font codeFrom/codeTo are not valid ordered Unicode code points");
    }
    if (profile === FontAbiProfile.COMPACT16 && font.codeTo > UINT16_MAX) {
        throw new RangeError(
            `compact16 supports BMP code points only (U+0000-U+FFFF); got ${formatCodePoint(font.codeTo)}`
        );
    }

    for (let index = 0; index < font.glyphs.length; ++index) {
        validateGlyphRecord(font.glyphs[index], index, font);
    }
    if (profile === FontAbiProfile.COMPACT16) validateCompact16Ranges(font.ranges);
    validateGlyphRanges(font.ranges, font.glyphCount);

    if (mode === RangeMode.DENSE) {
        validateDenseFont(font);
    } else if (mode === RangeMode.COMPACT) {
        validateCompactFont(font);
    } else if (mode === RangeMode.ASCII_FIRST) {
        validateAsciiFirstFont(font);
    }

    validateActualBounds(font, mode);
    return true;
}

// Returns a slot index. Dense and ASCII-first may return a zero-placeholder
// slot; use glyphForCode() when actual glyph presence is required.
export function glyphIndexForCode(font, codePoint) {
    if (!font || !isValidCodePoint(codePoint)) return -1;

    let mode;
    try {
        mode = rangeModeFromFlags(font.flags);
    } catch {
        return -1;
    }

    const glyphCount = Number.isInteger(font.glyphCount)
        ? font.glyphCount
        : font.glyphs?.length || 0;

    if (mode === RangeMode.DENSE) {
        if (codePoint < font.codeFrom || codePoint > font.codeTo) return -1;
        const index = codePoint - font.codeFrom;
        return index < glyphCount ? index : -1;
    }

    if (mode === RangeMode.ASCII_FIRST && codePoint <= ASCII_TO) {
        return codePoint < glyphCount ? codePoint : -1;
    }

    const ranges = font.ranges || [];
    if (ranges.length === 0) return -1;

    // Compact fonts commonly begin with one continuous ASCII range. Resolve
    // that hot path directly before falling back to binary search.
    const firstRange = ranges[0];
    if (codePoint >= firstRange.codeFrom && codePoint <= firstRange.codeTo) {
        const index = firstRange.glyphOffset + codePoint - firstRange.codeFrom;
        return index < glyphCount ? index : -1;
    }
    if (codePoint < firstRange.codeFrom || ranges.length === 1) return -1;

    let left = 1;
    let right = ranges.length - 1;

    while (left <= right) {
        const middle = (left + right) >> 1;
        const range = ranges[middle];
        if (codePoint < range.codeFrom) {
            right = middle - 1;
        } else if (codePoint > range.codeTo) {
            left = middle + 1;
        } else {
            const index = range.glyphOffset + codePoint - range.codeFrom;
            return index < glyphCount ? index : -1;
        }
    }

    return -1;
}

export function glyphPresent(font, index) {
    if (!font || !Array.isArray(font.glyphs) || !Number.isInteger(index)
        || index < 0 || index >= font.glyphs.length) {
        return false;
    }
    return !isPlaceholderGlyph(font.glyphs[index]);
}

export function glyphForCode(font, codePoint) {
    const index = glyphIndexForCode(font, codePoint);
    return index >= 0 && glyphPresent(font, index) ? font.glyphs[index] : null;
}

export function isPlaceholderGlyph(glyph) {
    return !!glyph
        && glyph.offset === 0
        && glyph.width === 0
        && glyph.height === 0
        && glyph.advanceX === 0
        && glyph.offsetX === 0
        && glyph.offsetY === 0;
}

export function normalizeCodePoints(codes) {
    return Array.from(new Set(codes))
        .filter(isValidCodePoint)
        .sort((a, b) => a - b);
}

export function formatCodePoint(code) {
    return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function isValidCodePoint(code) {
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        && !(code >= 0xd800 && code <= 0xdfff);
}


function validateCompact16Ranges(ranges) {
    if (ranges.length > UINT16_MAX) {
        throw new RangeError(`compact16 rangeCount must not exceed ${UINT16_MAX}`);
    }
    for (let index = 0; index < ranges.length; ++index) {
        const range = ranges[index];
        if (range.codeFrom > UINT16_MAX || range.codeTo > UINT16_MAX) {
            throw new RangeError(
                `compact16 range ${index} contains a supplementary code point; only U+0000-U+FFFF is supported`
            );
        }
        assertUint16(range.glyphOffset, `range[${index}].glyphOffset`);
    }
}

function validateDenseFont(font) {
    if (font.rangeCount !== 0 || font.ranges.length !== 0) {
        throw new Error("Dense layout must not contain a range table");
    }
    const expected = font.codeTo - font.codeFrom + 1;
    if (font.glyphCount !== expected) {
        throw new Error(`Dense glyphCount must equal codeTo - codeFrom + 1 (${expected})`);
    }
    for (let index = 0; index < font.glyphCount; ++index) {
        const expectedCode = font.codeFrom + index;
        const glyph = font.glyphs[index];
        if (expectedCode >= SURROGATE_FROM && expectedCode <= SURROGATE_TO) {
            if (!isPlaceholderGlyph(glyph) || glyph.charCode !== expectedCode) {
                throw new Error(
                    `Dense surrogate slot glyph[${index}] must be a zero placeholder for 0x${expectedCode.toString(16)}`
                );
            }
        } else {
            validateGlyphCharCode(glyph, expectedCode, index);
        }
    }
    if (!glyphPresent(font, 0) || !glyphPresent(font, font.glyphCount - 1)) {
        throw new Error("Dense codeFrom/codeTo must identify present edge glyphs");
    }
}

function validateCompactFont(font) {
    if (font.rangeCount === 0) throw new Error("Compact layout requires at least one range");
    let expectedOffset = 0;
    for (let index = 0; index < font.ranges.length; ++index) {
        const range = font.ranges[index];
        if (range.glyphOffset !== expectedOffset) {
            throw new Error(`Compact ranges must cover glyph offsets without gaps; expected ${expectedOffset}`);
        }
        const length = range.codeTo - range.codeFrom + 1;
        for (let delta = 0; delta < length; ++delta) {
            const glyphIndex = range.glyphOffset + delta;
            if (!glyphPresent(font, glyphIndex)) {
                throw new Error(`Compact range maps placeholder glyph ${glyphIndex}`);
            }
            validateGlyphCharCode(font.glyphs[glyphIndex], range.codeFrom + delta, glyphIndex);
        }
        expectedOffset += length;
    }
    if (expectedOffset !== font.glyphCount) {
        throw new Error(`Compact ranges cover ${expectedOffset} glyphs, expected ${font.glyphCount}`);
    }
    if (font.codeFrom !== font.ranges[0].codeFrom
        || font.codeTo !== font.ranges.at(-1).codeTo) {
        throw new Error("Compact codeFrom/codeTo must match the first and last range");
    }
}

function validateAsciiFirstFont(font) {
    if (font.glyphCount < ASCII_GLYPH_COUNT) {
        throw new Error(`ASCII first requires at least ${ASCII_GLYPH_COUNT} glyph slots`);
    }
    for (let code = ASCII_FROM; code <= ASCII_TO; ++code) {
        validateGlyphCharCode(font.glyphs[code], code, code);
    }

    if (font.glyphCount === ASCII_GLYPH_COUNT) {
        if (font.rangeCount !== 0) {
            throw new Error("ASCII first without extensions must have an empty range table");
        }
        return;
    }
    if (font.rangeCount === 0) {
        throw new Error("ASCII first extensions require a range table");
    }

    let expectedOffset = ASCII_GLYPH_COUNT;
    for (const range of font.ranges) {
        if (range.codeFrom <= ASCII_TO) {
            throw new Error("ASCII first extension ranges may not contain ASCII code points");
        }
        if (range.glyphOffset !== expectedOffset) {
            throw new Error(`ASCII first ranges must cover extension offsets without gaps; expected ${expectedOffset}`);
        }
        const length = range.codeTo - range.codeFrom + 1;
        for (let delta = 0; delta < length; ++delta) {
            const glyphIndex = range.glyphOffset + delta;
            if (!glyphPresent(font, glyphIndex)) {
                throw new Error(`ASCII first extension maps placeholder glyph ${glyphIndex}`);
            }
            validateGlyphCharCode(font.glyphs[glyphIndex], range.codeFrom + delta, glyphIndex);
        }
        expectedOffset += length;
    }
    if (expectedOffset !== font.glyphCount) {
        throw new Error(`ASCII first ranges cover through offset ${expectedOffset}, expected ${font.glyphCount}`);
    }
}

function validateActualBounds(font, mode) {
    let actualFrom = null;
    let actualTo = null;

    if (mode === RangeMode.DENSE) {
        actualFrom = font.codeFrom;
        actualTo = font.codeTo;
    } else if (mode === RangeMode.COMPACT) {
        actualFrom = font.ranges[0].codeFrom;
        actualTo = font.ranges.at(-1).codeTo;
    } else {
        for (let code = ASCII_FROM; code <= ASCII_TO; ++code) {
            if (!glyphPresent(font, code)) continue;
            actualFrom ??= code;
            actualTo = code;
        }
        if (font.ranges.length > 0) {
            actualFrom ??= font.ranges[0].codeFrom;
            actualTo = font.ranges.at(-1).codeTo;
        }
    }

    if (actualFrom === null || font.codeFrom !== actualFrom || font.codeTo !== actualTo) {
        throw new Error(`codeFrom/codeTo must be the actual present bounds (${actualFrom}-${actualTo})`);
    }
}

function validateGlyphRecord(glyph, index, font) {
    if (!glyph || typeof glyph !== "object") throw new TypeError(`Invalid glyph ${index}`);
    assertUint32(glyph.offset, `glyph[${index}].offset`);
    assertUint16(glyph.width, `glyph[${index}].width`);
    assertUint16(glyph.height, `glyph[${index}].height`);
    assertUint16(glyph.advanceX, `glyph[${index}].advanceX`);
    assertInt16(glyph.offsetX, `glyph[${index}].offsetX`);
    assertInt16(glyph.offsetY, `glyph[${index}].offsetY`);

    const placeholder = isPlaceholderGlyph(glyph);
    if (glyph.present === false && !placeholder) {
        throw new Error(`glyph[${index}] is marked absent but is not a zero placeholder`);
    }
    if (glyph.present === true && placeholder) {
        throw new Error(`glyph[${index}] is marked present but encodes the zero placeholder`);
    }

    const bitmapBytes = Math.ceil(glyph.width * glyph.height * font.bpp / 8);
    if (glyph.offset > font.bitmapSize || glyph.offset + bitmapBytes > font.bitmapSize) {
        throw new Error(
            `glyph[${index}] bitmap exceeds bitmapSize: ${glyph.offset} + ${bitmapBytes} > ${font.bitmapSize}`
        );
    }
}

function validateGlyphCharCode(glyph, expected, index) {
    if (!isValidCodePoint(glyph.charCode) || glyph.charCode !== expected) {
        throw new Error(`glyph[${index}].charCode must be ${formatCodePoint(expected)}`);
    }
}

function validateRangeRecord(range, index) {
    if (!range || !isValidCodePoint(range.codeFrom) || !isValidCodePoint(range.codeTo)) {
        throw new Error(`Invalid code point in glyph range ${index}`);
    }
    if (range.codeFrom > range.codeTo) {
        throw new Error(`Invalid glyph range ${index}: codeFrom exceeds codeTo`);
    }
    if (range.codeFrom < 0xd800 && range.codeTo > 0xdfff) {
        throw new Error(`Glyph range ${index} crosses the Unicode surrogate block`);
    }
    assertUint32(range.glyphOffset, `range[${index}].glyphOffset`);
}

function normalizeRangeEntry(entry, index) {
    const codePoint = entry?.codePoint ?? entry?.charCode ?? entry?.codeFrom;
    const glyphOffset = entry?.glyphOffset;
    if (!isValidCodePoint(codePoint)) {
        throw new Error(`Invalid code point in range entry ${index ?? ""}`.trim());
    }
    assertUint32(glyphOffset, `glyphOffset for ${formatCodePoint(codePoint)}`);
    return {codePoint, glyphOffset};
}

function assertUint32(value, name) {
    assertIntegerInRange(value, 0, UINT32_MAX, name);
}

function assertUint16(value, name) {
    assertIntegerInRange(value, 0, UINT16_MAX, name);
}

function assertInt16(value, name) {
    assertIntegerInRange(value, INT16_MIN, INT16_MAX, name);
}

function assertIntegerInRange(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${value}`);
    }
}

function sequence(from, to) {
    return Array.from({length: to - from + 1}, (_, index) => from + index);
}
