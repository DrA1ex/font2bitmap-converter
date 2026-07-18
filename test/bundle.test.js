// Bitmap font converter bundle regression tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";

test("browser entry point bundles without writing build artifacts", async () => {
    const result = await build({
        entryPoints: ["./src/index.js"],
        bundle: true,
        format: "esm",
        write: false,
        logLevel: "silent",
    });

    assert.ok(result.outputFiles?.length > 0, "esbuild returns an in-memory bundle");
    assert.ok(result.outputFiles[0].contents.length > 0, "in-memory bundle is not empty");
});
