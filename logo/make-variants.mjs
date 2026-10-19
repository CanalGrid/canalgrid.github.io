// Canal Grid — 10 icon variants (V01..V10) + contact sheet
// usage: node make-variants.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

const SIZE = 512, SS = 4;

// ------------------------------------------------------------- geometries
const ORTHO = {
  main: [[132, 400], [132, 268], [80, 214], [80, 132], [168, 44], [168, -80]],
  branch: [[76, 176], [214, 176], [268, 122], [400, 122]],
};
const DIAG = {
  main: [[-40, 392], [58, 244], [150, 200], [176, 104], [274, 52], [372, -96]],
  branch: null,
};
function sampleCubics(cubics, n = 90) {
  const pts = [];
  cubics.forEach((p, ci) => {
    for (let i = ci === 0 ? 0 : 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      pts.push([b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0],
                b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1]]);
    }
  });
  return pts;
}
const CURVE = {
  main: sampleCubics([
    [[40, 420], [40, 300], [154, 300], [154, 168]],
    [[154, 168], [154, 40], [268, 60], [300, -80]],
  ]),
  branch: null,
};

// ---------------------------------------------------------------- presets
const P = [
  { id: 'V01', name: 'Graphite survey', bg: '0F1214', land: 'EAE6DC', water: '00C9A7',
    geo: ORTHO, n: 6, w: 26, bw: 15, gut: 11, outline: 0, radius: 0 },
  { id: 'V02', name: 'Ink & mint', bg: '0B0E14', land: '8FE8DC', water: '0B0E14',
    geo: CURVE, n: 5, w: 34, bw: 0, gut: 0, outline: 0, radius: 0, hairline: '2F5E60' },
  { id: 'V03', name: 'Navy & amber', bg: '0B1530', land: 'F0E7D6', water: 'FFB020',
    geo: ORTHO, n: 6, w: 28, bw: 16, gut: 12, outline: 0, radius: 0 },
  { id: 'V04', name: 'Blueprint', bg: '0A1633', land: '2E6BE6', water: 'F2F6FF',
    geo: ORTHO, n: 7, w: 22, bw: 13, gut: 9, outline: 7, radius: 0 },
  { id: 'V05', name: 'Vermillion works', bg: '17171A', land: 'B8B3A8', water: 'FF3B21',
    geo: DIAG, n: 5, w: 32, bw: 0, gut: 13, outline: 0, radius: 0 },
  { id: 'V06', name: 'Acid lime', bg: '0A0A0A', land: 'C6FF3D', water: '0A0A0A',
    geo: ORTHO, n: 6, w: 30, bw: 17, gut: 0, outline: 0, radius: 0 },
  { id: 'V07', name: 'Inverted jade', bg: '05201C', land: '00C9A7', water: 'F2EFE6',
    geo: ORTHO, n: 6, w: 26, bw: 15, gut: 11, outline: 0, radius: 0 },
  { id: 'V08', name: 'Micro survey', bg: '101010', land: 'EFEDE6', water: '2B4BFF',
    geo: ORTHO, n: 8, w: 20, bw: 12, gut: 8, outline: 0, radius: 0 },
  { id: 'V09', name: 'Sage & clay', bg: '1C201B', land: 'C9D4BE', water: 'D2622F',
    geo: CURVE, n: 5, w: 30, bw: 0, gut: 10, outline: 0, radius: 12 },
  { id: 'V10', name: 'Hard contrast', bg: '000000', land: 'FFFFFF', water: 'FF0033',
    geo: DIAG, n: 6, w: 28, bw: 0, gut: 14, outline: 0, radius: 0 },
  { id: 'V05a', name: 'Vermillion works — brand teal water', bg: '0B0E14', land: '8FE8DC', water: '2F5E60',
    geo: DIAG, n: 5, w: 32, bw: 0, gut: 13, outline: 0, radius: 0 },
  { id: 'V05b', name: 'Vermillion works — canal as void', bg: '0B0E14', land: '8FE8DC', water: '0B0E14',
    geo: DIAG, n: 5, w: 32, bw: 0, gut: 13, outline: 0, radius: 0, hairline: '2F5E60' },
];
const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

// ------------------------------------------------------------ rasteriser
function makeRaster(N) {
  const lay = () => new Uint8Array(N * N);
  const fillRect = (m, x0, y0, x1, y1) => {
    const ax = Math.max(0, Math.round(x0)), ay = Math.max(0, Math.round(y0));
    const bx = Math.min(N, Math.round(x1)), by = Math.min(N, Math.round(y1));
    for (let y = ay; y < by; y++) { const r = y * N; for (let x = ax; x < bx; x++) m[r + x] = 255; }
  };
  const fillPoly = (m, pts) => {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(N - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const yy = y + 0.5; xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) {
          xs.push(a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      const row = y * N;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ax = Math.max(0, Math.round(xs[k])), bx = Math.min(N, Math.round(xs[k + 1]));
        for (let x = ax; x < bx; x++) m[row + x] = 255;
      }
    }
  };
  const disc = (m, cx, cy, r) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, rest = r * r - dy * dy;
      if (rest < 0) continue;
      const half = Math.sqrt(rest), row = y * N;
      const a = Math.max(x0, Math.ceil(cx - half)), b = Math.min(x1, Math.floor(cx + half));
      for (let x = a; x <= b; x++) m[row + x] = 255;
    }
  };
  const roundRect = (m, x0, y0, x1, y1, r) => {
    if (r <= 0) return fillRect(m, x0, y0, x1, y1);
    fillRect(m, x0 + r, y0, x1 - r, y1);
    fillRect(m, x0, y0 + r, x0 + r, y1 - r);
    fillRect(m, x1 - r, y0 + r, x1, y1 - r);
    disc(m, x0 + r, y0 + r, r); disc(m, x1 - r, y0 + r, r);
    disc(m, x0 + r, y1 - r, r); disc(m, x1 - r, y1 - r, r);
  };
  const band = (m, pts, width, tf) => {
    const Q = pts.map(tf), w = width / 2;
    if (Q.length < 2) return;
    const norm = (i) => {
      const a = Q[i], b = Q[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [-dy / L, dx / L];
    };
    const left = [], right = [];
    for (let i = 0; i < Q.length; i++) {
      let nx, ny;
      if (i === 0) [nx, ny] = norm(0);
      else if (i === Q.length - 1) [nx, ny] = norm(Q.length - 2);
      else {
        const [ax, ay] = norm(i - 1), [bx, by] = norm(i);
        let mx = ax + bx, my = ay + by; const L = Math.hypot(mx, my) || 1;
        mx /= L; my /= L;
        const sc = Math.min(4, 1 / Math.max(0.25, mx * ax + my * ay));
        nx = mx * sc; ny = my * sc;
      }
      left.push([Q[i][0] + nx * w, Q[i][1] + ny * w]);
      right.push([Q[i][0] - nx * w, Q[i][1] - ny * w]);
    }
    fillPoly(m, [...left, ...right.reverse()]);
  };
  return { lay, fillRect, fillPoly, roundRect, band };
}

function renderIcon(p, out画 = SIZE) {
  const N = out画 * SS;
  const R = makeRaster(N);
  const land = R.lay(), gut = R.lay(), water = R.lay(), hair = R.lay();

  const PAD = Math.round(out画 * 0.09);
  const size = out画 - PAD * 2;
  const s = (size / 320) * SS;
  const cx = (out画 / 2) * SS, cy = (out画 / 2) * SS;
  const tf = (q) => [cx + (q[0] - 160) * s, cy + (q[1] - 160) * s];

  // land parcels
  const n = p.n, gap = p.n >= 8 ? 5 : 6;
  const tile = (320 - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = j * (tile + gap), y = i * (tile + gap);
    const a = tf([x, y]), b = tf([x + tile, y + tile]);
    R.roundRect(land, a[0], a[1], b[0], b[1], p.radius * s);
    if (p.outline) {                                   // hollow parcels
      const ia = tf([x + p.outline, y + p.outline]), ib = tf([x + tile - p.outline, y + tile - p.outline]);
      R.roundRect(gut, ia[0], ia[1], ib[0], ib[1], Math.max(0, (p.radius - p.outline) * s));
    }
  }

  // canal
  const geos = [[p.geo.main, p.w]];
  if (p.geo.branch && p.bw) geos.push([p.geo.branch, p.bw]);
  for (const [pts, w] of geos) if (p.gut) R.band(gut, pts, (w + p.gut * 2) * s, tf);
  for (const [pts, w] of geos) R.band(water, pts, w * s, tf);
  if (p.hairline) for (const [pts, w] of geos) R.band(hair, pts, Math.max(2, 3) * s, tf);

  // resolve + compose
  const BG = hex(p.bg), LAND = hex(p.land), WATER = hex(p.water), HAIR = p.hairline ? hex(p.hairline) : null;
  const buf = Buffer.alloc(out画 * out画 * 3);
  const nsub = SS * SS;
  const cov = (m, x, y) => {
    let acc = 0;
    for (let sy = 0; sy < SS; sy++) {
      const row = (y * SS + sy) * N + x * SS;
      for (let sx = 0; sx < SS; sx++) acc += m[row + sx];
    }
    return acc / (255 * nsub);
  };
  for (let y = 0; y < out画; y++) for (let x = 0; x < out画; x++) {
    const px = [BG[0], BG[1], BG[2]];
    const cl = cov(land, x, y), cg = cov(gut, x, y), cw = cov(water, x, y);
    const ch = HAIR ? cov(hair, x, y) : 0;
    for (let k = 0; k < 3; k++) {
      px[k] += (LAND[k] - px[k]) * cl;
      px[k] += (BG[k] - px[k]) * cg;
      px[k] += (WATER[k] - px[k]) * cw;
      if (HAIR) px[k] += (HAIR[k] - px[k]) * ch * 0.85;
    }
    const o = (y * out画 + x) * 3;
    buf[o] = Math.round(px[0]); buf[o + 1] = Math.round(px[1]); buf[o + 2] = Math.round(px[2]);
  }
  return buf;
}

// ------------------------------------------------------------ PNG encode
const T = (() => { const t = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t, 'ascii'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
};
function writePNG(file, rgb, w, h) {
  const stride = w * 3 + 1, raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 2;
    const cur = y * w * 3, prev = (y - 1) * w * 3;
    for (let i = 0; i < w * 3; i++) raw[y * stride + 1 + i] = (rgb[cur + i] - (y === 0 ? 0 : rgb[prev + i])) & 0xff;
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
  return fs.statSync(file).size;
}

// ------------------------------------------------------------------- run
const CELL = 300, COLS = 5, ROWS = 2, MARGIN = 24, LABEL = 34;
const SW = COLS * CELL + MARGIN * (COLS + 1);
const SH = ROWS * (CELL + LABEL) + MARGIN * (ROWS + 1);
const sheet = Buffer.alloc(SW * SH * 3, 0x18);

const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
(ONLY ? P.filter((q) => ONLY.includes(q.id)) : P).forEach((p, i) => {
  const full = renderIcon(p, SIZE);
  const kb = (writePNG(`variants/canal-grid-icon-512-${p.id}.png`, full, SIZE, SIZE) / 1024).toFixed(0);
  console.log(p.id, p.name, kb + 'KB');

  const thumb = renderIcon(p, CELL);
  const col = i % COLS, row = Math.floor(i / COLS);
  const ox = MARGIN + col * (CELL + MARGIN), oy = MARGIN + row * (CELL + LABEL + MARGIN);
  for (let y = 0; y < CELL; y++) {
    thumb.copy(sheet, ((oy + y) * SW + ox) * 3, y * CELL * 3, (y + 1) * CELL * 3);
  }
});
if (!ONLY) writePNG('variants/_contact-sheet.png', sheet, SW, SH);
console.log('sheet', SW + 'x' + SH);
