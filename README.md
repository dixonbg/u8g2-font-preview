# U8g2 Font Preview

Find the right [U8g2](https://github.com/olikraus/u8g2) font before flashing your display.
Search, filter, and preview the complete U8g2 font collection directly in your browser.

## [Open the live font preview →](https://dixonbg.github.io/u8g2-font-preview/)

No installation, account, or upload required.

## What you can do

- Preview custom text on a pixel-accurate canvas.
- Search fonts by name or by the characters they contain.
- Filter by pixel height, rendering mode, and character set.
- Browse every available glyph and insert one into the preview with a click.
- Match the dimensions and scale of your target display.
- Copy the selected U8g2 font name or open its source and wiki pages.

The previewer reads the official U8g2 font list and renders both BDF-backed and
U8g2 binary `.c` fonts. Everything runs client-side, with no dependencies and no
data collection.

## Run locally

Clone the repository and serve it with any static web server:

```bash
git clone https://github.com/dixonbg/u8g2-font-preview.git
cd u8g2-font-preview
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080). A local server is
required because the app fetches font resources; opening `index.html` through a
`file://` URL will not work.

## How it works

The project is a dependency-free, single-page application. Its UI, filtering,
font parsers, and canvas renderer live in `index.html`. Font metadata is fetched
from the upstream U8g2 project and font files are loaded on demand, then cached
for the browser session.

Maintenance scripts regenerate the embedded metadata:

```bash
node gen-heights.js
node gen-glyph-index.js
```

## License

The original source code in this project is licensed under the
[BSD 2-Clause License](LICENSE). Third-party U8g2 and font materials retain
their own copyrights and license terms and are not relicensed by this project.
See [Third-party notices](THIRD_PARTY_NOTICES.md).

## Credits

[U8g2](https://github.com/olikraus/u8g2) is created by Oliver Kraus. Its library
code is licensed under BSD-2-Clause. Individual fonts use separate licenses;
consult the upstream font group and source before redistributing a selected font.
See [Third-party notices](THIRD_PARTY_NOTICES.md) for details.
