#!/usr/bin/env node
/**
 * gen-heights.js  —  pre-compute U8g2 font pixel heights and patch index.html
 *
 * Fetches the U8g2 font list and the first ~30 bytes of every .c font file,
 * reads ascent_A (header byte 13) and descent_g (header byte 14) from the
 * 23-byte U8g2 font header, and embeds a compact lookup table into index.html
 * between the HEIGHTS_START / HEIGHTS_END markers.
 *
 * Usage:
 *   node gen-heights.js
 *
 * Requirements:
 *   Node.js 18+  (uses built-in fetch)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const FONT_LIST_URL  = 'https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntlistallplain.md';
const FONT_BASE      = 'https://cdn.jsdelivr.net/gh/olikraus/u8g2@master/tools/font/build/single_font_files/';
const INDEX_PATH     = path.join(__dirname, 'index.html');
const CONCURRENCY    = 20;   // parallel requests — stay friendly to the CDN

// ── Parse first N bytes from U8g2 .c source text ─────────────────────────────
function parseCFontBytes(text, maxBytes = 30) {
  // Locate the array initialiser — handles both formats:
  //   const uint8_t name[N] = "..."          (old)
  //   ...U8G2_FONT_SECTION("name") = "..."   (new, most fonts)
  // The ")" in U8G2_FONT_SECTION(...) precedes " = " so we match [)]] followed by =.
  // We find the LAST such match to avoid false hits inside glyph data earlier in the string.
  const eqMatch = text.match(/[)\]]\s*=/);
  if (!eqMatch) return [];
  const afterEq = text.slice(eqMatch.index + eqMatch[0].length);

  const bytes = [];
  const strRe = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = strRe.exec(afterEq)) !== null && bytes.length < maxBytes) {
    const s = m[1];
    let i   = 0;
    while (i < s.length && bytes.length < maxBytes) {
      if (s[i] !== '\\') {
        bytes.push(s.codePointAt(i));
        i++;
        continue;
      }
      i++;  // skip backslash
      if (i >= s.length) break;

      if (s[i] === 'x') {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16) || 0);
        i += 3;
      } else if (s[i] >= '0' && s[i] <= '7') {
        let j = i;
        while (j < i + 3 && j < s.length && s[j] >= '0' && s[j] <= '7') j++;
        bytes.push(parseInt(s.slice(i, j), 8));
        i = j;
      } else {
        const esc = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, '"': 34, "'": 39 };
        bytes.push(esc[s[i]] !== undefined ? esc[s[i]] : s.codePointAt(i));
        i++;
      }
    }
  }
  return bytes;
}

// Extract pixel height from the 23-byte header
//   ascent_A (byte 13) + |descent_g| (byte 14, signed)
//   fallback to max_char_height (byte 10) if ascent+descent is zero
function getHeight(bytes) {
  if (bytes.length < 11) return 0;
  if (bytes.length >= 15) {
    const ascent  = bytes[13];
    const raw14   = bytes[14];
    const descent = raw14 >= 0x80 ? raw14 - 0x100 : raw14;
    const h = ascent + Math.abs(descent);
    if (h > 0) return h;
  }
  // fallback: max_char_height
  const mch = bytes[10];
  return mch >= 0x80 ? mch - 0x100 : mch; // treat as signed just in case
}

// ── Parse font names from wiki markdown ──────────────────────────────────────
function parseFontNames(text) {
  const seen  = new Set();
  const names = [];
  for (const line of text.split('\n')) {
    const m = line.match(/\bu8g2_font_\w+\b/g);
    if (!m) continue;
    for (const name of m) {
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    }
  }
  return names;
}

// ── Bounded concurrency helper ────────────────────────────────────────────────
async function withConcurrency(arr, concurrency, fn) {
  const results = new Array(arr.length).fill(null);
  let   next    = 0;
  async function worker() {
    while (next < arr.length) {
      const i = next++;
      results[i] = await fn(arr[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, arr.length) }, worker));
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (typeof fetch !== 'function') {
    console.error('Error: Node.js 18+ required (built-in fetch).');
    process.exit(1);
  }

  // 1. Load font list
  process.stderr.write('Fetching font list… ');
  const listText  = await fetch(FONT_LIST_URL).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  const fontNames = parseFontNames(listText);
  process.stderr.write(`${fontNames.length} fonts found.\n`);

  // 2. Fetch each .c file (only the first ~600 bytes are needed for the header)
  let done = 0;
  const heights = {};

  await withConcurrency(fontNames, CONCURRENCY, async (name) => {
    try {
      const url  = FONT_BASE + name + '.c';
      const resp = await fetch(url);
      if (resp.ok) {
        // We need only the first few hundred bytes; read the full text but
        // parseCFontBytes stops after 30 bytes anyway.
        const text = await resp.text();
        const h    = getHeight(parseCFontBytes(text, 30));
        if (h > 0) heights[name] = h;
      }
    } catch (_) { /* network error — skip */ }

    done++;
    if (done % 50 === 0 || done === fontNames.length) {
      process.stderr.write(`  ${done} / ${fontNames.length}\r`);
    }
  });

  process.stderr.write(`\nDone. ${Object.keys(heights).length} / ${fontNames.length} heights collected.\n`);

  // 3. Build compact JS object literal (sorted by name)
  const entries = Object.keys(heights).sort()
    .map(k => `  "${k}":${heights[k]}`);
  const tableJS = `{\n${entries.join(',\n')}\n}`;

  // 4. Patch index.html — replace content between HEIGHTS_START and HEIGHTS_END
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const START = '/* HEIGHTS_START */';
  const END   = '/* HEIGHTS_END */';
  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1 || ei < si) {
    process.stderr.write('ERROR: HEIGHTS_START / HEIGHTS_END markers not found in index.html\n');
    process.exit(1);
  }
  const patched = html.slice(0, si + START.length) + tableJS + html.slice(ei);
  fs.writeFileSync(INDEX_PATH, patched, 'utf8');
  process.stderr.write(`index.html patched with ${Object.keys(heights).length} entries.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
