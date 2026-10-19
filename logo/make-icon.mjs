import zlib from 'node:zlib';
import fs from 'node:fs';

const SS = 3;                 // supersample factor
const OUT = 512;
const N = OUT * SS;
const PAD = 56;               // margin in 512-space
const SCALE = (OUT - PAD * 2) / 320;
const OFF = PAD;

const INK = [0x0b, 0x0e, 0x14];
const MINT = [0x8f, 0xe8, 0xdc];
const DEEP = [0x2f, 0x5e, 0x60];

// map viewBox(320) coords -> supersampled pixel coords
const M = (v) => (v * SCALE + OFF) * SS;

const buf = Buffer.alloc(N * N * 3);
for (let i = 0; i < N * N; i++) {
  buf[i * 3] = INK[0]; buf[i * 3 + 1] = INK[1]; buf[i * 3 + 2] = INK[2];
}

function px(x, y, c) {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}

function rect(x0, y0, w, h, c) {
  const ax = Math.round(M(x0)), ay = Math.round(M(y0));
  const bx = Math.round(M(x0 + w)), by = Math.round(M(y0 + h));
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

function bez(p, t) {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return [
    b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0],
    b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1],
  ];
}

function stroke(segs, widthVB, c) {
  const r = (widthVB / 2) * SCALE * SS;
  for (const seg of segs) {
    const steps = 2400;
    for (let i = 0; i <= steps; i++) {
      const [x, y] = bez(seg, i / steps);
      disc(M(x), M(y), r, c);
    }
  }
}

// --- 5x5 grid of tiles -------------------------------------------------
const POS = [4, 68, 132, 196, 260];
for (const y of POS) for (const x of POS) rect(x, y, 56, 56, MINT);

// --- canal: carve the channel out of the tiles -------------------------
const CANAL = [
  [[44, 336], [44, 252], [152, 252], [152, 168]],
  [[152, 168], [152, 84], [262, 92], [284, -12]],
];
stroke(CANAL, 46, INK);
stroke(CANAL, 3, DEEP);

// --- downsample -> 512x512 --------------------------------------------
const out = Buffer.alloc(OUT * OUT * 3);
const nsub = SS * SS;
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * N + (x * SS + sx)) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
    }
    const o = (y * OUT + x) * 3;
    out[o] = Math.round(r / nsub);
    out[o + 1] = Math.round(g / nsub);
    out[o + 2] = Math.round(b / nsub);
  }
}

// --- PNG encode (24-bit RGB, no alpha) ---------------------------------
const raw = Buffer.alloc(OUT * (OUT * 3 + 1));
for (let y = 0; y < OUT; y++) {
  raw[y * (OUT * 3 + 1)] = 0;
  out.copy(raw, y * (OUT * 3 + 1) + 1, y * OUT * 3, (y + 1) * OUT * 3);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(process.argv[2] || 'canal-grid-icon-512.png', png);
console.log('wrote', process.argv[2] || 'canal-grid-icon-512.png', png.length, 'bytes');
