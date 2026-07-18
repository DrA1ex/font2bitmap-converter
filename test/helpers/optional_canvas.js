// Optional native canvas test support
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

let canvasModulePromise = null;

export function loadOptionalCanvas() {
    canvasModulePromise ??= import("@napi-rs/canvas").catch(error => {
        if (isMissingOptionalCanvas(error)) return null;
        throw error;
    });
    return canvasModulePromise;
}

export function nativeCanvasSkipReason(canvasModule) {
    return canvasModule ? false : "optional @napi-rs/canvas is not installed";
}

function isMissingOptionalCanvas(error) {
    return error?.code === "ERR_MODULE_NOT_FOUND"
        || String(error?.message || error).includes("@napi-rs/canvas");
}
