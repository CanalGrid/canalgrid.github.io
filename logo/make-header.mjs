import zlib from 'node:zlib';
import fs from 'node:fs';

const W = 4096, H = 2304, SS = 2;
const NW = W * SS, NH = H * SS;

const INK = [0x0b, 0x0e, 0x14];
const MINT = [0x8f, 0xe8, 0xdc];
const DEEP = [0x2f, 0x5e, 0x60];
const FAINT = [0x14, 0x1d, 0x26];
const PAPER = [0xe8, 0xf6, 0xf3];

const buf = Buffer.alloc(NW * NH * 3);
for (let i = 0; i < NW * NH; i++) {
  buf[i * 3] = INK[0]; buf[i * 3 + 1] = INK[1]; buf[i * 3 + 2] = INK[2];
}

const px = (x, y, c) => {
  if (x < 0 || y < 0 || x >= NW || y >= NH) return;
  const i = ((y * NW) + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
};

// rect in final-image px
function rect(x0, y0, w, h, c) {
  const ax = Math.round(x0 * SS), ay = Math.round(y0 * SS);
  const bx = Math.round((x0 + w) * SS), by = Math.round((y0 + h) * SS);
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) px(x, y, c);
}

function disc(cx, cy, r, c) {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) px(x, y, c);
    }
  }
}

const bez = (p, t) => {
  const u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return [b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0],
          b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1]];
};

// stroke a path list in final-image px space; tf maps local -> image px
function strokePath(subs, widthPx, c, tf) {
  const r = (widthPx / 2) * SS;
  for (const s of subs) {
    if (s.length === 4 && Array.isArray(s[0]) && s.cubic) { /* unreachable */ }
  }
  for (const s of subs) {
    if (s.type === 'cubic') {
      const p = s.p.map(tf);
      const steps = Math.max(64, Math.ceil(dist(p[0], p[3]) / (SS * 0.6)) * 3);
      for (let i = 0; i <= steps; i++) {
        const [x, y] = bez(p, i / steps);
        disc(x * SS, y * SS, r, c);
      }
    } else {
      const pts = s.pts.map(tf);
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const steps = Math.max(2, Math.ceil(dist(a, b) * SS / 0.6));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          disc((a[0] + (b[0] - a[0]) * t) * SS, (a[1] + (b[1] - a[1]) * t) * SS, r, c);
        }
      }
    }
  }
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- glyphs
// design box 100 x 140, stroke 16
const GLYPHS = {
  C: [{ type: 'cubic', p: [[90, 30], [68, 4], [14, 10], [10, 70]] },
      { type: 'cubic', p: [[10, 70], [6, 130], [68, 138], [90, 110]] }],
  A: [{ type: 'poly', pts: [[8, 140], [50, 6], [92, 140]] },
      { type: 'poly', pts: [[26, 92], [74, 92]] }],
  N: [{ type: 'poly', pts: [[10, 140], [10, 6], [90, 140], [90, 6]] }],
  L: [{ type: 'poly', pts: [[12, 6], [12, 140], [88, 140]] }],
  G: [{ type: 'cubic', p: [[90, 30], [68, 4], [14, 10], [10, 70]] },
      { type: 'cubic', p: [[10, 70], [6, 130], [70, 140], [90, 112]] },
      { type: 'poly', pts: [[90, 112], [90, 76]] },
      { type: 'poly', pts: [[60, 76], [90, 76]] }],
  R: [{ type: 'poly', pts: [[12, 140], [12, 6]] },
      { type: 'cubic', p: [[12, 6], [86, 2], [86, 78], [12, 74]] },
      { type: 'poly', pts: [[46, 74], [90, 140]] }],
  I: [{ type: 'poly', pts: [[50, 6], [50, 140]] }],
  D: [{ type: 'poly', pts: [[12, 6], [12, 140]] },
      { type: 'cubic', p: [[12, 6], [96, 12], [96, 134], [12, 140]] }],
};

function drawText(text, x, y, scale, advance, color, weight) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      strokePath(g, weight * scale, color, (p) => [cx + p[0] * scale, y + p[1] * scale]);
    }
    cx += advance;
  }
  return cx;
}

// ------------------------------------------------------- background field
// faint grid across the whole canvas, on the mark's tile rhythm
{
  const cell = 256, gap = 8;
  for (let y = -cell; y < H + cell; y += cell) {
    for (let x = -cell; x < W + cell; x += cell) {
      rect(x + gap, y + gap, cell - gap * 2, cell - gap * 2, FAINT);
    }
  }
  // faint canal sweeping the full width, carved out of the faint grid
  const sweep = [
    { type: 'cubic', p: [[-300, 2600], [400, 2150], [900, 2200], [1500, 1930]] },
    { type: 'cubic', p: [[1500, 1930], [2200, 1620], [2700, 1800], [3200, 1420]] },
    { type: 'cubic', p: [[3200, 1420], [3750, 1000], [3820, 620], [4400, 120]] },
  ];
  strokePath(sweep, 150, INK, (p) => p);
  strokePath(sweep, 5, [0x1c, 0x2b, 0x33], (p) => p);
}

// ---------------------------------------------------------------- lockup
// mark: 5x5 tiles cleaved by the canal (Direction A), 320-unit design space
const MARK = 760;
const GX = 1123, GY = 1152;                 // group origin: left edge, vertical centre
const mx = GX, my = GY - MARK / 2;
const ms = MARK / 320;
const mtf = (p) => [mx + p[0] * ms, my + p[1] * ms];

const POS = [4, 68, 132, 196, 260];
for (const ty of POS) for (const tx of POS) {
  rect(mx + tx * ms, my + ty * ms, 56 * ms, 56 * ms, MINT);
}
const CANAL = [
  { type: 'cubic', p: [[44, 336], [44, 252], [152, 252], [152, 168]] },
  { type: 'cubic', p: [[152, 168], [152, 84], [262, 92], [284, -12]] },
];
strokePath(CANAL, 46 * ms, INK, mtf);
strokePath(CANAL, 3 * ms, DEEP, mtf);

// wordmark
const TX = GX + MARK + 150;
const s1 = 1.5, adv1 = 100 * s1 + 45;                    // CANAL
const w1 = adv1 * 5 - 45;
const s2 = 0.95;                                          // GRID, justified to w1
const adv2 = (w1 - 100 * s2) / 3 + 0;
drawText('CANAL', TX, GY - 190, s1, adv1, PAPER, 17);
drawText('GRID', TX, GY + 70, s2, adv2, MINT, 15);

// ------------------------------------------------------------- downsample
const out = Buffer.alloc(W * H * 3);
const nsub = SS * SS;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) {
      const row = (y * SS + sy) * NW;
      for (let sx = 0; sx < SS; sx++) {
        const i = (row + x * SS + sx) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
    }
    const o = (y * W + x) * 3;
    out[o] = Math.round(r / nsub); out[o + 1] = Math.round(g / nsub); out[o + 2] = Math.round(b / nsub);
  }
}

// ------------------------------------------------------------- PNG encode
const stride = W * 3 + 1;
const raw = Buffer.alloc(H * stride);
for (let y = 0; y < H; y++) {
  raw[y * stride] = 2; // Up filter — long flat runs compress hard
  const cur = y * W * 3, prev = (y - 1) * W * 3;
  for (let i = 0; i < W * 3; i++) {
    const up = y === 0 ? 0 : out[prev + i];
    raw[y * stride + 1 + i] = (out[cur + i] - up) & 0xff;
  }
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
if (process.env.PREVIEW) {
  const F = 4, PW = W / F, PH = H / F;
  const small = Buffer.alloc(PW * PH * 3);
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
  fs.writeFileSync('_header-preview.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(rw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('preview written');
}

const name = process.argv[2] || 'canal-grid-header-4096x2304.png';
fs.writeFileSync(name, png);
console.log('wrote', name, (png.length / 1024).toFixed(0), 'KB');
