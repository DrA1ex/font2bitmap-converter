/*
 * Canonical bitmap font ABI shared by the converter and renderers.
 *
 * Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
 *
 * This file may be distributed under the terms of the GNU GPLv3 license.
 */

#pragma once

#include <stddef.h>
#include <stdint.h>
#ifndef __cplusplus
#include <stdbool.h>
#endif

#define FONT_BITMAP_ABI_VERSION 2
#define FONT_UNICODE_MAX 0x10ffffu
#define FONT_ASCII_GLYPH_COUNT 128u

// Font.flags layout. Only the three exact combinations below are valid.
enum FontFlags {
    FONT_FLAG_COMPACT = 0x01,

    FONT_RANGE_DENSE = 0x00,
    FONT_RANGE_COMPACT = 0x02,
    FONT_RANGE_ASCII_FIRST = 0x04,
    FONT_RANGE_MODE_MASK = 0x06,
    FONT_FLAGS_MASK = 0x07,
};

typedef struct Glyph {
    uint32_t offset;
    uint16_t width;
    uint16_t height;
    uint16_t advanceX;
    int16_t offsetX;
    int16_t offsetY;
} Glyph;

// Sorted, inclusive Unicode range. glyphOffset is the glyph-array index for
// codeFrom; subsequent code points in the range use consecutive glyph indices.
typedef struct GlyphRange {
    uint32_t codeFrom;
    uint32_t codeTo;
    uint32_t glyphOffset;
} GlyphRange;

typedef struct Font {
    const char *name;
    const uint8_t *bitmaps;
    const Glyph *glyphs;
    const GlyphRange *ranges;

    // Actual byte size of the bitmaps array, including an optional one-byte
    // sentinel used by generated headers when the logical bitmap stream is empty.
    uint32_t bitmapSize;

    // Actual minimum and maximum present/supported Unicode code points.
    uint32_t codeFrom;
    uint32_t codeTo;

    uint32_t rangeCount;
    uint32_t glyphCount;
    uint16_t advanceY;
    uint8_t bpp;
    uint8_t flags;
} Font;

#if defined(__cplusplus)
static_assert(sizeof(Glyph) == 16, "Glyph ABI must remain 16 bytes");
static_assert(sizeof(GlyphRange) == 12, "GlyphRange ABI must remain 12 bytes");
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(Glyph) == 16, "Glyph ABI must remain 16 bytes");
_Static_assert(sizeof(GlyphRange) == 12, "GlyphRange ABI must remain 12 bytes");
#endif

static inline bool fontCodePointValid(uint32_t codepoint) {
    return codepoint <= FONT_UNICODE_MAX
        && !(codepoint >= 0xd800u && codepoint <= 0xdfffu);
}

static inline bool fontBppValid(uint8_t bpp) {
    return bpp == 1u || bpp == 2u || bpp == 4u || bpp == 8u;
}

// A zero-initialized Glyph is the canonical absent-slot placeholder. A glyph
// with no bitmap (for example, space) is still present when any metric is nonzero.
static inline bool fontGlyphPresent(const Font *font, uint32_t index) {
    if (!font || !font->glyphs || index >= font->glyphCount) return false;
    const Glyph *glyph = &font->glyphs[index];
    return glyph->offset != 0u
        || glyph->width != 0u
        || glyph->height != 0u
        || glyph->advanceX != 0u
        || glyph->offsetX != 0
        || glyph->offsetY != 0;
}

static inline bool fontIsCompact(const Font *font) {
    return font && (font->flags & FONT_FLAG_COMPACT) != 0;
}

// Returns one of FONT_RANGE_* for an exact supported flags value, or 0xff for
// malformed/unknown flags. Flags are the sole source of the lookup mode.
static inline uint8_t fontRangeMode(const Font *font) {
    if (!font) return 0xffu;
    switch (font->flags) {
        case FONT_RANGE_DENSE:
            return FONT_RANGE_DENSE;
        case FONT_FLAG_COMPACT | FONT_RANGE_COMPACT:
            return FONT_RANGE_COMPACT;
        case FONT_FLAG_COMPACT | FONT_RANGE_ASCII_FIRST:
            return FONT_RANGE_ASCII_FIRST;
        default:
            return 0xffu;
    }
}

static inline bool fontGlyphBitmapBoundsValid(const Font *font, const Glyph *glyph) {
    if (!font || !glyph) return false;
    const uint64_t pixels = (uint64_t) glyph->width * glyph->height;
    const uint64_t bytes = (pixels * font->bpp + 7u) / 8u;
    const uint64_t end = (uint64_t) glyph->offset + bytes;
    return glyph->offset <= font->bitmapSize && end <= font->bitmapSize;
}

static inline bool fontRangeCodeBoundsValid(const GlyphRange *range) {
    if (!range || !fontCodePointValid(range->codeFrom)
        || !fontCodePointValid(range->codeTo)
        || range->codeFrom > range->codeTo) {
        return false;
    }
    // A continuous range may not pass through the UTF-16 surrogate block.
    return !(range->codeFrom < 0xd800u && range->codeTo > 0xdfffu);
}

static inline bool fontRangesSorted(const Font *font) {
    if (!font) return false;
    if (font->rangeCount == 0u) return font->ranges == NULL;
    if (!font->ranges) return false;

    for (uint32_t i = 0; i < font->rangeCount; ++i) {
        const GlyphRange *range = &font->ranges[i];
        if (!fontRangeCodeBoundsValid(range)) return false;
        if (i > 0u && range->codeFrom <= font->ranges[i - 1u].codeTo) return false;
    }
    return true;
}

static inline bool fontActualBoundsValid(const Font *font, uint8_t mode) {
    bool found = false;
    uint32_t actualFrom = 0u;
    uint32_t actualTo = 0u;

    if (mode == FONT_RANGE_DENSE) {
        if (!fontGlyphPresent(font, 0u)
            || !fontGlyphPresent(font, font->glyphCount - 1u)) {
            return false;
        }
        actualFrom = font->codeFrom;
        actualTo = font->codeTo;
        found = true;
    } else if (mode == FONT_RANGE_COMPACT) {
        if (font->rangeCount == 0u) return false;
        actualFrom = font->ranges[0].codeFrom;
        actualTo = font->ranges[font->rangeCount - 1u].codeTo;
        found = true;
    } else if (mode == FONT_RANGE_ASCII_FIRST) {
        for (uint32_t code = 0u; code < FONT_ASCII_GLYPH_COUNT; ++code) {
            if (!fontGlyphPresent(font, code)) continue;
            if (!found) actualFrom = code;
            actualTo = code;
            found = true;
        }
        if (font->rangeCount > 0u) {
            if (!found) actualFrom = font->ranges[0].codeFrom;
            actualTo = font->ranges[font->rangeCount - 1u].codeTo;
            found = true;
        }
    }

    return found && actualFrom == font->codeFrom && actualTo == font->codeTo;
}

// Mode-aware ABI validator. Intended for debug/startup validation; generated
// headers are checked by the JavaScript exporter before they are emitted.
static inline bool fontValid(const Font *font) {
    if (!font || !font->name || !font->bitmaps || !font->glyphs) return false;
    if (!fontBppValid(font->bpp) || font->bitmapSize == 0u || font->glyphCount == 0u) return false;
    if (!fontCodePointValid(font->codeFrom) || !fontCodePointValid(font->codeTo)
        || font->codeFrom > font->codeTo) {
        return false;
    }

    const uint8_t mode = fontRangeMode(font);
    if (mode == 0xffu) return false;
    if (!fontRangesSorted(font)) return false;

    for (uint32_t i = 0; i < font->glyphCount; ++i) {
        if (!fontGlyphBitmapBoundsValid(font, &font->glyphs[i])) return false;
    }

    if (mode == FONT_RANGE_DENSE) {
        if (font->ranges != NULL || font->rangeCount != 0u) return false;
        const uint64_t expected = (uint64_t) font->codeTo - font->codeFrom + 1u;
        if (expected != font->glyphCount) return false;
    } else if (mode == FONT_RANGE_COMPACT) {
        if (!font->ranges || font->rangeCount == 0u) return false;
        uint64_t expectedOffset = 0u;
        for (uint32_t i = 0; i < font->rangeCount; ++i) {
            const GlyphRange *range = &font->ranges[i];
            const uint64_t length = (uint64_t) range->codeTo - range->codeFrom + 1u;
            if (range->glyphOffset != expectedOffset) return false;
            expectedOffset += length;
            if (expectedOffset > font->glyphCount) return false;
            for (uint64_t glyphIndex = range->glyphOffset; glyphIndex < expectedOffset; ++glyphIndex) {
                if (!fontGlyphPresent(font, (uint32_t) glyphIndex)) return false;
            }
        }
        if (expectedOffset != font->glyphCount) return false;
        if (font->codeFrom != font->ranges[0].codeFrom
            || font->codeTo != font->ranges[font->rangeCount - 1u].codeTo) {
            return false;
        }
    } else if (mode == FONT_RANGE_ASCII_FIRST) {
        if (font->glyphCount < FONT_ASCII_GLYPH_COUNT) return false;
        if (font->glyphCount == FONT_ASCII_GLYPH_COUNT) {
            if (font->ranges != NULL || font->rangeCount != 0u) return false;
        } else {
            if (!font->ranges || font->rangeCount == 0u) return false;
            uint64_t expectedOffset = FONT_ASCII_GLYPH_COUNT;
            for (uint32_t i = 0; i < font->rangeCount; ++i) {
                const GlyphRange *range = &font->ranges[i];
                const uint64_t length = (uint64_t) range->codeTo - range->codeFrom + 1u;
                if (range->codeFrom <= 0x7fu || range->glyphOffset != expectedOffset) return false;
                expectedOffset += length;
                if (expectedOffset > font->glyphCount) return false;
                for (uint64_t glyphIndex = range->glyphOffset; glyphIndex < expectedOffset; ++glyphIndex) {
                    if (!fontGlyphPresent(font, (uint32_t) glyphIndex)) return false;
                }
            }
            if (expectedOffset != font->glyphCount) return false;
        }
    }

    return fontActualBoundsValid(font, mode);
}

// Returns a glyph-array slot index, or -1 when the code point is outside the
// layout/mapping or flags are malformed. Dense and ASCII-first direct lookup
// may return a zero-placeholder slot. Use fontGlyphForCode() when absence must
// be distinguished from an allocated placeholder.
static inline int32_t fontGlyphIndex(const Font *font, uint32_t codepoint) {
    if (!font || !fontCodePointValid(codepoint)) return -1;

    const uint8_t mode = fontRangeMode(font);
    if (mode == FONT_RANGE_DENSE) {
        if (codepoint < font->codeFrom || codepoint > font->codeTo) return -1;
        const uint32_t index = codepoint - font->codeFrom;
        return index < font->glyphCount ? (int32_t) index : -1;
    }

    if (mode == FONT_RANGE_ASCII_FIRST && codepoint <= 0x7fu) {
        return codepoint < font->glyphCount ? (int32_t) codepoint : -1;
    }

    if (mode != FONT_RANGE_COMPACT && mode != FONT_RANGE_ASCII_FIRST) return -1;
    if (!font->ranges || font->rangeCount == 0u) return -1;

    // Compact fonts commonly start with one continuous ASCII range. Resolve
    // that hot path directly before falling back to binary search.
    const GlyphRange *first = &font->ranges[0];
    if (codepoint >= first->codeFrom && codepoint <= first->codeTo) {
        const uint64_t index = (uint64_t) first->glyphOffset + codepoint - first->codeFrom;
        return index < font->glyphCount ? (int32_t) index : -1;
    }
    if (codepoint < first->codeFrom || font->rangeCount == 1u) return -1;

    uint32_t left = 1u;
    uint32_t right = font->rangeCount;
    while (left < right) {
        const uint32_t middle = left + (right - left) / 2u;
        const GlyphRange *range = &font->ranges[middle];

        if (codepoint < range->codeFrom) {
            right = middle;
        } else if (codepoint > range->codeTo) {
            left = middle + 1u;
        } else {
            const uint64_t index = (uint64_t) range->glyphOffset + codepoint - range->codeFrom;
            return index < font->glyphCount ? (int32_t) index : -1;
        }
    }

    return -1;
}

// Returns NULL for absent code points and zero-placeholder slots.
static inline const Glyph *fontGlyphForCode(const Font *font, uint32_t codepoint) {
    const int32_t index = fontGlyphIndex(font, codepoint);
    if (index < 0 || !fontGlyphPresent(font, (uint32_t) index)) return NULL;
    return &font->glyphs[index];
}
