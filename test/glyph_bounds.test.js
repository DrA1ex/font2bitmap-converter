// Glyph geometry regression tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";
import {calculateContentBounds} from "../src/utils/glyph.js";

test("glyph content bounds use source alpha coverage instead of BPP quantization", () => {
    // The low-alpha edge pixels are intentionally below the non-zero threshold
    // of 2 bpp, but they still belong to the raster geometry and must keep the
    // same glyph box when exporting at 1/2/4/8 bpp.
    const alpha = Uint8Array.from([
        0, 0, 0, 0, 0,
        0, 8, 255, 8, 0,
        0, 0, 255, 0, 0,
        0, 0, 0, 0, 0,
    ]);

    assert.deepEqual(calculateContentBounds(alpha, 5, 4), {
        left: 1,
        top: 1,
        right: 3,
        bottom: 2,
        width: 3,
        height: 2,
    });
});

test("glyph content bounds still return null for an empty raster", () => {
    assert.equal(calculateContentBounds(new Uint8Array(12), 4, 3), null);
});
