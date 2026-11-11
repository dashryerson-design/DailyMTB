// Full-face downhill MTB helmet (built in the head slot: origin = centre of the head, X = face direction,
// Y = up, Z = right). Layered: glossy shell with graphics and rubber edge trim, EPS liner showing at the
// openings, integrated chin bar with vent grille, adjustable peaked visor on side screws, vents across
// the shell, goggles with mirrored lens + strap, cheek-pad release tabs.
import { tube, paint, solid, mats, mesh, mix, hex, nz } from './kit.js';
const T = window.THREE;

// keep only the triangles whose centroid passes keep(x, y, z) (on the unit sphere)
function carve(g, keep) {
  const p = g.attributes.position, idx = g.index.array, out = [];
  for (let i = 0; i < idx.length; i += 3) {
    let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 3; k++) { cx += p.getX(idx[i + k]); cy += p.getY(idx[i + k]); cz += p.getZ(idx[i + k]); }
    if (keep(cx / 3, cy / 3, cz / 3)) out.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(out); return g;
}
// unit-sphere direction -> helmet shell surface (the shell's shape lives here so vents/trims sit on it)
const SX = 0.152, SY = 0.146, SZ = 0.13;
function shellPoint(x, y, z, k = 1) {
  const taper = 1 - 0.1 * Math.max(0, x);                     // narrower at the front
  let px = x * SX, py = y * SY + 0.012, pz = z * SZ * taper;
  if (x < 0) { px *= 1 + 0.08 * Math.max(0, -y * 0.3 + 0.2); }   // fuller rear
  if (x < 0 && y < 0) py -= 0.035 * (-x) * (-y);                   // rear drops low over the neck
  if (x > 0.2 && y < -0.3) { const k = Math.min(1, (x - 0.2) / 0.5) * Math.min(1, (-0.3 - y) / 0.3); px += 0.036 * k; py -= 0.012 * k; }   // chin bar juts forward
  if (y > 0.2) py += 0.006 * (y - 0.2) * (1 - Math.abs(z));         // subtle top ridge
  return [px * k, py * k, pz * k];
}
// openings: face port (eyes) and the neck. The chin bar is a separate part.
const isPort = (x, y, z) => x > 0.32 && y > -0.36 && y < 0.3 && Math.abs(z) < 0.74;   // eye port only: cheeks + jaw stay covered
const isOpen = (x, y, z) => isPort(x, y, z) || y < -0.86 + 0.22 * Math.max(0, -x) - 0.1 * Math.max(0, x);   // + neck opening

export function fullFaceHelmet(o = {}) {
  const C = { shell: hex(o.shell ?? 0xf2f3f5), accent: hex(o.accent ?? 0xf26b1d), dark: hex(o.dark ?? 0x1c1e22), trim: hex(0x0f1012), liner: hex(0x2a2c30), visor: hex(o.visor ?? 0x1c1e22), lens: hex(o.lens ?? 0xe0902a), strap: hex(o.strap ?? 0xf26b1d) };
  const M = mats(), g = new T.Group();
  // ---- shell (outer) with graphics: centre stripe, side swoosh, dark rubber trim along every edge
  const sh = carve(new T.SphereGeometry(1, 60, 44), (x, y, z) => !isOpen(x, y, z));
  const sp = sh.attributes.position, unit = new Float32Array(sp.array);
  for (let i = 0; i < sp.count; i++) sp.setXYZ(i, ...shellPoint(sp.getX(i), sp.getY(i), sp.getZ(i)));
  sh.computeVertexNormals();
  const edgeDist = (x, y, z) => {   // ~0 at an opening edge
    let d = 1; for (const [dx, dy, dz] of [[0.08, 0, 0], [-0.08, 0, 0], [0, 0.08, 0], [0, -0.08, 0], [0, 0, 0.08], [0, 0, -0.08]]) if (isOpen(x + dx, y + dy, z + dz)) d = Math.min(d, 0.5); return d;
  };
  paint(sh, (px, py, pz) => {
    const i = sh._i = (sh._i ?? -1) + 1, x = unit[i * 3], y = unit[i * 3 + 1], z = unit[i * 3 + 2];
    if (edgeDist(x, y, z) < 1) return C.trim;                                              // rubber edge trim
    if (Math.abs(z) < 0.11 && y > -0.2) return Math.abs(z) < 0.035 ? C.dark : C.accent;   // centre stripe with a pinline
    const sw = y - (-0.15 + 0.35 * x);                                                     // side swoosh sweeping back
    if (Math.abs(z) > 0.55 && sw > -0.09 && sw < 0.05 && x > -0.75) return sw > 0.02 ? C.dark : C.accent;
    if (x > 0.45 && y < -0.38) return Math.abs(z) < 0.12 ? C.dark : y < -0.7 ? C.trim : C.shell;   // chin bar face
    if (y < -0.42) return C.dark;                                                           // lower shell section
    return mix(C.shell, [1, 1, 1], 0.05 * nz(x * 4, y * 4));
  });
  mesh(sh, M.shell, g);
  // ---- EPS liner just inside (seen at the openings: gives the shell real thickness)
  const ln = carve(new T.SphereGeometry(1, 30, 20), (x, y, z) => !isOpen(x, y, z));
  const lp = ln.attributes.position; for (let i = 0; i < lp.count; i++) lp.setXYZ(i, ...shellPoint(lp.getX(i), lp.getY(i), lp.getZ(i), 0.88));
  ln.computeVertexNormals(); mesh(solid(ln, C.liner), M.foam, g, false);
  // chin vent grille: three horizontal slots across the front of the bar + mesh behind
  for (let k = 0; k < 3; k++) { const v = new T.Mesh(solid(new T.BoxGeometry(0.012, 0.008, 0.05 - k * 0.008), C.trim), M.plastic); v.position.set(0.158 - k * 0.004, -0.07 - k * 0.015, 0); g.add(v); }
  for (const s of [-1, 1]) { const v = new T.Mesh(solid(new T.BoxGeometry(0.01, 0.03, 0.012), C.trim), M.plastic); v.position.set(0.14, -0.08, s * 0.06); v.rotation.y = s * 0.45; g.add(v); }
  // ---- vents: dark recessed slots set into the shell, oriented along its surface
  const vents = [[0.5, 0.62, 0.22, 0.034], [0.5, 0.62, -0.22, 0.034], [0.25, 0.85, 0.12, 0.04], [0.25, 0.85, -0.12, 0.04], [-0.1, 0.95, 0.25, 0.036], [-0.1, 0.95, -0.25, 0.036],
    [-0.7, 0.45, 0.2, 0.03], [-0.7, 0.45, -0.2, 0.03], [-0.85, 0.1, 0, 0.028], [0.2, 0.35, 0.85, 0.026], [0.2, 0.35, -0.85, 0.026], [0.72, 0.42, 0, 0.03]];
  const ventG = solid(new T.BoxGeometry(1, 0.009, 0.013), C.trim);
  for (const [x, y, z, len] of vents) {
    const d = new T.Vector3(x, y, z).normalize(), p = new T.Vector3(...shellPoint(d.x, d.y, d.z, 1.002)), n = new T.Vector3(...shellPoint(d.x, d.y, d.z, 1.05)).sub(p).normalize();
    const along = new T.Vector3(-1, 0, 0).addScaledVector(n, n.x).normalize(), side = new T.Vector3().crossVectors(along, n);
    const v = new T.Mesh(ventG, M.plastic); v.scale.set(len, 1, 1); v.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(along, n, side)); v.position.copy(p).addScaledVector(n, -0.002); g.add(v);
  }
  // ---- visor: a curved peak with a slight upturn and thickened edge, on two side screws
  const VU = 14, VV = 4, vpos = [], vidx = [];
  for (let j = 0; j <= VV; j++) for (let i = 0; i <= VU; i++) {
    const u = i / VU * 2 - 1, v = j / VV, a = u * 1.0, reach = (0.085 * (0.45 + 0.55 * (1 - u * u))) * v;
    const bx = Math.cos(a) * SX * 0.99, bz = Math.sin(a) * SZ * 0.96, by = 0.075 + 0.016 * (1 - u * u);
    vpos.push(bx + Math.cos(a) * reach, by + 0.02 * v + 0.018 * v * v, bz + Math.sin(a) * reach * 0.6);
  }
  for (let j = 0; j < VV; j++) for (let i = 0; i < VU; i++) { const a = j * (VU + 1) + i, b = a + 1, c = a + VU + 1, d = c + 1; vidx.push(a, b, c, b, d, c); }
  const vg = new T.BufferGeometry(); vg.setAttribute('position', new T.Float32BufferAttribute(vpos, 3)); vg.setIndex(vidx); vg.computeVertexNormals();
  paint(vg, (x, y, z) => (Math.abs(z) < 0.03 ? C.accent : C.visor));
  const vm = M.plastic.clone(); vm.side = T.DoubleSide; mesh(vg, vm, g);
  const edge = []; for (let i = 0; i <= VU; i++) edge.push(new T.Vector3(vpos[(VV * (VU + 1) + i) * 3], vpos[(VV * (VU + 1) + i) * 3 + 1], vpos[(VV * (VU + 1) + i) * 3 + 2]));
  mesh(solid(new T.TubeGeometry(new T.CatmullRomCurve3(edge), 24, 0.0035, 5), C.visor), M.plastic, g);
  for (const s of [-1, 1]) {   // visor screws + washers
    const sc = new T.Mesh(solid(new T.CylinderGeometry(0.009, 0.009, 0.006, 10), hex(0x8a8f96)), M.metal); sc.rotation.x = Math.PI / 2; sc.position.set(Math.cos(1.0) * SX * 1.0, 0.083, s * Math.sin(1.0) * SZ * 1.02); g.add(sc);
  }
  // ---- face (just visible through the eye port) and goggles with mirrored lens + strap
  const face = new T.Mesh(solid(new T.SphereGeometry(0.08, 16, 12), hex(0xb88a70)), M.skin); face.scale.set(1, 1.1, 0.85); face.position.set(0.005, -0.015, 0); g.add(face);
  const frame = new T.CylinderGeometry(0.128, 0.128, 0.056, 22, 1, true, Math.PI / 2 - 0.95, 1.9); frame.scale(1, 1, 1);
  const fr = new T.Mesh(solid(frame, C.trim), M.plastic.clone()); fr.material.side = T.DoubleSide; fr.position.y = 0.012; g.add(fr);
  const lens = new T.CylinderGeometry(0.131, 0.131, 0.042, 22, 1, true, Math.PI / 2 - 0.8, 1.6);
  const le = new T.Mesh(paint(lens, (x, y) => mix(C.lens, [0.95, 0.4, 0.15], 0.5 + y * 10)), M.lens); le.position.y = 0.012; g.add(le);
  const strap = new T.CylinderGeometry(1, 1, 0.034, 30, 1, true, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9); strap.scale(SX * 1.035, 1, SZ * 1.05);
  mesh(paint(strap, (x, y, z) => (Math.abs(y) > 0.012 ? C.trim : Math.sin(z * 120) > 0.6 ? C.dark : C.strap)), M.fabric, g).position.y = 0.012;
  // cheek-pad emergency release tabs (red), a classic full-face detail
  for (const s of [-1, 1]) { const t = new T.Mesh(solid(new T.BoxGeometry(0.02, 0.012, 0.006), hex(0xd8261c)), M.plastic); t.position.set(0.035, -0.105, s * 0.133); g.add(t); }
  return g;
}
