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
// ---- cartoon ("low poly") look helpers
let _grad = null;
export function toonGradient() {   // 3-band cel shading ramp
  if (_grad) return _grad; const T = window.THREE, d = new Uint8Array([90, 170, 255]);
  _grad = new T.DataTexture(d, 3, 1, T.LuminanceFormat); _grad.minFilter = _grad.magFilter = T.NearestFilter; _grad.generateMipmaps = false; _grad.needsUpdate = true; return _grad;
}
export function toonMat(o = {}) { const T = window.THREE; return new T.MeshToonMaterial({ gradientMap: toonGradient(), ...o }); }
// flat-colour facets: every triangle gets one colour (its average), pushed brighter/more saturated and
// stepped into a few tones, and a face normal - crisp cartoon facets instead of smeared gradients
export function facetize(g, { sat = 1.3, gain = 1.12, steps = 7, perVertex = false } = {}) {
  const T = window.THREE; if (g.index) g = g.toNonIndexed();
  const c = g.attributes.color; if (c) { const col = new T.Color(), hsl = {};
    if (perVertex) {   // keep smooth per-vertex colour (soft, clean colour edges), just punch it up
      for (let i = 0; i < c.count; i++) { col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).convertLinearToSRGB().getHSL(hsl); col.setHSL(hsl.h, Math.min(1, hsl.s * sat), Math.min(1, hsl.l * gain)).convertSRGBToLinear(); c.setXYZ(i, col.r, col.g, col.b); }
      c.needsUpdate = true; g.computeVertexNormals(); return g;
    }
    for (let i = 0; i < c.count; i += 3) {
      let r = 0, gg = 0, b = 0; for (let k = 0; k < 3; k++) { r += c.getX(i + k); gg += c.getY(i + k); b += c.getZ(i + k); }
      col.setRGB(r / 3, gg / 3, b / 3).convertLinearToSRGB().getHSL(hsl);
      const l = Math.round(Math.min(1, hsl.l * gain) * steps) / steps;
      col.setHSL(hsl.h, Math.min(1, hsl.s * sat), Math.max(0.04, l)).convertSRGBToLinear();
      for (let k = 0; k < 3; k++) c.setXYZ(i + k, col.r, col.g, col.b);
    } c.needsUpdate = true; }
  g.computeVertexNormals(); return g;
}
// restyle the bike / rider / ghost: cel-shaded flat colours plus an ink outline in cartoon mode,
// the original physically-based materials in real mode. Geometry stays full detail.
export function styleModel(root) {
  const T = window.THREE, lp = Q.style === 'lowpoly', ghost = (m) => m.transparent && m.opacity < 1;
  root.traverse((o) => {
    if (o.userData.outline) return;
    if (o.isMesh && o.material && !Array.isArray(o.material)) {
      const u = o.userData;
      if (!u.real) u.real = o.material;
      if (lp) {
        const r = u.real;
        if (!u.toon) u.toon = toonMat({ color: r.color ? r.color.clone() : new T.Color(1, 1, 1), vertexColors: !!r.vertexColors, transparent: r.transparent, opacity: r.opacity, depthWrite: r.depthWrite, side: r.side });
        o.material = u.toon;
        // ink outline: back faces pushed out along the normals (skip tiny parts and ghosts)
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (!u.ol && !o.isInstancedMesh && !ghost(r) && o.geometry.boundingSphere.radius > 0.03) {
          const ol = new T.Mesh(o.geometry, outlineMat()); ol.userData.outline = true; ol.castShadow = false; ol.raycast = () => {}; o.add(ol); u.ol = ol;
        }
        if (u.ol) u.ol.visible = true;
      } else { o.material = u.real; if (u.ol) u.ol.visible = false; }
    }
  });
}
let _ol = null;
function outlineMat() {
  if (_ol) return _ol; const T = window.THREE;
  _ol = new T.MeshBasicMaterial({ color: 0x14161a, side: T.BackSide });
  _ol.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * 0.007;'); };
  return _ol;
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
