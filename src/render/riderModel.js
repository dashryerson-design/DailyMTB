// Rider visual. A set of named attachment slots (one per bone) is placed every frame from the 17 joint
// positions produced by the procedural pose (or the ragdoll after a crash). Gear is modular: each
// component (helmet, jersey, pants, protection, gloves, shoes, body) is built by its own function into
// those slots and can be swapped independently with setComponent(). Slot frame: X = front, Y = along
// the bone (from its first joint), Z = right; the origin sits on the first joint.
import { J, SEG } from '../physics/rider.js';
import { DEFAULT_OUTFIT } from './rider/outfit.js';
const T = window.THREE;

const SLOTS = ['pelvis', 'belly', 'chest', 'neck', 'head', ...['shoulder', 'upper', 'elbow', 'fore', 'hand', 'thigh', 'knee', 'shin', 'foot'].flatMap((n) => [n + 'L', n + 'R'])];
// nominal bone lengths: a slot is stretched along Y by actual/nominal so gear stays attached at both ends
const NOMINAL = { belly: SEG.lumbar, chest: SEG.thorax, neck: SEG.neck, upper: SEG.upper, fore: SEG.fore, thigh: SEG.thigh, shin: SEG.shin };

const Xv = new T.Vector3(), Yv = new T.Vector3(), Zv = new T.Vector3(), Mb = new T.Matrix4(), tA = new T.Vector3(), tB = new T.Vector3();
// place slot o at a, Y toward b, X toward hint (made perpendicular), optional Y stretch to match a nominal length
function place(o, a, b, hint, nominal) {
  Yv.subVectors(b, a); const L = Yv.length() || 1; Yv.multiplyScalar(1 / L);
  Xv.copy(hint).addScaledVector(Yv, -hint.dot(Yv)); if (Xv.lengthSq() < 1e-8) Xv.set(0, 1, 0).addScaledVector(Yv, -Yv.y); Xv.normalize();
  Zv.crossVectors(Xv, Yv); Mb.makeBasis(Xv, Yv, Zv); o.quaternion.setFromRotationMatrix(Mb); o.position.copy(a);
  o.scale.set(1, nominal ? L / nominal : 1, 1);
}

export class RiderModel {
  constructor(scene, outfit = DEFAULT_OUTFIT) {
    this.group = new T.Group(); scene.add(this.group);
    this.slots = {}; for (const n of SLOTS) { const g = new T.Group(); g.name = n; this.slots[n] = g; this.group.add(g); }
    this.parts = {}; this.opts = {};
    for (const [k, f] of Object.entries(outfit)) this.setComponent(k, f);
    this.v = Array.from({ length: 17 }, () => new T.Vector3());
  }
  // swap one gear component (e.g. setComponent('helmet', openFaceHelmet, { shell: 0x222222 }))
  setComponent(kind, build, opts = this.opts[kind] || {}) {
    for (const m of this.parts[kind] || []) { m.parent && m.parent.remove(m); m.traverse((o) => o.geometry && o.geometry.dispose()); }
    this.opts[kind] = opts; this.parts[kind] = build ? build(this.slots, opts) : [];
  }

  update(rider) {
    const v = this.v; rider.x.forEach((p, i) => v[i].set(p.x, p.y, p.z));
    const S = this.slots;
    const hipM = new T.Vector3().addVectors(v[J.hipL], v[J.hipR]).multiplyScalar(0.5);
    const side = new T.Vector3().subVectors(v[J.hipR], v[J.hipL]).normalize();
    const up = new T.Vector3().subVectors(v[J.spine], hipM).normalize();
    const fwd = new T.Vector3().crossVectors(up, side).normalize();                     // body's facing (works for the ragdoll too)
    const shSide = new T.Vector3().subVectors(v[J.shR], v[J.shL]).normalize();
    const chestUp = new T.Vector3().subVectors(v[J.neck], v[J.spine]).normalize();
    const chestFwd = new T.Vector3().crossVectors(chestUp, shSide).normalize();
    place(S.pelvis, hipM, tA.copy(hipM).add(up), fwd);
    place(S.belly, hipM, v[J.spine], fwd, NOMINAL.belly);
    place(S.chest, v[J.spine], v[J.neck], chestFwd, NOMINAL.chest);
    const headUp = new T.Vector3().subVectors(v[J.head], v[J.neck]).normalize();
    place(S.neck, v[J.neck], v[J.head], chestFwd);
    place(S.head, v[J.head], tA.copy(v[J.head]).add(headUp), chestFwd);
    for (const s of ['L', 'R']) {
      const hp = v[J['hip' + s]], kn = v[J['knee' + s]], an = v[J['ank' + s]], to = v[J['toe' + s]], sh = v[J['sh' + s]], el = v[J['elb' + s]], hd = v[J['hand' + s]];
      // knee / elbow point outward from the limb's bend (the side the cap or pad sits on)
      const kneeOut = tA.addVectors(hp, an).multiplyScalar(0.5); kneeOut.subVectors(kn, kneeOut); if (kneeOut.lengthSq() < 1e-6) kneeOut.copy(fwd); kneeOut.normalize();
      const kO = kneeOut.clone();
      place(S['thigh' + s], hp, kn, kO, NOMINAL.thigh);
      place(S['shin' + s], kn, an, kO, NOMINAL.shin);
      place(S['knee' + s], kn, an, kO);
      const footUp = tB.subVectors(kn, an).normalize().clone();
      place(S['foot' + s], an, to, footUp);
      const elOut = tA.addVectors(sh, hd).multiplyScalar(0.5); elOut.subVectors(el, elOut); if (elOut.lengthSq() < 1e-6) elOut.copy(up).negate(); elOut.normalize();
      const eO = elOut.clone();
      place(S['shoulder' + s], sh, el, chestFwd);
      place(S['upper' + s], sh, el, eO.clone().negate(), NOMINAL.upper);
      place(S['elbow' + s], el, hd, eO);
      place(S['fore' + s], el, hd, chestUp, NOMINAL.fore);
      place(S['hand' + s], hd, tB.copy(hd).add(tA.subVectors(hd, el).normalize()), chestUp);
    }
  }
}
