// Glyph bitmap utilities
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

/**
 * Finds the smallest rectangle containing source raster coverage. Bounds are
 * intentionally independent of output BPP so glyph geometry remains stable
 * when only bitmap quantization changes. Returns null when the glyph has no
 * raster coverage.
 */
export function calculateContentBounds(alpha, width, height) {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            if (alpha[y * width + x] === 0) continue;

            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }

    if (right < left || bottom < top) return null;

    return {
        left,
        top,
        right,
        bottom,
        width: right - left + 1,
        height: bottom - top + 1,
    };
}

export function applyContentBounds(glyph, bounds) {
    if (!bounds) {
        glyph.width = 0;
        glyph.height = 0;
        glyph.offsetX = 0;
        glyph.offsetY = 0;
        return;
    }

    glyph.width = bounds.width;
    glyph.height = bounds.height;
    glyph.offsetX += bounds.left;
    glyph.offsetY += bounds.top;
}
