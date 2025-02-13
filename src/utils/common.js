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
    return `0x${value.toString(16).padStart(bytes * 2, "0")}`;
}