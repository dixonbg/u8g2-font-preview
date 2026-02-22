#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FONT_LIST_URL = 'https://raw.githubusercontent.com/wiki/olikraus/u8g2/fntlistallplain.md';
const U8G2_FONT_BASE = 'https://cdn.jsdelivr.net/gh/olikraus/u8g2@master/tools/font/build/single_font_files/';
const OUT_PATH = path.join(__dirname, 'glyph-index.json');
const CONCURRENCY = 20;
const LIST_TIMEOUT_MS = 20000;
const FONT_TIMEOUT_MS = 15000;
const VERBOSE = true;

function parseFontNames(text) {
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/\bu8g2_font_\w+\b/g);
    if (!m) continue;
    for (const name of m) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

function parseCFontBytes(text) {
  const declMatch = text.match(/const\s+uint8_t\s+\w+\s*\[[^\]]*\][\s\S]{0,200}?=\s*/m);
  let afterEq;
  if (declMatch) {
    afterEq = text.slice(declMatch.index + declMatch[0].length);
  } else {
    const eqMatch = text.match(/[)\]]\s*=/);
    if (!eqMatch) return new Uint8Array(0);
    afterEq = text.slice(eqMatch.index + eqMatch[0].length);
  }

  const bytes = [];
  const strRe = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = strRe.exec(afterEq)) !== null) {
    const s = m[1];
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '\\') {
        bytes.push(s.codePointAt(i));
        i++;
        continue;
      }
      i++;
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
  return new Uint8Array(bytes);
}

function toS8(b) { return b >= 0x80 ? b - 0x100 : b; }
function u16beAt(bytes, pos) { return (bytes[pos] << 8) | bytes[pos + 1]; }

function parseU8G2Header(bytes) {
  return {
    bits_per_0: bytes[2],
    bits_per_1: bytes[3],
    bits_per_char_width: bytes[4],
    bits_per_char_height: bytes[5],
    bits_per_char_x: bytes[6],
    bits_per_char_y: bytes[7],
    bits_per_delta_x: bytes[8],
    ascent_A: bytes[13],
    descent_g: toS8(bytes[14]),
    start_pos_upper_A: u16beAt(bytes, 17),
    start_pos_lower_a: u16beAt(bytes, 19),
    start_pos_unicode: u16beAt(bytes, 21),
  };
}

function headerLooksSane(hdr, bytesLen) {
  if (!hdr) return false;
  if (hdr.bits_per_0 < 0 || hdr.bits_per_0 > 8) return false;
  if (hdr.bits_per_1 < 0 || hdr.bits_per_1 > 8) return false;
  if (hdr.bits_per_char_width <= 0 || hdr.bits_per_char_width > 8) return false;
  if (hdr.bits_per_char_height <= 0 || hdr.bits_per_char_height > 8) return false;
  if (hdr.bits_per_char_x < 0 || hdr.bits_per_char_x > 8) return false;
  if (hdr.bits_per_char_y < 0 || hdr.bits_per_char_y > 8) return false;
  if (hdr.bits_per_delta_x < 0 || hdr.bits_per_delta_x > 8) return false;

  const upperStart = 23 + hdr.start_pos_upper_A;
  const lowerStart = 23 + hdr.start_pos_lower_a;
  const unicodeStart = 23 + hdr.start_pos_unicode;
  if (upperStart < 23 || upperStart > bytesLen + 2) return false;
  if (lowerStart < 23 || lowerStart > bytesLen + 2) return false;
  if (unicodeStart < 23 || unicodeStart > bytesLen + 2) return false;
  return true;
}

function makeBitStream(bytes, byteOffset) {
  let bitPos = 0;
  function getUnsigned(cnt) {
    let val = 0;
    for (let i = 0; i < cnt; i++) {
      const bIdx = byteOffset + Math.floor(bitPos / 8);
      const b = bIdx < bytes.length ? bytes[bIdx] : 0;
      if ((b >> (bitPos % 8)) & 1) val |= (1 << i);
      bitPos++;
    }
    return val;
  }
  function getSigned(cnt) {
    if (cnt === 0) return 0;
    const val = getUnsigned(cnt);
    return val - (1 << (cnt - 1));
  }
  return { getUnsigned, getSigned };
}

function decodeU8G2Glyph(hdr, bytes, byteOffset) {
  try {
    if (!hdr || byteOffset < 0 || byteOffset >= bytes.length) return false;
    const bs = makeBitStream(bytes, byteOffset);
    const w = bs.getUnsigned(hdr.bits_per_char_width);
    const h = bs.getUnsigned(hdr.bits_per_char_height);
    bs.getSigned(hdr.bits_per_char_x);
    bs.getSigned(hdr.bits_per_char_y);
    bs.getSigned(hdr.bits_per_delta_x);
    // Guard against corrupted decode paths that would otherwise run very long.
    if (w > 128 || h > 128) return false;
    if (w === 0 || h === 0) return true;

    const total = w * h;
    let idx = 0;
    let safety = 0;
    while (idx < total && safety++ < total * 8) {
      const a = bs.getUnsigned(hdr.bits_per_0);
      const b = bs.getUnsigned(hdr.bits_per_1);
      let cont;
      do {
        idx = Math.min(idx + a, total);
        idx = Math.min(idx + b, total);
        if (idx >= total) break;
        cont = bs.getUnsigned(1);
      } while (cont !== 0);
      if (idx >= total) break;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function walkSection(hdr, bytes, sectionOffset, cps) {
  let p = sectionOffset;
  let safety = 0;
  while (p + 1 < bytes.length && bytes[p] !== 0 && safety++ < 2000) {
    const enc = bytes[p];
    const jumpSize = bytes[p + 1];
    if (jumpSize === 0) break;
    if (decodeU8G2Glyph(hdr, bytes, p + 2)) cps.push(enc);
    p += jumpSize;
  }
}

function findUnicodeGlyphStart(bytes, unicodeStart) {
  if (!(unicodeStart > 0 && unicodeStart < bytes.length - 4)) return unicodeStart;
  const firstOffset = u16beAt(bytes, unicodeStart);
  if (firstOffset <= 0 || unicodeStart + firstOffset >= bytes.length) return unicodeStart;

  let p = unicodeStart;
  let acc = unicodeStart;
  for (let i = 0; i < 512; i++) {
    if (p + 3 >= bytes.length) return unicodeStart;
    const off = u16beAt(bytes, p);
    const lastEnc = u16beAt(bytes, p + 2);
    if (off === 0) return unicodeStart;
    acc += off;
    p += 4;
    if (acc > bytes.length) return unicodeStart;
    if (lastEnc === 0xffff) {
      const glyphStart = unicodeStart + firstOffset;
      return (glyphStart >= p && glyphStart < bytes.length) ? glyphStart : unicodeStart;
    }
  }
  return unicodeStart;
}

function walkUnicodeSection(hdr, bytes, sectionOffset, cps) {
  let p = findUnicodeGlyphStart(bytes, sectionOffset);
  let safety = 0;
  while (p + 2 < bytes.length && safety++ < 12000) {
    const enc = u16beAt(bytes, p);
    const jumpSize = bytes[p + 2];
    if (jumpSize === 0) break;
    if (decodeU8G2Glyph(hdr, bytes, p + 3)) cps.push(enc);
    p += jumpSize;
  }
}

function parseFontCodePoints(cText) {
  const bytes = parseCFontBytes(cText);
  if (bytes.length < 23) return [];

  const hdr = parseU8G2Header(bytes);
  if (!headerLooksSane(hdr, bytes.length)) return [];
  const cps = [];

  const base8Start = 23;
  const upperStart = 23 + hdr.start_pos_upper_A;
  const lowerStart = 23 + hdr.start_pos_lower_a;
  const unicodeStart = 23 + hdr.start_pos_unicode;

  if (base8Start < bytes.length) walkSection(hdr, bytes, base8Start, cps);
  if (upperStart < bytes.length) walkSection(hdr, bytes, upperStart, cps);
  if (lowerStart < bytes.length && lowerStart !== upperStart) walkSection(hdr, bytes, lowerStart, cps);
  if (hdr.start_pos_unicode > 0 && unicodeStart < bytes.length) walkUnicodeSection(hdr, bytes, unicodeStart, cps);

  return [...new Set(cps)].sort((a, b) => a - b);
}

function buildRangesFromCodePoints(codePoints) {
  if (!codePoints || codePoints.length === 0) return [];
  const ranges = [];
  let start = codePoints[0];
  let end = codePoints[0];
  for (let i = 1; i < codePoints.length; i++) {
    const cp = codePoints[i];
    if (cp === end + 1) end = cp;
    else { ranges.push([start, end]); start = cp; end = cp; }
  }
  ranges.push([start, end]);
  return ranges;
}

async function withConcurrency(arr, concurrency, fn) {
  const results = new Array(arr.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < arr.length) {
      const i = next++;
      results[i] = await fn(arr[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, arr.length) }, worker));
  return results;
}

async function fetchTextWithTimeout(url, timeoutMs, retries = 0) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      const resp = await fetch(url, { signal: ac.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) process.stderr.write(`Retry ${attempt + 1}/${retries} for ${url}\n`);
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('Node.js 18+ is required for built-in fetch');
    process.exit(1);
  }

  process.stderr.write('Fetching font list... ');
  const listText = await fetchTextWithTimeout(FONT_LIST_URL, LIST_TIMEOUT_MS, 2);
  const fontNames = parseFontNames(listText);
  process.stderr.write(`${fontNames.length} fonts\n`);
  process.stderr.write(`Config: concurrency=${CONCURRENCY}, listTimeout=${LIST_TIMEOUT_MS}ms, fontTimeout=${FONT_TIMEOUT_MS}ms\n`);

  const fonts = {};
  let done = 0;
  let started = 0;
  let ok = 0;
  let fail = 0;
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    process.stderr.write(
      `Heartbeat: ${done}/${fontNames.length} processed, ${ok} indexed, ${fail} failed, ${elapsed}s elapsed\n`
    );
  }, 5000);

  await withConcurrency(fontNames, CONCURRENCY, async (name) => {
    const t0 = Date.now();
    const ordinal = ++started;
    if (VERBOSE) process.stderr.write(`[${ordinal}/${fontNames.length}] START ${name}\n`);
    try {
      const url = U8G2_FONT_BASE + name + '.c';
      const text = await fetchTextWithTimeout(url, FONT_TIMEOUT_MS, 0);
      const cps = parseFontCodePoints(text);
      const ranges = buildRangesFromCodePoints(cps);
      if (ranges.length > 0) {
        fonts[name] = {
          ranges,
          count: cps.length,
          source: 'u8g2-c'
        };
        ok++;
        if (VERBOSE) {
          const ms = Date.now() - t0;
          process.stderr.write(`[${ordinal}/${fontNames.length}] OK    ${name} cps=${cps.length} ranges=${ranges.length} ${ms}ms\n`);
        }
      } else {
        fail++;
        if (VERBOSE) {
          const ms = Date.now() - t0;
          process.stderr.write(`[${ordinal}/${fontNames.length}] EMPTY ${name} (0 ranges) ${ms}ms\n`);
        }
      }
    } catch (e) {
      fail++;
      if (VERBOSE) {
        const ms = Date.now() - t0;
        const msg = e && e.message ? e.message : String(e);
        process.stderr.write(`[${ordinal}/${fontNames.length}] FAIL  ${name} ${ms}ms :: ${msg}\n`);
      }
    }
    done++;
    if (done % 10 === 0 || done === fontNames.length) {
      process.stderr.write(`Progress: ${done}/${fontNames.length} (ok=${ok}, fail=${fail})\n`);
    }
  });
  clearInterval(heartbeat);

  process.stderr.write(`\nWriting ${OUT_PATH}...\n`);
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fonts
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8');
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  process.stderr.write(`Done. Indexed ${Object.keys(fonts).length} fonts. ok=${ok} fail=${fail} elapsed=${elapsed}s\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
