// Trails: a fixed physics test layout (used by the tests) or a procedurally generated downhill run for a
// biome. Heightfield = coarse 2 m mountain terrain everywhere + 0.2 m detail tiles only along the trail.
import { clamp, smooth, lerp } from '../core/math.js';

export const SURF = { DIRT: 0, GRAVEL: 1, ROCK: 2, GRASS: 3, ROOT: 4, SNOW: 5, ICE: 6, SAND: 7 };
export const SURF_PROPS = [
  { name: 'Dirt', mu: 1.05, crr: 0.02 },
  { name: 'Gravel', mu: 0.72, crr: 0.035 },
  { name: 'Rock', mu: 0.92, crr: 0.012 },
  { name: 'Grass', mu: 0.78, crr: 0.05 },
  { name: 'Root', mu: 0.55, crr: 0.02 },
  { name: 'Packed snow', mu: 0.68, crr: 0.03 },
  { name: 'Ice', mu: 0.32, crr: 0.01 },
  { name: 'Sand', mu: 0.7, crr: 0.07 },
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

// ---- the fixed physics test track (tests/sim.mjs, tests/assist.mjs)
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

// ---- biomes: what the generator builds and what the ground is made of
export const BIOMES = {
  forest: { trail: SURF.DIRT, off: SURF.GRASS, grade: [0.1, 0.2], relief: 7, ridge: 4, valley: 0.09, roots: 1, rocks: 1, moss: true,
    w: { straight: 1.6, turn: 3, berm: 3.4, bumps: 3, rollers: 1.5, table: 1, bigjump: 0.6, drop: 1, rockslab: 0.7, tech: 1.6 } },
  snow: { trail: SURF.SNOW, off: SURF.SNOW, grade: [0.11, 0.22], relief: 14, ridge: 12, valley: 0.13, roots: 0, rocks: 0.5, ice: true,
    w: { straight: 2, turn: 3.2, berm: 3, bumps: 0.9, rollers: 2, table: 1.6, bigjump: 1, drop: 0.6, rockslab: 0.5, tech: 0.8, ice: 0.5 } },
  desert: { trail: SURF.DIRT, off: SURF.SAND, grade: [0.1, 0.2], relief: 10, ridge: 8, valley: 0.11, roots: 0, rocks: 1.3, sandstone: true,
    w: { straight: 2.2, turn: 3, berm: 2.2, bumps: 1.6, rollers: 1.5, table: 1, bigjump: 1.2, drop: 1.8, rockslab: 2, tech: 1, sand: 0.6 } },
  test: { trail: SURF.DIRT, off: SURF.GRASS, grade: [0.1, 0.1], relief: 2, ridge: 0, valley: 0.05, roots: 1, rocks: 1, w: {} },
};

const W = 1.7;        // tread half-width (3.4 m wide trail)

// generate a downhill run: features are the proven shapes below, placed with rideability rules
export function generateLayout(seed, biome) {
  const r = rng(seed * 7919 + 13), B = BIOMES[biome], target = 330 + r() * 520;   // 0.3-0.9 km runs
  const out = [{ len: 16, name: 'Start', grade: 0.1 }];
  let heading = 0, s = 30, n = 0, last = '';
  const names = { berm: 'Berm', bumps: biome === 'forest' ? 'Root garden' : 'Rock garden', rollers: 'Rollers', table: 'Tabletop', bigjump: 'Big jump', drop: 'Drop', rockslab: biome === 'desert' ? 'Sandstone slabs' : 'Rock slab', tech: 'Tech turns', ice: 'Ice patch', sand: 'Sand wash' };
  const G = () => lerp(B.grade[0], B.grade[1], r());
  const push = (seg) => { out.push(seg); s += seg.arc ? seg.arc * Math.abs(seg.ang) * D2R : seg.len; };
  const turnAng = (want) => {          // keep the run heading downhill: never more than 80° off the fall line
    let sign = Math.abs(heading) > 35 * D2R ? -Math.sign(heading) : (r() < 0.5 ? -1 : 1);
    let ang = Math.min(want, 80 * D2R - sign * heading); if (ang < 25 * D2R) { sign = -sign; ang = Math.min(want, 80 * D2R - sign * heading); }
    heading += sign * ang; return sign * ang / D2R;
  };
  const pick = () => { const e = Object.entries(B.w).filter(([k]) => k !== last); const tot = e.reduce((a, [, v]) => a + v, 0); let q = r() * tot; for (const [k, v] of e) if ((q -= v) <= 0) return k; return 'straight'; };
  while (s < target - 30) {
    const k = pick(); last = k; n++;
    const jump = k === 'rollers' || k === 'table' || k === 'bigjump' || k === 'drop';
    if (jump) push(k === 'bigjump' ? { len: 26 + r() * 8, grade: 0.2 } : { len: 12 + r() * 8, grade: 0.15 + r() * 0.04 });   // run-in long/steep enough to arrive with speed                // run-in: straight, steady, fast enough
    switch (k) {
      case 'straight': {   // short and never flat: a chute, a rolling crest/dip pair, or a plain descent
        const v = r(); if (v < 0.35) push({ len: 14 + r() * 12, grade: 0.22 + r() * 0.06, name: 'Steep chute' });
        else if (v < 0.65) { push({ len: 10 + r() * 6, grade: 0.03 }); push({ len: 10 + r() * 8, grade: 0.24 }); }
        else push({ len: 12 + r() * 14, grade: G() }); break; }
      case 'turn': { const R = 11 + r() * 12; push({ arc: R, ang: turnAng((45 + r() * 50) * D2R), grade: 0.1 + r() * 0.06 }); push({ arc: 11 + r() * 10, ang: turnAng((40 + r() * 45) * D2R), grade: 0.1 + r() * 0.06 }); break; }
      case 'berm': { const R = 9 + r() * 13, bank = clamp(48 - R * 1.1 + r() * 6, 24, 44); push({ arc: R, ang: turnAng((70 + r() * 70) * D2R), bank, grade: 0.1, name: names.berm }); push({ len: 5 + r() * 6, grade: 0.16 }); break; }
      case 'tech': { push({ arc: 8 + r() * 3, ang: turnAng((50 + r() * 35) * D2R), feat: 'innerRocks', grade: 0.06, name: names.tech }); push({ len: 6 + r() * 6, grade: 0.07 }); push({ arc: 8 + r() * 4, ang: turnAng((45 + r() * 35) * D2R), grade: 0.06 }); break; }
      case 'bumps': push({ len: 35 + r() * 35, feat: 'bumps', grade: G(), name: names.bumps, roots: B.roots, rocks: B.rocks }); break;
      case 'rockslab': push({ len: 15 + r() * 10, feat: 'rockslab', surf: SURF.ROCK, grade: G(), name: names.rockslab }); break;
      case 'ice': push({ len: 10 + r() * 6, surf: SURF.ICE, grade: 0.06, name: names.ice }); break;
      case 'sand': push({ len: 15 + r() * 12, surf: SURF.SAND, grade: 0.09, name: names.sand }); break;
      default: push({ len: { rollers: 32, table: 22, bigjump: 32, drop: 22 }[k], feat: k, grade: 0.1, name: names[k], safe: true });
    }
    if (jump) push({ len: 12 + r() * 6, grade: 0.12 });                             // runout after every jump/drop
  }
  push({ len: 28, name: 'Finish', grade: 0.1, finish: true });
  return out;
}

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
    case 'bigjump': {
      // generated tracks use a filled gap (step-down deck) so coming up short rolls out instead of casing
      const pit = seg.safe ? 0.35 : -1.0;
      if (ls < 5) h += 1.4 * Math.pow(ls / 5, 1.7);
      else if (ls < 6) h += lerp(1.4, pit, smooth(ls - 5));
      else if (ls < 11.5) h += pit;
      else if (ls < 12.5) h += lerp(pit, 0.25, smooth(ls - 11.5));
      else if (ls < 20) h += lerp(0.25, -2.0, smooth((ls - 12.5) / 7.5));
      break; }
    case 'rockslab': h += 0.05 * noise(ls * 0.9, d * 0.9); break;
    case 'drop': if (ls > 3 && ls < 8.05) { surf = SURF.ROCK; h += 0.04 * noise(ls * 1.3, d * 1.3); } break;
  }
  if (seg.bank) {
    const f = smooth(Math.min(ls, seg.len - ls) / 7);
    const o = -seg.sign * d, wb = W + 0.5, tb = Math.tan(seg.bank * D2R * f);
    const oc = Math.max(-wb, Math.min(o, 0.65 * wb)); h += tb * (oc + wb) ** 2 / (2 * wb) - tb * wb / 2;
  }
  return [h, surf];
}

// a rideable track for a biome: generate, check, and retry with a new seed if any rule is broken
export function generateTrack(biome, seed = (Math.random() * 1e9) | 0) {
  for (let tries = 0; tries < 8; tries++) {
    const t = buildTrack(seed + tries * 101, { biome });
    if (t.check.ok) return t;
    console.warn('track rejected:', t.check.why);
  }
  return buildTrack(seed, { biome });
}

export function buildTrack(seed = 7, opts = {}) {
  const t0 = Date.now(), biome = opts.biome || 'test', B = BIOMES[biome], ds = 0.25;
  const layout = opts.layout || (biome === 'test' ? LAYOUT : generateLayout(seed, biome));
  const noise = makeNoise(seed), n2 = makeNoise(seed + 11), n3 = makeNoise(seed + 29);
  const S = [], X = [], Z = [], PSI = [], SEG = [], GR = [], segs = [];
  let x = 0, z = 0, psi = 0, s = 0;
  layout.forEach((def, k) => {
    const len = def.arc ? def.arc * Math.abs(def.ang) * D2R : def.len;
    const seg = { ...def, len, s0: s, surf: def.surf ?? B.trail, sign: def.ang ? Math.sign(def.ang) : 0, grade: def.grade ?? 0.1 };
    segs.push(seg);
    const n = Math.round(len / ds);
    for (let i = 0; i < n; i++) {
      S.push(s); X.push(x); Z.push(z); PSI.push(psi); SEG.push(k); GR.push(seg.grade);
      if (def.arc) psi += seg.sign * ds / def.arc;
      x += Math.cos(psi) * ds; z += Math.sin(psi) * ds; s += ds;
    }
  });
  S.push(s); X.push(x); Z.push(z); PSI.push(psi); SEG.push(segs.length - 1); GR.push(GR[GR.length - 1]);
  const total = s, NS = S.length;

  // elevation: grades eased over 12 m (no sudden gradient changes), plus the drops built into jump/drop features
  const EL = new Float32Array(NS), half = 24; let acc = 0, run = 0;
  for (let i = 0; i < Math.min(NS, half); i++) run += GR[i];
  for (let i = 0; i < NS; i++) {
    const a = i + half < NS ? GR[i + half] : GR[NS - 1], b = i - half - 1 >= 0 ? GR[i - half - 1] : GR[0];
    run += a - b; EL[i] = acc; acc -= (run / (2 * half + 1)) * ds;
  }
  const events = [];
  for (const sg of segs) {
    if (sg.feat === 'bigjump') events.push({ s: sg.s0 + 20, D: 2.0 });
    if (sg.feat === 'drop') events.push({ s: sg.s0 + 8.05, D: 1.1 });
  }
  const keep = biome !== 'test';   // generated runs keep the height lost at jumps/drops (no creeping back uphill)
  const offset = (s) => { let o = 0; for (const e of events) if (s >= e.s) o -= e.D * (keep ? 1 : Math.max(0, Math.min(1, 1 - (s - e.s - 18) / 70))); return o; };
  const elev = (s) => { const f = clamp(s / ds, 0, NS - 1), i = Math.min(Math.floor(f), NS - 2); return lerp(EL[i], EL[i + 1], f - i) + offset(s); };

  // ---- coarse mountain terrain (2 m) around the run: the land follows the trail's descent, rises into
  // valley walls and ridges away from it, with biome-specific relief
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < NS; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]); }
  const M = biome === 'test' ? 40 : 70; minX -= M; minZ -= M; maxX += M; maxZ += M;
  const cr = 2, cnx = Math.ceil((maxX - minX) / cr) + 2, cnz = Math.ceil((maxZ - minZ) / cr) + 2, CH = new Float32Array(cnx * cnz), CD = new Float32Array(cnx * cnz);
  const step = biome === 'test' ? 8 : 12, side = biome === 'test' ? 0 : (seed & 1 ? 1 : -1);   // which side of the trail the mountain rises on
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) {
    const px = minX + i * cr, pz = minZ + j * cr; let ws = 0, we = 0, dm = 1e9, sd = 0;
    for (let k = 0; k < NS; k += step) {
      const dx = px - X[k], dz = pz - Z[k], d2 = dx * dx + dz * dz; if (d2 < dm) { dm = d2; sd = -dx * Math.sin(PSI[k]) + dz * Math.cos(PSI[k]); }
      if (d2 < 9000) { const w = Math.exp(-d2 / 800); ws += w; we += w * EL[k]; }
    }
    const dist = Math.sqrt(dm), base = ws > 1e-9 ? we / ws : elev(S[NS - 1]), far = smooth((dist - 8) / 40);
    const ridged = 1 - Math.abs(noise(px / 110, pz / 110)), mtn = B.ridge * ridged * ridged * far;
    CH[i + j * cnx] = base + B.valley * Math.min(dist, 90) + side * Math.sign(sd) * smooth((dist - 5) / 25) * Math.min(dist, 90) * 0.38 + far * (B.relief * 0.35 * noise(px / 55 + 7, pz / 55) + mtn) + 0.4 * noise(px / 9 + 50, pz / 9);
    CD[i + j * cnx] = dist;
  }
  const cbil = (A, px, pz) => {
    const fx = (px - minX) / cr, fz = (pz - minZ) / cr, i = clamp(Math.floor(fx), 0, cnx - 2), j = clamp(Math.floor(fz), 0, cnz - 2), tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1), k = i + j * cnx;
    return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + cnx] * (1 - tx) + A[k + cnx + 1] * tx) * tz;
  };
  const natural = (px, pz) => cbil(CH, px, pz) + 0.08 * n2(px / 2.3, pz / 2.3);

  // ---- 0.2 m detail tiles, only where the trail is
  const res = biome === 'test' ? 0.15 : 0.2, TS = 64, tiles = new Map(), offN = 1 << 15;
  const key = (ti, tj) => (ti + offN) * 65536 + (tj + offN);
  const tile = (ti, tj, make) => {
    const k = key(ti, tj); let t = tiles.get(k);
    if (!t && make) {
      t = { H: new Float32Array(TS * TS), SF: new Uint8Array(TS * TS).fill(B.off), TD: new Uint8Array(TS * TS).fill(255), best: new Float32Array(TS * TS).fill(1e9), bi: new Int32Array(TS * TS).fill(-1) };
      for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) t.H[i + j * TS] = natural(minX + (ti * TS + i) * res, minZ + (tj * TS + j) * res);
      tiles.set(k, t);
    }
    return t;
  };
  const cellH = (i, j) => { const t = tiles.get(key(i >> 6, j >> 6)); return t ? t.H[(i & 63) + (j & 63) * TS] : natural(minX + i * res, minZ + j * res); };
  const cell = (i, j) => { const t = tile(i >> 6, j >> 6, true); return [t, (i & 63) + (j & 63) * TS]; };

  const R = 7.2, rc = Math.ceil(R / res);
  for (let k = 0; k < NS; k++) {
    const ci = Math.round((X[k] - minX) / res), cj = Math.round((Z[k] - minZ) / res);
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      const dx = minX + i * res - X[k], dz = minZ + j * res - Z[k], d2 = dx * dx + dz * dz; if (d2 >= R * R) continue;
      const [t, id] = cell(i, j); if (d2 < t.best[id]) { t.best[id] = d2; t.bi[id] = k; }
    }
  }
  for (const [kk, t] of tiles) {
    const ti = Math.floor(kk / 65536) - offN, tj = (kk % 65536) - offN;
    for (let id = 0; id < TS * TS; id++) {
      const k = t.bi[id]; if (k < 0) continue;
      const px = minX + (ti * TS + (id & 63)) * res, pz = minZ + (tj * TS + (id >> 6)) * res;
      const c = Math.cos(PSI[k]), sn = Math.sin(PSI[k]), dx = px - X[k], dz = pz - Z[k];
      const along = dx * c + dz * sn, d = -dx * sn + dz * c, sc = S[k] + along, seg = segs[SEG[k]];
      const [ph, surf] = profile(seg, clamp(sc - seg.s0, 0, seg.len), d, noise);
      const o = -seg.sign * d, t0b = (seg.bank && o > 0) ? 3.0 : W + 0.5, ad = Math.abs(d);
      t.H[id] = lerp(elev(sc) + ph, t.H[id], smooth((ad - t0b) / 4.0));
      if (ad < W + 0.3) t.SF[id] = surf;
      t.TD[id] = Math.min(255, Math.round(ad * 20));
    }
    delete t.best; delete t.bi;
  }

  const sampleAt = (s) => { const k = clamp(Math.round(s / ds), 0, NS - 1); return { x: X[k], z: Z[k], psi: PSI[k], s: S[k] }; };
  const toWorld = (s, d) => { const p = sampleAt(s); return { x: p.x - Math.sin(p.psi) * d, z: p.z + Math.cos(p.psi) * d, psi: p.psi }; };
  const h = (px, pz) => {
    const fx = (px - minX) / res, fz = (pz - minZ) / res, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const t = tiles.get(key(i >> 6, j >> 6));
    if (t && (i & 63) < 63 && (j & 63) < 63) { const k = (i & 63) + (j & 63) * TS; return (t.H[k] * (1 - tx) + t.H[k + 1] * tx) * (1 - tz) + (t.H[k + TS] * (1 - tx) + t.H[k + TS + 1] * tx) * tz; }
    // only fall back to the plain terrain when none of the four surrounding cells is in a detail tile
    if (!t && !tiles.get(key((i + 1) >> 6, j >> 6)) && !tiles.get(key(i >> 6, (j + 1) >> 6)) && !tiles.get(key((i + 1) >> 6, (j + 1) >> 6))) return natural(px, pz);
    return (cellH(i, j) * (1 - tx) + cellH(i + 1, j) * tx) * (1 - tz) + (cellH(i, j + 1) * (1 - tx) + cellH(i + 1, j + 1) * tx) * tz;
  };
  const lookup = (px, pz, f, dflt) => { const i = Math.round((px - minX) / res), j = Math.round((pz - minZ) / res), t = tiles.get(key(i >> 6, j >> 6)); return t ? f(t, (i & 63) + (j & 63) * TS) : dflt; };

  // ---- obstacles: rocks (domes) and roots (half-capsules) stamped into the detail tiles
  const r = rng(seed + 3), rocks = [], roots = [];
  for (const sg of segs) {
    const rd = sg.rocks ?? B.rocks ?? 1, rtd = sg.roots ?? B.roots ?? 1;
    if (sg.feat === 'bumps') {
      const nR = Math.round(55 * rd * sg.len / 70);
      for (let k = 0; k < nR; k++) { const big = k < 4 * rd; rocks.push({ s: sg.s0 + 3 + r() * (sg.len - 6), d: (r() * 2 - 1) * 1.5, rr: big ? 0.4 + r() * 0.12 : 0.1 + r() * 0.16, rh: big ? 0.15 + r() * 0.06 : 0.04 + r() * 0.08 }); }
      if (rtd > 0) for (let ls = 3; ls < sg.len - 3; ls += (2.2 + r() * 3) / rtd) roots.push({ s: sg.s0 + ls, ang: (r() - 0.5) * 0.9, rr: 0.03 + r() * 0.03, len: 4.2 });
    }
    if (sg.feat === 'innerRocks') for (let k = 0; k < 14 * rd; k++) rocks.push({ s: sg.s0 + 1 + r() * (sg.len - 2), d: sg.sign * (1.2 + r() * 1.2), rr: 0.15 + r() * 0.2, rh: 0.08 + r() * 0.15 });
    if (sg.feat === 'rockslab') for (let k = 0; k < 18 * rd; k++) rocks.push({ s: sg.s0 + r() * sg.len, d: (r() * 2 - 1) * 1.6, rr: 0.1 + r() * 0.15, rh: 0.03 + r() * 0.07 });
    if (sg.feat === 'drop') {
      for (let k = 0; k < 10; k++) { const side = k % 2 ? 1 : -1; rocks.push({ s: sg.s0 + 6.6 + r() * 1.3, d: side * (1.0 + r() * 1.1), rr: 0.25 + r() * 0.2, rh: 0.15 + r() * 0.2 }); }
      for (let k = 0; k < 6; k++) rocks.push({ s: sg.s0 + 8.3 + r() * 0.6, d: (r() * 2 - 1) * 2.2, rr: 0.3 + r() * 0.2, rh: 0.25 + r() * 0.3, face: true });
    }
    // trail-side boulders (off the riding line) make the corridor feel natural
    if (biome !== 'test' && r() < 0.5 * rd) for (let k = 0; k < 3; k++) rocks.push({ s: sg.s0 + r() * sg.len, d: (r() < 0.5 ? -1 : 1) * (2.6 + r() * 2.5), rr: 0.3 + r() * 0.6, rh: 0.2 + r() * 0.5, side: true });
  }
  for (const rk of rocks) {
    const p = toWorld(rk.s, rk.d); rk.x = p.x; rk.z = p.z; rk.base = h(p.x, p.z);
    const rc2 = Math.ceil(rk.rr / res) + 1, ci = Math.round((p.x - minX) / res), cj = Math.round((p.z - minZ) / res);
    for (let j = cj - rc2; j <= cj + rc2; j++) for (let i = ci - rc2; i <= ci + rc2; i++) {
      const q = Math.hypot(minX + i * res - p.x, minZ + j * res - p.z) / rk.rr; if (q >= 1) continue;
      // rocks in the riding line are rounded humps you roll over; trail-side boulders keep their steep faces
      const [t, id] = cell(i, j), inLine = !rk.side && !rk.face, hh = rk.base + (inLine ? 0.8 : 1) * rk.rh * Math.pow(1 - q * q, inLine ? 1.8 : 0.9);
      if (hh > t.H[id]) { t.H[id] = hh; t.SF[id] = SURF.ROCK; }
    }
  }
  for (const rt of roots) {
    const p = toWorld(rt.s, 0), a = p.psi + Math.PI / 2 + rt.ang, ux = Math.cos(a), uz = Math.sin(a);
    rt.x0 = p.x - ux * rt.len / 2; rt.z0 = p.z - uz * rt.len / 2; rt.x1 = p.x + ux * rt.len / 2; rt.z1 = p.z + uz * rt.len / 2;
    const steps = Math.ceil(rt.len / res), rc2 = Math.ceil(rt.rr / res) + 1, done = new Set();
    for (let tt = 0; tt <= steps; tt++) {
      const cx = rt.x0 + ux * rt.len * tt / steps, cz = rt.z0 + uz * rt.len * tt / steps, ci = Math.round((cx - minX) / res), cj = Math.round((cz - minZ) / res);
      for (let j = cj - rc2; j <= cj + rc2; j++) for (let i = ci - rc2; i <= ci + rc2; i++) {
        const dx = minX + i * res - rt.x0, dz = minZ + j * res - rt.z0, along = clamp(dx * ux + dz * uz, 0, rt.len);
        const q = Math.hypot(dx - ux * along, dz - uz * along) / rt.rr; if (q >= 1) continue;
        const [t, id] = cell(i, j); if (done.has(t.H.length * 0 + id + (i >> 6) * 1e7 + (j >> 6) * 1e4)) continue;
        done.add(id + (i >> 6) * 1e7 + (j >> 6) * 1e4); t.H[id] += 0.75 * rt.rr * Math.sqrt(1 - q * q); t.SF[id] = SURF.ROOT;
      }
    }
  }

  const normal = (px, pz) => {
    const e = res, gx = (h(px + e, pz) - h(px - e, pz)) / (2 * e), gz = (h(px, pz + e) - h(px, pz - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
    return { x: -gx / l, y: 1 / l, z: -gz / l };
  };

  // ---- rideability checks (generated tracks only)
  const check = { ok: true, why: '' };
  if (biome !== 'test') {
    const fail = (w) => { check.ok = false; check.why = w; };
    if (total < 280 || total > 950) fail(`length ${total.toFixed(0)} m`);
    const jumpy = (sv) => { const sg = segs[SEG[clamp(Math.round(sv / ds), 0, NS - 1)]]; return sg.feat && sg.feat !== 'bumps' && sg.feat !== 'rockslab' && sg.feat !== 'innerRocks'; };
    for (let sv = 2; sv < total - 2 && check.ok; sv += 1) {
      if (jumpy(sv) || jumpy(sv + 1)) continue;
      const a = toWorld(sv, 0), b = toWorld(sv + 1, 0), g = (h(b.x, b.z) - h(a.x, a.z));
      if (g < -0.45 || g > 0.25) fail(`slope ${g.toFixed(2)} at ${sv.toFixed(0)} m`);
    }
    for (let i = 0; i < NS && check.ok; i += 20) for (let j = i + 240; j < NS; j += 20)          // trail never comes back near itself
      if ((X[i] - X[j]) ** 2 + (Z[i] - Z[j]) ** 2 < 18 * 18) { fail(`trail overlaps itself at ${S[i].toFixed(0)} m`); break; }
  }

  const sections = segs.filter(sg => sg.name).map(sg => ({ name: sg.name, s: sg.s0 }));
  return {
    h, normal, surface: (px, pz) => lookup(px, pz, (t, id) => t.SF[id], B.off), trackDist: (px, pz) => lookup(px, pz, (t, id) => t.TD[id], 255) / 20,
    farDist: (px, pz) => cbil(CD, px, pz),
    sampleAt, toWorld, elev, total, segs, sections, rocks, roots, bounds: { minX, maxX, minZ, maxZ }, res, biome, seed, check, offSurf: B.off,
    tileCount: tiles.size, centerline: { S, X, Z, PSI }, buildMs: Date.now() - t0,
  };
}
