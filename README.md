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

## Contribution

Contributuins welcomed! Feel free to fork the repository, make changes, and submit pull requests.

## License

[GPl-v3.0](LICENSE)
