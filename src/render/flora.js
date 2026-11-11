// Procedural plant geometry with baked vertex colour (ambient occlusion toward the inside/bottom,
// lighter tips, snow on upward faces). All geometries are built once and drawn instanced.
import { makeNoise } from '../terrain/track.js';
const T = window.THREE;
const nz = makeNoise(314);

// merge non-indexed geometries that carry position + color
function merge(parts) {
  let n = 0; parts.forEach((p) => n += p.attributes.position.count);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o); col.set(p.attributes.color.array, o); nor.set(p.attributes.normal.array, o); o += p.attributes.position.array.length; }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3)); return g;   // keep the smooth per-part normals (no faceting)
}
// colour every vertex of a geometry with f(x, y, z, nx, ny, nz) -> [r, g, b] (sRGB 0..1, converted to linear)
function paint(g, f) {
  if (g.index) { g.computeVertexNormals(); g = g.toNonIndexed(); } else g.computeVertexNormals();   // smooth normals while indexed
  const p = g.attributes.position, nn = g.attributes.normal, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = f(p.getX(i), p.getY(i), p.getZ(i), nn.getX(i), nn.getY(i), nn.getZ(i)); c[i * 3] = v[0] ** 2.2; c[i * 3 + 1] = v[1] ** 2.2; c[i * 3 + 2] = v[2] ** 2.2; }
  g.setAttribute('color', new T.BufferAttribute(c, 3)); return g;
}
const displace = (g, f) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = f(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, v[0], v[1], v[2]); } return g; };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// conifer: whorls of drooping needle-branch sprays around the trunk (alpha-textured cards, two crossed
// per branch for volume), shorter towards the top, plus a sparse dark inner mass so it never looks see-through
const branchTex = {};
function branchTexture(snowy) {
  if (branchTex[snowy]) return branchTex[snowy];
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const stem = (x0, y0, x1, y1, w) => { g.strokeStyle = '#3a2a1c'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // main stem along the card, side twigs fanning forward, needles along every twig
  const twigs = [[0, 64, 250, 64]];
  for (let k = 0; k < 14; k++) { const x = 18 + k * 16, sd = k % 2 ? 1 : -1, len = (1 - k / 16) * 52 + 10; twigs.push([x, 64, x + len * 0.75, 64 + sd * len * 0.8]); twigs.push([x + 8, 64, x + 8 + len * 0.7, 64 - sd * len * 0.7]); }
  for (const [x0, y0, x1, y1] of twigs) {
    const n = Math.hypot(x1 - x0, y1 - y0) / 2.2;
    for (let i = 0; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, a = Math.atan2(y1 - y0, x1 - x0);
      for (const sd of [-1, 1]) {
        const na = a + sd * (0.9 + Math.random() * 0.4), L = 7 + Math.random() * 6 * (1 - 0.4 * t), l = 24 + Math.random() * 30;
        g.strokeStyle = `rgb(${l * 0.7},${l * 1.15 + 18},${l * 0.6})`; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * L, y + Math.sin(na) * L); g.stroke();
      }
    }
    stem(x0, y0, x1, y1, x0 === 0 ? 3 : 1.4);
  }
  if (snowy) { g.fillStyle = 'rgba(240,244,250,0.92)'; for (let i = 0; i < 70; i++) { const x = Math.random() * W, y = 40 + Math.random() * 48; g.beginPath(); g.ellipse(x, y, 6 + Math.random() * 12, 3 + Math.random() * 5, 0, 0, 6.28); g.fill(); } }
  const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; branchTex[snowy] = t; return t;
}
export function pineMaterial(snowy) {
  const map = branchTexture(snowy);
  const m = new T.MeshStandardMaterial({ map, alphaTest: 0.35, side: T.DoubleSide, vertexColors: true, roughness: 0.9 });
  m.depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map, alphaTest: 0.35 });   // needle-shaped shadows
  return m;
}
export function pineGeo(snowy, seed = 0) {
  const parts = [], H = 7.6, whorls = 16;
  for (let k = 0; k < whorls; k++) {
    const u = k / (whorls - 1), y0 = 1.3 + u * (H - 1.6), L = 2.6 * (1 - u) ** 0.85 + 0.45, n = Math.round(9 - 3 * u);
    for (let b = 0; b < n; b++) {
      const a = (b / n) * Math.PI * 2 + k * 2.39 + seed + (nz(k, b) * 0.5), droop = (0.35 + 0.35 * (1 - u)) * L * 0.45, up = 0.25 * L * (0.3 + u);
      for (const roll of [0, 1.15]) {
        const c = new T.PlaneGeometry(L, L * 0.62, 2, 1); c.translate(L / 2, 0, 0); c.rotateX(Math.PI / 2 + roll * (b % 2 ? 1 : -1));
        displace(c, (x, y, z) => { const t = x / L; return [x, y + up * t - droop * t * t, z]; });   // rises from the trunk, tips droop
        c.rotateY(a); c.translate(0, y0, 0);
        parts.push(paint(c, (x, y, z) => { const t = Math.min(1, Math.hypot(x, z) / L); const v = 0.45 + 0.55 * t * (0.75 + 0.25 * u); return [v, v, v * 0.95]; }));
      }
    }
  }
  // inner mass: a slim dark core so you can't see straight through the middle
  const core = new T.ConeGeometry(0.9, H - 1.2, 10, 1, true); core.translate(0, 1.2 + (H - 1.2) / 2, 0);
  const cg = paint(core, () => [0.06, 0.09, 0.05]); cg.setAttribute('uv', new T.BufferAttribute(new Float32Array(cg.attributes.position.count * 2).fill(0.02), 2)); parts.push(cg);
  return mergeUV(parts);
}
// distant stand-in: a few lumpy, drooping tiers (~100 triangles) coloured like the near tree seen through haze
export function pineFarGeo(snowy) {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const u = k / 3, rad = 2.5 * (1 - u * 0.8) + 0.2, h = 2.4 - 0.5 * u, y0 = 1.2 + u * 4.9;
    const c = new T.ConeGeometry(rad, h, 8, 1, true); c.translate(0, y0 + h / 2, 0);
    displace(c, (x, y, z) => { const a = Math.atan2(z, x), f = 1 + 0.18 * Math.sin(a * 5 + k); return [x * f, y, z * f]; });
    parts.push(paint(c, (x, y, z, nx, ny) => { let col = mix([0.07, 0.12, 0.06], [0.15, 0.24, 0.11], Math.min(1, Math.hypot(x, z) / rad)); if (snowy && ny > 0.3) col = mix(col, [0.85, 0.88, 0.93], 0.55); return col; }));
  }
  return merge(parts);
}
// merge keeping uvs (for textured cards)
function mergeUV(parts) {
  const g = merge(parts); let n = 0; parts.forEach((p) => n += p.attributes.position.count);
  const uv = new Float32Array(n * 2); let o = 0; for (const p of parts) { uv.set(p.attributes.uv.array, o); o += p.attributes.uv.array.length; }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2)); return g;
}
export function trunkGeo(cactus) {
  if (cactus) return null;
  const g = new T.CylinderGeometry(0.05, 0.15, 1, 9, 4); g.translate(0, 0.5, 0);
  displace(g, (x, y, z) => { const f = 1 + 0.08 * nz(Math.atan2(z, x) * 3, y * 4); return [x * f, y, z * f]; });
  return paint(g, (x, y) => mix([0.16, 0.11, 0.08], [0.33, 0.24, 0.17], 0.4 + 0.4 * nz(Math.atan2(0, 1) + x * 9, y * 6)));
}

// saguaro: ribbed trunk with a rounded crown and curved arms
export function cactusGeo() {
  const parts = [], ribs = 12;
  const ribbed = (g, r0) => displace(g, (x, y, z) => { const a = Math.atan2(z, x), f = 1 + 0.09 * Math.cos(a * ribs); return [x * f, y, z * f]; });
  const col = (x, y, z) => { const a = Math.atan2(z, x), ridge = 0.5 + 0.5 * Math.cos(a * ribs); return mix([0.19, 0.27, 0.15], [0.36, 0.45, 0.26], ridge * 0.8 + 0.15 * nz(y * 2, a)); };
  const body = ribbed(new T.CylinderGeometry(0.27, 0.32, 3.4, 24, 6, true)); body.translate(0, 1.7, 0); parts.push(paint(body, col));
  const top = ribbed(new T.SphereGeometry(0.27, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)); top.translate(0, 3.4, 0); parts.push(paint(top, col));
  for (const [sd, y0, len, up] of [[1, 1.5, 0.75, 1.1], [-1, 2.0, 0.6, 0.9]]) {
    const curve = new T.CatmullRomCurve3([new T.Vector3(0, y0, 0), new T.Vector3(sd * len * 0.7, y0 + 0.05, 0), new T.Vector3(sd * len, y0 + 0.35, 0), new T.Vector3(sd * len, y0 + up, 0)]);
    const arm = new T.TubeGeometry(curve, 16, 0.17, 16, false); parts.push(paint(arm, (x, y, z) => mix([0.2, 0.28, 0.16], [0.34, 0.43, 0.25], 0.4 + 0.4 * nz(x * 5, y * 5))));
    const cap = new T.SphereGeometry(0.17, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(sd * len, y0 + up, 0); parts.push(paint(cap, () => [0.33, 0.42, 0.25]));
  }
  return merge(parts);
}

// shrub: a clump of lumpy lobes, darker underneath and inside, lighter where the sun hits the top
export function bushGeo(kind) {
  const parts = [], lobes = [[0, 0.45, 0, 0.62], [0.42, 0.35, 0.15, 0.48], [-0.38, 0.33, -0.1, 0.5], [0.08, 0.32, 0.42, 0.45], [-0.1, 0.3, -0.44, 0.44], [0.12, 0.72, -0.05, 0.42]];
  const pal = { forest: [[0.07, 0.14, 0.05], [0.26, 0.40, 0.14]], snow: [[0.55, 0.6, 0.66], [0.97, 0.98, 1.0]], desert: [[0.25, 0.27, 0.18], [0.55, 0.56, 0.40]] }[kind] || [[0.07, 0.14, 0.05], [0.26, 0.40, 0.14]];
  lobes.forEach(([lx, ly, lz, lr], i) => {
    const g = new T.IcosahedronGeometry(lr, 1);
    displace(g, (x, y, z) => { const f = 1 + 0.22 * nz(x * 4 + i * 7, z * 4 + y * 3) + 0.1 * nz(x * 11, y * 11 + z); return [x * f + lx, y * f * 0.85 + ly, z * f + lz]; });
    parts.push(paint(g, (x, y, z, nx, ny) => { const t = Math.min(1, Math.max(0, 0.35 + 0.45 * ny + 0.5 * (y - 0.3) + 0.15 * nz(x * 9, z * 9))); return mix(pal[0], pal[1], t); }));
  });
  return merge(parts);
}

// grass tuft: crossed blade cards with an alpha texture
let grassTex = null;
function grassTexture() {
  if (grassTex) return grassTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const x0 = 10 + Math.random() * 108, lean = (Math.random() - 0.5) * 50, h = 60 + Math.random() * 66, w = 2 + Math.random() * 3;
    const l = 170 + Math.random() * 70; g.fillStyle = `rgb(${l},${l},${l})`;
    g.beginPath(); g.moveTo(x0 - w, 128); g.quadraticCurveTo(x0 + lean * 0.4, 128 - h * 0.6, x0 + lean, 128 - h); g.quadraticCurveTo(x0 + lean * 0.4 + w * 0.5, 128 - h * 0.6, x0 + w, 128); g.fill();
  }
  grassTex = new T.CanvasTexture(c); return grassTex;
}
export function grassGeo() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new T.PlaneGeometry(1, 0.6, 1, 2); g.translate(0, 0.3, 0); g.rotateY(k * Math.PI / 3);
    parts.push(paint(g, (x, y) => [0.35 + 1.0 * y, 0.35 + 1.0 * y, 0.35 + 1.0 * y]));   // darker at the roots
  }
  const g = merge(parts); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(parts.flatMap((p) => Array.from(p.attributes.uv ? p.attributes.uv.array : []))), 2));
  return g;
}
export function grassMaterial() {
  return new T.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: T.DoubleSide, vertexColors: true, roughness: 0.95, color: 0xffffff });
}
