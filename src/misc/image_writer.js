// Packed Image Writer
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

const SupportedBpp = new Set([1, 2, 4, 8]);

export class PackedImageWriter {
    static convertPixel(alpha, bpp) {
        validateBpp(bpp);
        const normalizedAlpha = Math.max(0, Math.min(255, Number(alpha) || 0));

        if (bpp === 1) return normalizedAlpha >= 128 ? 1 : 0;

        const maxValue = (1 << bpp) - 1;
        return Math.round(normalizedAlpha * maxValue / 255);
    }

    constructor(bpp) {
        validateBpp(bpp);
        this.bpp = bpp;
        this.bits = [];
        this.rowByte = 0;
        this.bitIndex = 0;
    }

    write(alpha) {
        const value = PackedImageWriter.convertPixel(alpha, this.bpp);
        this.rowByte |= value << ((8 - this.bpp) - this.bitIndex);
        this.bitIndex += this.bpp;

        if (this.bitIndex === 8) this.flush();
    }

    flush() {
        if (this.bitIndex === 0) return;

        this.bits.push(this.rowByte);
        this.rowByte = 0;
        this.bitIndex = 0;
    }

    byteArray() {
        return Uint8Array.from(this.bits);
    }
}

function validateBpp(bpp) {
    if (!SupportedBpp.has(bpp)) {
        throw new RangeError(`Unsupported bits-per-pixel value: ${bpp}`);
    }
}
