// Articulated rider: 17 mass points joined by rigid bones and joint-limit constraints (position-based
// dynamics, same 1 kHz step as the bike). The rider touches the bike only through compliant contacts:
// hands->grips, feet->pedals, pelvis->saddle (one-sided). Posture is held by muscle forces that act
// BETWEEN body parts (legs push hips away from feet, arms/back hold the chest), so the only way the rider
// moves the bike is through those contacts - shifting the hips really does pitch the bike.
import { V, rodr, clamp } from '../core/math.js';
import * as G from './geometry.js';
import { COM } from './bike.js';

const GRAV = 9.81, g = new V(0, -GRAV, 0);
export const J = { head: 0, neck: 1, shL: 2, shR: 3, spine: 4, hipL: 5, hipR: 6, elbL: 7, elbR: 8, handL: 9, handR: 10, kneeL: 11, kneeR: 12, ankL: 13, ankR: 14, toeL: 15, toeR: 16 };
const MASSES = [5.5, 6, 6, 6, 12, 8, 8, 2, 2, 1.2, 1.2, 6.5, 6.5, 3, 3, 1, 1];          // 78.9 kg
const RADII = [0.13, 0.1, 0.08, 0.08, 0.12, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.06, 0.06, 0.05, 0.05, 0.04, 0.04];
export const SEG = { thigh: 0.47, shin: 0.46, upper: 0.34, fore: 0.33, lumbar: 0.26, thorax: 0.27, neck: 0.24, hipW: 0.1, shW: 0.19 };
export const RIDER_MASS = MASSES.reduce((a, b) => a + b, 0);
const M_UPPER = RIDER_MASS - (MASSES[11] + MASSES[12] + MASSES[13] + MASSES[14] + MASSES[15] + MASSES[16]); // carried by the legs
const M_CHEST = MASSES[0] + MASSES[1] + MASSES[2] + MASSES[3] + 2 * (MASSES[7] + MASSES[9]) * 0.5;

const dfl = new V(G.DF[0], G.DF[1], 0), crown = new V(G.CROWN[0], G.CROWN[1], 0);
const BB = (x, y, z = 0) => new V(x - COM[0], y - COM[1], z);        // BB-frame -> chassis-local

function ik(a, t, l1, l2, pole) {
  const d = t.sub(a), dl = Math.min(d.len(), l1 + l2 - 1e-4), dn = d.norm();
  const x = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pp = pole.sub(dn.mul(pole.dot(dn))).norm();
  return a.add(dn.mul(x)).add(pp.mul(h));
}

export class Rider {
  constructor() {
    this.n = MASSES.length; this.w = MASSES.map(m => 1 / m);
    this.attached = true; this.tone = 1; this.crashed = false; this.stand = 1; this.rough = 0; this.aF = new V(0, 0, 0);
  }

  // ---- bike-side contact points (chassis-local unless noted)
  gripL(b, s) { const p = new V(G.GRIP[0], G.GRIP[1], s * G.GRIP_Z); return BB(0, 0).add(crown.add(rodr(p.sub(crown), dfl, -b.steer))); }
  pedal(b, s) { const p = G.pedalAt(b.crank, s); return BB(p[0], p[1], s * G.PEDAL_Z); }
  world(b, l) { return b.p.add(b.q.rot(l)); }
  velAt(b, wp) { return b.v.add(b.w.cross(wp.sub(b.p))); }

  // posture targets in the BB frame -> chassis local
  pose(b, hip) {
    const P = {}, L = (x, y, z = 0) => new V(x, y, z);
    const H = L(hip[0], hip[1]);
    P.spine = H.add(L(0.11, 0.236)); P.neck = P.spine.add(L(0.22, 0.14));
    P.head = P.neck.add(L(0.13, 0.2)); P.hipL = H.add(L(0, 0, -SEG.hipW)); P.hipR = H.add(L(0, 0, SEG.hipW));
    P.shL = P.neck.add(L(0, -0.03, -SEG.shW)); P.shR = P.neck.add(L(0, -0.03, SEG.shW));
    for (const [s, k] of [[-1, 'L'], [1, 'R']]) {
      const gp = this.gripL(b, s).add(new V(COM[0], COM[1], 0)), pd = G.pedalAt(b.crank, s);
      P['hand' + k] = gp;
      P['elb' + k] = ik(P['sh' + k], gp, SEG.upper, SEG.fore, L(-0.4, -0.5, s * 0.8));
      P['ank' + k] = L(pd[0] - 0.04, pd[1] + 0.075, s * G.PEDAL_Z); P['toe' + k] = L(pd[0] + 0.11, pd[1] + 0.03, s * G.PEDAL_Z);
      P['knee' + k] = ik(P['hip' + k], P['ank' + k], SEG.thigh, SEG.shin, L(1, 0.25, s * 0.15));
    }
    const arr = []; for (const [k, i] of Object.entries(J)) arr[i] = BB(P[k].x, P[k].y, P[k].z); return arr;
  }

  reset(b) {
    const loc = this.pose(b, [-0.16, 0.86]);
    this.x = loc.map(l => this.world(b, l)); this.v = this.x.map(p => this.velAt(b, p));
    this.buildConstraints();
  }

  // ragdoll joint structure from the current body positions
  buildConstraints() {
    const d = (a, c) => this.x[a].sub(this.x[c]).len(), C = [];
    const bone = (a, c) => C.push([J[a], J[c], d(J[a], J[c]), d(J[a], J[c])]);
    const rel = (a, c, lo, hi) => { const r = d(J[a], J[c]); C.push([J[a], J[c], r + lo, r + hi]); };
    const abs = (a, c, lo, hi) => C.push([J[a], J[c], lo, hi]);
    // upper torso (rigid tetra), pelvis (rigid triangle), spine = ball joint between them
    for (const [a, c] of [['head', 'neck'], ['neck', 'shL'], ['neck', 'shR'], ['shL', 'shR'], ['neck', 'spine'], ['shL', 'spine'], ['shR', 'spine'], ['spine', 'hipL'], ['spine', 'hipR'], ['hipL', 'hipR'],
      ['shL', 'elbL'], ['elbL', 'handL'], ['shR', 'elbR'], ['elbR', 'handR'], ['hipL', 'kneeL'], ['kneeL', 'ankL'], ['hipR', 'kneeR'], ['kneeR', 'ankR'], ['ankL', 'toeL'], ['ankR', 'toeR']]) bone(a, c);
    // joint limits as distance ranges between non-adjacent points
    rel('neck', 'hipL', -0.16, 0.05); rel('neck', 'hipR', -0.16, 0.05);           // spine flexion / extension / side bend
    rel('shL', 'hipR', -0.07, 0.07); rel('shR', 'hipL', -0.07, 0.07);             // spine twist
    rel('head', 'shL', -0.07, 0.06); rel('head', 'shR', -0.07, 0.06); rel('head', 'spine', -0.1, 0.05); // neck
    abs('shL', 'handL', 0.14, SEG.upper + SEG.fore); abs('shR', 'handR', 0.14, SEG.upper + SEG.fore);       // elbows
    abs('hipL', 'ankL', 0.2, SEG.thigh + SEG.shin); abs('hipR', 'ankR', 0.2, SEG.thigh + SEG.shin);         // knees
    rel('kneeL', 'toeL', -0.09, 0.07); rel('kneeR', 'toeR', -0.09, 0.07);        // ankles
    abs('spine', 'kneeL', 0.22, d(J.spine, J.kneeL) + 0.12); abs('spine', 'kneeR', 0.22, d(J.spine, J.kneeR) + 0.12); // hip flexion
    abs('neck', 'elbL', 0.12, 0.62); abs('neck', 'elbR', 0.12, 0.62);           // shoulder cone
    abs('kneeL', 'kneeR', 0.1, 0.9); abs('hipR', 'kneeL', 0.1, 0.62); abs('hipL', 'kneeR', 0.1, 0.62);
    this.C = C; this.attached = true; this.crashed = false; this.tone = 1; this.stand = 1; this.rough = 0; this.aF = new V(0, 0, 0);
    this.saddleLoad = 0; this.gripErr = 0; this.footErr = 0;
    this.sup = 1; this.absorb = 0; this.wasOnGround = true; this.vyAir = 0; this.lip = 0; this.p0 = undefined;
  }

  // one physics step. Returns forces acting on the bike.
  step(dt, b, keys, track) {
    const x = this.x, v = this.v, n = this.n, F = x.map(() => g.mul(1)).map((a, i) => a.mul(MASSES[i]));
    const ext = [], q = b.q, up = q.rot(new V(0, 1, 0)), fwd = q.rot(new V(1, 0, 0)), right = q.rot(new V(0, 0, 1));
    const add = (i, f) => { F[i] = F[i].add(f); };
    const toBike = (p, f, tag) => ext.push({ p, f, tag });
    const tone = this.tone;
    // filtered bike acceleration: muscles support the body against gravity + sustained accelerations,
    // impacts are left to the leg/arm compliance
    // gravity compensation: on the ground the legs carry the body weight; in free flight bike and rider
    // fall together so no support is needed (blended so take-off and landing stay smooth)
    const onGround = !!(b.cF || b.cR);
    // landing: on touchdown after real airtime the legs let go a little and soak up the hit, scaled by
    // how fast we were coming down; the posture then recovers over ~0.5 s
    if (onGround && !this.wasOnGround && b.air === 0 && (b.lastAir || 0) > 0.12) this.absorb = clamp(-this.vyAir / 3, 0.2, 1);
    if (!onGround) this.vyAir = b.v.y;
    this.wasOnGround = onGround; this.absorb = Math.max(0, (this.absorb || 0) - dt / 0.5);
    this.sup = clamp((this.sup ?? 1) + (onGround ? 1 : -1) * dt * 6, 0, 1);
    const support = g.mul(this.crashed ? 0 : -this.sup);

    // ---- posture controller (targets in BB frame)
    const ip = b.inp, spd = Math.max(0, b.speed || 0), air = b.air > 0.04;
    const suspV = Math.abs(b.sFd) + Math.abs(b.thd) * 0.43;
    this.rough += (Math.min(suspV, 2) - this.rough) * Math.min(1, dt / 0.4);
    const wantStand = air || spd > 4 || this.rough > 0.25 || Math.abs(ip.pitch) > 0.1 || keys.stand;
    this.stand = clamp(this.stand + (wantStand ? 1 : -1) * dt * 1.8, 0, 1);
    const brake = Math.min(1, ip.bF + 0.6 * ip.bR) * Math.min(1, spd / 4), pitchAng = Math.asin(clamp(fwd.y, -1, 1));
    const lip = (b.cR && !b.cF && b.w.dot(right) < -0.5) ? 1 : 0;   // front wheel has left the lip: instinctively get back
    this.lip = clamp((this.lip ?? 0) + (lip ? 8 : -3) * dt, 0, 1);
    const hipX = -0.23 - 0.1 * this.lip + 0.07 * this.stand - 0.12 * brake + 0.04 * ip.thr - 0.17 * ip.pitch + 0.45 * Math.sin(pitchAng) * this.stand * this.sup;
    const hipY = 0.785 + 0.095 * this.stand + (air ? 0.03 : 0) - 0.06 * Math.min(1, this.rough) - 0.12 * this.absorb;
    // keep the hips where both feet can still reach their pedals (legs bend, never over-stretch)
    let hipYr = hipY; const hx = clamp(hipX, -0.42, 0.02), reach = (SEG.thigh + SEG.shin) * 0.96;
    for (const s of [-1, 1]) { const pd = G.pedalAt(b.crank, s), ax = pd[0] - 0.04, ay = pd[1] + 0.075, dz = s * G.PEDAL_Z - s * SEG.hipW;
      hipYr = Math.min(hipYr, ay + Math.sqrt(Math.max(0.01, reach * reach - (hx - ax) ** 2 - dz * dz))); }
    // in the air, pitch input rotates the body relative to the bike (extend arms / legs): the muscles drive
    // the body to the rotated pose and the reaction turns the bike the other way (shared angular momentum)
    if (this.sup > 0.9) this.p0 = pitchAng;                // pitch at take-off
    // airborne the body keeps its own attitude and the bike rotates under it (arms/legs give), so the
    // bar/pedal couple from the pitch input turns the bike instead of the whole rider+bike block
    const beta = 0, piv = [-0.08, 0.95];
    const rot = (x, y) => { const c = Math.cos(beta), s2 = Math.sin(beta), dx = x - piv[0], dy = y - piv[1]; return [piv[0] + dx * c - dy * s2, piv[1] + dx * s2 + dy * c]; };
    const hR = rot(hx, hipYr), nR = rot(hx + 0.31 + 0.05 * this.stand - 0.04 * brake, hipYr + 0.39 - 0.06 * this.stand);
    const hipT = this.world(b, BB(hR[0], hR[1]));
    const neckT = this.world(b, BB(nR[0], nR[1]));

    // ---- contacts: hands->grips, feet->pedals (compliant, two-way)
    let gripErr = 0, footErr = 0;
    if (this.attached) {
      for (const [s, hi, ai, ti] of [[-1, J.handL, J.ankL, J.toeL], [1, J.handR, J.ankR, J.toeR]]) {
        const gp = this.world(b, this.gripL(b, s)), gv = this.velAt(b, gp);
        const fh = gp.sub(x[hi]).mul(16000).add(gv.sub(v[hi]).mul(140)); add(hi, fh); toBike(gp, fh.mul(-1), 'grip');
        gripErr = Math.max(gripErr, gp.sub(x[hi]).len());
        const pl = this.pedal(b, s), pc = this.world(b, pl);
        const at = this.world(b, pl.add(new V(-0.04, 0.075, 0))), tt = this.world(b, pl.add(new V(0.11, 0.03, 0)));
        const fa = at.sub(x[ai]).mul(30000).add(this.velAt(b, at).sub(v[ai]).mul(260)); add(ai, fa); toBike(at, fa.mul(-1), 'ankle');
        const ft = tt.sub(x[ti]).mul(5000).add(this.velAt(b, tt).sub(v[ti]).mul(40)); add(ti, ft); toBike(tt, ft.mul(-1), 'toe');
        footErr = Math.max(footErr, at.sub(x[ai]).len());
      }
      // pitch technique: pull/push the bars against the pedals (internal couple rider <-> bike)
      if (Math.abs(ip.pitch) > 0.01) {
        const f = up.mul(220 * ip.pitch);
        // arms push between grips and shoulders, legs between pedals and hips (the body is the reaction mass).
        // The rider-side pair is scaled so its couple exactly cancels the bike-side couple (angular momentum kept).
        const zA = right; let tb = 0, tr = 0;
        for (const s of [-1, 1]) { const gp = this.world(b, this.gripL(b, s)), pp = this.world(b, this.pedal(b, s)); tb += gp.sub(pp).cross(f.mul(0.5)).dot(zA); toBike(gp, f.mul(0.5)); toBike(pp, f.mul(-0.5)); }
        for (const [sh, hp] of [[J.shL, J.hipL], [J.shR, J.hipR]]) tr += x[sh].sub(x[hp]).cross(f.mul(-0.5)).dot(zA);
        const k = Math.abs(tr) > 1e-6 ? clamp(-tb / tr, 0, 4) : 0;
        for (const [sh, hp] of [[J.shL, J.hipL], [J.shR, J.hipR]]) { add(sh, f.mul(-0.5 * k)); add(hp, f.mul(0.5 * k)); }
      }
    }
    this.gripErr = gripErr; this.footErr = footErr;

    // ---- muscles (forces between body parts; scaled by tone, mostly off once crashed)
    const hipM = x[J.hipL].add(x[J.hipR]).mul(0.5), hipV = v[J.hipL].add(v[J.hipR]).mul(0.5);
    const Fm = x.map(() => new V()), madd = (i, f) => { Fm[i] = Fm[i].add(f); };
    if (tone > 0 && !this.crashed) {   // posture muscles only while riding; a detached rider is a true ragdoll
      // legs: hips relative to feet (stiffer laterally to lean with the bike)
      const e = hipT.sub(hipM), ev = this.velAt(b, hipT).sub(hipV);
      const eL = new V(e.dot(fwd), e.dot(up), e.dot(right)), evL = new V(ev.dot(fwd), ev.dot(up), ev.dot(right));
      const air2 = 0.35 + 0.65 * this.sup;   // airborne: body goes compliant fore/aft so it can act as the reaction mass
      const legK = 1 - 0.45 * this.absorb;   // softer legs right after touchdown
      const fl = new V((2600 * eL.x + 420 * evL.x) * air2, (3200 * eL.y + 480 * evL.y) * air2 * legK, 20000 * eL.z + 1600 * evL.z);
      let fLeg = fwd.mul(fl.x).add(up.mul(fl.y)).add(right.mul(fl.z)).mul(tone).add(support.mul(M_UPPER * tone * (0.25 + 0.75 * this.stand))); // seated: saddle takes most of the weight
      const lim = 3200; if (fLeg.len() > lim) fLeg = fLeg.mul(lim / fLeg.len());
      madd(J.hipL, fLeg.mul(0.5)); madd(J.hipR, fLeg.mul(0.5));
      madd(J.ankL, fLeg.mul(-0.5)); madd(J.ankR, fLeg.mul(-0.5));   // always reacted: muscles are internal
      // back + arms: chest relative to hips and hands
      const ec = neckT.sub(x[J.neck]), ecv = this.velAt(b, neckT).sub(v[J.neck]);
      const ecz = right.mul(ec.dot(right) * 4000 + ecv.dot(right) * 300);   // stiffer sideways: lean with the bike
      let fC = ec.mul(1800).add(ecv.mul(170)).mul(air2).add(ecz).mul(tone).add(support.mul(M_CHEST * tone * 0.6));
      if (fC.len() > 1800) fC = fC.mul(1800 / fC.len());
      madd(J.neck, fC.mul(0.6)); madd(J.shL, fC.mul(0.2)); madd(J.shR, fC.mul(0.2));
      if (this.attached) { madd(J.hipL, fC.mul(-0.25)); madd(J.hipR, fC.mul(-0.25)); madd(J.handL, fC.mul(-0.25)); madd(J.handR, fC.mul(-0.25)); }
      else { madd(J.hipL, fC.mul(-0.5)); madd(J.hipR, fC.mul(-0.5)); }
      // head: hold above the chest, looking ahead
      const cu = x[J.neck].sub(x[J.spine]).norm(), ht = x[J.neck].add(cu.mul(0.17)).add(fwd.mul(0.17));
      const fHd = ht.sub(x[J.head]).mul(500).add(v[J.neck].sub(v[J.head]).mul(30)).mul(tone);
      madd(J.head, fHd); madd(J.neck, fHd.mul(-1));
      // knees forward/out, elbows out/back (pole forces, reacted at the ends of each limb)
      for (const [s, hp, kn, an, sh, el, hd] of [[-1, J.hipL, J.kneeL, J.ankL, J.shL, J.elbL, J.handL], [1, J.hipR, J.kneeR, J.ankR, J.shR, J.elbR, J.handR]]) {
        const fk = fwd.mul(90).add(right.mul(s * 35)).mul(tone); madd(kn, fk); madd(hp, fk.mul(-0.5)); madd(an, fk.mul(-0.5));
        const fe = right.mul(s * 45).add(fwd.mul(-20)).add(up.mul(-10)).mul(tone); madd(el, fe); madd(sh, fe.mul(-0.5)); madd(hd, fe.mul(-0.5));
      }
    }

    // muscles are internal: zero net force by construction, but non-collinear pairs make a net couple.
    // Real joint torques react against the bike through the feet/hands, so pass that couple to the bike
    // (keeps rider+bike angular momentum exact). Detached, cancel it inside the body instead.
    let tq = new V(); for (let i = 0; i < n; i++) { tq = tq.add(x[i].sub(hipM).cross(Fm[i])); F[i] = F[i].add(Fm[i]); }
    if (this.attached) ext.push({ p: b.p, f: new V(), t: tq.mul(-1) });
    else { const d = x[J.neck].sub(hipM), dd = d.dot(d), fc = tq.cross(d).mul(1 / dd); F[J.neck] = F[J.neck].sub(fc); F[J.hipL] = F[J.hipL].add(fc.mul(0.5)); F[J.hipR] = F[J.hipR].add(fc.mul(0.5)); }

    // ---- saddle: one-sided support under the pelvis (seat can only push up)
    this.saddleLoad = 0;
    if (!this.crashed) {
      const hl = q.inv(hipM.sub(b.p)).add(new V(COM[0], COM[1], 0)), st = G.SADDLE_TOP;
      const depth = st[1] + 0.07 - hl.y;
      if (depth > 0 && hl.x > st[0] - 0.16 && hl.x < st[0] + 0.12 && Math.abs(hl.z) < 0.14) {
        const sp = this.world(b, BB(st[0], st[1])), rv = hipV.sub(this.velAt(b, sp));
        const fn = Math.max(0, 30000 * depth - 900 * rv.dot(up)), f = up.mul(fn).add(rv.sub(up.mul(rv.dot(up))).mul(-Math.min(300, fn * 0.6)));
        add(J.hipL, f.mul(0.5)); add(J.hipR, f.mul(0.5)); toBike(sp, f.mul(-1), 'saddle'); this.saddleLoad = fn;
      }
    }

    // ---- integrate (position based): predict, collide with ground, project joints
    const xp = new Array(n), hitN = new Array(n);
    let groundHit = false;
    // aerodynamic drag on the rider (CdA ~0.5 m^2), spread over the body by mass
    const vb = b.v, dragK = 0.5 * 1.2 * 0.5 * vb.len() / RIDER_MASS;
    for (let i = 0; i < n; i++) { F[i] = F[i].sub(v[i].mul(dragK * MASSES[i])); }
    for (let i = 0; i < n; i++) { v[i] = v[i].add(F[i].mul(dt / MASSES[i])); xp[i] = x[i].add(v[i].mul(dt)); }
    for (let it = 0; it < 4; it++) {
      for (const [a, c, lo, hi] of this.C) {
        const d = xp[c].sub(xp[a]), L = d.len(); if (L < 1e-9) continue;
        const tgt = L < lo ? lo : L > hi ? hi : L; if (tgt === L) continue;
        const corr = d.mul((L - tgt) / L / (this.w[a] + this.w[c]));
        xp[a] = xp[a].add(corr.mul(this.w[a])); xp[c] = xp[c].sub(corr.mul(this.w[c]));
      }
      // knees bend forward only (relative to the pelvis), and clear the frame while riding
      const pr = xp[J.hipR].sub(xp[J.hipL]).norm();
      for (const [hp, kn, an, s] of [[J.hipL, J.kneeL, J.ankL, -1], [J.hipR, J.kneeR, J.ankR, 1]]) {
        const pf = pr.cross(xp[an].sub(xp[hp])).norm();   // knee hinge: bends forward in the leg's own plane
        const mid = xp[hp].add(xp[an]).mul(0.5), def = -xp[kn].sub(mid).dot(pf);
        const straight = xp[an].sub(xp[hp]).len() > 0.9 * (SEG.thigh + SEG.shin);   // hinge plane undefined when straight
        if (def > 0 && !straight) xp[kn] = xp[kn].add(pf.mul(Math.min(def, 0.01)));
        if (this.attached) { const kl = q.inv(xp[kn].sub(b.p)); const lat = 0.1 - s * kl.z; if (lat > 0) xp[kn] = xp[kn].add(right.mul(s * lat)); }
      }
      for (let i = 0; i < n; i++) {
        if (this.attached && (i === J.handL || i === J.handR || i >= J.ankL)) continue;   // hands/feet ride on the bike's contacts
        const gh = track.h(xp[i].x, xp[i].z) + RADII[i], dep = gh - xp[i].y;
        if (dep > 0) {
          const nn = track.normal(xp[i].x, xp[i].z), nv = new V(nn.x, nn.y, nn.z);
          xp[i] = xp[i].add(nv.mul(dep * nv.y)); hitN[i] = nv;
          const mv = xp[i].sub(x[i]), tan = mv.sub(nv.mul(mv.dot(nv)));
          xp[i] = xp[i].sub(tan.mul(Math.min(1, 0.8 * dep / Math.max(tan.len(), 1e-6))));
          if (i <= J.hipR || i === J.elbL || i === J.elbR || i === J.kneeL || i === J.kneeR) groundHit = true;
        }
      }
    }
    // velocities from the corrected positions; clamp relative to the body's mean velocity so that
    // conflicting contacts in a pile-up can never pump energy into a limb
    let vm = new V(); for (let i = 0; i < n; i++) vm = vm.add(xp[i].sub(x[i]).mul(MASSES[i] / dt)); vm = vm.mul(1 / RIDER_MASS);
    for (let i = 0; i < n; i++) { let vi = xp[i].sub(x[i]).mul(1 / dt), rel = vi.sub(vm); const rl = rel.len(); if (rl > 12) { vi = vm.add(rel.mul(12 / rl)); xp[i] = x[i].add(vi.mul(dt)); } if (hitN[i]) { const vn = vi.dot(hitN[i]); if (vn > 0.5) vi = vi.sub(hitN[i].mul(vn - 0.5)); }   // ground contact: no bounce / pop-out
      v[i] = vi; x[i] = xp[i]; }

    // ---- crash: body hits the ground, a hand or foot is ripped off, or the bike is upside down
    if (!this.crashed && (groundHit || gripErr > 0.22 || footErr > 0.25 || up.y < 0.1)) this.crash();
    if (this.crashed) this.tone = Math.max(0.12, this.tone - dt * 3);
    return ext;
  }

  // thrown off the bike: start the ragdoll from the animated pose and its velocities
  fromPose(xs, vs) {
    this.x = xs.map(p => new V(p.x, p.y, p.z)); this.v = vs.map(p => new V(p.x, p.y, p.z));
    this.buildConstraints(); this.attached = false; this.crashed = true; this.tone = 0.6;
  }

  // spin the body as a whole about its centre of mass (no net force): used by the assist layer
  applyTorque(t) {
    const c = this.com; let I = 0; const r = this.x.map(p => p.sub(c)); r.forEach((ri, i) => I += MASSES[i] * ri.dot(ri));
    const a = t.mul(1 / Math.max(I, 1)), dt = 0.001;
    this.v = this.v.map((v, i) => v.add(a.cross(r[i]).mul(dt)));
  }

  crash() { this.crashed = true; this.attached = false; }
  get com() { let s = new V(); this.x.forEach((p, i) => s = s.add(p.mul(MASSES[i]))); return s.mul(1 / RIDER_MASS); }
}
