# TrueType to Bitmap Font Converter

A browser and command-line converter that rasterizes TrueType/OpenType fonts into packed bitmap data for embedded renderers and Adafruit GFX.

**Web application:** https://dra1ex.github.io/font2bitmap-converter/

<img max-width="1000" alt="Web UI" src="https://github.com/user-attachments/assets/30f127c1-40e4-4c1b-92f7-384c7096621b" />

## Features

- Built-in Roboto and JetBrains Mono families, plus uploaded `.ttf`, `.otf`, and `.woff` fonts.
- 1, 2, 4, and 8 bits per pixel for the custom format.
- Hinted path rasterization with protected glyph bounds and 4x coverage supersampling.
- Correct handling of negative bearings, empty glyphs, supplementary Unicode code points, and font line metrics.
- A resizable preview canvas with 1x–4x samples, metrics/grid overlays, and a cursor-following magnifier.
- The magnifier uses 5x zoom and switches to 10x while Ctrl, Alt, or Shift is held.
- Dense, Compact, and ASCII first glyph layouts.
- Built-in Basic/Full European and Basic/Full Slavic character presets alongside the existing ranges.
- Strict missing-glyph validation in both the browser UI and CLI.
- Adafruit GFX export, the full Unicode32 ABI v2, and an optional compact16 BMP-only ABI profile.

## Size and DPI behavior

Both Custom and Adafruit exports preserve the converter's original sizing behavior:

```text
raster pixels = floor(size × DPI / 96)
```

The Custom DPI is 222. The Adafruit DPI is 141. This intentionally avoids the larger output produced by changing Adafruit to a `/72` point conversion.

## Character presets

The existing **Default**, **Light**, **Russian**, **All**, and **Custom** ranges remain unchanged. Four additional presets are available:

- **Basic European** — **Default** plus a compact Western European set for common French, German, Italian, Spanish, Portuguese, and Dutch text. It intentionally excludes Nordic and Central/Eastern European letters.
- **Full European** — **Default** plus Latin-1 Supplement, Latin Extended-A, modern Romanian `Ș/ș` and `Ț/ț`, `ẞ`, Nordic letters, Central/Eastern European Latin letters, and common European typography.
- **Basic Slavic** — **Default** plus the complete Russian alphabet and the core Ukrainian `Є/є`, `І/і`, `Ї/ї`, `Ґ/ґ` and Belarusian `Ў/ў` letters.
- **Full Slavic** — **Default** plus the complete `U+0400..U+045F` Cyrillic set and Ukrainian `Ґ/ґ`.

Every language preset contains the complete **Default** character set and then adds language-specific characters. The European and Slavic presets are independent. **Russian** remains a separate smaller preset. Missing glyphs are reported by the normal strict/non-strict export logic.

## Glyph layouts

The **Glyph layout** option controls the relationship between a Unicode code point and its glyph-array index. The exact mode is stored in `Font.flags`.

The named **all** range is resolved lazily from the selected font's Unicode `cmap`. It includes only mappings that can be represented by the bitmap ABI, instead of constructing and scanning a 65,536-character BMP string. The selected layout is preserved: choosing Dense still creates one continuous slot span from the first mapped code point to the last, while Compact stores mapped code points only.

### Dense

Every code point from `codeFrom` through `codeTo` has a glyph entry. Sparse gaps and unsupported characters use an empty placeholder.

```cpp
index = codepoint - font.codeFrom;
```

Leading and trailing unsupported entries are removed, so `codeFrom` and `codeTo` are the actual minimum and maximum exported code points.

Dense is the only mode supported by the standard Adafruit `GFXfont` structure.

Dense spans above 4,096 glyph slots produce a warning. Spans above 65,536 slots are rejected by default because a sparse selection such as `A;0x1F600` would allocate every intermediate glyph slot. Use Compact, ASCII first, or explicitly opt in with the CLI `--allow-large-dense` flag.

Explicit custom Dense ranges still reject spans crossing `U+D800..U+DFFF`, because those values are not Unicode scalar values. The named **all** selection is allowed to cross the block: it reserves 2,048 unreachable zero-placeholder slots so that the Dense index formula remains continuous. A warning is shown, and the user may select Compact to avoid those slots.

### Compact

Only selected and supported glyphs are stored. The glyph array is sorted by Unicode code point.

A separate sorted `GlyphRange` array maps code points to glyph offsets:

```cpp
typedef struct GlyphRange {
    uint32_t codeFrom;
    uint32_t codeTo;
    uint32_t glyphOffset;
} GlyphRange;
```

Continuous code points with continuous glyph offsets are merged into one range. Isolated characters are emitted as singleton ranges where `codeFrom == codeTo`.

Compact is the recommended layout for localized and sparse Unicode fonts.

### ASCII first

Glyph indices `0..127` always correspond directly to ASCII code points `0x00..0x7f`:

```cpp
index = codepoint;
```

Unselected or unsupported ASCII entries remain zeroed placeholders. Supported non-ASCII glyphs are appended immediately after index 127 and resolved through the same sorted `GlyphRange` array used by Compact mode.

## Range and ABI contract

The canonical ABI is defined in [`types.h`](types.h):

```cpp
#define FONT_BITMAP_ABI_VERSION 2
```

Generated custom headers verify this macro and fail compilation when used with an incompatible `types.h`.

Custom fonts export:

- `const GlyphRange *ranges`;
- `uint32_t bitmapSize`, initialized from the actual `sizeof(FontBitmaps)` array;
- `uint32_t rangeCount`;
- `uint32_t glyphCount`;
- actual `codeFrom` and `codeTo`;
- the exact layout type in `flags`.

Every generated font is deterministic and validated before export. Common validation checks supported `bpp`, exact flags, required pointers, Unicode bounds, ABI integer widths, and every glyph's `offset + packed bitmap bytes` against `bitmapSize`.

Mode-specific validation additionally requires:

- Dense: no range table and `glyphCount == codeTo - codeFrom + 1`;
- Compact: sorted ranges fully cover offsets `0..glyphCount-1` without gaps;
- ASCII first: direct slots `0..127`, no ASCII codes in extension ranges, and full extension coverage from offset 128;
- duplicate/overlapping code ranges and glyph-offset intervals are rejected.

Generated glyph comments always use the glyph's real Unicode code point rather than deriving it from an array index.

The bundled `types.h` provides:

- `Glyph`, with a verified 16-byte ABI;
- `GlyphRange`, with a verified 12-byte ABI;
- `Font` and layout flags;
- `fontGlyphIndex()` for allocation-free slot lookup;
- `fontGlyphPresent()` and `fontGlyphForCode()` for placeholder-aware lookup;
- `fontValid()` for complete mode-aware runtime/debug validation;

## compact16 export profile

Select **compact16 (BMP only)** in the **ABI profile** field when the target renderer uses only `U+0000..U+FFFF` and needs a smaller range table. This profile supports only the Compact glyph layout and includes [`types_compact16.h`](types_compact16.h).

Its range ABI is:

```cpp
typedef struct GlyphRange {
    uint16_t codeFrom;
    uint16_t codeTo;
    uint16_t glyphOffset;
} GlyphRange;

static_assert(sizeof(GlyphRange) == 6);
```

`codeFrom` and `codeTo` are inclusive BMP boundaries. Glyphs inside a range are resolved with:

```cpp
glyphIndex = range.glyphOffset + codePoint - range.codeFrom;
```

The profile stores `codeFrom`, `codeTo`, `rangeCount`, `glyphCount`, and `glyphOffset` as `uint16_t`; `Glyph.offset` and `Font.bitmapSize` remain `uint32_t`. It rejects supplementary Unicode above `U+FFFF`, non-Compact layouts, and more than 65,535 glyphs or ranges. Ranges remain sorted, non-overlapping, and must cover the full Compact glyph array without gaps.

The generated header checks `FONT_BITMAP_COMPACT16_ABI_VERSION`, and the compact16 lookup checks the first range before binary search.

## C linkage

Generated arrays and font objects are declared as `static const`. A generated header can therefore be included by multiple C or C++ translation units without linker multiple-definition errors.

## Strict missing-glyph validation

The converter always records the complete, sorted `missingCodePoints` list.

In the browser, missing code points and Dense-layout warnings appear below the preview statistics. Enabling **Strict export** prevents a header from being downloaded when any selected glyph is absent. The `?` tooltip next to the option explains this behavior directly in the UI.

In the CLI, `--strict` exits with an error and prints every missing code point. Without `--strict`, the header is generated and the missing list is written as a warning and as a comment in the header.

## Font flags

| Mask/value | Meaning |
|---|---|
| `0x01` | `FONT_FLAG_COMPACT` |
| `0x00` | `FONT_RANGE_DENSE` |
| `0x02` | `FONT_RANGE_COMPACT` |
| `0x04` | `FONT_RANGE_ASCII_FIRST` |
| `0x06` | `FONT_RANGE_MODE_MASK` |

`FONT_FLAG_COMPACT` is set for Compact and ASCII first. Only the exact flag values `0x00`, `0x03`, and `0x05` are valid font modes. `0x06` is only the mode mask and is rejected as a font value. Flags are the sole source of runtime lookup behavior.

Compact lookup checks the first range directly before binary-searching the remaining table. This keeps the common first ASCII range fast without changing the range ABI.

## Custom format integration

Copy `types.h` into the same directory as generated custom font headers:

```cpp
static_assert(FONT_BITMAP_ABI_VERSION == 2, "Unsupported font ABI");

if (!fontValid(&Roboto12ptCompact)) {
    // Reject malformed metadata before rendering.
}

const int32_t slot = fontGlyphIndex(&Roboto12ptCompact, codepoint);
// Dense and ASCII-first lookup can return an allocated zero-placeholder slot.
const Glyph *glyph = fontGlyphForCode(&Roboto12ptCompact, codepoint);
if (glyph) {
    // Read ceil(width × height × bpp / 8) bytes from glyph->offset.
    // fontValid() guarantees the read remains inside bitmapSize.
}
```

Consumers must decode UTF-8 into `uint32_t` Unicode code points. A `uint16_t` UTF-8 API cannot address supplementary characters above `U+FFFF`.

Supported glyphs with no visible bitmap, such as a space, retain their `advanceX` and use zero width and height. The canonical absent placeholder is exactly `{0, 0, 0, 0, 0, 0}`; `fontGlyphIndex()` may return its slot, while `fontGlyphForCode()` returns `NULL`.

## Memory statistics

The preview and generated header report these values separately:

- bitmap bytes;
- glyph count and glyph bytes;
- range count and range bytes;
- total size, calculated as bitmap bytes + glyph bytes + range bytes.

Custom estimates use the bundled ABI sizes:

```text
sizeof(Glyph)      = 16 bytes
sizeof(GlyphRange) = 12 bytes   // Unicode32 ABI v2
sizeof(GlyphRange) = 6 bytes    // compact16 profile
```

## Headless CLI

Install dependencies and run the included command:

```bash
npm install
npm run cli -- \
  --font ./font.ttf \
  --size 20 \
  --bpp 1 \
  --layout compact \
  --profile compact16 \
  --charset-file ./charset.txt \
  --strict \
  --output ./font.h
```

The UTF-8 charset file is interpreted as a set of literal Unicode characters. An initial BOM and line breaks are ignored, so the file can be maintained as readable lines. Spaces and other non-line-break characters remain part of the charset.

Available options:

```text
--font PATH
--size NUMBER
--bpp 1|2|4|8
--layout dense|compact|ascii-first
--profile unicode32|compact16
--charset-file PATH
--strict
--output PATH
--format custom|adafruit
--dpi NUMBER
--name NAME
--allow-large-dense
```

The CLI defaults to Compact and the Unicode32 profile. `--profile compact16` requires Compact layout and rejects every selected code point above `U+FFFF`. Adafruit output supports only 1 bpp and Dense layout.

## Adafruit GFX

Select **Adafruit** to generate a standard `GFXfont` header. Adafruit export always uses Dense because the external `GFXfont` structure has no range pointer, range count, glyph count, flags, or ABI version fields.

## Development

Requirements:

- Node.js 18 or newer;
- npm;
- a C/C++ compiler for generated-header integration tests.

Install dependencies and start the development server:

```bash
npm install
npm run serve
```

Create a production bundle:

```bash
npm run bundle
```

Run unit, range, CLI, rasterization, ABI, compile, and two-translation-unit linkage tests:

```bash
npm test
```

## Query parameters

| Parameter | Type | Description |
|---|---|---|
| `text` | string | Default preview text |
| `fontSize` | number | Font size entered in the UI |
| `fontFamily` | string | Default font name |
| `exportFormat` | string | Export format, for example `Adafruit` or `Custom 4bpp` |
| `exportRange` | string | Named or custom glyph range |
| `rangeMode` | string | `dense`, `compact`, or `ascii-first` |
| `abiProfile` | string | `unicode32` or `compact16` |
| `exportSizes` | comma-separated numbers | Sizes used by **Get All Fonts** |

## Custom range syntax

Use semicolons to separate ranges and individual symbols:

```text
A-Z;a-z;0x410-0x44f;0x401;0x451;0x1f600
```

Supported forms:

- Literal range: `a-z`
- Literal characters: `abcABC .,!`
- Hexadecimal range: `0xa0-0xb1`
- Individual hexadecimal code point: `0x1f600`
- Escaped separator/range characters: `\;`, `\-`, `\\`

## License

[GPL-3.0](LICENSE)

## Optional native Canvas dependency

The browser converter does not require `@napi-rs/canvas`. It is an optional dependency loaded dynamically by the headless CLI. Install optional dependencies with `npm install --include=optional` before using the CLI.
