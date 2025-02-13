// Glyph utils
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


import {PackedImageWriter} from "../misc/image_writer";


export function trimGlyph(glyph, emptyLeft, emptyRight, emptyTop, emptyBottom) {
    glyph.height = Math.max(1, glyph.height - emptyTop - emptyBottom);
    glyph.width = Math.max(1, glyph.width - emptyLeft - emptyRight);
    glyph.offsetY += emptyTop;
    glyph.offsetX += emptyLeft;
}

export function calculateEmptySpace(imageData, canvasWidth, canvasHeight, bpp) {
    return {
        emptyTop: countEmptyRows(imageData, canvasWidth, canvasHeight, bpp, 1),
        emptyBottom: countEmptyRows(imageData, canvasWidth, canvasHeight, bpp, -1),
        emptyLeft: countEmptyCols(imageData, canvasWidth, canvasHeight, bpp, 1),
        emptyRight: countEmptyCols(imageData, canvasWidth, canvasHeight, bpp, -1),
    }
}


function countEmptyRows(imageData, width, height, bpp, step) {
    let count = 0;
    for (let y = step > 0 ? 0 : height - 1; y >= 0 && y < height; y += step) {
        let rowEmpty = true;

        for (let x = 0; x < width; x++) {
            const alpha = imageData.data[(y * imageData.width + x) * 4 + 3]
            if (PackedImageWriter.convertPixel(alpha, bpp) > 0) {
                rowEmpty = false;
                break;
            }
        }

        if (!rowEmpty) break;
        ++count;
    }

    return count;
}

function countEmptyCols(imageData, width, height, bpp, step) {
    let count = 0;
    for (let x = step > 0 ? 0 : width - 1; x >= 0 && x < width; x += step) {
        let colEmpty = true;

        for (let y = 0; y < height; y++) {
            const alpha = imageData.data[(y * imageData.width + x) * 4 + 3]
            if (PackedImageWriter.convertPixel(alpha, bpp) > 0) {
                colEmpty = false;
                break;
            }
        }

        if (!colEmpty) break;
        ++count;
    }

    return count;
}
