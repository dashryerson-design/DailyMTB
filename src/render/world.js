// Terrain meshes (chunked, high-res near the trail), rocks, roots, vegetation, lighting, sky.
import { SURF, rng, makeNoise } from '../terrain/track.js';
import { Q, applySun, toonMat, facetize } from './quality.js';
import { pineGeo, pineFarGeo, pineMaterial, trunkGeo, cactusGeo, bushGeo, grassGeo, grassMaterial } from './flora.js';
const T = window.THREE;

function detailTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), img = g.createImageData(256, 256), n = makeNoise(5), n2 = makeNoise(9);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const tx = x / 256 * 8, ty = y / 256 * 8, wrap = (f, a, b) => f(a % 8, b % 8);
    let v = 0.55 + 0.25 * wrap(n, tx, ty) + 0.12 * wrap(n2, tx * 4 % 8, ty * 4 % 8) + (Math.random() - 0.5) * 0.25;
    v = Math.max(0, Math.min(1, v)) * 255; const i = (x + y * 256) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; return t;
}

// Spatially chunked instancing with distance LOD and view culling. Every object is put in a grid cell;
// each cell gets one InstancedMesh per layer (e.g. detailed tree / cheap far tree). Per frame a cell's
// layer is shown only if the cell is inside its distance band and inside the camera view (with a
// generous margin, and always when close enough to throw shadows into view), so nothing visibly pops.
const _fr = new T.Frustum(), _pm = new T.Matrix4(), _sph = new T.Sphere(), ZERO = new T.Matrix4().makeScale(0, 0, 0);
class Chunks {
  // layers: [{ geo, mat, depth?, near, far, shadow }]  near/far = camera distance band (m), shadow = cast within (m)
  constructor(parent, layers, cell = 48) { this.parent = parent; this.layers = layers; this.cell = cell; this.cells = new Map(); this.items = []; }
  add(x, y, z, mats, color) {   // mats[l] = Matrix4 for layer l (or null)
    const k = Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
    let c = this.cells.get(k); if (!c) this.cells.set(k, c = { list: [], x0: Math.floor(x / this.cell) * this.cell, z0: Math.floor(z / this.cell) * this.cell, ymin: 1e9, ymax: -1e9 });
    c.ymin = Math.min(c.ymin, y); c.ymax = Math.max(c.ymax, y);
    const it = { c, mats, color, slot: [] }; c.list.push(it); this.items.push(it); return this.items.length - 1;
  }
  build() {
    for (const c of this.cells.values()) {
      c.mesh = this.layers.map((L, l) => {
        const its = c.list.filter((it) => it.mats[l]); if (!its.length) return null;
        const m = new T.InstancedMesh(L.geo, L.mat, its.length); m.frustumCulled = false; m.receiveShadow = !!L.receive; m.castShadow = false;
        if (L.depth) m.customDepthMaterial = L.depth;
        its.forEach((it, i) => { m.setMatrixAt(i, it.mats[l]); it.slot[l] = i; if (it.color && m.setColorAt) m.setColorAt(i, it.color); });
        m.visible = false; this.parent.add(m); return m;
      });
      const h = this.cell / 2; c.cx = c.x0 + h; c.cz = c.z0 + h; c.cy = (c.ymin + c.ymax) / 2 + 4; c.rad = h * 1.42 + (c.ymax - c.ymin) / 2 + 10;
    }
  }
  update(cam) {
    cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    const p = cam.position;
    for (const c of this.cells.values()) {
      const dx = Math.max(0, Math.abs(p.x - c.cx) - this.cell / 2), dz = Math.max(0, Math.abs(p.z - c.cz) - this.cell / 2), d = Math.hypot(dx, dz);
      _sph.center.set(c.cx, c.cy, c.cz); _sph.radius = c.rad;
      const inView = d < 30 || _fr.intersectsSphere(_sph);   // close cells always (their shadows can fall into view)
      c.mesh.forEach((m, l) => { if (!m) return; const L = this.layers[l]; const f = L.k === 'all' ? 1 : Q[L.k] ?? Q.lod, nr = L.near * f, fr = L.far * f; m.visible = inView && d >= nr && d < fr; m.castShadow = Q.shadows && m.visible && d < (L.shadow || 0) * Q.shadowDist; });
    }
  }
  hide(id, on, layers) {   // tuck one object away (or restore it) in the given layers
    const it = this.items[id];
    for (const l of layers) { const m = it.c.mesh[l]; if (!m) continue; m.setMatrixAt(it.slot[l], on ? ZERO : it.mats[l]); m.instanceMatrix.needsUpdate = true; }
  }
}

// per-biome look: ground colours, rocks, sky/fog, vegetation
export const PAL = {
  forest: { dirt: [0.33, 0.22, 0.13], trail: [0.36, 0.25, 0.15], edge: [0.17, 0.12, 0.08], off: [0.21, 0.29, 0.10], rock: 0x6c7262, sky: 0xa7c2d8, fog: [70, 280], hemi: [0xcfe3ff, 0x4a3a28], sun: 0xfff0d8, trees: 1500, treeKind: 'pine', fol: [0.33, 0.35, 0.16], bushes: 1600, bush: [0.26, 0.4, 0.16] },
  snow: { dirt: [0.66, 0.70, 0.77], trail: [0.46, 0.53, 0.66], edge: [0.78, 0.84, 0.93], off: [0.93, 0.95, 0.98], rock: 0x8a8e94, sky: 0xc5d3e2, fog: [60, 260], hemi: [0xe6f0ff, 0x8a96a8], sun: 0xffffff, trees: 800, treeKind: 'snowpine', fol: [0.38, 0.25, 0.2], bushes: 350, bush: [0.6, 0.05, 0.85] },
  desert: { dirt: [0.62, 0.45, 0.30], trail: [0.52, 0.36, 0.23], edge: [0.66, 0.50, 0.34], off: [0.84, 0.71, 0.52], rock: 0xb3683f, sky: 0xd8c8a6, fog: [80, 320], hemi: [0xfff1d6, 0x9a6a40], sun: 0xffe7c2, trees: 260, treeKind: 'cactus', fol: [0.28, 0.35, 0.28], bushes: 700, bush: [0.12, 0.25, 0.32] },
};
PAL.test = PAL.forest;
const TW = 1.7;   // tread half-width (matches track.js W)
const colsFor = (P) => ({
  [SURF.DIRT]: P.dirt, [SURF.GRAVEL]: [0.42, 0.39, 0.34], [SURF.ROCK]: [0.40, 0.39, 0.37], [SURF.GRASS]: P.off, [SURF.ROOT]: [0.24, 0.15, 0.08],
  [SURF.SNOW]: P === PAL.snow ? P.dirt : [0.85, 0.88, 0.92], [SURF.ICE]: [0.62, 0.78, 0.9], [SURF.SAND]: P === PAL.desert ? P.off : [0.76, 0.62, 0.42],
});

export function buildWorld(scene0, track) {
  const P = PAL[track.biome] || PAL.forest, COLS = colsFor(P), root = new T.Group(); scene0.add(root);
  const scene = { add: (...o) => root.add(...o) };
  const tex = detailTexture(), noise = makeNoise(21);
  // ground detail by quality: Low drops the bump relief and texture filtering (flat colour + light grain)
  const LP = Q.style === 'lowpoly', lowG = Q.level === 'low' || LP; tex.anisotropy = { high: 8, medium: 4, low: 1 }[Q.level] || 8;
  if (lowG) { tex.minFilter = T.LinearMipmapNearestFilter; tex.repeat.set(0.5, 0.5); }
  const terrainMat = LP ? toonMat({ vertexColors: true })   // cartoon: cel-shaded flat-colour facets
    : new T.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: lowG ? null : tex, bumpScale: 0.025, roughness: 0.95, metalness: 0 });
  const { minX, maxX, minZ, maxZ } = track.bounds, CH = 32;
  // chunks along the trail get a detailed mesh (by quality) plus a coarse one used once the camera is
  // far away; skirts hide the seams where neighbouring chunks differ in detail
  const terrLod = [];
  const buildChunk = (cx, cz, n) => {
    const res = CH / n, N = n + 3;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ii = Math.min(Math.max(i - 1, 0), n), jj = Math.min(Math.max(j - 1, 0), n), skirt = ii !== i - 1 || jj !== j - 1;
      const x = cx + ii * res, z = cz + jj * res, y = track.h(x, z) - (skirt ? 0.6 : 0), k = i + j * N;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = x / 2.2; uv[k * 2 + 1] = z / 2.2;
      const s = track.surface(x, z), nn = track.normal(x, z), td = track.trackDist(x, z);
      // off-trail ground: natural colour variation, lighter/greyer on steep faces
      const offLike = s === SURF.GRASS || s === track.offSurf, base = COLS[s];
      const m = 0.5 + 0.5 * noise(x / 6, z / 6), m2 = 0.5 + 0.5 * noise(x / 1.3 + 40, z / 1.3), steep = 1 - nn.y;
      const offC = offLike ? [base[0] * (0.82 + 0.3 * m + 0.08 * m2) + steep * 0.25, base[1] * (0.84 + 0.24 * m + 0.06 * m2) + steep * 0.1, base[2] * (0.9 + 0.15 * m) + steep * 0.05] : base;
      // the ridden line: a packed, worn tread with a ragged edge, two tyre ruts and a band of churned
      // material kicked to the sides - its own colour so it reads clearly against the ground around it
      const jit = 0.28 * noise(x / 2.1 + 3, z / 2.1), mask = 1 - Math.min(1, Math.max(0, (td - (TW - 0.15 + jit)) / 0.3));
      const tb = (s === SURF.DIRT || s === SURF.SNOW || offLike) ? (LP && track.biome === 'snow' ? [0.36, 0.47, 0.7] : P.trail) : base;   // cartoon snow: punchier blue packed trail
      const rut = 1 - (LP ? 0.07 : track.biome === 'snow' ? 0.24 : 0.16) * Math.exp(-(((td - 0.32) / 0.11) ** 2)) * (0.7 + 0.3 * m2), grain = LP ? 0.97 + 0.06 * m : 0.88 + 0.2 * m2 + 0.06 * m;   // cartoon: clean, even trail colour
      const trailC = tb.map((v) => v * rut * grain * (1 + 0.06 * Math.exp(-((td / 0.18) ** 2))));
      let c = offC.map((v, q) => v + (trailC[q] - v) * mask);
      const band = Math.exp(-(((td - (TW + 0.3 + jit)) / 0.32) ** 2)) * (LP ? 0.55 : 0.45 + 0.4 * m2);
      if (offLike || s === SURF.DIRT) c = c.map((v, q) => v + (P.edge[q] - v) * band * 0.65);
      col[k * 3] = c[0] ** 2.2; col[k * 3 + 1] = c[1] ** 2.2; col[k * 3 + 2] = c[2] ** 2.2;
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = i + j * N, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(LP ? facetize(g, { sat: 1.3, gain: 1.08, steps: 18 }) : g, terrainMat); m.receiveShadow = true; scene.add(m); return m;
  };
  for (let cz = minZ; cz < maxZ; cz += CH) for (let cx = minX; cx < maxX; cx += CH) {
    let near = false;
    for (let z = cz; z <= cz + CH && !near; z += 2) for (let x = cx; x <= cx + CH; x += 2) if (track.trackDist(x, z) < 9) { near = true; break; }
    const lo = buildChunk(cx, cz, 13);
    if (near) { const hi = buildChunk(cx, cz, { high: 80, medium: 54, low: 40 }[Q.level]); hi.visible = false; terrLod.push({ hi, lo, x: cx + CH / 2, z: cz + CH / 2 }); }
  }

  // rocks (same footprint/height as their heightfield domes)
  const r = rng(77), rockGeo = new T.IcosahedronGeometry(1, LP ? 0 : 2), pa = rockGeo.attributes.position;
  for (let i = 0; i < pa.count; i++) { const v = new T.Vector3().fromBufferAttribute(pa, i), f = 1 + 0.18 * noise(v.x * 2 + 9, v.z * 2 + v.y); v.multiplyScalar(f); if (v.y < 0) v.y *= 0.6; pa.setXYZ(i, v.x, v.y, v.z); }
  rockGeo.computeVertexNormals();
  const rockGeoLP = LP ? facetize(rockGeo.toNonIndexed()) : null;
  const rockMat = LP ? toonMat({ color: new T.Color(P.rock).convertSRGBToLinear().multiplyScalar(1.15) }) : new T.MeshStandardMaterial({ color: new T.Color(P.rock).convertSRGBToLinear(), roughness: 0.88, map: LP ? null : tex, bumpMap: lowG ? null : tex, bumpScale: 0.03, flatShading: LP });
  const deco = [];
  for (let i = 0; i < 700; i++) { const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ); if (track.trackDist(x, z) < 4 || (track.farDist && track.farDist(x, z) > 60)) continue; const s = 0.2 + r() ** 3 * 1.6; deco.push({ x, z, rr: s, rh: s * (0.5 + r() * 0.4), base: track.h(x, z) - s * 0.15 }); }
  const all = [...track.rocks, ...deco], mm = new T.Matrix4(), q = new T.Quaternion(), chunks = [];
  const rockFar = new T.IcosahedronGeometry(1, 0); rockFar.scale(1, 0.75, 1);
  const rocks = new Chunks(root, [{ geo: rockGeoLP || rockGeo, mat: rockMat, near: 0, far: 70, shadow: 35, receive: true }, { geo: rockFar, mat: rockMat, near: 70, far: 400 }]); chunks.push(rocks);
  all.forEach((rk) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28); const M = new T.Matrix4().compose(new T.Vector3(rk.x, rk.base, rk.z), q, new T.Vector3(rk.rr, rk.rh, rk.rr * (0.8 + r() * 0.3))); rocks.add(rk.x, rk.base, rk.z, [M, M]); });
  rocks.build();
  // roots
  const rootMat = new T.MeshStandardMaterial({ color: new T.Color(0x4a3220).convertSRGBToLinear(), roughness: 0.8 });
  for (const rt of track.roots) {
    const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8, x = rt.x0 + (rt.x1 - rt.x0) * t, z = rt.z0 + (rt.z1 - rt.z0) * t; pts.push(new T.Vector3(x, track.h(x, z) - rt.rr * 0.45, z)); }
    const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, rt.rr, 7), rootMat); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  // trees + bushes (instanced)
  const cactus = P.treeKind === 'cactus';
  const trunkG = cactus ? new T.CylinderGeometry(0.001, 0.001, 0.001, 3) : LP ? new T.CylinderGeometry(0.07, 0.17, 1, 5).translate(0, 0.5, 0) : trunkGeo(false);
  const folG = LP ? facetize(cactus ? cactusGeo(true) : pineFarGeo(P.treeKind === 'snowpine', 4, 7), { sat: 1.45, gain: 1.35, steps: 6 }) : cactus ? cactusGeo() : pineGeo(P.treeKind === 'snowpine');
  const trees = [], dens = { pine: 1, snowpine: 0.7, cactus: 0.25 }[P.treeKind] ?? 1;
  // line the trail: a dense wall of trees just off the riding line, so the run feels like a corridor
  for (let sv = 0; sv < track.total; sv += 2.2) for (const sd of [-1, 1]) {
    if (r() > 0.45 * dens) continue;
    const d = sd * (6 + r() ** 1.4 * 12), p = track.toWorld(sv + (r() - 0.5), d);
    if (track.trackDist(p.x, p.z) < 5.5) continue;
    trees.push([p.x, p.z, 0.6 + r() * 0.8]);
  }
  for (let i = 0; i < P.trees * 6 && trees.length < P.trees + 800 * dens; i++) { const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ); if (track.trackDist(x, z) < 5.5 || (track.farDist && track.farDist(x, z) > 65)) continue; trees.push([x, z, 0.7 + r() * 0.8]); }
  // detailed trees up close (with shadows), a cheap stand-in beyond ~75 m (already deep in the haze)
  const folMat = LP ? toonMat({ vertexColors: true }) : cactus ? new T.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.9 }) : pineMaterial(P.treeKind === 'snowpine');
  const farMat = LP ? folMat : new T.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.95 });
  const TREE_NEAR = 75, treeCh = new Chunks(root, [
    { geo: folG, mat: folMat, depth: folMat.depth, near: 0, far: TREE_NEAR, k: 'tree', shadow: 32, receive: true },
    { geo: trunkG, mat: LP ? toonMat({ color: new T.Color(0x6b4428).convertSRGBToLinear() }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: tex, bumpMap: tex, bumpScale: 0.02 }), near: 0, far: TREE_NEAR, k: 'tree', shadow: 32 },
    { geo: cactus ? folG : pineFarGeo(P.treeKind === 'snowpine'), mat: cactus ? folMat : farMat, near: TREE_NEAR, far: 600, k: 'tree' },
    // back rows (behind the trees lining the trail): mid-detail, no shadows, simple trunk
    { geo: cactus ? folG : LP ? folG : pineFarGeo(P.treeKind === 'snowpine', 6, 10), mat: cactus ? folMat : farMat, near: 0, far: LP ? 2000 : TREE_NEAR, k: LP ? 'all' : 'tree', shadow: cactus || LP ? 30 : 0, receive: true },
    { geo: cactus ? trunkG : new T.CylinderGeometry(0.06, 0.15, 1, 6).translate(0, 0.5, 0), mat: LP ? toonMat({ color: new T.Color(0x6b4428).convertSRGBToLinear() }) : new T.MeshStandardMaterial({ color: new T.Color(0x3a2a1e).convertSRGBToLinear(), roughness: 0.95 }), near: 0, far: LP ? 2000 : TREE_NEAR, k: LP ? 'all' : 'tree' },
  ], 32); chunks.push(treeCh);
  // Low graphics: thin the forest to ~45% (keeping more of the trees right by the trail)
  if (Q.level === 'low' && !cactus && !LP) { const keep = trees.filter(([x, z]) => r() < (track.trackDist(x, z) < 10 ? 0.65 : 0.35)); trees.length = 0; trees.push(...keep); }
  const treeId = trees.map(([x, z, s]) => { const y = track.h(x, z); q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28);
    const F = new T.Matrix4().compose(new T.Vector3(x, y, z), q, new T.Vector3(s, s, s)), Tr = cactus ? null : new T.Matrix4().compose(new T.Vector3(x, y, z), q, new T.Vector3(s, 7.2 * s, s));
    const front = cactus || (!LP && Q.level !== 'low' && track.trackDist(x, z) < 14);   // only the row lining the trail gets the full tree (none on Low)
    return treeCh.add(x, y, z, front ? [F, Tr, F, null, null] : [null, null, LP ? null : F, F, cactus ? null : Tr], new T.Color(0.85 + r() * 0.25, 0.85 + r() * 0.25, 0.8 + r() * 0.2)); });
  treeCh.build();
  const bushG0 = bushGeo(track.biome === 'test' ? 'forest' : track.biome, LP), bushG = LP ? facetize(bushG0, { sat: 1.4, gain: 1.3, steps: 6 }) : bushG0, bushes = [];
  for (let sv = 0; sv < track.total; sv += 1.6) for (const sd of [-1, 1]) {      // low undergrowth along the trail edge
    if (r() > 0.5) continue;
    const p = track.toWorld(sv + (r() - 0.5), sd * (3.2 + r() * 5)); if (track.trackDist(p.x, p.z) < 3.1) continue;
    bushes.push([p.x, p.z, 0.25 + r() * 0.4]);
  }
  for (let i = 0; i < P.bushes * 3 && bushes.length < P.bushes + 900; i++) { const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ), d = track.trackDist(x, z); if (d < 2.9 || (d > 9 && r() < 0.6)) continue; bushes.push([x, z, 0.3 + r() * 0.6]); }
  const bushCh = new Chunks(root, [{ geo: bushG, mat: LP ? toonMat({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.92 }), near: 0, far: 110, shadow: 30, receive: true, k: 'bush' }]); chunks.push(bushCh);
  bushes.forEach(([x, z, s]) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28); const y = track.h(x, z) - s * 0.08; bushCh.add(x, y, z, [new T.Matrix4().compose(new T.Vector3(x, y, z), q, new T.Vector3(s * 1.3, s, s * 1.2))], new T.Color(0.8 + r() * 0.3, 0.8 + r() * 0.3, 0.78 + r() * 0.22)); });
  bushCh.build();
  // grass tufts: lush in the forest, sparse dry clumps in the desert, none on snow
  const gN = LP ? 0 : { forest: 7000, test: 7000, desert: 1800 }[track.biome] || 0;   // no grass cards in low poly
  if (gN) {
    const tufts = [], dry = track.biome === 'desert';
    for (let i = 0; i < gN * 4 && tufts.length < gN; i++) {
      const sv = r() * track.total, p = track.toWorld(sv, (r() < 0.5 ? -1 : 1) * (TW + 0.5 + r() ** 1.6 * 16)), d = track.trackDist(p.x, p.z);
      if (d < TW + 0.4 || track.surface(p.x, p.z) === SURF.ROCK) continue; tufts.push([p.x, p.z, 0.5 + r() * 0.9]);
    }
    const grassCh = new Chunks(root, [{ geo: grassGeo(), mat: grassMaterial(), near: 0, far: 50, receive: true, k: 'grass' }], 32); chunks.push(grassCh);
    tufts.forEach(([x, z, s]) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28); const y = track.h(x, z) - 0.03;
      const c = dry ? new T.Color().setHSL(0.11 + r() * 0.03, 0.35, 0.42 + r() * 0.12) : new T.Color().setHSL(0.2 + r() * 0.06, 0.45, 0.22 + r() * 0.1);
      grassCh.add(x, y, z, [new T.Matrix4().compose(new T.Vector3(x, y, z), q, new T.Vector3(s, s * (0.8 + r() * 0.6), s))], c.convertSRGBToLinear()); });
    grassCh.build();
  }

  // sky, fog, lights
  const sky = new T.Color(LP ? { forest: 0x86c5f2, snow: 0xa9d4f5, desert: 0xf6c98d, test: 0x86c5f2 }[track.biome] || P.sky : P.sky); scene0.background = sky; scene0.fog = new T.Fog(sky, P.fog[0] * (LP ? 1.4 : 1), P.fog[1] * (LP ? 1.2 : 1));
  scene.add(new T.HemisphereLight(P.hemi[0], P.hemi[1], LP ? 0.85 : 0.55));
  const sun = new T.DirectionalLight(P.sun, 2.1); sun.castShadow = true; sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); applySun(sun);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 120 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // trees right next to the camera (it swings wide in tight, tree-lined turns) are tucked away so the view stays clear
  const hidden = new Set();
  const clearView = (cam) => {
    const c = cam.position;
    trees.forEach(([x, z, s], i) => {
      const near = (x - c.x) ** 2 + (z - c.z) ** 2 < (2.6 * s + 1.2) ** 2;
      if (near !== hidden.has(i)) { if (near) hidden.add(i); else hidden.delete(i); treeCh.hide(treeId[i], near, [0, 1, 3, 4]); }
    });
    for (const ch of chunks) ch.update(cam);
    const tr = 70 * Q.lod;   // detailed terrain only near the camera
    for (const t of terrLod) { const dx = Math.max(0, Math.abs(c.x - t.x) - CH / 2), dz = Math.max(0, Math.abs(c.z - t.z) - CH / 2), on = dx * dx + dz * dz < tr * tr; t.hi.visible = on; t.lo.visible = !on; }
  };
  return { sun, root, clearView };
}

export function envMap(renderer) {
  const s = new T.Scene(), g = new T.SphereGeometry(50, 32, 16), c = [], p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 50; const col = y > 0 ? new T.Color(0xa9c8e8).lerp(new T.Color(0xf2f0e6), Math.max(0, 1 - y * 3)) : new T.Color(0x3d3326); c.push(col.r, col.g, col.b); }
  g.setAttribute('color', new T.Float32BufferAttribute(c, 3));
  s.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
  const pm = new T.PMREMGenerator(renderer); return pm.fromScene(s).texture;
}
