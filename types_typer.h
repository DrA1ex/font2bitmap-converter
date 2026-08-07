/*
 * Typer bitmap font ABI.
 *
 * Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
 *
 * This file may be distributed under the terms of the GNU GPLv3 license.
 */

#pragma once

#include <stdint.h>

struct Glyph {
    uint32_t offset;

    uint16_t width;
    uint16_t height;

    int16_t advanceX;

    int16_t offsetX;
    int16_t offsetY;
};

// Sorted, inclusive Unicode range. glyphOffset is the glyph-array index for
// codeFrom; subsequent code points in the range use consecutive glyph indices.
struct GlyphRange {
    uint16_t codeFrom;
    uint16_t codeTo;
    uint16_t glyphOffset;
};

struct FontMetrics {
    // Positive pixel distances from the baseline used for stable line layout.
    uint16_t ascent;
    uint16_t descent;

    // Baseline-relative exclusive pixel envelope of all exported glyph ink.
    int16_t inkTop;
    int16_t inkBottom;
};

struct Font {
    const char *name;
    const uint8_t *buffer;
    const Glyph *glyphs;
    const GlyphRange *ranges = nullptr;

    uint8_t bpp;

    uint16_t codeFrom;
    uint16_t codeTo;

    int16_t advanceY;

    uint16_t rangeCount = 0;
    uint16_t glyphCount = 0;

    FontMetrics metrics;
};
