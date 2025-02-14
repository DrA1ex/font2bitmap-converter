# TrueType to Bitmap Font Converter

**TrueType to Bitmap Font Converter** is a web-based tool for converting TrueType font files (`.ttf`) into bitmap font data. This data can be used for lightweight font rendering in embedded systems, game engines, or other applications that require pixel-perfect font rendering.

**Web Application URL:** [TrueType to Bitmap Font Converter](https://dra1ex.github.io/font2bitmap-converter/)

<img max-width="1000" alt="WebUI" src="https://github.com/user-attachments/assets/30f127c1-40e4-4c1b-92f7-384c7096621b" />

## Features

- **Convert TTF to Bitmap**  
  Convert TrueType fonts into bitmap font data, easily exportable via C header files.

- **Built-in and Custom Fonts**  
  Use preloaded (built-in) fonts or upload custom `.ttf` files for conversion.

- **Customizable Options**  
  Configure font parameters and select glyphs range you need.

- **Live Preview**  
  See a rendered preview of the converted font in real time, just as it would appear on the device screen.

- **Batch Conversion**  
  Convert multiple fonts at once and export them in bulk.

- **Supported Formats**  
  - Supports generating font data for **Adafruit GFX**.  
  - Font data format suitable for use with custom rendering engines.


## Example Usage

### Draw Text Using Generated Bitmap Fonts

To use the generated fonts in your C-based projects, check out the pre-implemented drawing module:  
[text.h implementation](https://github.com/DrA1ex/ff5m/blob/dev/.bin/src/common/text.h)

The associated font type definitions can be found here:
[font types.h](https://github.com/DrA1ex/ff5m/blob/dev/.bin/src/common/fonts/types.h)

### Integration with Adafruit GFX

The exported files are also compatible with the [Adafruit GFX graphics library](https://learn.adafruit.com/adafruit-gfx-graphics-library/overview), a common choice for drawing fonts on small screens like OLEDs or TFT displays with Arduino or similar platforms.


## Query Parameters

The following query parameters can be used to preconfigure the converter. These parameters can be appended to the URL query string to provide default values for settings.

| Parameter         | Type              | Default Value   | Description                                                                 |
|-------------------|-------------------|-----------------|-----------------------------------------------------------------------------|
| `text`           | `string`          | `""` (empty)    | Provides the default preview text to render                  |
| `fontSize`       | `integer`         | `""` (empty)    | Sets the default font size |
| `fontFamily`     | `string`          | `""` (empty)    | Specifies the default font name                |
| `exportFormat`   | `string`          | `""` (empty)    | Defines the default export format (e.g., `Adafruint`, `Custom 2bpp`, etc.)              |
| `exportRange`    | `string`          | `""` (empty)    | Specifies the range of characters (e.g., `default`, or `0-9,a-z`) to be exported. |
| `exportSizes`    | `array[integer]`  | `[]` (empty)    | Comma-separated list of export sizes (e.g., `16,32,64`) for `Export All Fonts` action. |

#### Example
To use these query parameters, append them to the converter's URL. For example:

```
https://dra1ex.github.io/font2bitmap-converter/?text=Hello&fontSize=16&fontFamily=Arial&exportFormat=png&exportRange=33-126&exportSizes=16,32,64
```

### Custom range format

The `exportRange` parameter allows you to specify a range of font glyphs for export. Here's how it works:

#### Supported Formats for Ranges
1. **Symbol Range**: Specify a range between two characters.  
   Example: `a-z` (includes all characters from 'a' to 'z')

2. **Individual Symbols**: List specific characters.  
   Example: `abcABC .,`

3. **Code Range**: Specify a range of Unicode code points in hexadecimal.  
   Example: `0xa0-0xb1` (includes all codes between `0xa0` and `0xb1`).

4. **Individual Code Points**: List specific Unicode code points in hexadecimal.  
   Example: `0xff,0xaab0,0xabf`.

#### Separator for Multiple Ranges
Use a semicolon (`;`) to separate multiple ranges.  
Example: `a-z;0xa0-0xb1;abc`.

#### Escaping Special Symbols
To include special characters literally, use the backslash (`\`) escape.  
Example: `a\-z` is interpreted as the symbols: `a`, `-`, `z`.

## Contribution

Contributuins welcomed! Feel free to fork the repository, make changes, and submit pull requests.

## License

[GPl-v3.0](LICENSE)
