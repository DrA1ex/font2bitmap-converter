// Common utils
//
// Copyright (C) 2025, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

const HexTokenRe = "(0x[0-9a-fA-F]+)";
const EscapedTokenRe = "(?:\\\\([;\\\\-]))";
const OtherTokenRe = "([^;\\\\-])";
const TokenRe = `(?:${HexTokenRe}|${EscapedTokenRe}|${OtherTokenRe})`;

const SplitTokenRe = "(?:;|$)"

const RangePatternRe = new RegExp(
    `(${TokenRe})(-${TokenRe}(?=${SplitTokenRe}))?${SplitTokenRe}?`, "g"
)

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


export function parseRange(rangeStr) {
    const results = new Set();

    // Function to process a range (e.g., a-z, 0xa0-0xb1)
    function processRange(start, end) {
        const startCode = isHex(start) ? parseInt(start, 16) : start.charCodeAt(0);
        const endCode = isHex(end) ? parseInt(end, 16) : end.charCodeAt(0);

        for (let i = startCode; i <= endCode; i++) {
            results.add(String.fromCharCode(i));
        }
    }

    // Function to process individual symbol or code point
    function processSymbol(symbol) {
        if (isHex(symbol)) {
            // If it's a character code in hex, convert to string
            results.add(String.fromCharCode(parseInt(symbol, 16)));
        } else {
            // Otherwise, it's a literal character
            results.add(symbol);
        }
    }

    // Helper function to check if a string is a hex code
    function isHex(str) {
        return /^0x[0-9a-fA-F]+$/.test(str);
    }

    for (const match of rangeStr.matchAll(RangePatternRe)) {
        const [_1, _2, startHex, startEscaped, startSymb, range, endHex, endEscaped, endSymb] = match;

        const start = startHex || startEscaped || startSymb;
        if (range) {
            const end = endHex || endEscaped || endSymb;
            processRange(start, end);
        } else if (start) {
            processSymbol(start);
        }
    }

    return Array.from(results).join("");
}

