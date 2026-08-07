// Named Custom-range expression regression tests
//
// Copyright (C) 2025-2026, Alexander K <https://github.com/drA1ex>
//
// This file may be distributed under the terms of the GNU GPLv3 license

import test from "node:test";
import assert from "node:assert/strict";

import {FontRanges, parseFontRangeExpression} from "../src/defs.js";

function sortedUnique(...charsets) {
    const codes = new Set();
    for (const charset of charsets) {
        for (const character of Array.from(charset)) codes.add(character.codePointAt(0));
    }
    return Array.from(codes)
        .sort((left, right) => left - right)
        .map(code => String.fromCodePoint(code))
        .join("");
}

test("named ranges merge, de-duplicate, and sort independently of expression order", () => {
    const expected = sortedUnique(FontRanges.russian, FontRanges.basicEuropean);

    assert.equal(parseFontRangeExpression(":russian:;:basic_european:"), expected);
    assert.equal(parseFontRangeExpression(":basic_european:;:russian:"), expected);
});

test("named ranges can be mixed with legacy Custom range syntax", () => {
    const parsed = parseFontRangeExpression(":basic_slavic:;0x20ac;\\;;A-Z");

    for (const character of ["А", "Я", "Є", "€", ";", "A", "Z"]) {
        assert.ok(parsed.includes(character), `contains ${character}`);
    }

    const codes = Array.from(parsed, character => character.codePointAt(0));
    assert.deepEqual(codes, Array.from(new Set(codes)).sort((left, right) => left - right));
});

test("unknown named ranges fail explicitly", () => {
    assert.throws(
        () => parseFontRangeExpression(":russian:;:does_not_exist:"),
        /Unknown named glyph range: :does_not_exist:/
    );
});
