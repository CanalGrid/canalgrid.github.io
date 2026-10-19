// Canal Grid — brand renderer v2 (neon / gradient / bloom)
// usage: node make-brand.mjs icon|header [outfile]
import zlib from 'node:zlib';
import fs from 'node:fs';

const MODE = process.argv[2] || 'icon';
const CFG = MODE === 'header'
  ? { W: 4096, H: 2304, SS: 2 }
  : { W: 512, H: 512, SS: 4 };
const { W, H, SS } = CFG;
const NW = W * SS, NH = H * SS;

// ------------------------------------------------------------ palette
const BASE = [0x05, 0x06, 0x0d];
const G0 = [0x2b, 0xf5, 0xd8];   // aqua
const G1 = [0x3d, 0x8b, 0xff];   // electric blue
const G2 = [0xa8, 0x55, 0xf7];   // violet
const NEON = [0xff, 0x2d, 0x78]; // hot magenta — the water
const WHITE = [0xff, 0xff, 0xff];

// ------------------------------------------------------ mask machinery
const mask = () => new Uint8Array(NW * NH);
function mRect(m, x0, y0, w, h) {
  const ax = Math.max(0, Math.round(x0 * SS)), ay = Math.max(0, Math.round(y0 * SS));
  const bx = Math.min(NW, Math.round((x0 + w) * SS)), by = Math.min(NH, Math.round((y0 + h) * SS));
  for (let y = ay; y < by; y++) { const row = y * NW; for (let x = ax; x < bx; x++) m[row + x] = 255; }
}
function mDisc(m, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(NW - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(NH - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy, row = y * NW, rest = r2 - dy * dy;
    if (rest < 0) continue;
    const half = Math.sqrt(rest);
    const a = Math.max(x0, Math.ceil(cx - half)), b = Math.min(x1, Math.floor(cx + half));
    for (let x = a; x <= b; x++) m[row + x] = 255;
  }
}
const bez = (p, t) => {
  const u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return [b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0],
          b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1]];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// stroke with an optional width ramp (w0 -> w1 across the whole path)
function mStroke(m, subs, w0, tf, w1 = w0) {
  const total = subs.length;
  subs.forEach((s, si) => {
    const pts = s.type === 'cubic' ? s.p.map(tf) : s.pts.map(tf);
    const seg = (i, n) => (si + i / n) / total;
    if (s.type === 'cubic') {
      const steps = Math.max(200, Math.ceil(dist(pts[0], pts[3]) * SS / 0.5));
      for (let i = 0; i <= steps; i++) {
        const t = seg(i, steps);
        const [x, y] = bez(pts, i / steps);
        mDisc(m, x * SS, y * SS, ((w0 + (w1 - w0) * t) / 2) * SS);
      }
    } else {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const steps = Math.max(2, Math.ceil(dist(a, b) * SS / 0.5));
        for (let i = 0; i <= steps; i++) {
          const u = i / steps, t = seg((k + u) / (pts.length - 1), 1);
          mDisc(m, (a[0] + (b[0] - a[0]) * u) * SS, (a[1] + (b[1] - a[1]) * u) * SS,
                ((w0 + (w1 - w0) * t) / 2) * SS);
        }
      }
    }
  });
}

// supersampled mask -> float coverage at final resolution
function resolve(m) {
  const out = new Float32Array(W * H);
  const n = SS * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = (y * SS + sy) * NW + x * SS;
        for (let sx = 0; sx < SS; sx++) s += m[row + sx];
      }
      out[y * W + x] = s / (255 * n);
    }
  }
  return out;
}

function boxBlur(src, r, passes = 3) {
  let a = Float32Array.from(src), b = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {                        // horizontal
      const row = y * W; let sum = 0;
      for (let x = 0; x <= r && x < W; x++) sum += a[row + x];
      for (let x = 0; x < W; x++) {
        const lo = x - r - 1, hi = x + r;
        b[row + x] = sum / (2 * r + 1);
        if (hi + 1 < W) sum += a[row + hi + 1];
        if (lo >= 0) sum -= a[row + lo];
      }
    }
    for (let x = 0; x < W; x++) {                        // vertical
      let sum = 0;
      for (let y = 0; y <= r && y < H; y++) sum += b[y * W + x];
      for (let y = 0; y < H; y++) {
        const lo = y - r - 1, hi = y + r;
        a[y * W + x] = sum / (2 * r + 1);
        if (hi + 1 < H) sum += b[(hi + 1) * W + x];
        if (lo >= 0) sum -= b[lo * W + x];
      }
    }
  }
  return a;
}

// ------------------------------------------------------------- geometry
const EXT = MODE === 'header' ? 640 : 112;
const TILE_POS = [4, 68, 132, 196, 260];
const CANAL = [
  { type: 'poly', pts: [[44 + EXT * 0.042, 344 + EXT * 0.999], [44, 344]] }, // bleed off the bottom
  { type: 'cubic', p: [[44, 344], [40, 250], [156, 254], [154, 168]] },
  { type: 'cubic', p: [[154, 168], [152, 80], [266, 92], [292, -20]] },
  { type: 'poly', pts: [[292, -20], [292 + EXT * 0.226, -20 - EXT * 0.974]] }, // bleed off the top
];

// hand-drawn geometric alphabet, design box 100 x 140
const GLYPHS = {
  C: [{ type: 'cubic', p: [[90, 30], [68, 4], [14, 10], [10, 70]] },
      { type: 'cubic', p: [[10, 70], [6, 130], [68, 138], [90, 110]] }],
  A: [{ type: 'poly', pts: [[8, 140], [50, 6], [92, 140]] }, { type: 'poly', pts: [[26, 92], [74, 92]] }],
  N: [{ type: 'poly', pts: [[10, 140], [10, 6], [90, 140], [90, 6]] }],
  L: [{ type: 'poly', pts: [[12, 6], [12, 140], [88, 140]] }],
  G: [{ type: 'cubic', p: [[90, 30], [68, 4], [14, 10], [10, 70]] },
      { type: 'cubic', p: [[10, 70], [6, 130], [70, 140], [90, 112]] },
      { type: 'poly', pts: [[90, 112], [90, 76]] }, { type: 'poly', pts: [[60, 76], [90, 76]] }],
  R: [{ type: 'poly', pts: [[12, 140], [12, 6]] },
      { type: 'cubic', p: [[12, 6], [86, 2], [86, 78], [12, 74]] },
      { type: 'poly', pts: [[46, 74], [90, 140]] }],
  I: [{ type: 'poly', pts: [[50, 6], [50, 140]] }],
  D: [{ type: 'poly', pts: [[12, 6], [12, 140]] },
      { type: 'cubic', p: [[12, 6], [96, 12], [96, 134], [12, 140]] }],
};
function text(m, str, x, y, scale, advance, weight) {
  let cx = x;
  for (const ch of str) {
    const g = GLYPHS[ch];
    if (g) mStroke(m, g, weight * scale, (p) => [cx + p[0] * scale, y + p[1] * scale]);
    cx += advance;
  }
  return cx;
}

// ------------------------------------------------------------- composing
const rot = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s]; };
function markTransform(ox, oy, size, angle) {
  const s = size / 320, [c, sn] = rot(angle);
  return (p) => {
    const x = (p[0] - 160) * s, y = (p[1] - 160) * s;
    return [ox + x * c - y * sn, oy + x * sn + y * c];
  };
}

let tiles = mask(), canal = mask(), water = mask(), type = mask(), typeAcc = mask(), streak = mask();
let GRAD;            // (x,y) -> [r,g,b]
let markCentre;

function gradientAt(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return (x, y) => {
    let t = ((x - x0) * dx + (y - y0) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t < 0.5 ? mix(G0, G1, t * 2) : mix(G1, G2, (t - 0.5) * 2);
  };
}

if (MODE === 'icon') {
  const PAD = 40, SIZE = W - PAD * 2, CX = W / 2, CY = H / 2;
  markCentre = [CX, CY];
  const tf = markTransform(CX, CY, SIZE, 0);
  const s = SIZE / 320;
  for (const ty of TILE_POS) for (const tx of TILE_POS) {
    const a = tf([tx, ty]), b = tf([tx + 56, ty + 56]);
    mRect(tiles, a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  mStroke(canal, CANAL, 48 * s, tf);
  mStroke(water, CANAL, 9 * s, tf);
  GRAD = gradientAt(PAD, PAD, W - PAD, H - PAD);
} else {
  const MARK = 900, ANG = -10 * Math.PI / 180;
  const MX = 1430, CY = H / 2;
  markCentre = [MX, CY];
  const tf = markTransform(MX, CY, MARK, ANG);
  const s = MARK / 320;
  for (const ty of TILE_POS) for (const tx of TILE_POS) {
    const q = [[tx, ty], [tx + 56, ty], [tx + 56, ty + 56], [tx, ty + 56]].map(tf);
    // rotated tile: stroke the quad's interior by scanning it
    fillQuad(tiles, q);
  }
  mStroke(canal, CANAL, 48 * s, tf);
  mStroke(water, CANAL, 9 * s, tf);
  GRAD = gradientAt(MX - MARK / 2, CY - MARK / 2, 3100, CY + MARK / 2);

  // wordmark
  const TX = MX + MARK / 2 + 190;
  const s1 = 1.62, adv1 = 100 * s1 + 46, w1 = adv1 * 5 - 46;
  const s2 = 1.0, adv2 = (w1 - 100 * s2) / 3;
  text(type, 'CANAL', TX, CY - 210, s1, adv1, 18);
  text(typeAcc, 'GRID', TX, CY + 66, s2, adv2, 16);

  // speed streaks, parallel to the canal
  for (const [ox, oy, w] of [[-500, 300, 5], [-380, 720, 9], [260, 1980, 6], [520, 2280, 11]]) {
    mStroke(streak, [{ type: 'cubic', p: [[0, 0], [900, -260], [1800, -520], [3000, -1000]] }],
      w, (p) => [ox + p[0] + p[1] * 0.18, oy + p[1] * 1.35 + p[0] * 0.30]);
  }
}

function fillQuad(m, q) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of q) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const y0 = Math.max(0, Math.floor(minY * SS)), y1 = Math.min(NH - 1, Math.ceil(maxY * SS));
  for (let y = y0; y <= y1; y++) {
    const yy = (y + 0.5) / SS;
    const xs = [];
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) {
        xs.push(a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, r) => p - r);
    const ax = Math.max(0, Math.round(xs[0] * SS)), bx = Math.min(NW, Math.round(xs[xs.length - 1] * SS));
    const row = y * NW;
    for (let x = ax; x < bx; x++) m[row + x] = 255;
  }
}

// ---------------------------------------------------------------- resolve
const cTiles = resolve(tiles), cCanal = resolve(canal), cWater = resolve(water);
const cType = resolve(type), cTypeAcc = resolve(typeAcc), cStreak = resolve(streak);
tiles = canal = water = type = typeAcc = streak = null;

const R = Math.round(W * 0.035);
const glowTile = boxBlur(cTiles, R);
const glowWater = boxBlur(cWater, Math.round(R * 0.9));
const glowType = boxBlur(cTypeAcc, Math.round(R * 0.5));

// ---------------------------------------------------------------- compose
const out = Buffer.alloc(W * H * 3);
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const bloomR = W * 0.55;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const g = GRAD(x, y);

    // background: near-black + a wide violet bloom behind the mark
    const d = Math.hypot(x - markCentre[0], y - markCentre[1]) / bloomR;
    const halo = Math.exp(-d * d * 1.6);
    let r = BASE[0] + 26 * halo, gg = BASE[1] + 14 * halo, b = BASE[2] + 46 * halo;

    // faint speed streaks
    const st = cStreak[i];
    if (st > 0) { r += 22 * st; gg += 34 * st; b += 60 * st; }

    // glow passes (additive)
    const gt = glowTile[i] * 0.55, gw = glowWater[i] * 0.85, gy = glowType[i] * 0.35;
    r += g[0] * gt + NEON[0] * gw + g[0] * gy;
    gg += g[1] * gt + NEON[1] * gw + g[1] * gy;
    b += g[2] * gt + NEON[2] * gw + g[2] * gy;

    // solid marks (over)
    const tile = cTiles[i] * (1 - cCanal[i]);
    if (tile > 0) { r += (g[0] - r) * tile; gg += (g[1] - gg) * tile; b += (g[2] - b) * tile; }

    const wt = cWater[i];
    if (wt > 0) {
      const core = [Math.min(255, NEON[0] + 40), NEON[1] + 30, NEON[2] + 20];
      r += (core[0] - r) * wt; gg += (core[1] - gg) * wt; b += (core[2] - b) * wt;
    }

    const tp = cType[i];
    if (tp > 0) { r += (WHITE[0] - r) * tp; gg += (WHITE[1] - gg) * tp; b += (WHITE[2] - b) * tp; }
    const ta = cTypeAcc[i];
    if (ta > 0) { r += (g[0] - r) * ta; gg += (g[1] - gg) * ta; b += (g[2] - b) * ta; }

    const o = i * 3;
    out[o] = clamp(Math.round(r)); out[o + 1] = clamp(Math.round(gg)); out[o + 2] = clamp(Math.round(b));
  }
}

// ------------------------------------------------------------ PNG encode
const stride = W * 3 + 1;
const raw = Buffer.alloc(H * stride);
for (let y = 0; y < H; y++) {
  raw[y * stride] = 2;
  const cur = y * W * 3, prev = (y - 1) * W * 3;
  for (let i = 0; i < W * 3; i++) raw[y * stride + 1 + i] = (out[cur + i] - (y === 0 ? 0 : out[prev + i])) & 0xff;
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t, 'ascii'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const name = process.argv[3] || (MODE === 'icon' ? 'canal-grid-icon-512-v2.png' : 'canal-grid-header-4096x2304-v2.png');
fs.writeFileSync(name, png);
console.log('wrote', name, W + 'x' + H, (png.length / 1024).toFixed(0) + 'KB');

if (process.env.PREVIEW && W > 1200) {
  const F = 4, PW = W / F, PH = H / F, small = Buffer.alloc(PW * PH * 3);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < F; sy++) for (let sx = 0; sx < F; sx++) {
      const i = ((y * F + sy) * W + x * F + sx) * 3; r += out[i]; g += out[i + 1]; b += out[i + 2];
    }
    const o = (y * PW + x) * 3;
    small[o] = Math.round(r / (F * F)); small[o + 1] = Math.round(g / (F * F)); small[o + 2] = Math.round(b / (F * F));
  }
  const st2 = PW * 3 + 1, rw = Buffer.alloc(PH * st2);
  for (let y = 0; y < PH; y++) { rw[y * st2] = 0; small.copy(rw, y * st2 + 1, y * PW * 3, (y + 1) * PW * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(PW, 0); ih.writeUInt32BE(PH, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync('_preview.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(rw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('preview written');
}
