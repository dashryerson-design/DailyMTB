// Stylised blocky rider: one rounded-box mesh per body segment, each placed every frame from the
// simulated joint positions (no skinning, no animation - what you see is the physics state).
import { J } from '../physics/rider.js';
const T = window.THREE;

function roundedBox(w, h, d, r, seg = 3) {
  const g = new T.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, v = new T.Vector3(), inner = new T.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    v.sub(inner); if (v.lengthSq() > 1e-12) v.setLength(r); v.add(inner); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}
const mat = (hex, rough = 0.7, metal = 0) => { const m = new T.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }); m.color.convertSRGBToLinear(); return m; };
const C = {
  jersey: mat(0x1f3b73, 0.8), accent: mat(0xf26b1d, 0.6), pants: mat(0x2b2e33, 0.85), pad: mat(0x151617, 0.5),
  helmet: mat(0xeef0f2, 0.3, 0.1), goggle: mat(0x0d0d0e, 0.15, 0.6), lens: mat(0xd88a2a, 0.1, 0.8), glove: mat(0x18191b, 0.7), shoe: mat(0x3a3d42, 0.75), sole: mat(0x111111, 0.9),
};

const X = new T.Vector3(), Yv = new T.Vector3(), Z = new T.Vector3(), M = new T.Matrix4(), tmp = new T.Vector3();
// orient an object: local Y along a->b, local Z toward `side`, centred between a and b (+ offset along Y)
function orient(o, a, b, side, along = 0) {
  Yv.subVectors(b, a); const L = Yv.length(); Yv.multiplyScalar(1 / (L || 1));
  Z.copy(side).addScaledVector(Yv, -side.dot(Yv)); if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1); Z.normalize();
  X.crossVectors(Yv, Z).normalize(); M.makeBasis(X, Yv, Z);
  o.quaternion.setFromRotationMatrix(M);
  o.position.copy(a).addScaledVector(Yv, L / 2 + along);
}

export class RiderModel {
  constructor(scene) {
    const g = this.group = new T.Group(); scene.add(g);
    const part = (geo, m) => { const o = new T.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    const grp = () => { const o = new T.Group(); g.add(o); return o; };
    const P = this.p = {};
    // torso
    P.pelvis = part(roundedBox(0.22, 0.17, 0.34, 0.05), C.pants);
    P.belly = part(roundedBox(0.2, 0.27, 0.3, 0.06), C.jersey);
    P.chest = grp();
    const ch = new T.Mesh(roundedBox(0.24, 0.34, 0.4, 0.07), C.jersey); ch.castShadow = true; P.chest.add(ch);
    const stripe = new T.Mesh(roundedBox(0.245, 0.06, 0.405, 0.02), C.accent); stripe.position.y = 0.05; P.chest.add(stripe);
    const num = new T.Mesh(roundedBox(0.01, 0.12, 0.12, 0.004), C.helmet); num.position.set(-0.122, 0.0, 0); P.chest.add(num);
    P.neck = part(roundedBox(0.08, 0.1, 0.09, 0.03), C.pants);
    // head + full-face helmet + goggles
    P.head = grp();
    const add = (o, x, y, z) => { o.position.set(x, y, z); o.castShadow = true; P.head.add(o); return o; };
    add(new T.Mesh(roundedBox(0.28, 0.27, 0.25, 0.09), C.helmet), 0, 0, 0);
    add(new T.Mesh(roundedBox(0.1, 0.11, 0.2, 0.04), C.helmet), 0.13, -0.11, 0);                 // chin bar
    add(new T.Mesh(roundedBox(0.04, 0.05, 0.12, 0.015), C.goggle), 0.18, -0.11, 0);                // vent
    add(new T.Mesh(roundedBox(0.08, 0.025, 0.22, 0.01), C.accent), 0.15, 0.1, 0).rotation.z = -0.25; // peak
    add(new T.Mesh(roundedBox(0.05, 0.065, 0.2, 0.02), C.goggle), 0.14, 0.0, 0);
    add(new T.Mesh(roundedBox(0.012, 0.045, 0.17, 0.008), C.lens), 0.166, 0.0, 0);
    add(new T.Mesh(roundedBox(0.2, 0.03, 0.258, 0.012), C.accent), -0.04, 0.0, 0);                 // goggle strap / stripe
    // limbs
    for (const s of ['L', 'R']) {
      P['thigh' + s] = part(roundedBox(0.15, 0.47, 0.15, 0.05), C.pants);
      P['shin' + s] = part(roundedBox(0.115, 0.46, 0.115, 0.04), C.pants);
      P['knee' + s] = grp();
      const kp = new T.Mesh(roundedBox(0.07, 0.17, 0.13, 0.03), C.pad); kp.position.x = 0.07; kp.castShadow = true; P['knee' + s].add(kp);
      const ks = new T.Mesh(roundedBox(0.072, 0.03, 0.132, 0.01), C.accent); ks.position.set(0.072, 0.03, 0); P['knee' + s].add(ks);
      P['foot' + s] = grp();
      const sh = new T.Mesh(roundedBox(0.1, 0.25, 0.105, 0.035), C.shoe); sh.castShadow = true; P['foot' + s].add(sh);
      const so = new T.Mesh(roundedBox(0.025, 0.26, 0.11, 0.01), C.sole); so.position.x = -0.05; P['foot' + s].add(so);
      P['upper' + s] = part(roundedBox(0.1, 0.34, 0.1, 0.035), C.jersey);
      P['fore' + s] = part(roundedBox(0.085, 0.33, 0.085, 0.03), C.jersey);
      P['cuff' + s] = part(roundedBox(0.095, 0.05, 0.095, 0.02), C.accent);
      P['hand' + s] = part(roundedBox(0.075, 0.11, 0.095, 0.03), C.glove);
      P['pad' + s] = part(roundedBox(0.13, 0.11, 0.13, 0.045), C.accent);
    }
    this.v = Array.from({ length: 17 }, () => new T.Vector3());
  }

  update(rider, bike) {
    const v = this.v; rider.x.forEach((p, i) => v[i].set(p.x, p.y, p.z));
    const P = this.p, side = new T.Vector3().subVectors(v[J.hipR], v[J.hipL]).normalize();
    const shSide = new T.Vector3().subVectors(v[J.shR], v[J.shL]).normalize();
    const hipM = new T.Vector3().addVectors(v[J.hipL], v[J.hipR]).multiplyScalar(0.5);
    const up = new T.Vector3().subVectors(v[J.spine], hipM).normalize();
    // pelvis: Y = up the spine, Z = across the hips
    orient(P.pelvis, hipM, tmp.copy(hipM).addScaledVector(up, 0.001), side); P.pelvis.position.copy(hipM).addScaledVector(up, 0.02);
    orient(P.belly, hipM, v[J.spine], side, 0.02);
    orient(P.chest, v[J.spine], v[J.neck], shSide, 0.0);
    orient(P.neck, v[J.neck], v[J.head], shSide, -0.06);
    orient(P.head, v[J.neck], v[J.head], shSide); P.head.position.copy(v[J.head]);
    // the helmet's forward (local +X) should face where the chest faces
    for (const [s, hp, kn, an, to, sh, el, hd] of [['L', J.hipL, J.kneeL, J.ankL, J.toeL, J.shL, J.elbL, J.handL], ['R', J.hipR, J.kneeR, J.ankR, J.toeR, J.shR, J.elbR, J.handR]]) {
      orient(P['thigh' + s], v[hp], v[kn], side);
      orient(P['shin' + s], v[kn], v[an], side);
      orient(P['knee' + s], v[kn], v[an], side); P['knee' + s].position.copy(v[kn]);
      // shoe: lies along ankle->toe, sole down (toward the pedal)
      const footUp = new T.Vector3().subVectors(v[kn], v[an]).normalize();
      orient(P['foot' + s], v[an], v[to], footUp); P['foot' + s].rotateY(Math.PI / 2); P['foot' + s].position.copy(v[an]).lerp(v[to], 0.45).addScaledVector(footUp, -0.01);
      orient(P['upper' + s], v[sh], v[el], side);
      orient(P['fore' + s], v[el], v[hd], side);
      orient(P['cuff' + s], v[el], v[hd], side, 0.13);
      const fd = new T.Vector3().subVectors(v[hd], v[el]).normalize();
      orient(P['hand' + s], v[hd], tmp.copy(v[hd]).addScaledVector(fd, 0.05), side); P['hand' + s].position.copy(v[hd]).addScaledVector(fd, 0.01);
      orient(P['pad' + s], v[sh], v[el], side); P['pad' + s].position.copy(v[sh]).addScaledVector(up, 0.01);
    }
  }
}
