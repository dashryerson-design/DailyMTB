// Test track: centerline layout, features, and a 0.15 m physics heightfield with surface map.
import { clamp, smooth, lerp } from '../core/math.js';

export const SURF = { DIRT: 0, GRAVEL: 1, ROCK: 2, GRASS: 3, ROOT: 4 };
export const SURF_PROPS = [
  { name: 'Dirt', mu: 1.05, crr: 0.02 },
  { name: 'Gravel', mu: 0.72, crr: 0.035 },
  { name: 'Rock', mu: 0.92, crr: 0.012 },
  { name: 'Grass', mu: 0.78, crr: 0.05 },
  { name: 'Root', mu: 0.55, crr: 0.02 },
];
const D2R = Math.PI / 180;

export function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function makeNoise(seed) {
  const r = rng(seed), p = [...Array(256).keys()], perm = new Uint16Array(512), val = new Float32Array(256);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) val[i] = r() * 2 - 1;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const A = perm[yi & 255], B = perm[(yi + 1) & 255];
    const a = val[perm[(xi & 255) + A]], b = val[perm[((xi + 1) & 255) + A]], c = val[perm[(xi & 255) + B]], d = val[perm[((xi + 1) & 255) + B]];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Segments: straight {len} or arc {arc: radius, ang: degrees (+ right)}; bank in degrees.
const S_ = SURF;
export const LAYOUT = [
  { len: 25, name: 'Start' },
  { len: 70, name: 'Rock & root garden', feat: 'bumps' },
  { len: 15, surf: S_.GRAVEL },
  { len: 32, name: 'Rollers', feat: 'rollers' },
  { len: 10 },
  { len: 22, name: 'Tabletop', feat: 'table' },
  { len: 12 },
  { len: 32, name: 'Big jump', feat: 'bigjump' },
  { len: 16 },
  { arc: 14, ang: -100, bank: 30, name: 'Berm L (wide)' },
  { len: 12 },
  { arc: 8, ang: 150, bank: 45, name: 'Berm R (tight)' },
  { len: 15 },
  { arc: 22, ang: -140, bank: 38, name: 'Sweeper' },
  { len: 15, surf: S_.GRAVEL },
  { arc: 12, ang: 70, name: 'Flat turns', surf: S_.GRAVEL },
  { len: 8 },
  { arc: 6, ang: -90, feat: 'innerRocks' },
  { len: 6 },
  { arc: 7, ang: 80 },
  { len: 15, surf: S_.ROCK, feat: 'rockslab' },
  { len: 22, name: 'Rocky drop', feat: 'drop' },
  { len: 45, name: 'Runout' },
];

const W = 1.7;        // tread half-width
const GRADE = 0.10;   // base downhill grade

function profile(seg, ls, d, noise) {
  let h = -0.04 * Math.max(0, 1 - (d / W) ** 2), surf = seg.surf;
  switch (seg.feat) {
    case 'bumps': h += 0.035 * Math.sin(2 * Math.PI * ls / 1.1) * (0.5 + 0.5 * Math.sin(ls * 0.37)); break;
    case 'rollers': for (const r0 of [4, 13, 22]) { const u = (ls - r0) / 6; if (u > 0 && u < 1) h += 0.5 * Math.sin(Math.PI * u) ** 2; } break;
    case 'table':
      if (ls < 4.5) h += 1.2 * Math.pow(ls / 4.5, 1.5);
      else if (ls < 9.5) h += 1.2;
      else if (ls < 16) h += 0.6 * (1 + Math.cos(Math.PI * (ls - 9.5) / 6.5));
      break;
    case 'bigjump':
      if (ls < 5) h += 1.4 * Math.pow(ls / 5, 1.7);
      else if (ls < 6) h += lerp(1.4, -1.0, smooth(ls - 5));
      else if (ls < 11.5) h += -1.0;
      else if (ls < 12.5) h += lerp(-1.0, 0.25, smooth(ls - 11.5));
      else if (ls < 20) h += lerp(0.25, -2.0, smooth((ls - 12.5) / 7.5));
      break;
    case 'rockslab': h += 0.05 * noise(ls * 0.9, d * 0.9); break;
    case 'drop': if (ls > 3 && ls < 8.05) { surf = SURF.ROCK; h += 0.04 * noise(ls * 1.3, d * 1.3); } break;
  }
  if (seg.bank) {
    const f = smooth(Math.min(seg.ls === undefined ? ls : ls, seg.len - ls) / 7);
    const o = -seg.sign * d, wb = W + 0.5, tb = Math.tan(seg.bank * D2R * f);
    const oc = Math.max(-wb, Math.min(o, 0.65 * wb)); h += tb * (oc + wb) ** 2 / (2 * wb) - tb * wb / 2; // riding line stays on grade
  }
  return [h, surf];
}

export function buildTrack(seed = 7) {
  const t0 = Date.now(), ds = 0.25, noise = makeNoise(seed), n2 = makeNoise(seed + 11);
  const S = [], X = [], Z = [], PSI = [], SEG = [], segs = [];
  let x = 0, z = 0, psi = 0, s = 0;
  LAYOUT.forEach((def, k) => {
    const len = def.arc ? def.arc * Math.abs(def.ang) * D2R : def.len;
    const seg = { ...def, len, s0: s, surf: def.surf ?? SURF.DIRT, sign: def.ang ? Math.sign(def.ang) : 0 };
    segs.push(seg);
    const n = Math.round(len / ds);
    for (let i = 0; i < n; i++) {
      S.push(s); X.push(x); Z.push(z); PSI.push(psi); SEG.push(k);
      if (def.arc) psi += seg.sign * ds / def.arc;
      x += Math.cos(psi) * ds; z += Math.sin(psi) * ds; s += ds;
    }
  });
  S.push(s); X.push(x); Z.push(z); PSI.push(psi); SEG.push(segs.length - 1);
  const total = s, NS = S.length;

  const events = [];
  for (const sg of segs) {
    if (sg.feat === 'bigjump') events.push({ s: sg.s0 + 20, D: 2.0 });
    if (sg.feat === 'drop') events.push({ s: sg.s0 + 8.05, D: 1.1 });
  }
  const offset = (s) => { let o = 0; for (const e of events) if (s >= e.s) o -= e.D * Math.max(0, Math.min(1, 1 - (s - e.s - 18) / 70)); return o; };
  const elev = (s) => -GRADE * s + offset(s);

  // grid
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < NS; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]); }
  const M = 40; minX -= M; minZ -= M; maxX += M; maxZ += M;
  const res = 0.15, nx = Math.ceil((maxX - minX) / res) + 1, nz = Math.ceil((maxZ - minZ) / res) + 1;
  const H = new Float32Array(nx * nz), SF = new Uint8Array(nx * nz).fill(SURF.GRASS), TD = new Uint8Array(nx * nz).fill(255);

  // coarse natural terrain (2 m)
  const cr = 2, cnx = Math.ceil((maxX - minX) / cr) + 2, cnz = Math.ceil((maxZ - minZ) / cr) + 2, CH = new Float32Array(cnx * cnz);
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) {
    const px = minX + i * cr, pz = minZ + j * cr; let ws = 0, we = 0, dm = 1e9;
    for (let k = 0; k < NS; k += 8) {
      const dx = px - X[k], dz = pz - Z[k], d2 = dx * dx + dz * dz, w = Math.exp(-d2 / 800);
      ws += w; we += w * elev(S[k]); if (d2 < dm) dm = d2;
    }
    const dist = Math.sqrt(dm), base = ws > 1e-9 ? we / ws : elev(S[NS - 1]);
    CH[i + j * cnx] = base + 0.05 * Math.min(dist, 80) + 1.8 * noise(px / 45, pz / 45) + 0.4 * noise(px / 9 + 50, pz / 9);
  }
  const coarse = (px, pz) => {
    const fx = (px - minX) / cr, fz = (pz - minZ) / cr, i = clamp(Math.floor(fx), 0, cnx - 2), j = clamp(Math.floor(fz), 0, cnz - 2), tx = fx - i, tz = fz - j, k = i + j * cnx;
    return (CH[k] * (1 - tx) + CH[k + 1] * tx) * (1 - tz) + (CH[k + cnx] * (1 - tx) + CH[k + cnx + 1] * tx) * tz;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const px = minX + i * res, pz = minZ + j * res;
    H[i + j * nx] = coarse(px, pz) + 0.08 * n2(px / 2.3, pz / 2.3);
  }

  // corridor carve: nearest centerline sample per cell
  const R = 7.2, rc = Math.ceil(R / res), best = new Float32Array(nx * nz).fill(1e9), bi = new Int32Array(nx * nz).fill(-1);
  for (let k = 0; k < NS; k++) {
    const ci = Math.round((X[k] - minX) / res), cj = Math.round((Z[k] - minZ) / res);
    for (let j = Math.max(0, cj - rc); j <= Math.min(nz - 1, cj + rc); j++) for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
      const dx = minX + i * res - X[k], dz = minZ + j * res - Z[k], d2 = dx * dx + dz * dz, id = i + j * nx;
      if (d2 < R * R && d2 < best[id]) { best[id] = d2; bi[id] = k; }
    }
  }
  for (let id = 0; id < nx * nz; id++) {
    const k = bi[id]; if (k < 0) continue;
    const i = id % nx, j = (id / nx) | 0, px = minX + i * res, pz = minZ + j * res;
    const c = Math.cos(PSI[k]), sn = Math.sin(PSI[k]), dx = px - X[k], dz = pz - Z[k];
    const along = dx * c + dz * sn, d = -dx * sn + dz * c, sc = S[k] + along, seg = segs[SEG[k]];
    const [ph, surf] = profile(seg, clamp(sc - seg.s0, 0, seg.len), d, noise);
    const o = -seg.sign * d, t0b = (seg.bank && o > 0) ? 3.0 : W + 0.5, ad = Math.abs(d);
    const b = smooth((ad - t0b) / 4.0);
    H[id] = lerp(elev(sc) + ph, H[id], b);
    if (ad < W + 0.3) SF[id] = surf;
    TD[id] = Math.min(255, Math.round(ad * 20));
  }

  // point helpers
  const sampleAt = (s) => { const k = clamp(Math.round(s / ds), 0, NS - 1); return { x: X[k], z: Z[k], psi: PSI[k], s: S[k] }; };
  const toWorld = (s, d) => { const p = sampleAt(s); return { x: p.x - Math.sin(p.psi) * d, z: p.z + Math.cos(p.psi) * d, psi: p.psi }; };
  const idx = (px, pz) => clamp(Math.round((px - minX) / res), 0, nx - 1) + clamp(Math.round((pz - minZ) / res), 0, nz - 1) * nx;
  const h = (px, pz) => {
    const fx = (px - minX) / res, fz = (pz - minZ) / res, i = clamp(Math.floor(fx), 0, nx - 2), j = clamp(Math.floor(fz), 0, nz - 2), tx = fx - i, tz = fz - j, k = i + j * nx;
    return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + nx] * (1 - tx) + H[k + nx + 1] * tx) * tz;
  };

  // obstacles: rocks (domes) and roots (half-capsules) stamped into the heightfield
  const r = rng(seed + 3), rocks = [], roots = [];
  for (const sg of segs) {
    if (sg.feat === 'bumps') {
      for (let k = 0; k < 55; k++) {
        const big = k < 4;
        rocks.push({ s: sg.s0 + 3 + r() * (sg.len - 6), d: (r() * 2 - 1) * 1.5, rr: big ? 0.4 + r() * 0.12 : 0.1 + r() * 0.16, rh: big ? 0.15 + r() * 0.06 : 0.04 + r() * 0.08 });
      }
      for (let ls = 3; ls < sg.len - 3; ls += 2.2 + r() * 3) roots.push({ s: sg.s0 + ls, ang: (r() - 0.5) * 0.9, rr: 0.03 + r() * 0.03, len: 4.2 });
    }
    if (sg.feat === 'innerRocks') for (let k = 0; k < 14; k++) rocks.push({ s: sg.s0 + 1 + r() * (sg.len - 2), d: sg.sign * (1.2 + r() * 1.2), rr: 0.15 + r() * 0.2, rh: 0.08 + r() * 0.15 });
    if (sg.feat === 'rockslab') for (let k = 0; k < 18; k++) rocks.push({ s: sg.s0 + r() * sg.len, d: (r() * 2 - 1) * 1.6, rr: 0.1 + r() * 0.15, rh: 0.03 + r() * 0.07 });
    if (sg.feat === 'drop') {
      for (let k = 0; k < 10; k++) { const side = k % 2 ? 1 : -1; rocks.push({ s: sg.s0 + 6.6 + r() * 1.3, d: side * (1.0 + r() * 1.1), rr: 0.25 + r() * 0.2, rh: 0.15 + r() * 0.2 }); }
      for (let k = 0; k < 6; k++) rocks.push({ s: sg.s0 + 8.3 + r() * 0.6, d: (r() * 2 - 1) * 2.2, rr: 0.3 + r() * 0.2, rh: 0.25 + r() * 0.3, face: true });
    }
  }
  for (const rk of rocks) {
    const p = toWorld(rk.s, rk.d); rk.x = p.x; rk.z = p.z; rk.base = h(p.x, p.z);
    const rc2 = Math.ceil(rk.rr / res) + 1, ci = Math.round((p.x - minX) / res), cj = Math.round((p.z - minZ) / res);
    for (let j = cj - rc2; j <= cj + rc2; j++) for (let i = ci - rc2; i <= ci + rc2; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const q = Math.hypot(minX + i * res - p.x, minZ + j * res - p.z) / rk.rr; if (q >= 1) continue;
      const hh = rk.base + rk.rh * Math.pow(1 - q * q, 0.9), id = i + j * nx;
      if (hh > H[id]) { H[id] = hh; SF[id] = SURF.ROCK; }
    }
  }
  for (const rt of roots) {
    const p = toWorld(rt.s, 0), a = p.psi + Math.PI / 2 + rt.ang, ux = Math.cos(a), uz = Math.sin(a);
    rt.x0 = p.x - ux * rt.len / 2; rt.z0 = p.z - uz * rt.len / 2; rt.x1 = p.x + ux * rt.len / 2; rt.z1 = p.z + uz * rt.len / 2;
    const steps = Math.ceil(rt.len / res), rc2 = Math.ceil(rt.rr / res) + 1, done = new Set();
    for (let t = 0; t <= steps; t++) {
      const cx = rt.x0 + ux * rt.len * t / steps, cz = rt.z0 + uz * rt.len * t / steps, ci = Math.round((cx - minX) / res), cj = Math.round((cz - minZ) / res);
      for (let j = cj - rc2; j <= cj + rc2; j++) for (let i = ci - rc2; i <= ci + rc2; i++) {
        const id = i + j * nx; if (done.has(id)) continue;
        const dx = minX + i * res - rt.x0, dz = minZ + j * res - rt.z0, along = clamp(dx * ux + dz * uz, 0, rt.len);
        const q = Math.hypot(dx - ux * along, dz - uz * along) / rt.rr; if (q >= 1) continue;
        done.add(id); H[id] += 0.75 * rt.rr * Math.sqrt(1 - q * q); SF[id] = SURF.ROOT;
      }
    }
  }

  const normal = (px, pz) => {
    const e = res, gx = (h(px + e, pz) - h(px - e, pz)) / (2 * e), gz = (h(px, pz + e) - h(px, pz - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
    return { x: -gx / l, y: 1 / l, z: -gz / l };
  };
  const sections = segs.filter(sg => sg.name).map(sg => ({ name: sg.name, s: sg.s0 }));
  return {
    h, normal, surface: (px, pz) => SF[idx(px, pz)], trackDist: (px, pz) => TD[idx(px, pz)] / 20,
    sampleAt, toWorld, elev, total, segs, sections, rocks, roots, bounds: { minX, maxX, minZ, maxZ }, res, nx, nz,
    centerline: { S, X, Z, PSI }, buildMs: Date.now() - t0,
  };
}
