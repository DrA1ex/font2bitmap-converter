// Packed Image Writer
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


export class PackedImageWriter {
    static convertPixel(alpha, bpp) {
        const k = bpp > 1 ? Math.floor(0xff / 2 ** bpp + 1) : 128;
        return Math.floor(alpha / k);
    }

    constructor(bpp) {
        this.bpp = bpp;
        this.bits = [];
        this.rowByte = 0;
        this.bitIndex = 0;
    }

    write(alpha) {
        const value = PackedImageWriter.convertPixel(alpha, this.bpp)
        this.rowByte |= value << ((8 - this.bpp) - this.bitIndex);

        this.bitIndex += this.bpp;

        // TODO: To support 'odd' bpp values need to handle bitIndex >= 8 with carry additional bits
        if (this.bitIndex === 8) {
            this.flush();
        }
    }

    flush() {
        if (this.bitIndex === 0) return

        this.bits.push(this.rowByte);
        this.rowByte = this.bitIndex = 0;
    }

    byteArray() {
        return Uint8Array.from(this.bits);
    }
}
