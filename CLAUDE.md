# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single `index.html` file — a U8g2 font preview tool. No build step, no dependencies, no bundler. Everything (HTML, CSS, JS) lives in `index.html`.

## Running Locally

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

A local server is required (not `file://`) because the app fetches external resources via `fetch()`.

## Architecture

### Data Flow

1. **Font index** — fetched once at startup from `https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntlistallplain.md`, parsed with a regex into ~800 font objects, cached in `sessionStorage`.
2. **BDF files** — fetched on demand (per selected font) from `https://cdn.jsdelivr.net/gh/olikraus/u8g2@master/tools/font/bdf/[name].bdf`. Each fetched BDF is cached in a JS `Map` to avoid re-fetching.
3. **Rendering** — custom pure-JS BDF parser + ImageData-based canvas renderer (zero external deps). Integer nearest-neighbor upscaling (1×/2×/3×).

### Font Name Parsing

U8g2 font names follow: `u8g2_font_<family><height>_<mode><charset>`

Example: `u8g2_font_ncenB08_tr` → family=`ncenB`, height=`08`, mode=`t` (transparent), charset=`r` (ASCII 32–127).

The BDF source filename is typically `<family><height>.bdf`, stored in `tools/font/bdf/` in the u8g2 repo. TTF-derived fonts (logisoso, PressStart2P, etc.) have no BDF source; the UI shows a fallback note for these.

### Key JS Sections (all inline in index.html)

| Section | Responsibility |
|---------|----------------|
| `parseFontList()` | Fetch + regex-parse wiki markdown into font objects |
| `parseBDF()` | Parse raw BDF text → `Map<codepoint, glyph>` |
| `renderText()` | Draw text onto `ImageData`, center + clip to canvas bounds |
| `applyScale()` | Nearest-neighbor upscale of ImageData to display canvas |
| `applyFilters()` | AND-combine search/height/mode/charset filters on font array |
| UI event handlers | Wire filters, font list clicks, text input, W/H/scale controls |

### External URLs Used

- Font list (CORS-OK): `https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntlistallplain.md`
- BDF files (CORS-OK via jsDelivr): `https://cdn.jsdelivr.net/gh/olikraus/u8g2@master/tools/font/bdf/<name>.bdf`
- U8g2 wiki group page: `https://github.com/olikraus/u8g2/wiki/fntgrp<family>`
- Single `.c` font file: `https://github.com/olikraus/u8g2/blob/master/tools/font/build/single_font_files/<fullname>.c`
