// Common utils
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license


export function capitalize(str) {
    function isDigit(char) {
        return char >= '0' && char <= '9';
    }

    return str.split(" ")
        .map(s => s.replaceAll(/[^A-Za-z0-9]/g, ""))
        .filter(s => s.length)
        .map(s => /\d+/.test(s) ? s : `${s[0].toUpperCase()}${s.slice(1)}`)
        .reduce((prev, cur) => {
            if ((!prev || isDigit(prev.at(-1))) && isDigit(cur[0])) {
                prev += "_";
            }
            prev += cur;

            return prev;
        }, "")
}


export function generateString(...pairs) {
    let result = "";

    for (let i = 0; i < pairs.length; i += 2) {
        const [from, to] = pairs.slice(i, i + 2);

        result += new Array(to.charCodeAt() - from.charCodeAt() + 1)
            .fill(0)
            .map((_, i) => String.fromCharCode(from.charCodeAt() + i))
            .join("");
    }

    return result;
}

export function toHex(value, bytes = 1) {
    let count = bytes * 2;

    const str = value.toString(16);
    if (str.length > bytes) {
        count = str.length + str.length % 2;
    }

    return `0x${str.padStart(count, "0")}`;
}

export function getColorComponents(color) {
    const a = (color >>> 24) & 0xff;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    return [a, r, g, b];
}

export function toColor(colorComponents) {
    let result = 0;
    const bitOffset = (colorComponents.length - 1) * 8;
    for (let i = 0; i < colorComponents.length; i++) {
        result |= (colorComponents[i] & 0xff) << (bitOffset - i * 8);
    }

    return result;
}
