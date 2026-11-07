// Visual bike + rider. Every moving part is driven from the physics state (no canned animation).
// Coordinates inside `bb` are the physics BB frame: x forward, y up, z right.
import * as G from '../physics/geometry.js';
import { COM } from '../physics/bike.js';
const T = window.THREE;
const Yv = new T.Vector3(0, 1, 0);
const v3 = (x, y, z = 0) => new T.Vector3(x, y, z);
const p3 = (a, z = 0) => v3(a[0], a[1], z);

const M = (o) => new T.MeshStandardMaterial(o);
export const MAT = {
  frame: M({ color: 0x17606a, metalness: 0.55, roughness: 0.3 }),
  frameAcc: M({ color: 0xd8dde0, metalness: 0.4, roughness: 0.35 }),
  black: M({ color: 0x141516, metalness: 0.25, roughness: 0.55 }),
  alloy: M({ color: 0xa4aab0, metalness: 0.95, roughness: 0.28 }),
  kashima: M({ color: 0xc9a14a, metalness: 1, roughness: 0.22 }),
  lowers: M({ color: 0x1b1b1d, metalness: 0.35, roughness: 0.45 }),
  rubber: M({ color: 0x1a1a1a, metalness: 0, roughness: 0.92 }),
  grip: M({ color: 0x262626, metalness: 0, roughness: 0.85 }),
  spring: M({ color: 0xe8661c, metalness: 0.45, roughness: 0.38 }),
  shock: M({ color: 0x2a2c2f, metalness: 0.7, roughness: 0.3 }),
  shaft: M({ color: 0xdadada, metalness: 1, roughness: 0.12 }),
  rotor: M({ color: 0xbfc3c7, metalness: 1, roughness: 0.22, side: T.DoubleSide }),
  chain: M({ color: 0x8a8a8a, metalness: 0.9, roughness: 0.35 }),
  bolt: M({ color: 0x6e7378, metalness: 1, roughness: 0.3 }),
  gold: M({ color: 0xd4a017, metalness: 1, roughness: 0.3 }),
  hose: M({ color: 0x101010, metalness: 0.1, roughness: 0.6 }),
  jersey: M({ color: 0x24427a, roughness: 0.8 }),
  pants: M({ color: 0x2b2d31, roughness: 0.85 }),
  skin: M({ color: 0xc89a7a, roughness: 0.7 }),
  helmet: M({ color: 0xe9eaec, metalness: 0.2, roughness: 0.35 }),
  visor: M({ color: 0x0c0c0c, metalness: 0.6, roughness: 0.2 }),
  shoe: M({ color: 0x1c1c1c, roughness: 0.8 }),
};

// author colours in sRGB, render in linear
Object.values(MAT).forEach(m => m.color.convertSRGBToLinear());

function mesh(g, m) { const o = new T.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; }
const UNIT_CYL = {};
function cyl(r, mat, seg = 12) { const k = r + ':' + seg; UNIT_CYL[k] = UNIT_CYL[k] || new T.CylinderGeometry(r, r, 1, seg); return mesh(UNIT_CYL[k], mat); }
export function place(o, a, b) {
  const d = b.clone().sub(a), L = d.length();
  o.position.copy(a).addScaledVector(d, 0.5); o.scale.set(1, L || 1e-4, 1);
  if (L > 1e-6) o.quaternion.setFromUnitVectors(Yv, d.multiplyScalar(1 / L));
  return o;
}
const tube = (a, b, r, mat, seg) => place(cyl(r, mat, seg), a, b);
function bolt(pos, len = 0.13, r = 0.009) {
  const g = new T.Group(); g.position.copy(pos);
  const s = mesh(new T.CylinderGeometry(r, r, len, 10), MAT.alloy); s.rotation.x = Math.PI / 2; g.add(s);
  for (const z of [-len / 2, len / 2]) { const h = mesh(new T.CylinderGeometry(r * 1.6, r * 1.6, 0.008, 6), MAT.bolt); h.rotation.x = Math.PI / 2; h.position.z = z; g.add(h); }
  return g;
}
function merge(list) {
  let n = 0; const parts = list.map(g => g.index ? g.toNonIndexed() : g); parts.forEach(p => n += p.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); return g;
}
const xf = (g, pos, quat, scl) => g.applyMatrix4(new T.Matrix4().compose(pos, quat || new T.Quaternion(), scl || v3(1, 1, 1)));
function gear(teeth, r, depth) {
  const s = new T.Shape(), n = teeth * 4;
  for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, rr = (i % 4 < 2) ? r + 0.003 : r - 0.002; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const hole = new T.Path(); hole.absarc(0, 0, r * 0.62, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 }); g.translate(0, 0, -depth / 2); return g;
}

function wheel(rotorR, side) {
  const g = new T.Group(), R = G.R_WHEEL;
  const tyre = mesh(new T.TorusGeometry(R - 0.036, 0.036, 14, 80), MAT.rubber); g.add(tyre);
  const knobs = [], q = new T.Quaternion();
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2;
    for (const [tz, off] of [[-0.028, 0], [0, 0.5], [0.028, 0]]) {
      const ang = a + off * Math.PI * 2 / 72, rr = R - 0.036 + Math.sqrt(Math.max(0, 0.037 ** 2 - tz * tz)) + 0.003;
      q.setFromAxisAngle(v3(0, 0, 1), ang);
      knobs.push(xf(new T.BoxGeometry(0.006, 0.014, tz ? 0.012 : 0.018), v3(Math.cos(ang) * rr, Math.sin(ang) * rr, tz), q));
    }
  }
  g.add(mesh(merge(knobs), MAT.rubber));
  g.add(mesh(new T.TorusGeometry(R - 0.068, 0.012, 8, 64), MAT.black));
  const hub = mesh(new T.CylinderGeometry(0.022, 0.022, 0.12, 16), MAT.black); hub.rotation.x = Math.PI / 2; g.add(hub);
  const spokes = [];
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * Math.PI * 2, zs = i % 2 ? 0.03 : -0.03, ha = a + (i % 4 < 2 ? 0.4 : -0.4);
    const A = v3(Math.cos(ha) * 0.03, Math.sin(ha) * 0.03, zs), B = v3(Math.cos(a) * (R - 0.078), Math.sin(a) * (R - 0.078), 0);
    const d = B.clone().sub(A), L = d.length(), qq = new T.Quaternion().setFromUnitVectors(Yv, d.clone().normalize());
    spokes.push(xf(new T.CylinderGeometry(0.0016, 0.0016, L, 4), A.clone().addScaledVector(d, 0.5), qq));
  }
  g.add(mesh(merge(spokes), MAT.alloy));
  const rotor = mesh(new T.RingGeometry(rotorR - 0.022, rotorR, 48), MAT.rotor); rotor.position.z = side * 0.062; g.add(rotor);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, arm = mesh(new T.BoxGeometry(rotorR - 0.04, 0.012, 0.003), MAT.alloy); arm.position.set(Math.cos(a) * (rotorR / 2 + 0.005), Math.sin(a) * (rotorR / 2 + 0.005), side * 0.062); arm.rotation.z = a; g.add(arm); }
  return g;
}

function helix(radius, turns, wire) {
  class H extends T.Curve { getPoint(t) { const a = t * turns * Math.PI * 2; return v3(Math.cos(a) * radius, t, Math.sin(a) * radius); } }
  return new T.TubeGeometry(new H(), turns * 24, wire, 6, false);
}

export class BikeModel {
  constructor(scene) {
    const root = this.root = new T.Group(); scene.add(root);
    const bb = this.bb = new T.Group(); bb.position.set(-COM[0], -COM[1], 0); root.add(bb);
    const F = new T.Group(); bb.add(F);
    const L = G.LINK;
    // ---- main frame
    F.add(tube(v3(0, 0), p3(G.HT_BOT).add(v3(0.004, 0.01)), 0.031, MAT.frame));
    F.add(tube(p3(G.TT_JOIN), p3(G.HT_TOP).add(v3(0.005, -0.02)), 0.022, MAT.frame));
    F.add(tube(v3(0, 0.03), p3(G.SEAT_TOP), 0.02, MAT.frame));
    F.add(tube(p3(G.HT_BOT).addScaledVector(p3(G.DF), -0.01), p3(G.HT_TOP).addScaledVector(p3(G.DF), 0.008), 0.034, MAT.frame));
    F.add(tube(v3(0.075, 0.067), p3(G.ROCKER_P), 0.016, MAT.frame));
    F.add(tube(v3(-0.105, 0.33), p3(L.D), 0.012, MAT.frame));
    F.add(tube(v3(0.03, 0.02), p3(G.PIVOT), 0.022, MAT.frame));
    const bbs = mesh(new T.CylinderGeometry(0.024, 0.024, 0.092, 16), MAT.frame); bbs.rotation.x = Math.PI / 2; F.add(bbs);
    for (const z of [-1, 1]) F.add(tube(v3(-0.11, 0.34, 0), v3(-0.104, 0.33, z * 0.02), 0.006, MAT.frame));
    F.add(bolt(p3(G.PIVOT), 0.15, 0.011)); F.add(bolt(p3(G.ROCKER_P), 0.1)); F.add(bolt(p3(L.D), 0.06, 0.007));
    // seat post / dropper
    const stDir = p3(G.SEAT_TOP).normalize();
    const postTop = p3(G.POST_TOP);
    F.add(tube(p3(G.SEAT_TOP).addScaledVector(stDir, -0.03), p3(G.SEAT_TOP).addScaledVector(stDir, 0.03), 0.019, MAT.black));
    F.add(tube(p3(G.SEAT_TOP), postTop, 0.0155, MAT.black));
    F.add(tube(p3(G.SEAT_TOP).addScaledVector(stDir, 0.025), p3(G.SEAT_TOP).addScaledVector(stDir, 0.045), 0.02, MAT.alloy));
    const ss = new T.Shape(); ss.moveTo(0.13, 0); ss.bezierCurveTo(0.13, 0.025, 0.02, 0.03, -0.02, 0.07); ss.bezierCurveTo(-0.1, 0.08, -0.13, 0.06, -0.13, 0); ss.bezierCurveTo(-0.13, -0.06, -0.1, -0.08, -0.02, -0.07); ss.bezierCurveTo(0.02, -0.03, 0.13, -0.025, 0.13, 0);
    const saddle = mesh(new T.ExtrudeGeometry(ss, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.01, bevelSegments: 3 }), MAT.black);
    saddle.rotation.x = Math.PI / 2; saddle.position.copy(postTop).add(v3(0, 0.045)); F.add(saddle);
    // rear brake hose + gear cable along the down tube (frame part)
    const hoseF = new T.CatmullRomCurve3([p3(G.HT_TOP).add(v3(0.06, 0.02, 0.03)), p3(G.HT_BOT).add(v3(-0.02, -0.03, 0.035)), v3(0.25, 0.17, 0.035), v3(0.05, -0.02, 0.035), p3(G.PIVOT).add(v3(-0.02, -0.03, -0.04))]);
    F.add(mesh(new T.TubeGeometry(hoseF, 40, 0.0035, 6), MAT.hose));

    // ---- rocker (rotates about R0)
    const RK = this.rocker = new T.Group(); RK.position.copy(p3(G.ROCKER_P)); F.add(RK);
    const rk = (pt) => p3(pt).sub(p3(G.ROCKER_P));
    for (const z of [-0.032, 0.032]) {
      RK.add(tube(rk(G.ROCKER_P).setZ(z), rk(G.ROCKER_K).setZ(z), 0.011, MAT.frameAcc)); RK.add(tube(rk(G.ROCKER_P).setZ(z), rk(L.S0).setZ(z), 0.012, MAT.frameAcc)); RK.add(tube(rk(G.ROCKER_K).setZ(z), rk(L.S0).setZ(z), 0.008, MAT.frameAcc));
    }
    RK.add(bolt(rk(G.ROCKER_K), 0.075, 0.007)); RK.add(bolt(rk(L.S0), 0.075, 0.007));
    // ---- link (L on swingarm -> K on rocker), placed each frame
    this.links = [-0.028, 0.028].map(z => { const o = cyl(0.009, MAT.frameAcc); o.userData.z = z; F.add(o); return o; });
    // ---- shock
    const SH = this.shock = new T.Group(); F.add(SH);
    const body = mesh(new T.CylinderGeometry(0.021, 0.021, 0.115, 16), MAT.shock); body.position.y = 0.0575; SH.add(body);
    const pig = mesh(new T.CylinderGeometry(0.014, 0.014, 0.075, 12), MAT.gold); pig.position.set(0, 0.07, 0.032); SH.add(pig);
    const col = mesh(new T.CylinderGeometry(0.034, 0.034, 0.006, 20), MAT.alloy); col.position.y = 0.03; SH.add(col);
    const eyeA = mesh(new T.TorusGeometry(0.012, 0.005, 6, 12), MAT.alloy); SH.add(eyeA);
    this.shaft = cyl(0.0075, MAT.shaft); SH.add(this.shaft);
    this.shaftCol = mesh(new T.CylinderGeometry(0.031, 0.031, 0.007, 20), MAT.alloy); SH.add(this.shaftCol);
    this.spring = mesh(helix(0.029, 8, 0.0042), MAT.spring); this.spring.position.y = 0.033; SH.add(this.spring);
    this.eyeB = mesh(new T.TorusGeometry(0.012, 0.005, 6, 12), MAT.alloy); SH.add(this.eyeB);

    // ---- swingarm (rotates about main pivot)
    const SW = this.swing = new T.Group(); bb.add(SW);
    const P = p3(G.PIVOT), A = p3(G.AXLE_R), B = p3(G.BRIDGE), Ls = p3(G.LINK_SA);
    for (const s of [-1, 1]) {
      SW.add(tube(P.clone().setZ(s * 0.045), A.clone().add(v3(0.03, 0.005)).setZ(s * 0.072), 0.017, MAT.frame));
      SW.add(tube(A.clone().add(v3(0.0, 0.02)).setZ(s * 0.072), B.clone().setZ(s * 0.042), 0.014, MAT.frame));
      SW.add(tube(B.clone().setZ(s * 0.042), Ls.clone().setZ(s * 0.03), 0.013, MAT.frame));
      SW.add(tube(P.clone().setZ(s * 0.04), Ls.clone().setZ(s * 0.03), 0.014, MAT.frame));
      const drop = mesh(new T.BoxGeometry(0.06, 0.05, 0.008), MAT.black); drop.position.copy(A).setZ(s * 0.075); SW.add(drop);
    }
    SW.add(tube(B.clone().setZ(-0.045), B.clone().setZ(0.045), 0.011, MAT.frame));
    SW.add(tube(v3(-0.2, 0.06, -0.06), v3(-0.2, 0.06, 0.06), 0.009, MAT.frame));
    SW.add(bolt(Ls, 0.09, 0.007));
    const ax = mesh(new T.CylinderGeometry(0.007, 0.007, 0.17, 8), MAT.alloy); ax.rotation.x = Math.PI / 2; ax.position.copy(A); SW.add(ax);
    // rear caliper (post mount on the left chainstay) + hose
    const rcal = mesh(new T.BoxGeometry(0.06, 0.03, 0.03), MAT.gold); rcal.position.copy(A).add(v3(0.06, 0.055, -0.065)); rcal.rotation.z = -0.7; SW.add(rcal);
    SW.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3([P.clone().add(v3(-0.02, -0.03, -0.045)), v3(-0.25, 0.045, -0.07), rcal.position.clone().add(v3(0.01, 0.01, 0))]), 20, 0.0035, 6), MAT.hose));
    // cassette + derailleur
    this.cassette = new T.Group(); this.cassette.position.copy(A); SW.add(this.cassette);
    G.COGS.forEach((n, i) => { const c = mesh(gear(n, G.cogR(n), 0.0022), MAT.alloy); c.position.z = 0.032 + i * 0.0042; this.cassette.add(c); });
    const pu = p3(G.PULLEY_U).add(A), pl = p3(G.PULLEY_L).add(A);
    for (const p of [pu, pl]) { const g = mesh(gear(12, 0.024, 0.005), MAT.black); g.position.copy(p).setZ(0.052); SW.add(g); }
    for (const z of [0.045, 0.059]) SW.add(tube(pu.clone().add(v3(-0.01, 0.015)).setZ(z), pl.clone().add(v3(0.0, -0.012)).setZ(z), 0.009, MAT.black));
    const der = mesh(new T.BoxGeometry(0.05, 0.03, 0.022), MAT.black); der.position.copy(A).add(v3(-0.01, -0.03, 0.085)); der.rotation.z = 0.6; SW.add(der);
    this.rearWheel = wheel(0.09, -1); this.rearWheel.position.copy(A); SW.add(this.rearWheel);

    // ---- steering assembly (rotates about the head-tube axis)
    const ST = this.steerG = new T.Group(); bb.add(ST);
    const C = p3(G.CROWN), df = p3(G.DF), nf = p3(G.NF), off = G.FORK.offset, hw = G.FORK.halfWidth;
    ST.add(tube(C, p3(G.HT_TOP).addScaledVector(df, 0.045), 0.0175, MAT.black));
    const crown = mesh(new T.BoxGeometry(0.06, 0.04, 2 * hw + 0.05), MAT.black); crown.position.copy(C).addScaledVector(nf, off * 0.6); crown.quaternion.setFromUnitVectors(Yv, df); ST.add(crown);
    const sTop = C.clone().addScaledVector(nf, off);
    for (const s of [-1, 1]) ST.add(tube(sTop.clone().setZ(s * hw), sTop.clone().addScaledVector(df, -G.FORK.stanchionLen).setZ(s * hw), 0.018, MAT.kashima, 16));
    const stemA = p3(G.HT_TOP).addScaledVector(df, 0.03), bar = stemA.clone().add(v3(0.05, 0.012));
    ST.add(tube(stemA, bar, 0.02, MAT.black));
    for (const s of [-1, 1]) {
      const a = bar.clone().setZ(s * 0.06), b = bar.clone().add(v3(-0.012, 0.03)).setZ(s * 0.16), c = bar.clone().add(v3(-0.03, 0.035)).setZ(s * 0.4);
      ST.add(tube(a, b, 0.0175, MAT.black)); ST.add(tube(b, c, 0.011, MAT.black));
      ST.add(tube(c.clone().setZ(s * 0.27), c.clone().setZ(s * 0.405), 0.017, MAT.grip));
      const mc = mesh(new T.BoxGeometry(0.04, 0.025, 0.03), MAT.black); mc.position.copy(c).setZ(s * 0.25); ST.add(mc);
      ST.add(tube(c.clone().setZ(s * 0.25).add(v3(0.01, 0)), c.clone().add(v3(0.075, -0.04)).setZ(s * 0.33), 0.005, MAT.alloy));
    }
    this.gripPts = [-1, 1].map(s => bar.clone().add(v3(-0.03, 0.035)).setZ(s * 0.34));
    ST.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3([bar.clone().add(v3(-0.03, 0.03, -0.25)), bar.clone().add(v3(0.08, -0.05, -0.12)), sTop.clone().add(v3(0.05, -0.02, -hw - 0.03))]), 20, 0.0035, 6), MAT.hose));
    // lowers slide on the stanchions (translated along the steer axis by fork travel)
    const LW = this.lowers = new T.Group(); ST.add(LW);
    const axE = C.clone().addScaledVector(df, -G.FORK.a2c).addScaledVector(nf, off);
    for (const s of [-1, 1]) {
      LW.add(tube(axE.clone().addScaledVector(df, -0.015).setZ(s * hw), axE.clone().addScaledVector(df, G.FORK.lowerLen).setZ(s * hw), 0.0235, MAT.lowers, 16));
      LW.add(tube(axE.clone().addScaledVector(df, G.FORK.lowerLen - 0.004).setZ(s * hw), axE.clone().addScaledVector(df, G.FORK.lowerLen + 0.012).setZ(s * hw), 0.0215, MAT.black, 16));
    }
    const archC = axE.clone().addScaledVector(df, 0.3).addScaledVector(nf, 0.03);
    LW.add(tube(archC.clone().setZ(-hw), archC.clone().addScaledVector(df, 0.03).setZ(0), 0.012, MAT.lowers));
    LW.add(tube(archC.clone().addScaledVector(df, 0.03).setZ(0), archC.clone().setZ(hw), 0.012, MAT.lowers));
    const fax = mesh(new T.CylinderGeometry(0.008, 0.008, 2 * hw + 0.03, 8), MAT.alloy); fax.rotation.x = Math.PI / 2; fax.position.copy(axE); LW.add(fax);
    const fcal = mesh(new T.BoxGeometry(0.065, 0.032, 0.03), MAT.gold); fcal.position.copy(axE).addScaledVector(df, 0.07).addScaledVector(nf, -0.07).setZ(-hw + 0.012); fcal.quaternion.setFromUnitVectors(Yv, df); LW.add(fcal);
    LW.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3([axE.clone().addScaledVector(df, G.FORK.lowerLen + 0.02).setZ(-hw - 0.03), axE.clone().addScaledVector(df, 0.2).addScaledVector(nf, -0.02).setZ(-hw - 0.03), fcal.position.clone()]), 16, 0.0035, 6), MAT.hose));
    this.frontWheel = wheel(0.1015, -1); this.frontWheel.position.copy(axE); LW.add(this.frontWheel);
    this.axE = axE;

    // ---- cranks / chainring / pedals
    const CR = this.cranks = new T.Group(); bb.add(CR);
    const ring = mesh(gear(G.RING_T, G.cogR(G.RING_T), 0.004), MAT.black); ring.position.z = 0.052; CR.add(ring);
    const sp = mesh(new T.CylinderGeometry(0.012, 0.012, 0.2, 8), MAT.alloy); sp.rotation.x = Math.PI / 2; CR.add(sp);
    this.pedals = [];
    for (const s of [-1, 1]) {
      const tip = v3(0, s * -0.165, s * 0.075);
      CR.add(tube(v3(0, 0, s * 0.06), tip, 0.013, MAT.black));
      const pg = new T.Group(); pg.position.copy(tip).setZ(s * 0.12); CR.add(pg);
      pg.add(mesh(new T.BoxGeometry(0.1, 0.017, 0.095), MAT.black));
      for (const px of [-0.045, 0.045]) for (const pz of [-0.04, 0.04]) { const pin = mesh(new T.CylinderGeometry(0.002, 0.002, 0.008, 4), MAT.alloy); pin.position.set(px, 0.012, pz); pg.add(pin); }
      this.pedals.push(pg);
    }
    // chain links (instanced, positioned along the live chain path each frame)
    this.nLinks = 120;
    this.chain = new T.InstancedMesh(new T.BoxGeometry(0.0118, 0.0055, 0.006), MAT.chain, this.nLinks); this.chain.castShadow = true; bb.add(this.chain);

    this._tmp = new T.Vector3();
  }

  update(b) {
    const L = G.LINK, th = b.th, k = L.kin(th);
    this.root.position.set(b.p.x, b.p.y, b.p.z); this.root.quaternion.set(b.q.x, b.q.y, b.q.z, b.q.w);
    // swingarm & rocker & link & shock from exact linkage kinematics
    const P = p3(G.PIVOT);
    this.swing.rotation.z = -th; this.swing.position.copy(P.clone().sub(P.clone().applyAxisAngle(v3(0, 0, 1), -th)));
    this.rocker.rotation.z = k.al;
    for (const o of this.links) place(o, p3(k.L, o.userData.z), p3(k.K, o.userData.z));
    const D = p3(L.D), S = p3(k.S), dir = S.clone().sub(D), len = dir.length();
    this.shock.position.copy(D); this.shock.quaternion.setFromUnitVectors(Yv, dir.multiplyScalar(1 / len));
    place(this.shaft, v3(0, len - 0.115), v3(0, len)); this.shaftCol.position.y = len - 0.016; this.eyeB.position.y = len;
    this.spring.scale.y = len - 0.016 - 0.033;
    // steering about the head tube axis, lowers slide up the stanchions
    const C = p3(G.CROWN), df = p3(G.DF);
    this.steerG.quaternion.setFromAxisAngle(df, -b.steer);
    this.steerG.position.copy(C.clone().sub(C.clone().applyQuaternion(this.steerG.quaternion)));
    this.lowers.position.copy(df.clone().multiplyScalar(b.sF));
    // wheels, cranks, cassette
    this.frontWheel.rotation.z = -b.wheelAngF; this.rearWheel.rotation.z = -b.wheelAngR;
    this.cranks.rotation.z = -b.crank; this.pedals.forEach(p => p.rotation.z = b.crank);
    this.cassette.rotation.z = -b.cassette;
    this.updateChain(b, th);
  }

  updateChain(b, th) {
    const ra = G.rearAt(th), A = [ra.ax, ra.ay], cog = G.COGS[b.gear], rc = G.cogR(cog), rr = G.cogR(G.RING_T);
    const rotA = (p) => { const c = Math.cos(-th), s = Math.sin(-th); return [A[0] + p[0] * c - p[1] * s, A[1] + p[0] * s + p[1] * c]; };
    const U = rotA(G.PULLEY_U), Lp = rotA(G.PULLEY_L), pts = [];
    const arc = (cx, cy, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    arc(A[0], A[1], rc, Math.PI / 2, Math.PI * 1.25, 8);
    arc(U[0], U[1], 0.024, Math.PI, Math.PI * 1.9, 5);
    arc(Lp[0], Lp[1], 0.024, Math.PI * 0.5, -Math.PI * 0.5, 6);
    arc(0, 0, rr, -Math.PI / 2, Math.PI / 2, 14);
    pts.push(pts[0]);
    const seg = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
    const m = new T.Matrix4(), q = new T.Quaternion(), pos = new T.Vector3(), sc = v3(1, 1, 1), step = tot / this.nLinks;
    let off = ((-b.chainPos % step) + step) % step;
    let si = 0, acc = 0;
    for (let n = 0; n < this.nLinks; n++) {
      const d = off + n * step;
      while (si < seg.length - 1 && acc + seg[si] < d) { acc += seg[si]; si++; }
      const t = (d - acc) / seg[si], a = pts[si], c = pts[si + 1];
      pos.set(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, 0.052);
      q.setFromAxisAngle(v3(0, 0, 1), Math.atan2(c[1] - a[1], c[0] - a[0]));
      this.chain.setMatrixAt(n, m.compose(pos, q, sc));
    }
    this.chain.instanceMatrix.needsUpdate = true;
  }
}
