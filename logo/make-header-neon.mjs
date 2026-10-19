// Canal Grid — brand renderer v3 (flat / sharp / premium)
// usage: node make-brand-v3.mjs icon|header [outfile]
import zlib from 'node:zlib';
import fs from 'node:fs';

const MODE = process.argv[2] || 'icon';
const { W, H, SS } = MODE === 'header'
  ? { W: 4096, H: 2304, SS: 3 }
  : { W: 512, H: 512, SS: 6 };
const NW = W * SS, NH = H * SS;

// -------------------------------------------------------------- palette
const BG = [0x0a, 0x0a, 0x0a];   // background
const BONE = [0x24, 0xff, 0x8e]; // land — neon lime-mint
const JADE = [0x0a, 0x0a, 0x0a]; // water — same as ground: the canal reads as a cut
const PAPER = [0xf2, 0xf2, 0xf0];

// ------------------------------------------------------------ rasteriser
const layer = () => new Uint8Array(NW * NH);

function fillRect(m, x0, y0, x1, y1) {
  const ax = Math.max(0, Math.round(x0 * SS)), ay = Math.max(0, Math.round(y0 * SS));
  const bx = Math.min(NW, Math.round(x1 * SS)), by = Math.min(NH, Math.round(y1 * SS));
  for (let y = ay; y < by; y++) { const r = y * NW; for (let x = ax; x < bx; x++) m[r + x] = 255; }
}

// even-odd scanline fill — keeps mitred corners razor sharp
function fillPoly(m, pts) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const y0 = Math.max(0, Math.floor(minY * SS)), y1 = Math.min(NH - 1, Math.ceil(maxY * SS));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yy = (y + 0.5) / SS;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) {
        xs.push(a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const row = y * NW;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ax = Math.max(0, Math.round(xs[k] * SS)), bx = Math.min(NW, Math.round(xs[k + 1] * SS));
      for (let x = ax; x < bx; x++) m[row + x] = 255;
    }
  }
}

// mitred band around a polyline: the canal, cut with straight edges
function band(m, pts, width, tf) {
  const P = pts.map(tf);
  const w = width / 2;
  const norm = (i) => {
    const a = P[i], b = P[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    return [-dy / L, dx / L];
  };
  const left = [], right = [];
  for (let i = 0; i < P.length; i++) {
    let nx, ny;
    if (i === 0) { [nx, ny] = norm(0); }
    else if (i === P.length - 1) { [nx, ny] = norm(P.length - 2); }
    else {                                    // mitre join
      const [ax, ay] = norm(i - 1), [bx, by] = norm(i);
      let mx = ax + bx, my = ay + by;
      const L = Math.hypot(mx, my); mx /= L; my /= L;
      const scale = Math.min(4, 1 / Math.max(0.25, mx * ax + my * ay));
      nx = mx * scale; ny = my * scale;
    }
    left.push([P[i][0] + nx * w, P[i][1] + ny * w]);
    right.push([P[i][0] - nx * w, P[i][1] - ny * w]);
  }
  fillPoly(m, [...left, ...right.reverse()]);
}

function resolve(m) {
  const out = new Float32Array(W * H), n = SS * SS;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let sy = 0; sy < SS; sy++) {
      const row = (y * SS + sy) * NW + x * SS;
      for (let sx = 0; sx < SS; sx++) s += m[row + sx];
    }
    out[y * W + x] = s / (255 * n);
  }
  return out;
}

// -------------------------------------------------------------- geometry
// 6 x 6 land parcels in a 320 design square
const GAP = 6, N5 = 5, TILE = (320 - GAP * (N5 - 1)) / N5;
const POS = Array.from({ length: N5 }, (_, i) => i * (TILE + GAP));
// the canal: straight reaches meeting at surveyed angles, not a soft curve
const REACH = [[-260, 724], [-40, 392], [58, 244], [150, 200], [176, 104], [274, 52], [372, -96], [592, -428]];
// a branch klong meeting the main line at a right-angled junction
const BRANCH = null;
const CANAL_W = 32, BRANCH_W = 0, GUTTER = 13;   // gutter = graphite margin either side

// ---------------------------------------------------------------- glyphs
const G = {
  C: [[[92, 22], [58, 6], [22, 22], [10, 70], [22, 118], [58, 134], [92, 118]]],
  A: [[[6, 140], [50, 6], [94, 140]], [[26, 92], [74, 92]]],
  N: [[[10, 140], [10, 6], [90, 140], [90, 6]]],
  L: [[[12, 6], [12, 140], [88, 140]]],
  Gg: [[[92, 22], [58, 6], [22, 22], [10, 70], [22, 118], [58, 134], [92, 116], [92, 76], [62, 76]]],
  R: [[[12, 140], [12, 6], [66, 6], [88, 26], [88, 56], [66, 74], [12, 74]], [[52, 74], [92, 140]]],
  I: [[[50, 6], [50, 140]]],
  D: [[[12, 140], [12, 6], [62, 6], [92, 40], [92, 106], [62, 140], [12, 140]]],
};

// round-joined stroking for the wordmark — mitred bands self-intersect at heavy weights
function stampDisc(m, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(NW - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(NH - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy, rest = r * r - dy * dy;
    if (rest < 0) continue;
    const half = Math.sqrt(rest), row = y * NW;
    const a = Math.max(x0, Math.ceil(cx - half)), b = Math.min(x1, Math.floor(cx + half));
    for (let x = a; x <= b; x++) m[row + x] = 255;
  }
}
function strokeLine(m, pts, width, tf) {
  const Q = pts.map(tf), r = (width / 2) * SS;
  for (let k = 0; k + 1 < Q.length; k++) {
    const a = Q[k], b = Q[k + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * SS / 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampDisc(m, (a[0] + (b[0] - a[0]) * t) * SS, (a[1] + (b[1] - a[1]) * t) * SS, r);
    }
  }
}
function letter(m, ch, x, y, s, weight) {
  const key = ch === 'G' ? 'Gg' : ch;
  for (const poly of G[key]) strokeLine(m, poly, weight * s, (p) => [x + p[0] * s, y + p[1] * s]);
}
function word(m, str, x, y, s, adv, weight) {
  let cx = x;
  for (const ch of str) { letter(m, ch, cx, y, s, weight); cx += adv; }
}

// -------------------------------------------------------------- compose
const land = layer(), gutter = layer(), water = layer(), type = layer(), rule = layer();

function drawMark(cx, cy, size) {
  const s = size / 320;
  const tf = (p) => [cx + (p[0] - 160) * s, cy + (p[1] - 160) * s];
  for (const ty of POS) for (const tx of POS) {
    const a = tf([tx, ty]), b = tf([tx + TILE, ty + TILE]);
    fillRect(land, a[0], a[1], b[0], b[1]);
  }
  band(gutter, REACH, (CANAL_W + GUTTER * 2) * s, tf);
  band(water, REACH, CANAL_W * s, tf);
}

if (MODE === 'icon') {
  const SIZE = W - 46 * 2;
  drawMark(W / 2, H / 2, SIZE);
} else {
  const MARK = 1010, CY = H / 2, MX = 1240;
  drawMark(MX, CY, MARK);
  const TX = MX + MARK / 2 + 330;
  const s1 = 1.95, adv1 = 100 * s1 + 58, w1 = adv1 * 5 - 58;
  const s2 = 1.12, adv2 = (w1 - 100 * s2) / 3;
  word(type, 'CANAL', TX, CY - 250, s1, adv1, 21);
  word(rule, 'GRID', TX, CY + 84, s2, adv2, 18);

}

const cLand = resolve(land), cGut = resolve(gutter), cWat = resolve(water);
const cType = resolve(type), cRule = resolve(rule);

const out = Buffer.alloc(W * H * 3);
const over = (dst, src, a, i) => { dst[i] += (src - dst[i]) * a; };
for (let i = 0; i < W * H; i++) {
  const px = [BG[0], BG[1], BG[2]];
  for (let k = 0; k < 3; k++) {
    over(px, BONE[k], cLand[i], k);            // land
    over(px, BG[k], cGut[i], k);               // graphite gutter cut through it
    over(px, JADE[k], cWat[i], k);             // water
    over(px, PAPER[k], cType[i], k);           // wordmark
    over(px, BONE[k], cRule[i], k);            // GRID line, mint
  }
  const o = i * 3;
  out[o] = Math.round(px[0]); out[o + 1] = Math.round(px[1]); out[o + 2] = Math.round(px[2]);
}

// ------------------------------------------------------------ PNG encode
const stride = W * 3 + 1, raw = Buffer.alloc(H * stride);
for (let y = 0; y < H; y++) {
  raw[y * stride] = 2;
  const cur = y * W * 3, prev = (y - 1) * W * 3;
  for (let i = 0; i < W * 3; i++) raw[y * stride + 1 + i] = (out[cur + i] - (y === 0 ? 0 : out[prev + i])) & 0xff;
}
const T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t, 'ascii'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const name = process.argv[3] || (MODE === 'icon' ? 'canal-grid-icon-512-neon.png' : 'canal-grid-header-4096x2304-neon.png');
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
  const st = PW * 3 + 1, rw = Buffer.alloc(PH * st);
  for (let y = 0; y < PH; y++) { rw[y * st] = 0; small.copy(rw, y * st + 1, y * PW * 3, (y + 1) * PW * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(PW, 0); ih.writeUInt32BE(PH, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync('_preview.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(rw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('preview written');
}
