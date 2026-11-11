// Graphics quality presets. Read live by the renderer setup and the world's LOD/culling every frame,
// so a change applies immediately (no reload). Saved per device.
const PRESETS = {
  high:   { label: 'High',   pixelRatio: 2,    shadows: true,  shadowMap: 2048, shadowDist: 1,   soft: true,  lod: 1,    grass: 1,   tree: 1,    bush: 1 },
  medium: { label: 'Medium', pixelRatio: 1.25, shadows: true,  shadowMap: 1024, shadowDist: 0.5, soft: false, lod: 0.75, grass: 0.6, tree: 0.5,  bush: 0.5 },
  low:    { label: 'Low',    pixelRatio: 1,    shadows: false, shadowMap: 512,  shadowDist: 0,   soft: false, lod: 0.55, grass: 0,    tree: 0.35, bush: 0 }   // low: trees only, no undergrowth,
};
const KEY = 'dailymtb.quality';
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;   // tablets/phones start on Medium
let level = 'high';
try { level = localStorage.getItem(KEY) || (touch ? 'medium' : 'high'); } catch { level = touch ? 'medium' : 'high'; }
if (!PRESETS[level]) level = 'high';
export const Q = { ...PRESETS[level], level };
export const LEVELS = Object.keys(PRESETS);
export function setQuality(l) { if (!PRESETS[l]) return; Object.assign(Q, PRESETS[l], { level: l }); try { localStorage.setItem(KEY, l); } catch {} }
// apply renderer-side settings (pixel ratio, shadow filtering); the sun's map size is applied by applySun
export function applyRenderer(r) {
  r.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  r.shadowMap.type = Q.soft ? window.THREE.PCFSoftShadowMap : window.THREE.PCFShadowMap; r.shadowMap.needsUpdate = true;
}
export function applySun(sun) {
  if (!sun) return; sun.castShadow = Q.shadows;
  if (sun.shadow.mapSize.x !== Q.shadowMap) { sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
}

// ---- visual style: 'real' (textured, detailed) or 'lowpoly' (flat-shaded facets, simple geometry, no
// textures). Independent of the quality preset, which still controls resolution/shadows/distances.
const SKEY = 'dailymtb.style';
try { Q.style = localStorage.getItem(SKEY) === 'lowpoly' ? 'lowpoly' : 'real'; } catch { Q.style = 'real'; }
export function setStyle(st) { Q.style = st === 'lowpoly' ? 'lowpoly' : 'real'; try { localStorage.setItem(SKEY, Q.style); } catch {} }
// restyle already-built models (bike, rider, ghost): faceted shading, bump/texture detail off in low poly
export function styleModel(root) {
  const lp = Q.style === 'lowpoly';
  root.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) {
    const u = m.userData; if (!('bump' in u)) { u.bump = m.bumpMap || null; }
    m.flatShading = lp; m.bumpMap = lp ? null : u.bump; m.needsUpdate = true; } });
}

// Build models in low-poly form: while fn runs, the curved three.js primitives are created with very few
// segments (so every tube, wheel, sphere and rounded part becomes clearly faceted). Geometry only;
// nothing about positions, sizes or physics changes.
export function buildLowPoly(fn) {
  const T = window.THREE, orig = {}, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v ?? hi));
  const patch = (name, map) => { orig[name] = T[name]; const O = orig[name]; T[name] = class extends O { constructor(...a) { super(...map(a)); } }; };
  patch('CylinderGeometry', ([rt, rb, h, rs, hs, ...r]) => [rt, rb, h, clamp(rs, 3, 6), 1, ...r]);
  patch('TorusGeometry', ([R, t, rs, ts, arc]) => [R, t, clamp(rs, 3, 4), clamp(ts, 6, 12), arc]);
  patch('TubeGeometry', ([path, ts, r, rs, closed]) => [path, Math.max(2, Math.round((ts ?? 64) / 4)), r, clamp(rs, 3, 4), closed]);
  patch('SphereGeometry', ([r, w, h, ...rest]) => [r, clamp(w, 4, 9), clamp(h, 2, 6), ...rest]);
  patch('RingGeometry', ([a, b, s, ...rest]) => [a, b, clamp(s, 3, 10), ...rest]);
  patch('IcosahedronGeometry', ([r]) => [r, 0]);
  patch('ConeGeometry', ([r, h, rs, ...rest]) => [r, h, clamp(rs, 3, 6), ...rest]);
  try { return fn(); } finally { Object.assign(T, orig); }
}
