// Multibody bike: sprung chassis (frame + rider, 6-DOF rigid body) + fork slider DOF + swingarm rotation DOF
// + two wheel spin DOFs. Tyres are found against the real terrain geometry; suspension forces come from the
// spring/damper models and feed straight back into the chassis. Fixed timestep, semi-implicit Euler.
import { V, Q, X, Y, Z, rodr, clamp } from '../core/math.js';
import { SURF_PROPS } from '../terrain/track.js';
import * as G from './geometry.js';
import { AirFork, CoilShock } from './suspension.js';
import { Assist, ASSIST } from './assist.js';

const GRAV = 9.81, g = new V(0, -GRAV, 0);
// The bike chassis is the frame (+fork crown, bars, cockpit). The rider is a separate articulated body
// (physics/rider.js) that only touches the bike through grips, pedals and saddle (external forces here).
const FRAME = { m: 15, com: [0.25, 0.30] };
const CM = FRAME.m;
export const COM = FRAME.com;
export const MASS = 95;                           // design mass (bike + rider) for spring rates / rider balance gains
const SYS_X = 0.06;                               // design x of combined CoM for static load split
const INERTIA = new V(0.7, 1.8, 1.9);             // frame roll, yaw, pitch about its CoM (kg m^2)
// Mounted rider (no ragdoll while riding): arms/legs ride rigidly with the frame, the torso is ONE mass point
// held by the legs/arms spring-damper. That single point gives the bike the rider's real weight, weight
// transfer and impact absorption; everything else about the rider is procedural animation (render/riderPose.js).
export const TORSO = { m: 62, anchor: [0.0, 0.86], k: new V(12000, 6000, 50000), c: new V(1300, 900, 3000), shift: 0.16 };
const LIMB_M = 17, MOUNTED_I = new V(1.6, 2.6, 3.2);
const SYS_ROLL_I = 12;                            // rider+bike roll inertia about CoM (for balance gains)
const MU_F = 3.2, MU_R = 4.2;                    // unsprung masses (kg)
const IW_F = 0.14, IW_R = 0.17;                  // wheel spin inertia
const R = G.R_WHEEL;
const TYRE = { k: 90000, k2: 1.5e6, c: 250, rim: 0.035, kRim: 8e5 };
const BRAKE = { front: 800, rear: 450 };         // max wheel torque N m
const L = (x, y, z = 0) => new V(x - COM[0], y - COM[1], z);   // BB-frame point -> CoM-relative

const dfl = new V(G.DF[0], G.DF[1], 0), nfl = new V(G.NF[0], G.NF[1], 0), crownL = L(G.CROWN[0], G.CROWN[1]);
const frontShare = (SYS_X - G.AXLE_R[0]) / G.WHEELBASE;
const PHASES = 33;
// lateral acceleration a full A/D press asks for; shared with the test riders
export const maxLatAccel = (v) => Math.min(ASSIST.latG * GRAV, v * v / ASSIST.minRadius);
// rider/frame collision points (BB frame): head, shoulders, hips, bar ends, saddle, bottom bracket
const ANCHOR = L(TORSO.anchor[0], TORSO.anchor[1]);
const BODY_PTS = [[0.5, 0.66, -0.4], [0.5, 0.66, 0.4], [-0.22, 0.72, 0], [0, -0.02, 0]].map(([x, y, z]) => ({ p: L(x, y, z) }));

export class Bike {
  constructor(track) {
    this.track = track;
    this.fork = new AirFork(G.FORK.travel, MASS * GRAV * frontShare * G.DF[1], G.FORK.sag);
    const r0 = G.rearAt(0), xs0 = G.SHOCK.eye - r0.len, Wr = MASS * GRAV * (1 - frontShare);
    this.shock = new CoilShock(G.SHOCK.stroke, (-Wr * r0.ty / r0.dlen) / xs0, G.leverage(0));
    this.Ith = MU_R * Math.hypot(r0.ax - G.PIVOT[0], r0.ay - G.PIVOT[1]) ** 2 + 0.05;
    this.reset(0, 0);
  }

  reset(s, speed) {
    const t = this.track, p = t.sampleAt(s), ah = t.sampleAt(s + 1.3), y0 = t.h(p.x, p.z), y1 = t.h(ah.x, ah.z);
    const pitch = Math.atan2(y1 - y0, 1.3);
    this.q = Q.axis(Y, -p.psi).mul(Q.axis(Z, pitch));
    const bbGround = 0.35 + 0.03;
    this.p = new V(p.x, Math.max(y0, y1) + bbGround, p.z).add(this.q.rot(new V(COM[0], COM[1], 0)));
    const f = this.q.rot(X);
    this.v = f.mul(speed); this.w = new V();
    this.mounted = true; this.pr = this.p.add(this.q.rot(ANCHOR)); this.vr = this.v; this.torsoOff = new V();
    this.sF = G.FORK.sag; this.sFd = 0; this.th = 0; this.thd = 0;
    this.wF = speed / R; this.wR = speed / R; this.steer = 0; this.crank = Math.PI / 2; this.cassette = 0; this.gear = 0; this.chainPos = 0;
    this.leanT = 0; this.aPrev = new V(); this.inp = { thr: 0, bF: 0, bR: 0, steer: 0, pitch: 0, lean: 0 };
    this.lrF = 0; this.assist = this.assist || new Assist(); this.assist.reset(); this.assistT = new V(); this.lastAir = 0;
    this.crashed = false; this.cF = null; this.cR = null; this.air = 0; this.rim = 0; this.bottomF = 0; this.bottomR = 0; this.time = 0;
  }

  // tyre: search the wheel's circle (in its own plane) for the deepest terrain penetration
  contact(c, vc, fw, aw, omega) {
    const t = this.track, u = aw.cross(fw), dep = new Float64Array(PHASES);
    let bi = -1, bd = 0;
    for (let i = 0; i < PHASES; i++) {
      const ph = -1.45 + 2.9 * i / (PHASES - 1), cu = Math.cos(ph) * R, sf = Math.sin(ph) * R;
      const px = c.x - u.x * cu + fw.x * sf, py = c.y - u.y * cu + fw.y * sf, pz = c.z - u.z * cu + fw.z * sf;
      dep[i] = t.h(px, pz) - py; if (dep[i] > bd) { bd = dep[i]; bi = i; }
    }
    if (bi < 0) return null;
    let off = 0;
    if (bi > 0 && bi < PHASES - 1) { const a = dep[bi - 1], b = dep[bi], cc = dep[bi + 1], den = a - 2 * b + cc; if (den < 0) off = clamp(0.5 * (a - cc) / den, -0.5, 0.5); }
    const ph = -1.45 + 2.9 * (bi + off) / (PHASES - 1);
    const p = c.add(u.mul(-Math.cos(ph) * R)).add(fw.mul(Math.sin(ph) * R));
    const nn = t.normal(p.x, p.z), n0 = new V(nn.x, nn.y, nn.z);
    // round tyre carcass: an off-centre hit mostly rolls over the casing, so damp the sideways component
    const n = n0.sub(aw.mul(n0.dot(aw) * 0.6)).norm();
    const pen = (t.h(p.x, p.z) - p.y) * n0.y; if (pen <= 0) return null;
    const sp = SURF_PROPS[t.surface(p.x, p.z)];
    const vn = vc.dot(n);
    let N = TYRE.k * pen + TYRE.k2 * pen * pen - TYRE.c * vn;
    let rim = false; if (pen > TYRE.rim) { N += TYRE.kRim * (pen - TYRE.rim) - 1500 * vn; rim = true; }
    N = Math.max(0, N);
    const l = fw.sub(n.mul(fw.dot(n))).norm(), lat = l.cross(n);
    const vl = vc.dot(l), vlat = vc.dot(lat), sv = vl - omega * R;
    const mu = sp.mu * (1 - 0.06 * Math.min(N / 1000, 3));
    let Fx = -mu * N * sv / Math.hypot(sv, Math.max(0.6, Math.abs(vl) * 0.12));
    let Fy = -mu * N * vlat / Math.hypot(vlat, Math.max(0.4, Math.abs(vl) * 0.14));
    const m = Math.hypot(Fx, Fy), lim = mu * N; if (m > lim) { Fx *= lim / m; Fy *= lim / m; }
    const slip = Math.min(1, m / Math.max(lim, 1));
    return { p, n, pen, N, Fx, Fy, F: n.mul(N).add(l.mul(Fx)).add(lat.mul(Fy)), surf: sp, rim, crr: sp.crr, slip, vl };
  }

  // ext: [{p: world point, f: world force}] from the rider (grips, pedals, saddle, muscle couples)
  step(dt, keys, ext = []) {
    if (this.crashed) keys = {};
    const ip = this.inp, ap = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
    ip.thr = ap(ip.thr, keys.w ? 1 : 0, 4); ip.bR = ap(ip.bR, keys.s ? 1 : 0, 8); ip.bF = ap(ip.bF, keys.space ? 1 : 0, 8);
    ip.steer = ap(ip.steer, keys.steer ?? ((keys.d ? 1 : 0) - (keys.a ? 1 : 0)), ASSIST.inputRate); ip.pitch = ap(ip.pitch, keys.pitch ?? ((keys.down ? 1 : 0) - (keys.up ? 1 : 0)), 6);
    ip.lean = ap(ip.lean, keys.lean ?? ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)), 3);   // ←/→ rider body lean

    const q = this.q, fwd = q.rot(X), up = q.rot(Y), right = q.rot(Z);
    const fh = new V(fwd.x, 0, fwd.z).norm(), rh = new V(-fh.z, 0, fh.x);
    const vf = this.v.dot(fh), lean = Math.atan2(up.dot(rh), up.y), leanRate = this.w.dot(fh);
    const grounded = this.cF || this.cR;
    this.lean = lean; this.speed = vf;

    // --- rider: balance by steering (steer into the fall), countersteer to initiate lean
    let target;
    const h = 0.97, Ir = SYS_ROLL_I + MASS * h * h, wn = ASSIST.leanBandwidth, zeta = 0.9, vabs = Math.max(Math.abs(vf), 0.1);
    if (!this.cF) target = this.steer * (1 - 8 * dt);   // front wheel unloaded: steering does nothing, so straighten the bars for touchdown
    else if (vf > 1.2) {
      const nb = this.track.normal(this.p.x, this.p.z), bank = Math.atan2(nb.x * rh.x + nb.z * rh.z, nb.y);   // + = surface tilted down to the right
      // A/D + ←/→ the same way = committed carve: the rider throws the bike much further over and turns far
      // tighter. How far depends on what the ground can hold: a little on the flat, a lot on a berm banked into the turn
      const combo = Math.abs(ip.steer) > 0.1 && Math.sign(ip.lean) === Math.sign(ip.steer) ? Math.abs(ip.lean) : 0;
      const bankIn = Math.max(0, Math.sign(ip.steer) * bank), aCarve = Math.min(vf * vf / 2.2, GRAV * Math.tan(Math.min(0.85, 0.66 + 0.4 * bankIn)));
      this.carve = { combo, bankIn, dir: Math.sign(ip.steer) };
      const aLat = ip.steer * (maxLatAccel(vf) + combo * Math.max(0, aCarve - maxLatAccel(vf)));
      this.leanT = ap(this.leanT, Math.atan(aLat / GRAV), ASSIST.leanRate * (1 + 1.2 * combo));
      // ←/→: rider tips the bike further over (balance handled by the steering), but only as far as the grip
      // allows: ~35° on flat ground, more on a berm that leans the same way
      // ←/→ tips the bike over a bit more, using only the lean margin the turn hasn't already used up
      const margin = clamp(1 - Math.abs(this.leanT) / (0.85 + 0.5 * Math.max(0, Math.sign(this.leanT) * bank)), 0, 1);
      const leanT = this.leanT + (combo > 0 ? 0.3 : 0.5) * ip.lean * (Math.sign(ip.lean) === Math.sign(this.leanT) || Math.abs(this.leanT) < 0.05 ? margin : 1);
      const a = MASS * h * vf * vf * Math.sin(G.HEAD_ANGLE) / G.WHEELBASE;
      const Kp = Math.min(5, (Ir * wn * wn + MASS * GRAV * h) / a), Kd = Math.min(1.2, 2 * zeta * wn * Ir / a);
      const ff = Math.atan(G.WHEELBASE * Math.tan(leanT) * GRAV / (vf * vf)) / Math.sin(G.HEAD_ANGLE);
      this.lrF = (this.lrF ?? 0) + (leanRate - (this.lrF ?? 0)) * Math.min(1, dt / 0.04);   // impacts make raw roll rate spiky
      target = ff + Kp * (lean - leanT) + Kd * clamp(this.lrF, -1.5, 1.5);
      this.leanTarget = leanT;
    } else { target = ip.steer * 0.6; this.leanT = lean; this.carve = null; }
    const maxSteer = 0.75 / (1 + 0.05 * vabs);
    this.steer = ap(this.steer, clamp(target, -maxSteer, maxSteer), ASSIST.steerRate);

    // --- front assembly (steered about the head-tube axis, fork slides along it)
    const st = -this.steer;
    const nRot = rodr(nfl, dfl, st), fwL = rodr(X, dfl, st), axL = rodr(Z, dfl, st);
    const hubFL = crownL.add(dfl.mul(-(G.FORK.a2c - this.sF))).add(nRot.mul(G.FORK.offset));
    const rF = q.rot(hubFL), hubF = this.p.add(rF), dW = q.rot(dfl), fwW = q.rot(fwL), axW = q.rot(axL);
    const vHubF = this.v.add(this.w.cross(rF)).add(dW.mul(this.sFd));

    // --- rear assembly (swingarm rotation th about main pivot)
    const ra = G.rearAt(this.th), hubRL = L(ra.ax, ra.ay), rR = q.rot(hubRL), hubR = this.p.add(rR);
    const tW = q.rot(new V(ra.tx, ra.ty, 0)), tl = tW.len(), tH = tW.mul(1 / tl);
    const vHubR = this.v.add(this.w.cross(rR)).add(tW.mul(this.thd));

    const cF = this.contact(hubF, vHubF, fwW, axW, this.wF), cR = this.contact(hubR, vHubR, fwd, right, this.wR);
    this.cF = cF; this.cR = cR;

    // --- drivetrain: auto gear selection, crank torque limit + rider power limit
    const wheelW = Math.max(this.wR, 0);
    let cog = G.COGS[this.gear], cad = wheelW * cog / G.RING_T;
    if (ip.thr > 0.05) {
      if (cad > 11 && this.gear < G.COGS.length - 1) this.gear++;
      else if (cad < 7 && this.gear > 0) this.gear--;
      cog = G.COGS[this.gear]; cad = wheelW * cog / G.RING_T;
    }
    const ratio = cog / G.RING_T;
    const Tdrive = ip.thr * Math.min(90 / ratio, 700 / Math.max(wheelW, 1.5)) * clamp((14 - cad) / 3, 0, 1);
    // chain tension on the swingarm (anti-squat), ring and cog tops in BB frame
    const rc = G.cogR(cog), Fc = Tdrive / rc;
    const cogTop = [ra.ax, ra.ay + rc], ringTop = [0, G.cogR(G.RING_T)], cd = [ringTop[0] - cogTop[0], ringTop[1] - cogTop[1]], cdl = Math.hypot(cd[0], cd[1]);
    const QchainArm = [cogTop[0] - G.PIVOT[0], cogTop[1] - G.PIVOT[1]];
    const Qchain = -(QchainArm[0] * cd[1] * Fc / cdl - QchainArm[1] * cd[0] * Fc / cdl);

    // --- fork DOF
    const cm = this.mounted ? CM + LIMB_M : CM, INR = this.mounted ? MOUNTED_I : INERTIA;
    let F = g.mul(cm), T = new V();
    const extF = (cF ? cF.F : new V()).add(g.mul(MU_F));
    const Ffork = this.fork.force(this.sF, this.sFd);
    const sFdd = (extF.dot(dW) - Ffork - MU_F * this.aPrev.dot(dW)) / MU_F;
    const fCh = dW.mul(Ffork).add(extF.sub(dW.mul(extF.dot(dW))));
    F = F.add(fCh); T = T.add(rF.cross(fCh));

    // --- swingarm DOF
    const extR = (cR ? cR.F : new V()).add(g.mul(MU_R));
    const xs = G.SHOCK.eye - ra.len, xsd = -ra.dlen * this.thd;
    const Fs = this.shock.force(xs, xsd);
    const Qint = Fs * ra.dlen + Qchain;
    const thdd = (extR.dot(tW) + Qint - MU_R * this.aPrev.dot(tW)) / this.Ith;
    const rCh = tH.mul(-Qint / tl).add(extR.sub(tH.mul(extR.dot(tH))));
    F = F.add(rCh); T = T.add(rR.cross(rCh));

    // --- wheel spin + brakes (caliper reaction into fork / swingarm)
    const spin = (w, I, c, Tin, Tb) => {
      let wn = w + dt * (Tin - (c ? c.Fx * R + c.crr * c.N * R * Math.tanh(w * 2) : 0.02 * w)) / I;
      const dw = Tb * dt / I; let applied = 0;
      if (Math.abs(wn) <= dw) { applied = wn * I / dt; wn = 0; } else { applied = Math.sign(wn) * Tb; wn -= Math.sign(wn) * dw; }
      return [wn, applied];
    };
    let tbF, tbR;
    [this.wF, tbF] = spin(this.wF, IW_F, cF, 0, ip.bF * BRAKE.front);
    [this.wR, tbR] = spin(this.wR, IW_R, cR, Tdrive, ip.bR * BRAKE.rear);
    T = T.add(axW.mul(-tbF));
    // rear caliper sits on the swingarm: its reaction acts on the swingarm DOF
    const thddB = tbR / this.Ith;
    F = F.add(tH.mul(-tbR / tl)); T = T.add(rR.cross(tH.mul(-tbR / tl)));

    // --- body/frame contacts: penalty springs with friction (lets crashes happen without passing through)
    for (const bp of BODY_PTS) {
      const r = q.rot(bp.p), wp = this.p.add(r), d = Math.min(0.08, this.track.h(wp.x, wp.z) - wp.y);
      if (d <= 0) continue;
      const nn = this.track.normal(wp.x, wp.z), n = new V(nn.x, nn.y, nn.z), vp = this.v.add(this.w.cross(r)), vn = vp.dot(n);
      const Nn = Math.max(0, 40000 * d - 1500 * vn), vt = vp.sub(n.mul(vn)), vtl = vt.len();
      const f = n.mul(Nn).add(vtl > 1e-3 ? vt.mul(-0.6 * Nn / Math.max(vtl, 0.5)) : new V());
      F = F.add(f); T = T.add(r.cross(f));
    }
    // rider contact forces (hands on grips, feet on pedals, pelvis on saddle)
    // mounted torso: spring-damper between the torso mass and its anchor (weight shift moves the anchor)
    if (this.mounted) {
      const rA = q.rot(ANCHOR.add(new V(-ip.pitch * TORSO.shift - 0.08 * ip.bF - 0.05 * ip.bR, 0, 0))), aW = this.p.add(rA), vA = this.v.add(this.w.cross(rA));
      const dl = q.inv(this.pr.sub(aW)), vl = q.inv(this.vr.sub(vA)), K = TORSO.k, Cd = TORSO.c;
      const fl = new V(-K.x * dl.x - Cd.x * vl.x, -K.y * dl.y - Cd.y * vl.y + (grounded ? TORSO.m * GRAV * Math.max(0.3, up.y) : 0), -K.z * dl.z - Cd.z * vl.z);
      const fr = q.rot(fl);
      this.vr = this.vr.add(fr.mul(dt / TORSO.m)).add(g.mul(dt)); this.pr = this.pr.add(this.vr.mul(dt));
      F = F.sub(fr); T = T.add(rA.cross(fr.mul(-1))); this.torsoOff = dl;
      T = T.add(right.mul(ip.pitch * 110));                 // bar/pedal push-pull against the body
      // crash: head/torso into the ground, or the bike upside down
      for (const off of [0, 0.42]) { const hp = this.pr.add(up.mul(off)); if (this.track.h(hp.x, hp.z) > hp.y - 0.15) this.crashed = true; }
      if (up.y < 0.1) this.crashed = true;
    }
    for (const e of ext) { F = F.add(e.f); T = T.add(e.p.sub(this.p).cross(e.f)); if (e.t) T = T.add(e.t); }

    // --- ←/→ body lean. On the ground the rider tips the bike over (on top of what the steering wants);
    // leaning into a banked/committed turn lets the rider pump it for speed. In the air it only rolls the
    // bike + rider (a torque never changes where the centre of mass flies) and fades back when released.
    if (!this.crashed && Math.abs(ip.lean) > 0.01) {
      if (grounded) {
        const into = Math.sign(ip.lean) === Math.sign(lean) ? Math.min(1, Math.abs(lean) / 0.35) : 0;
        if (vf > 2 && into > 0) F = F.add(fh.mul(110 * Math.abs(ip.lean) * into * clamp(1.6 - Math.abs(lean) / 0.5, 0, 1)));   // no extra drive when already at the grip limit   // pumping the turn
      }
    }
    // --- carving a berm (A/D + ←/→ together): the banked wall pushes the bike round. Extra yaw rate plus the
    // matching inward push (m·v·ω) so the velocity turns with the heading instead of sliding
    const cv = this.carve;
    if (cv && cv.combo > 0 && this.cF && this.cR && vf > 2 && !this.crashed) {
      const strength = cv.combo * clamp(0.35 + cv.bankIn / 0.45, 0, 1.4);   // a little on the flat, lots on a real berm
      const wx = 1.6 * strength, wNow = -this.w.y * cv.dir;               // extra yaw rate wanted (rad/s), current (+ = into turn)
      const tq = (this.mounted ? 260 : 40) * clamp(wx - Math.max(0, wNow - Math.abs(vf * Math.tan(this.steer) / G.WHEELBASE)), -1, 1);
      T = T.add(new V(0, -cv.dir * tq, 0));
      F = F.add(rh.mul(cv.dir * (this.mounted ? 94 : 15) * vf * wx * 0.6));
    }
    // --- low-speed foot-dab balance (a foot touching the ground), external
    const dab = grounded ? clamp((3 - vf) / 2, 0, 1) : 0;
    if (dab > 0 && !this.crashed) T = T.add(fh.mul(-dab * (1800 * lean + 400 * leanRate)));
    // airborne: rider uses body movement to keep the bike level in roll
    // --- assistance layer (upright, directional, landing, post-landing) - see assist.js. Applied to the
    // whole rider+bike: a share goes to the frame here, the rest to the rider's body (system.js)
    this.assistT = this.crashed ? new V() : this.assist.torque(this, dt, { fh, rh, up, fwd, right, lean, leanRate, vf, grounded, steerIn: ip.steer });
    T = T.add(this.assistT.mul(this.mounted ? 1 : 0.15));
    F = F.sub(this.v.mul(0.5 * 1.2 * (this.mounted ? 0.55 : 0.15) * this.v.len()));   // aerodynamic drag (rider + bike CdA)

    // --- integrate chassis (rigid body with full inertia tensor in body frame)
    const acc = F.mul(1 / cm); this.aPrev = acc;
    this.v = this.v.addS(acc, dt);
    const wb = q.inv(this.w), tb = q.inv(T), Iw = new V(INR.x * wb.x, INR.y * wb.y, INR.z * wb.z), gyro = wb.cross(Iw);
    const wbn = new V(wb.x + dt * (tb.x - gyro.x) / INR.x, wb.y + dt * (tb.y - gyro.y) / INR.y, wb.z + dt * (tb.z - gyro.z) / INR.z);
    this.w = q.rot(wbn);
    this.p = this.p.addS(this.v, dt);
    this.q = q.integrate(this.w, dt);

    // --- integrate suspension DOFs with hard mechanical stops
    this.sFd += sFdd * dt; this.sF += this.sFd * dt;
    if (this.sF > G.FORK.travel) { this.sF = G.FORK.travel; if (this.sFd > 0) this.sFd = 0; this.bottomF = 0.3; }
    if (this.sF < 0) { this.sF = 0; if (this.sFd < 0) this.sFd = 0; }
    this.thd += (thdd + thddB) * dt; this.th += this.thd * dt;
    if (this.th > G.LINK.thBot) { this.th = G.LINK.thBot; if (this.thd > 0) this.thd = 0; this.bottomR = 0.3; }
    if (this.th < G.LINK.thExt) { this.th = G.LINK.thExt; if (this.thd < 0) this.thd = 0; }

    // --- drivetrain kinematics (freehub: cranks/chain only turn while pedalling)
    const pedalling = ip.thr > 0.05 && Tdrive > 0.5;
    if (pedalling) { const dA = this.wR * ratio * dt; this.crank += dA; this.chainPos += dA * G.cogR(G.RING_T); this.cassette += this.wR * dt; }
    this.wheelAngF = (this.wheelAngF || 0) + this.wF * dt; this.wheelAngR = (this.wheelAngR || 0) + this.wR * dt;

    if (grounded && this.air > 0) this.lastAir = this.air;
    this.air = grounded ? 0 : this.air + dt;
    this.rim = (cF && cF.rim) || (cR && cR.rim) ? 0.3 : Math.max(0, this.rim - dt);
    this.bottomF = Math.max(0, this.bottomF - dt); this.bottomR = Math.max(0, this.bottomR - dt);
    this.Tdrive = Tdrive; this.Fs = Fs; this.Ffork = Ffork; this.time += dt;
  }

  get forkTravel() { return this.sF; }
  get shockStroke() { return G.SHOCK.eye - G.rearAt(this.th).len; }
  get rearTravel() { return G.rearAt(this.th).ay - G.rearAt(G.LINK.thExt).ay; }
  get ok() { return [this.p.x, this.p.y, this.p.z, this.w.x, this.v.y].every(Number.isFinite); }
}
