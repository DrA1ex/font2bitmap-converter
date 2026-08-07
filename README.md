# TrueType to Bitmap Font Converter

A browser and command-line tool for converting TrueType/OpenType fonts into packed bitmap fonts for embedded applications and Adafruit GFX.

**Web application:** https://dra1ex.github.io/font2bitmap-converter/

<img max-width="1000" alt="Font converter web interface" src="https://github.com/user-attachments/assets/30f127c1-40e4-4c1b-92f7-384c7096621b" />

## Features

- Built-in Roboto and JetBrains Mono fonts, plus uploaded `.ttf`, `.otf`, and `.woff` files.
- Legacy Custom and Custom Extended bitmap output at 1, 2, 4, or 8 bits per pixel.
- Adafruit GFX output at 1 bit per pixel.
- Dense, Compact, and ASCII first glyph layouts.
- Unicode32 and BMP-only `compact16` ABI profiles.
- Built-in character presets, composable named presets, and custom Unicode ranges.
- Missing-glyph detection with an optional strict export mode.
- Interactive preview with grid, glyph metrics, scaling, and a 5x/10x magnifier.
- Headless CLI for reproducible font generation.

## Browser usage

1. Select a built-in font or upload your own.
2. Choose the font size, output format, and character set.
3. For Custom formats, select bitmap depth, glyph layout, and ABI profile.
4. Inspect the preview and memory statistics.
5. Download one font or all configured sizes.

The summary below the preview reports bitmap, glyph-table, range-table, and total output sizes. Non-fatal warnings are shown through the warning icon at the beginning of the summary.

### Strict export

Strict export stops generation when the selected font does not contain every requested character. Without strict mode, supported glyphs are exported and all missing code points are reported as warnings.

## Character presets

Every language preset contains the complete **Default** set plus its additional characters.

- **Default** — printable ASCII.
- **Light** — a smaller general-purpose subset.
- **Russian** — Default plus the Russian alphabet.
- **Basic European** — common Western European Latin characters for languages such as French, German, Italian, Spanish, Portuguese, and Dutch. It excludes Nordic and Central/Eastern European extensions.
- **Full European** — broad European Latin coverage, including Nordic and Central/Eastern European letters and common typography.
- **Basic Slavic** — Russian plus the core Ukrainian `Є/є`, `І/і`, `Ї/ї`, `Ґ/ґ` and Belarusian `Ў/ў` letters.
- **Full Slavic** — broad modern Slavic Cyrillic coverage.
- **All** — every usable Unicode mapping exposed by the selected font.
- **Custom** — a user-defined list of characters, ranges, and named preset references.

Missing characters depend on the selected font and are handled by strict/non-strict export.

## Glyph layouts

The selected layout is stored in `Font.flags` and determines how a Unicode code point maps to a glyph slot.

### Dense

Dense creates one glyph slot for every code point between the exported minimum and maximum values:

```cpp
index = codePoint - font.codeFrom;
```

Unsupported values inside the span use zero placeholders. Dense is simple and fast, but sparse Unicode selections can produce very large tables. The UI warns about large spans; Compact is usually preferable for sparse sets.

Adafruit GFX uses Dense because `GFXfont` does not contain a range table.

### Compact

Compact stores only supported selected glyphs. A sorted range table maps continuous Unicode ranges to continuous glyph intervals:

```cpp
glyphIndex = range.glyphOffset + codePoint - range.codeFrom;
```

Compact is the recommended layout for localized fonts and sparse Unicode sets.

### ASCII first

ASCII first reserves glyph slots `0..127` for the corresponding ASCII code points. Non-ASCII glyphs follow immediately after them and are resolved through the range table.

Use this when direct ASCII indexing is useful and the fixed 128-slot base is acceptable.

## Custom export ABI

The canonical full-Unicode ABI is defined in [`types.h`](types.h):

```cpp
#define FONT_BITMAP_ABI_VERSION 2
```

Generated headers contain `static const` arrays and may be included from multiple C or C++ translation units. They store:

- packed bitmap data and its byte size;
- glyph metadata;
- optional Unicode range mappings;
- glyph and range counts;
- actual minimum and maximum code points;
- bits per pixel and layout flags.

The bundled helpers provide validated lookup without allocation:

```cpp
static_assert(FONT_BITMAP_ABI_VERSION == 2, "Unsupported font ABI");

if (!fontValid(&Roboto12ptCompact)) {
    // Reject malformed font metadata.
}

const Glyph *glyph = fontGlyphForCode(&Roboto12ptCompact, codePoint);
if (glyph) {
    // Read the glyph bitmap from glyph->offset.
}
```

`fontGlyphIndex()` performs fast slot lookup and may return a zero-placeholder slot in Dense and ASCII first layouts. `fontGlyphForCode()` returns `NULL` when the slot is absent.

Consumers should decode UTF-8 into `uint32_t` Unicode code points. Visible empty glyphs such as spaces keep their advance while using zero bitmap width and height.


### Custom Extended metrics

`Custom Extended` keeps the legacy Custom glyph and bitmap representation and adds one font-level metrics structure after the existing `Font` fields:

```cpp
typedef struct {
    uint16_t ascent;
    uint16_t descent;
    int16_t inkTop;
    int16_t inkBottom;
} FontMetrics;
```

`ascent` and `descent` are positive baseline distances used for stable vertical layout. `inkTop` and `inkBottom` are baseline-relative bounds of the painted pixels across the exported glyph set, calculated once during generation from final glyph `offsetY` and `height` values.

The Unicode32 extended ABI is defined in [`types_extended.h`](types_extended.h). The `compact16` extended ABI is defined in [`types_extended_compact16.h`](types_extended_compact16.h) and stores the same metrics as `uint8_t`, `uint8_t`, `int8_t`, and `int8_t`. Generation fails instead of truncating values when a compact metric does not fit its 8-bit range.

Legacy `Custom` output continues to use `types.h` or `types_compact16.h` unchanged.

### Typer format

`Typer` is a compact BMP-oriented C++ export intended for the Typer UI renderer. It always uses the Compact range layout with 16-bit code points, range offsets, and counts, while keeping font metrics at full 16-bit precision. Its ABI is defined in [`types_typer.h`](types_typer.h).

The format uses signed `int16_t` horizontal and vertical advances and const bitmap/glyph/range pointers. Generation rejects values that do not fit the Typer field widths rather than truncating them.

### compact16 profile

[`types_compact16.h`](types_compact16.h) defines a smaller BMP-only profile for Compact fonts:

```cpp
typedef struct {
    uint16_t codeFrom;
    uint16_t codeTo;
    uint16_t glyphOffset;
} GlyphRange;
```

`sizeof(GlyphRange)` is 6 bytes. Code points, glyph counts, range counts, and glyph offsets are limited to 16 bits; bitmap offsets and total bitmap size remain 32-bit.

Choose `compact16` only when all required characters are in `U+0000..U+FFFF`. Supplementary Unicode is rejected.

## Size and DPI

Raster dimensions are calculated as:

```text
pixels = floor(size × DPI / 96)
```

The default DPI is 222 for Custom, Custom Extended, and Typer output, and 141 for Adafruit output. The CLI uses the same defaults as the web UI unless `--dpi` explicitly overrides them.

## Command-line usage

The CLI uses the same generator, built-in fonts, range parser, and format DPI defaults as the browser version. `--font` accepts either a file path or a built-in font name. Character selection can come from either `--range` or `--charset-file`.

```bash
npm install
npm run cli -- \
  --font JetBrainsMono \
  --size 8 \
  --format typer \
  --bpp 4 \
  --range ':russian:;:basic_european:' \
  --strict \
  --output ./JetBrainsMono8.h
```

A file-based invocation remains supported:

```bash
npm run cli -- \
  --font ./font.ttf \
  --size 20 \
  --layout compact \
  --profile unicode32 \
  --charset-file ./charset.txt \
  --output ./font.h
```

Core options:

```text
--font FONT                    Built-in font name or TTF/OTF/WOFF path
--size NUMBER
--range EXPR                   Range expression; alternative to --charset-file
--charset-file PATH            Literal UTF-8 charset; alternative to --range
--output PATH                  Header path or - for stdout
--format custom|custom-extended|typer|adafruit
--bpp 1|2|4|8
--layout dense|compact|ascii-first
--profile unicode32|compact16
--dpi NUMBER                   Override the web-format DPI
--strict
--name NAME
--allow-large-dense
```

Built-in fonts are `Roboto`, `Roboto Bold`, `Roboto Thin`, `JetBrainsMono`, `JetBrainsMono Bold`, and `JetBrainsMono Thin`. Names are case-insensitive; quote names containing spaces.

Format/layout/profile constraints match the web generator:

- `custom` — legacy Custom ABI; `dense`, `compact`, or `ascii-first`; `unicode32` or `compact16` (the latter requires `compact`).
- `custom-extended` — the same Custom choices plus font metrics.
- `typer` — Typer ABI with fixed Compact layout and compact16/BMP ranges; BPP remains selectable.
- `adafruit` — fixed Dense layout and 1 BPP.

If `--dpi` is omitted, CLI rasterization uses exactly the same format default as the web UI: 222 DPI for Custom, Custom Extended, and Typer; 141 DPI for Adafruit. `--dpi` is only an explicit override.

The UTF-8 charset file contains literal characters. A leading BOM and line breaks are ignored; spaces and other characters remain part of the set.

### Optional native Canvas

The browser version does not use `@napi-rs/canvas`. The package is an optional dependency required only for CLI rasterization and Node.js raster tests.

Install it with normal optional dependencies:

```bash
npm install --include=optional
```

When it is unavailable, browser development still works and Canvas-dependent tests are skipped.

## Custom range syntax

Separate entries with semicolons:

```text
A-Z;a-z;0x410-0x44f;0x401;0x451;0x1f600
```

Supported forms:

- named preset: `:russian:`, `:basic_european:`, `:basic_slavic:`
- combined named presets: `:russian:;:basic_european:`
- literal range: `a-z`
- literal characters: `abcABC .,!`
- hexadecimal range: `0xa0-0xb1`
- hexadecimal code point: `0x1f600`
- escaped special characters: `\;`, `\-`, `\\`

Available named preset identifiers are `default`, `light`, `russian`,
`basic_european`, `full_european`, `basic_slavic`, and `full_slavic`. Named
presets may be mixed with literal/hex ranges. The merged character set is
de-duplicated and sorted by Unicode code point before the selected glyph layout
is built, so preset order does not affect glyph indices or range-table order.

## URL parameters

The web application accepts optional query parameters:

| Parameter | Description |
|---|---|
| `text` | Initial preview text |
| `fontSize` | Initial font size |
| `fontFamily` | Built-in font name |
| `exportFormat` | `Adafruit`, `Custom`, `Custom Extended`, or `Typer` (legacy `Custom Nbpp` values are still accepted) |
| `bpp` | Custom bitmap depth: `1`, `2`, `4`, or `8` |
| `exportRange` | Named preset or custom range |
| `rangeMode` | `dense`, `compact`, or `ascii-first` |
| `abiProfile` | `unicode32` or `compact16` |
| `exportSizes` | Comma-separated sizes for **Get All Fonts** |

## Development

Requirements: Node.js 18 or newer, npm, and a C/C++ compiler for header integration tests.

```bash
npm install       # install dependencies; does not build
npm run serve     # development server
npm test          # tests only; bundle validation runs in memory
npm run bundle    # create the production bundle
```

`npm install` and `npm test` do not create the `bundle/` directory.

## License

[GPL-3.0](LICENSE)
