// Shared building blocks for the rider's gear: shaped tubes (elliptical, offset rings with smooth
// normals), baked vertex colour, procedural fabric / tread textures, and the material set.
// Convention for every part: built in its slot's local frame, X = front, Y = along the bone, Z = right.
import { makeNoise } from '../../terrain/track.js';
const T = window.THREE;
export const nz = makeNoise(4242);
export const srgb = (c) => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2];
export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// rings: [[t, rx, rz, ox?, oz?], ...] (t along Y in units of L, rx = half depth front/back, rz = half width)
// color(t, a, p) -> sRGB, disp(t, a) -> radial offset (m). Ends are closed with a pole.
export const LOWPOLY = { on: false };   // set while building the low-poly rider: coarse rings, few sides
export function tube(rings, L, { n = 14, step = 0.03, color = () => [1, 1, 1], disp = () => 0 } = {}) {
  if (LOWPOLY.on) { n = Math.max(6, Math.round(n / 2)); step = 0.1; const d0 = disp; disp = (t, a) => 0.3 * d0(t, a); }
  // resample the profile finely (smooth silhouette + crisp colour panels)
  const fine = []; for (let r = 0; r < rings.length - 1; r++) { const A = rings[r], B = rings[r + 1], k = Math.max(1, Math.ceil((B[0] - A[0]) / step));
    for (let j = 0; j < k; j++) { const u = j / k, sm = u * u * (3 - 2 * u); fine.push(A.map((v, i) => i === 0 ? v + ((B[i] ?? 0) - v) * u : (v ?? 0) + ((B[i] ?? 0) - (v ?? 0)) * sm)); } }
  fine.push(rings[rings.length - 1]); rings = fine;
  const pos = [], col = [], idx = [], R = rings.length;
  rings.forEach(([t, rx, rz, ox = 0, oz = 0]) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = disp(t, a), c = Math.cos(a), s = Math.sin(a);
      const p = [ox + (rx + d) * c, t * L, oz + (rz + d) * s]; pos.push(...p); col.push(...srgb(color(t, a, p)));
    }
  });
  for (let r = 0; r < R - 1; r++) for (let i = 0; i < n; i++) { const a = r * n + i, b = r * n + (i + 1) % n, c = a + n, d = b + n; idx.push(a, c, b, b, c, d); }
  for (const [r, sgn] of [[0, -1], [R - 1, 1]]) {   // end caps
    const [t, , , ox = 0, oz = 0] = rings[r], k = pos.length / 3; pos.push(ox, t * L + sgn * 0.002, oz); col.push(...col.slice(r * n * 3, r * n * 3 + 3));
    for (let i = 0; i < n; i++) { const a = r * n + i, b = r * n + (i + 1) % n; if (sgn < 0) idx.push(k, a, b); else idx.push(k, b, a); }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); addUV(g); return g;
}
// planar-ish uvs from position (for the fabric bump detail)
export function addUV(g, s = 9) { const p = g.attributes.position, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * s; uv[i * 2 + 1] = p.getY(i) * s; } g.setAttribute('uv', new T.BufferAttribute(uv, 2)); return g; }
// bake a colour onto any geometry: f(x, y, z, nx, ny, nz) -> sRGB
export function paint(g, f) {
  const p = g.attributes.position, nn = g.attributes.normal || (g.computeVertexNormals(), g.attributes.normal), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(srgb(f(p.getX(i), p.getY(i), p.getZ(i), nn.getX(i), nn.getY(i), nn.getZ(i))), i * 3);
  g.setAttribute('color', new T.BufferAttribute(c, 3)); if (!g.attributes.uv) addUV(g); return g;
}
export const solid = (g, c) => paint(g, () => c);

// ---- textures (built once, shared)
const tex = {};
function canvasTex(key, size, draw, repeat = 1) {
  if (tex[key]) return tex[key];
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4; return (tex[key] = t);
}
// woven technical fabric: fine weave + soft creases (used as a bump map)
export const fabricBump = () => canvasTex('fabric', 128, (g, S) => {
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const w = ((x >> 1) + (y >> 1)) % 2 ? 150 : 110, cr = 40 * nz(x / 22, y / 9), v = Math.max(0, Math.min(255, w + cr + (Math.random() - 0.5) * 30)), i = (x + y * S) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
});
// moulded rubber / grip texture (soles, glove palms, chin bar grille)
export const treadBump = () => canvasTex('tread', 64, (g, S) => { g.fillStyle = '#777'; g.fillRect(0, 0, S, S); g.fillStyle = '#eee'; for (let y = 0; y < S; y += 8) for (let x = (y / 8) % 2 * 4; x < S; x += 8) g.fillRect(x, y, 5, 5); });

// ---- materials (vertex-coloured, so one material per surface type serves every colourway)
let M = null;
export function mats() {
  if (M) return M;
  const fb = fabricBump(), tb = treadBump();
  M = {
    fabric: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, bumpMap: fb, bumpScale: 0.0005 }),
    stretch: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, bumpMap: fb, bumpScale: 0.0003 }),
    shell: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.08 }),      // glossy helmet shell
    plastic: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.02 }),    // visor, chin vents, trims
    rubber: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, bumpMap: tb, bumpScale: 0.002 }),
    foam: new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: T.BackSide }),   // helmet liner seen through the openings
    lens: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.06, metalness: 0.9 }),
    metal: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8 }),
    skin: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }),
  };
  return M;
}
export function mesh(geo, mat, parent, shadow = true) { const m = new T.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; }
