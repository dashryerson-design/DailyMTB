// Terrain meshes (chunked, high-res near the trail), rocks, roots, vegetation, lighting, sky.
import { SURF, rng, makeNoise } from '../terrain/track.js';
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

// per-biome look: ground colours, rocks, sky/fog, vegetation
export const PAL = {
  forest: { dirt: [0.33, 0.22, 0.13], off: [0.20, 0.26, 0.10], rock: 0x6c7262, sky: 0xa7c2d8, fog: [70, 280], hemi: [0xcfe3ff, 0x4a3a28], sun: 0xfff0d8, trees: 1500, treeKind: 'pine', fol: [0.33, 0.35, 0.16], bushes: 1600, bush: [0.26, 0.4, 0.16] },
  snow: { dirt: [0.66, 0.70, 0.77], off: [0.90, 0.92, 0.95], rock: 0x8a8e94, sky: 0xc5d3e2, fog: [60, 260], hemi: [0xe6f0ff, 0x8a96a8], sun: 0xffffff, trees: 800, treeKind: 'snowpine', fol: [0.38, 0.25, 0.2], bushes: 350, bush: [0.6, 0.05, 0.85] },
  desert: { dirt: [0.62, 0.45, 0.30], off: [0.78, 0.62, 0.42], rock: 0xb3683f, sky: 0xd8c8a6, fog: [80, 320], hemi: [0xfff1d6, 0x9a6a40], sun: 0xffe7c2, trees: 260, treeKind: 'cactus', fol: [0.28, 0.35, 0.28], bushes: 700, bush: [0.12, 0.25, 0.32] },
};
PAL.test = PAL.forest;
const colsFor = (P) => ({
  [SURF.DIRT]: P.dirt, [SURF.GRAVEL]: [0.42, 0.39, 0.34], [SURF.ROCK]: [0.40, 0.39, 0.37], [SURF.GRASS]: P.off, [SURF.ROOT]: [0.24, 0.15, 0.08],
  [SURF.SNOW]: P === PAL.snow ? P.dirt : [0.85, 0.88, 0.92], [SURF.ICE]: [0.62, 0.78, 0.9], [SURF.SAND]: P === PAL.desert ? P.off : [0.76, 0.62, 0.42],
});

export function buildWorld(scene0, track) {
  const P = PAL[track.biome] || PAL.forest, COLS = colsFor(P), root = new T.Group(); scene0.add(root);
  const scene = { add: (...o) => root.add(...o) };
  const tex = detailTexture(), noise = makeNoise(21);
  const terrainMat = new T.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 0.025, roughness: 0.95, metalness: 0 });
  const { minX, maxX, minZ, maxZ } = track.bounds, CH = 32;
  for (let cz = minZ; cz < maxZ; cz += CH) for (let cx = minX; cx < maxX; cx += CH) {
    let near = false;
    for (let z = cz; z <= cz + CH && !near; z += 2) for (let x = cx; x <= cx + CH; x += 2) if (track.trackDist(x, z) < 9) { near = true; break; }
    const res = near ? 0.4 : 2.5, n = Math.round(CH / res), N = n + 3;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ii = Math.min(Math.max(i - 1, 0), n), jj = Math.min(Math.max(j - 1, 0), n), skirt = ii !== i - 1 || jj !== j - 1;
      const x = cx + ii * res, z = cz + jj * res, y = track.h(x, z) - (skirt ? 0.6 : 0), k = i + j * N;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = x / 2.2; uv[k * 2 + 1] = z / 2.2;
      const s = track.surface(x, z), nn = track.normal(x, z), td = track.trackDist(x, z);
      let c = COLS[s].slice();
      if (s === SURF.GRASS || (s === track.offSurf && s !== SURF.DIRT)) { const m = 0.5 + 0.5 * noise(x / 6, z / 6), steep = 1 - nn.y; c = [c[0] * (0.8 + 0.4 * m) + steep * 0.3, c[1] * (0.8 + 0.3 * m) + steep * 0.1, c[2] + steep * 0.05]; if (td < 3.2) { const f = (3.2 - td) / 1.2; for (let q = 0; q < 3; q++) c[q] += (COLS[SURF.DIRT][q] - c[q]) * Math.min(1, f) * 0.7; } }
      else if (s === SURF.DIRT) { const f = Math.max(0, 1 - td / 1.6); c = c.map((v, q) => v * (0.85 + 0.25 * noise(x / 1.5, z / 1.5)) + f * [0.05, 0.035, 0.02][q]); }
      col[k * 3] = c[0] ** 2.2; col[k * 3 + 1] = c[1] ** 2.2; col[k * 3 + 2] = c[2] ** 2.2;
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = i + j * N, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, terrainMat); m.receiveShadow = true; scene.add(m);
  }

  // rocks (same footprint/height as their heightfield domes)
  const r = rng(77), rockGeo = new T.IcosahedronGeometry(1, 2), pa = rockGeo.attributes.position;
  for (let i = 0; i < pa.count; i++) { const v = new T.Vector3().fromBufferAttribute(pa, i), f = 1 + 0.18 * noise(v.x * 2 + 9, v.z * 2 + v.y); v.multiplyScalar(f); if (v.y < 0) v.y *= 0.6; pa.setXYZ(i, v.x, v.y, v.z); }
  rockGeo.computeVertexNormals();
  const rockMat = new T.MeshStandardMaterial({ color: new T.Color(P.rock).convertSRGBToLinear(), roughness: 0.88, map: tex, bumpMap: tex, bumpScale: 0.03 });
  const deco = [];
  for (let i = 0; i < 700; i++) { const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ); if (track.trackDist(x, z) < 4 || (track.farDist && track.farDist(x, z) > 60)) continue; const s = 0.2 + r() ** 3 * 1.6; deco.push({ x, z, rr: s, rh: s * (0.5 + r() * 0.4), base: track.h(x, z) - s * 0.15 }); }
  const all = [...track.rocks, ...deco], rocks = new T.InstancedMesh(rockGeo, rockMat, all.length), mm = new T.Matrix4(), q = new T.Quaternion();
  all.forEach((rk, i) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28); rocks.setMatrixAt(i, mm.compose(new T.Vector3(rk.x, rk.base, rk.z), q, new T.Vector3(rk.rr, rk.rh, rk.rr * (0.8 + r() * 0.3)))); });
  rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);
  // roots
  const rootMat = new T.MeshStandardMaterial({ color: new T.Color(0x4a3220).convertSRGBToLinear(), roughness: 0.8 });
  for (const rt of track.roots) {
    const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8, x = rt.x0 + (rt.x1 - rt.x0) * t, z = rt.z0 + (rt.z1 - rt.z0) * t; pts.push(new T.Vector3(x, track.h(x, z) - rt.rr * 0.45, z)); }
    const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, rt.rr, 7), rootMat); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  // trees + bushes (instanced)
  const cactus = P.treeKind === 'cactus';
  const trunkG = cactus ? new T.CylinderGeometry(0.22, 0.26, 1, 9) : new T.CylinderGeometry(0.12, 0.2, 1, 7); trunkG.translate(0, 0.5, 0);
  const folG = (() => { const parts = cactus
      ? [[0.16, 1.1, 0.75, 1.6, 0], [0.15, 0.9, -0.7, 2.1, 0], [0.16, 0.55, 0.75, 2.35, 0], [0.15, 0.5, -0.7, 2.7, 0]].map(([rad, h, x, y]) => { const c = new T.CylinderGeometry(rad, rad, h, 8); c.translate(x, y, 0); return c.toNonIndexed(); })
        .concat([[0.55, 1.6], [-0.5, 2.1]].map(([x, y]) => { const c = new T.CylinderGeometry(0.13, 0.13, Math.abs(x) * 1.6, 6); c.rotateZ(Math.PI / 2); c.translate(x * 0.55, y - 0.45, 0); return c.toNonIndexed(); }))
      : [[2.2, 3.6, 2.4], [1.7, 3.0, 4.4], [1.1, 2.4, 6.2]].map(([rad, h, y]) => { const c = new T.ConeGeometry(rad, h, 9); c.translate(0, y, 0); return c.toNonIndexed(); }); let n = 0; parts.forEach(p => n += p.attributes.position.count); const pos = new Float32Array(n * 3); let o = 0; parts.forEach(p => { pos.set(p.attributes.position.array, o); o += p.attributes.position.array.length; }); const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; })();
  const trees = [], dens = { pine: 1, snowpine: 0.7, cactus: 0.25 }[P.treeKind] ?? 1;
  // line the trail: a dense wall of trees just off the riding line, so the run feels like a corridor
  for (let sv = 0; sv < track.total; sv += 2.2) for (const sd of [-1, 1]) {
    if (r() > 0.45 * dens) continue;
    const d = sd * (6 + r() ** 1.4 * 12), p = track.toWorld(sv + (r() - 0.5), d);
    if (track.trackDist(p.x, p.z) < 5.5) continue;
    trees.push([p.x, p.z, 0.6 + r() * 0.8]);
  }
  for (let i = 0; i < P.trees * 6 && trees.length < P.trees + 800 * dens; i++) { const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ); if (track.trackDist(x, z) < 5.5 || (track.farDist && track.farDist(x, z) > 65)) continue; trees.push([x, z, 0.7 + r() * 0.8]); }
  const trunks = new T.InstancedMesh(trunkG, new T.MeshStandardMaterial({ color: new T.Color(0x3b2a1e).convertSRGBToLinear(), roughness: 0.9 }), trees.length);
  const fol = new T.InstancedMesh(folG, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), trees.length);
  trees.forEach(([x, z, s], i) => { const y = track.h(x, z); q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28); trunks.setMatrixAt(i, mm.compose(new T.Vector3(x, y, z), q, new T.Vector3(s, (cactus ? 3.2 : 3.5) * s, s))); fol.setMatrixAt(i, mm.compose(new T.Vector3(x, y, z), q, new T.Vector3(s, s, s))); fol.setColorAt && fol.setColorAt(i, new T.Color().setHSL(P.fol[0] + r() * 0.04, P.fol[1], P.fol[2] + r() * 0.07).convertSRGBToLinear()); });
  if (cactus) trunks.material.color.set(0x4f6b3a).convertSRGBToLinear();
  trunks.castShadow = fol.castShadow = true; fol.receiveShadow = true; scene.add(trunks, fol);
  const bushG = new T.IcosahedronGeometry(1, 1), bushes = [];
  for (let sv = 0; sv < track.total; sv += 1.6) for (const sd of [-1, 1]) {      // low undergrowth along the trail edge
    if (r() > 0.5) continue;
    const p = track.toWorld(sv + (r() - 0.5), sd * (3.2 + r() * 5)); if (track.trackDist(p.x, p.z) < 3.1) continue;
    bushes.push([p.x, p.z, 0.25 + r() * 0.4]);
  }
  for (let i = 0; i < P.bushes * 3 && bushes.length < P.bushes + 900; i++) { const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ), d = track.trackDist(x, z); if (d < 2.9 || (d > 9 && r() < 0.6)) continue; bushes.push([x, z, 0.3 + r() * 0.6]); }
  const bm = new T.InstancedMesh(bushG, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), bushes.length);
  bushes.forEach(([x, z, s], i) => { bm.setMatrixAt(i, mm.compose(new T.Vector3(x, track.h(x, z) + s * 0.25, z), q, new T.Vector3(s * 1.3, s, s * 1.2))); bm.setColorAt && bm.setColorAt(i, new T.Color().setHSL(P.bush[0] + r() * 0.06, P.bush[1], P.bush[2] + r() * 0.08).convertSRGBToLinear()); });
  bm.castShadow = true; scene.add(bm);

  // sky, fog, lights
  const sky = new T.Color(P.sky); scene0.background = sky; scene0.fog = new T.Fog(sky, P.fog[0], P.fog[1]);
  scene.add(new T.HemisphereLight(P.hemi[0], P.hemi[1], 0.55));
  const sun = new T.DirectionalLight(P.sun, 2.1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 120 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // trees right next to the camera (it swings wide in tight, tree-lined turns) are tucked away so the view stays clear
  const hidden = new Set(), zero = new T.Matrix4().makeScale(0, 0, 0), tmpM = new T.Matrix4();
  const clearView = (c) => {
    let dirty = false;
    trees.forEach(([x, z, s], i) => {
      const near = (x - c.x) ** 2 + (z - c.z) ** 2 < (2.6 * s + 1.2) ** 2;
      if (near && !hidden.has(i)) { hidden.add(i); trunks.setMatrixAt(i, zero); fol.setMatrixAt(i, zero); dirty = true; }
      else if (!near && hidden.has(i)) { hidden.delete(i); const y = track.h(x, z); trunks.setMatrixAt(i, tmpM.compose(new T.Vector3(x, y, z), new T.Quaternion(), new T.Vector3(s, (cactus ? 3.2 : 3.5) * s, s))); fol.setMatrixAt(i, tmpM.compose(new T.Vector3(x, y, z), new T.Quaternion(), new T.Vector3(s, s, s))); dirty = true; }
    });
    if (dirty) { trunks.instanceMatrix.needsUpdate = true; fol.instanceMatrix.needsUpdate = true; }
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
