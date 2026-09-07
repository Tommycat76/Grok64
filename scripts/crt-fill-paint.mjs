/**
 * Painted-CRT helpers for the Plex fill gate.
 *
 * DOM getBoundingClientRect includes CSS transforms, so a 384×272 canvas
 * inside scale(sx,sy) reports fill 1.0 while CriOS still paints a stamp.
 * These helpers measure:
 *   1) untransformed CSS px (computed width/height, not the transformed rect)
 *   2) the bounding box of lit / non-background pixels in a bezel screenshot
 *
 * A green Plex run is still not a real CriOS PASS.
 */

import { inflateSync } from "node:zlib";

export const FILL_MIN = 0.85;
export const STAMP_AREA_MAX = 0.55;
export const FIRST_OVERLAY_MAX_MS = 4000;
export const FIRST_CRT_MAX_MS = 18000;
export const FIRST_CRT_WARN_MS = 8000;
export const PAINT_THRESH = 36;

/** #0c0c0e — --color-bezel. Used when corners cannot be sampled. */
export const BEZEL_RGB = [12, 12, 14];

export function cssPx(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function boxFill(innerW, innerH, outerW, outerH) {
  if (!(outerW >= 8) || !(outerH >= 8)) return { area: 0, fillW: 0, fillH: 0 };
  const iw = Math.max(0, innerW);
  const ih = Math.max(0, innerH);
  return {
    area: (Math.min(iw, outerW) * Math.min(ih, outerH)) / (outerW * outerH),
    fillW: iw / outerW,
    fillH: ih / outerH,
  };
}

export function fillsBox(innerW, innerH, outerW, outerH, min = FILL_MIN) {
  const f = boxFill(innerW, innerH, outerW, outerH);
  return f.area >= min && f.fillW >= min && f.fillH >= min;
}

export function colorDist(r, g, b, bg) {
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function pixel(data, i) {
  return [data[i], data[i + 1], data[i + 2]];
}

export function sampleCorners(data, width, height, pad = 3) {
  const pts = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    pts.push(pixel(data, i));
  };
  for (let y = 0; y < pad; y++) {
    for (let x = 0; x < pad; x++) {
      push(x, y);
      push(width - 1 - x, y);
      push(x, height - 1 - y);
      push(width - 1 - x, height - 1 - y);
    }
  }
  return pts;
}

function medianChannel(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export function medianColor(samples) {
  if (!samples.length) return BEZEL_RGB.slice();
  return [
    medianChannel(samples.map((p) => p[0])),
    medianChannel(samples.map((p) => p[1])),
    medianChannel(samples.map((p) => p[2])),
  ];
}

/**
 * Classify where a non-full bbox sits. Tom #44: bottom-left stamp
 * (small dark CRT, large bezel showing on the right and top).
 */
export function classifyStampCorner(bbox, imgW, imgH) {
  if (!bbox || imgW < 1 || imgH < 1) return "none";
  if (bbox.w / imgW >= FILL_MIN && bbox.h / imgH >= FILL_MIN) return "full";
  const leftGap = bbox.x / imgW;
  const rightGap = (imgW - (bbox.x + bbox.w)) / imgW;
  const topGap = bbox.y / imgH;
  const bottomGap = (imgH - (bbox.y + bbox.h)) / imgH;
  const horiz = leftGap <= rightGap ? "left" : "right";
  const vert = topGap <= bottomGap ? "top" : "bottom";
  return `${vert}-${horiz}`;
}

/**
 * Bounding box of pixels that differ from the bezel/background color.
 * Empty / near-black forever → empty:true (the ~39s blank).
 */
export function paintedContent(data, width, height, opts = {}) {
  const thresh = opts.thresh ?? PAINT_THRESH;
  const bg = opts.bg ?? medianColor(sampleCorners(data, width, height));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  const n = width * height;
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    if (colorDist(data[i], data[i + 1], data[i + 2], bg) < thresh) continue;
    const x = p % width;
    const y = (p / width) | 0;
    count += 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (count < 24 || maxX < 0) {
    return {
      empty: true,
      count,
      bbox: null,
      fill: 0,
      fillW: 0,
      fillH: 0,
      corner: "none",
      bg,
    };
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const bbox = { x: minX, y: minY, w: bw, h: bh };
  return {
    empty: false,
    count,
    bbox,
    fill: (bw * bh) / (width * height),
    fillW: bw / width,
    fillH: bh / height,
    corner: classifyStampCorner(bbox, width, height),
    bg,
  };
}

export function paintFails(paint, min = FILL_MIN) {
  if (!paint || paint.empty) return "no painted CRT (blank / bezel-only)";
  if (paint.fill < min || paint.fillW < min || paint.fillH < min) {
    return `painted stamp ${paint.corner} fill ${paint.fill.toFixed(2)}`;
  }
  return null;
}

/** #44 layout: locked 384×272 CSS box inside a taller phone bezel. */
export function oldStampLayoutFails(canvasCssW, canvasCssH, bezelW, bezelH, min = FILL_MIN) {
  return !fillsBox(canvasCssW, canvasCssH, bezelW, bezelH, min);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Minimal 8-bit RGB/RGBA PNG decoder (Playwright screenshots).
 */
export function decodePng(buf) {
  const u8 = buf instanceof Uint8Array ? u8of(buf) : new Uint8Array(buf);
  if (u8.length < 24 || u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) {
    throw new Error("not a PNG");
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let ctype = 0;
  const idats = [];
  while (off + 8 <= u8.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
    const start = off + 8;
    const data = u8.subarray(start, start + len);
    if (type === "IHDR") {
      width = dv.getUint32(start);
      height = dv.getUint32(start + 4);
      depth = u8[start + 8];
      ctype = u8[start + 9];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6)) {
    throw new Error(`unsupported png depth=${depth} color=${ctype}`);
  }
  const raw = inflateSync(Buffer.from(concat(idats)));
  const bpp = ctype === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let src = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const recon = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? recon[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 255;
      else if (filter !== 0) throw new Error(`png filter ${filter}`);
      recon[i] = v;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      rgba[di] = recon[si];
      rgba[di + 1] = recon[si + 1];
      rgba[di + 2] = recon[si + 2];
      rgba[di + 3] = bpp === 4 ? recon[si + 3] : 255;
    }
    prev = recon;
  }
  return { width, height, data: rgba };
}

function u8of(buf) {
  return buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
    ? buf
    : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Build a raw RGBA buffer (tests / fixtures). */
export function makeRgba(width, height, fill = [12, 12, 14, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3] ?? 255;
  }
  return { width, height, data };
}

export function fillRect(img, x, y, w, h, rgb) {
  const { width, height, data } = img;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * width + xx) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = rgb[3] ?? 255;
    }
  }
}

/** Tom #44 / CoS: large bezel, small dark CRT in the bottom-left. */
export function tomStampFixture(w = 374, h = 652) {
  const img = makeRgba(w, h, [0x6c, 0x5a, 0x9a, 255]);
  fillRect(img, 8, h - 8 - 96, 128, 96, [0x12, 0x16, 0x3a, 255]);
  return img;
}

/** Filled C64-ish READY (border + screen) covering the bezel. */
export function filledCrtFixture(w = 374, h = 652) {
  const img = makeRgba(w, h, [12, 12, 14, 255]);
  fillRect(img, 6, 6, w - 12, h - 12, [0xa5, 0xa4, 0xe0, 255]);
  fillRect(img, 28, 24, w - 56, h - 48, [0x3e, 0x31, 0xa2, 255]);
  fillRect(img, 40, 40, 90, 14, [0xf0, 0xf0, 0xf0, 255]);
  return img;
}
