/*
 * Extended compact BMP-only bitmap font ABI for constrained renderers.
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

#define FONT_BITMAP_EXTENDED_COMPACT16_ABI_VERSION 1
#define FONT_COMPACT16_UNICODE_MAX 0xffffu

// compact16 supports only the Compact layout. Keeping the canonical flags
// value makes generated metadata explicit and prevents accidental ABI mixing.
enum FontFlags {
    FONT_FLAG_COMPACT = 0x01,
    FONT_RANGE_COMPACT = 0x02,
    FONT_COMPACT16_FLAGS = FONT_FLAG_COMPACT | FONT_RANGE_COMPACT,
};

typedef struct {
    // Bitmap data may exceed 64 KiB, so offsets remain 32-bit.
    uint32_t offset;
    uint16_t width;
    uint16_t height;
    uint16_t advanceX;
    int16_t offsetX;
    int16_t offsetY;
} Glyph;

// Sorted inclusive BMP range. glyphOffset is the index for codeFrom;
// subsequent code points map to consecutive glyph indices.
typedef struct {
    uint16_t codeFrom;
    uint16_t codeTo;
    uint16_t glyphOffset;
} GlyphRange;

typedef struct {
    // Compact positive baseline distances. Generation rejects overflow.
    uint8_t ascent;
    uint8_t descent;

    // Compact baseline-relative exclusive ink envelope.
    int8_t inkTop;
    int8_t inkBottom;
} FontMetrics;

typedef struct {
    const char *name;
    const uint8_t *bitmaps;
    const Glyph *glyphs;
    const GlyphRange *ranges;

    uint32_t bitmapSize;
    uint16_t codeFrom;
    uint16_t codeTo;
    uint16_t rangeCount;
    uint16_t glyphCount;
    uint16_t advanceY;
    uint8_t bpp;
    uint8_t flags;
    FontMetrics metrics;
} Font;

#if defined(__cplusplus)
static_assert(sizeof(Glyph) == 16, "Glyph ABI must remain 16 bytes");
static_assert(sizeof(GlyphRange) == 6, "compact16 GlyphRange ABI must remain 6 bytes");
static_assert(sizeof(FontMetrics) == 4, "extended compact16 FontMetrics ABI must remain 4 bytes");
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(Glyph) == 16, "Glyph ABI must remain 16 bytes");
_Static_assert(sizeof(GlyphRange) == 6, "compact16 GlyphRange ABI must remain 6 bytes");
_Static_assert(sizeof(FontMetrics) == 4, "extended compact16 FontMetrics ABI must remain 4 bytes");
#endif

static inline bool fontCodePointValid(uint32_t codepoint) {
    return codepoint <= FONT_COMPACT16_UNICODE_MAX
        && !(codepoint >= 0xd800u && codepoint <= 0xdfffu);
}

static inline bool fontBppValid(uint8_t bpp) {
    return bpp == 1u || bpp == 2u || bpp == 4u || bpp == 8u;
}

// A zero-initialized Glyph is the canonical absent placeholder. compact16
// ranges must never map placeholders, but this helper is useful to callers.
static inline bool fontGlyphPresent(const Font *font, uint16_t index) {
    if (!font || !font->glyphs || index >= font->glyphCount) return false;
    const Glyph *glyph = &font->glyphs[index];
    return glyph->offset != 0u
        || glyph->width != 0u
        || glyph->height != 0u
        || glyph->advanceX != 0u
        || glyph->offsetX != 0
        || glyph->offsetY != 0;
}

static inline bool fontGlyphBitmapBoundsValid(const Font *font, const Glyph *glyph) {
    if (!font || !glyph) return false;
    const uint64_t pixels = (uint64_t) glyph->width * glyph->height;
    const uint64_t bytes = (pixels * font->bpp + 7u) / 8u;
    const uint64_t end = (uint64_t) glyph->offset + bytes;
    return glyph->offset <= font->bitmapSize && end <= font->bitmapSize;
}

static inline bool fontRangeValid(const GlyphRange *range) {
    if (!range || range->codeFrom > range->codeTo) return false;
    return fontCodePointValid(range->codeFrom)
        && fontCodePointValid(range->codeTo)
        && !(range->codeFrom < 0xd800u && range->codeTo > 0xdfffu);
}

static inline bool fontMetricsValid(const Font *font) {
    if (!font) return false;
    return font->metrics.inkTop <= font->metrics.inkBottom;
}

// Complete compact16 ABI validator. Ranges must be sorted, non-overlapping,
// and cover glyph offsets 0..glyphCount-1 without gaps.
static inline bool fontValid(const Font *font) {
    if (!fontMetricsValid(font)) return false;
    if (!font || !font->name || !font->bitmaps || !font->glyphs || !font->ranges) return false;
    if (!fontBppValid(font->bpp) || font->flags != FONT_COMPACT16_FLAGS) return false;
    if (font->bitmapSize == 0u || font->glyphCount == 0u || font->rangeCount == 0u) return false;
    if (!fontCodePointValid(font->codeFrom) || !fontCodePointValid(font->codeTo)
        || font->codeFrom > font->codeTo) {
        return false;
    }

    for (uint16_t i = 0u; i < font->glyphCount; ++i) {
        if (!fontGlyphPresent(font, i)
            || !fontGlyphBitmapBoundsValid(font, &font->glyphs[i])) {
            return false;
        }
    }

    uint32_t expectedOffset = 0u;
    uint16_t previousCodeTo = 0u;
    for (uint16_t i = 0u; i < font->rangeCount; ++i) {
        const GlyphRange *range = &font->ranges[i];
        if (!fontRangeValid(range)) return false;
        if (i > 0u && range->codeFrom <= previousCodeTo) return false;
        if (range->glyphOffset != expectedOffset) return false;

        const uint32_t length = (uint32_t) range->codeTo - range->codeFrom + 1u;
        expectedOffset += length;
        if (expectedOffset > font->glyphCount) return false;
        previousCodeTo = range->codeTo;
    }

    return expectedOffset == font->glyphCount
        && font->codeFrom == font->ranges[0].codeFrom
        && font->codeTo == font->ranges[font->rangeCount - 1u].codeTo;
}

// Returns a compact glyph-array index, or -1 when the BMP code point is absent.
static inline int32_t fontGlyphIndex(const Font *font, uint32_t codepoint) {
    if (!font || font->flags != FONT_COMPACT16_FLAGS || !fontCodePointValid(codepoint)
        || !font->ranges || font->rangeCount == 0u) {
        return -1;
    }

    // Printable ASCII is commonly stored in the first continuous range.
    const GlyphRange *first = &font->ranges[0];
    if (codepoint >= first->codeFrom && codepoint <= first->codeTo) {
        const uint32_t index = (uint32_t) first->glyphOffset + codepoint - first->codeFrom;
        return index < font->glyphCount ? (int32_t) index : -1;
    }
    if (codepoint < first->codeFrom || font->rangeCount == 1u) return -1;

    uint16_t left = 1u;
    uint16_t right = font->rangeCount;
    while (left < right) {
        const uint16_t middle = (uint16_t) (left + (right - left) / 2u);
        const GlyphRange *range = &font->ranges[middle];
        if (codepoint < range->codeFrom) {
            right = middle;
        } else if (codepoint > range->codeTo) {
            left = (uint16_t) (middle + 1u);
        } else {
            const uint32_t index = (uint32_t) range->glyphOffset + codepoint - range->codeFrom;
            return index < font->glyphCount ? (int32_t) index : -1;
        }
    }
    return -1;
}

static inline const Glyph *fontGlyphForCode(const Font *font, uint32_t codepoint) {
    const int32_t index = fontGlyphIndex(font, codepoint);
    if (index < 0 || !fontGlyphPresent(font, (uint16_t) index)) return NULL;
    return &font->glyphs[index];
}
