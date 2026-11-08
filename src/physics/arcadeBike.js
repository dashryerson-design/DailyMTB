// Simplified, glitch-free bike. The only "real" physics is what you feel: two springy suspension units
// (front fork, rear shock) between the ground under each wheel and a chassis that bobs and pitches on them.
// Wheels follow the ground HEIGHT only - no sideways tyre forces, no edges to catch, nothing to fling you.
// Steering is kinematic (turn radius from input + speed + grip), lean follows the turn, airtime is ballistic.
import { V, Q, X, Y, Z, clamp } from '../core/math.js';
import { SURF_PROPS } from '../terrain/track.js';
import * as G from './geometry.js';
import { COM as FRAME_COM } from './bike.js';

const GRAV = 9.81, R = G.R_WHEEL;
export const COM = FRAME_COM;                 // drawing frame origin offset (kept for the renderer)
const M = 94, IP = 20;                        // rider+bike mass, pitch inertia
const SYS = [0.06, 0.62];                     // combined centre of mass in the BB frame
const XF = G.AXLE_F[0] - SYS[0], XR = G.AXLE_R[0] - SYS[0];
const TRAVEL = 0.18, SAG_F = 0.045, SAG_R = 0.054;
const HUB_YF = G.AXLE_F[1] + SAG_F - SYS[1], HUB_YR = G.AXLE_R[1] + SAG_R - SYS[1];   // fully extended hubs, CoM-relative
const LOAD_F = M * GRAV * (SYS[0] - G.AXLE_R[0]) / G.WHEELBASE, LOAD_R = M * GRAV - LOAD_F;
// springs: linear + progressive ramp, static sag hits target; soft-ish damping for a lively, squishy feel
const SPR = {
  f: { k3: 9e5, damp: [480, 680] }, r: { k3: 9e5, damp: [560, 780] },
};
SPR.f.k = (LOAD_F - SPR.f.k3 * SAG_F ** 3) / SAG_F; SPR.r.k = (LOAD_R - SPR.r.k3 * SAG_R ** 3) / SAG_R;
const springF = (s, c, cd) => { let f = s.k * c + s.k3 * c * c * c + (cd > 0 ? s.damp[0] : s.damp[1]) * cd; const b = c - (TRAVEL - 0.012); if (b > 0) f += 2e5 * b + 1500 * Math.max(cd, 0); return clamp(f, 0, 3.2 * M * GRAV); };   // capped: a wall under one wheel can't fire you into the sky

// rear axle vertical travel -> swingarm angle (for drawing the linkage)
const TH_TABLE = (() => { const t = [], y0 = G.rearAt(G.LINK.thExt).ay; for (let i = 0; i <= 200; i++) { const th = G.LINK.thExt + (G.LINK.thBot - G.LINK.thExt) * i / 200; t.push([G.rearAt(th).ay - y0, th]); } return t; })();
const thForTravel = (c) => { const t = TH_TABLE; c = clamp(c, 0, t[t.length - 1][0]); let i = 1; while (i < t.length - 1 && t[i][0] < c) i++; const [a0, b0] = t[i - 1], [a1, b1] = t[i]; return b0 + (b1 - b0) * (c - a0) / Math.max(a1 - a0, 1e-9); };

export class ArcadeBike {
  constructor(track) { this.track = track; this.reset(0, 0); }

  reset(s, speed) {
    const t = this.track, p = t.sampleAt(s);
    this.psi = p.psi; this.speed = speed; this.vxa = 0; this.vza = 0;
    this.cx = p.x; this.cz = p.z;
    const g = t.h(p.x, p.z);
    this.cy = g + R + 0.35 + SYS[1] - 0.03; this.vy = 0;           // CoM height
    this.pitch = Math.atan2(t.h(p.x + Math.cos(p.psi) * 0.6, p.z + Math.sin(p.psi) * 0.6) - g, 0.6); this.pr8 = 0;
    this.lean = 0; this.leanB = 0; this.kap = 0; this.steer = 0; this.airYaw = 0; this.yawRate = 0;
    this.sF = SAG_F; this.sFd = 0; this.cR_ = SAG_R; this.cRd = 0; this.th = thForTravel(SAG_R); this.thd = 0;
    this.wheelAngF = 0; this.wheelAngR = 0; this.crank = Math.PI / 2; this.cassette = 0; this.chainPos = 0; this.gear = 0;
    this.inp = { thr: 0, bF: 0, bR: 0, steer: 0, pitch: 0, lean: 0 };
    this.air = 0; this.lastAir = 0; this.cF = null; this.cR = null; this.crashed = false; this.crashCause = ''; this.mounted = true;
    this.bottomF = 0; this.bottomR = 0; this.rim = 0; this.visBank = 0; this.load = 1;
    this.aPrev = new V(); this.torsoOff = new V(); this.w = new V();
    this.updatePose();
  }

  // ---- derived pose for the renderer / rider animation
  updatePose() {
    const q = Q.axis(Y, -(this.psi + this.airYaw)).mul(Q.axis(Z, this.pitch)).mul(Q.axis(X, this.lean));
    this.q = q;
    // the drawing frame's origin is the frame CoM; place it so the system CoM sits at (cx, cy, cz)
    const off = q.rot(new V(SYS[0] - COM[0], SYS[1] - COM[1], 0));
    this.p = new V(this.cx, this.cy, this.cz).sub(off);
    const vh = this.air > 0 ? new V(this.vxa, 0, this.vza) : new V(Math.cos(this.psi) * this.speed, 0, Math.sin(this.psi) * this.speed);
    this.v = new V(vh.x, this.vy, vh.z); this.vr = this.v; this.pr = this.p.add(q.rot(new V(-0.2, 0.55, 0)));
    this.w = new V(0, -this.yawRate, 0);
  }

  groundUnder(dx) {                 // ground height under a point dx metres ahead of the CoM (along the heading)
    const c = Math.cos(this.psi + this.airYaw), s = Math.sin(this.psi + this.airYaw);
    return this.track.h(this.cx + c * dx * Math.cos(this.pitch), this.cz + s * dx * Math.cos(this.pitch));
  }

  step(dt, keys = {}) {
    const t = this.track, ip = this.inp, ap = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
    if (this.crashed) keys = {};
    ip.thr = ap(ip.thr, keys.w ? 1 : 0, 3); ip.bR = ap(ip.bR, keys.s ? 1 : 0, 6); ip.bF = ap(ip.bF, keys.space ? 1 : 0, 6);
    ip.steer = ap(ip.steer, keys.steer ?? ((keys.d ? 1 : 0) - (keys.a ? 1 : 0)), 6);
    ip.pitch = ap(ip.pitch, keys.pitch ?? ((keys.down ? 1 : 0) - (keys.up ? 1 : 0)), 6);
    ip.lean = ap(ip.lean, keys.lean ?? ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)), 4);

    // ---- suspension: ground height under each wheel vs where the fully extended wheel would be
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const foot = (dx) => Math.max(this.groundUnder(dx), this.groundUnder(dx - 0.18), this.groundUnder(dx + 0.18));   // tyre footprint
    const gF = foot(XF), gR = foot(XR);
    const extF = this.cy + XF * sp + HUB_YF * cp - R, extR = this.cy + XR * sp + HUB_YR * cp - R;
    const cF = gF - extF, cRr = gR - extR;                       // compression (negative = wheel off the ground)
    const cFd = (cF - (this._cF ?? cF)) / dt, cRd = (cRr - (this._cR ?? cRr)) / dt; this._cF = cF; this._cR = cRr;
    const onF = cF > 0, onR = cRr > 0;
    const FF = onF ? springF(SPR.f, cF, cFd) : 0, FR = onR ? springF(SPR.r, cRr, cRd) : 0;
    const surfAt = (dx) => { const c = Math.cos(this.psi), s = Math.sin(this.psi); return SURF_PROPS[t.surface(this.cx + c * dx, this.cz + s * dx)]; };
    this.cF = onF ? { surf: surfAt(XF), N: FF, pen: 0, rim: false } : null;
    this.cR = onR ? { surf: surfAt(XR), N: FR, pen: 0, rim: false } : null;
    const grounded = onF || onR;
    this.load = (FF + FR) / (M * GRAV);

    // ---- vertical + pitch dynamics of the chassis on its springs
    let torque = (FF * XF + FR * XR) * cp;
    if (!this.crashed) torque += ip.pitch * (grounded ? 140 : 230);     // pull up / push down (manuals, air)
    if (!grounded && !this.crashed && Math.abs(ip.pitch) < 0.05) {     // airborne: ease toward the landing slope
      const slope = Math.atan2(this.groundUnder(3) - this.groundUnder(-1), 4), e = this.pitch - slope;
      if (Math.abs(e) > 0.08) torque += -650 * (e - Math.sign(e) * 0.08) - 130 * this.pr8;
    }
    const ay = (FF + FR) * cp / M - GRAV;
    this.vy += ay * dt;
    // the ground can only throw you up as fast as you're actually riding up it (lip speed), never more
    if (grounded) { const lift = Math.max(0, (this.groundUnder(0.6) - this.groundUnder(-0.6)) / 1.2) * Math.max(this.speed, 0) + 1.5; if (this.vy > lift) this.vy = lift; }
    this.cy += this.vy * dt;
    this.pr8 += (torque / IP - (grounded ? 4 : 0.3) * this.pr8) * dt; this.pitch += this.pr8 * dt;
    this.aPrev = new V(0, ay, 0);

    // ---- forward motion along the ground
    const sf = this.cF?.surf || this.cR?.surf || SURF_PROPS[0];
    if (grounded) {
      const slope = (this.groundUnder(0.4) - this.groundUnder(-0.4)) / 0.8;
      let a = -GRAV * slope / Math.sqrt(1 + slope * slope);
      if (ip.thr > 0.02) a += ip.thr * Math.min(3.2, 700 / Math.max(this.speed, 1) / M);
      a -= Math.sign(this.speed) * (sf.crr * GRAV + 0.0035 * this.speed * this.speed);
      const brake = (ip.bR * 4.5 + ip.bF * 6.5) * Math.min(1, sf.mu);
      if (this.speed > 0) this.speed = Math.max(0, this.speed + (a - brake) * dt); else this.speed += a * dt;
      if (this.crashed) this.speed *= Math.max(0, 1 - 2.5 * dt);
    }

    // ---- steering: turn radius from input, speed and available grip (more on a berm banked into the turn)
    const n = t.normal(this.cx, this.cz), rh = new V(-Math.sin(this.psi), 0, Math.cos(this.psi));
    const bank = Math.atan2(n.x * rh.x + n.z * rh.z, n.y);
    const v = Math.max(this.speed, 0.1), side = Math.sign(ip.steer) || 1, bankIn = Math.max(0, side * bank);
    const combo = Math.abs(ip.steer) > 0.1 && Math.sign(ip.lean) === Math.sign(ip.steer) ? Math.abs(ip.lean) : 0;
    const aLat = (sf.mu * 0.85 + 1.2 * Math.tan(bankIn)) * GRAV * (1 + 0.5 * combo);
    const kMax = Math.min(1 / (2.4 - 0.6 * combo), aLat / (v * v));
    if (grounded && !this.crashed) {
      // realistic order: input sets the lean you want, the bike rolls into it (takes a moment), and the turn
      // comes from the lean (tan(lean) = v²·κ / g). Below walking pace you just point the bars.
      const want = Math.atan(v * v * ip.steer * kMax / GRAV);
      this.leanB = (this.leanB ?? 0) + clamp(want - (this.leanB ?? 0), -2.6 * dt, 2.6 * dt);
      const kLean = GRAV * Math.tan(this.leanB) / (v * v), slow = clamp((3 - v) / 2.5, 0, 1);
      let k = kLean * (1 - slow) + ip.steer * 0.42 * slow;
      // asking for more than the tyres can hold: the bike drifts wide and scrubs speed
      const over = Math.abs(k) * v * v - aLat; if (over > 0) { k = Math.sign(k) * aLat / (v * v); this.speed = Math.max(0, this.speed - over * 0.25 * dt); }
      this.kap = ap(this.kap, k, 6);
      this.yawRate = this.speed * this.kap;
      this.psi += this.yawRate * dt;
      // lean = what the turn needs + the rider's own ←/→ lean
      const leanT = clamp(this.leanB * (1 - clamp((3 - v) / 2.5, 0, 1)) + 0.35 * ip.lean * (1 - combo * 0.5), -1.0, 1.0);
      this.lean += (leanT - this.lean) * Math.min(1, dt * 10);
      this.visBank = Math.sign(this.kap) === Math.sign(bank) ? bank * clamp(Math.abs(this.kap) * 15, 0, 1) : 0;
      this.airYaw *= Math.max(0, 1 - dt * 12);
    } else if (!grounded && !this.crashed) {
      this.yawRate *= Math.max(0, 1 - dt * 3);
      this.lean += (0.55 * ip.lean - this.lean) * Math.min(1, dt * 4);   // air tilt, back to level on release
      this.airYaw += (0.8 * ip.lean - this.airYaw) * Math.min(1, dt * 4); // whip: the bike swings out, the path doesn't
      this.visBank = 0;
    } else {                                                             // crashed: bike slides and falls over
      this.lean += ((this.lean >= 0 ? 1.4 : -1.4) - this.lean) * Math.min(1, dt * 3);
    }

    // ---- horizontal position: along the heading on the ground, ballistic in the air
    if (grounded) { this.vxa = Math.cos(this.psi) * this.speed; this.vza = Math.sin(this.psi) * this.speed; }
    this.cx += this.vxa * dt; this.cz += this.vza * dt;

    // ---- air time, landings
    if (!grounded) this.air += dt;
    else {
      if (this.air > 0.12) {
        this.lastAir = this.air;
        const slope = Math.atan2(this.groundUnder(1) - this.groundUnder(-1), 2), pe = Math.abs(this.pitch - slope);
        if (!this.crashed && (pe > 1.3 || Math.abs(this.lean) > 1.1)) { this.crashed = true; this.crashCause = 'bad landing'; this.mounted = this.mounted; }
        this.speed = Math.hypot(this.vxa, this.vza) * Math.cos(Math.min(this.airYaw, 0.6));   // landing crossed-up scrubs a little speed
        this.psi += this.airYaw * 0.5; this.airYaw *= 0.5;
      }
      this.air = 0;
    }
    // hard stop: never sink through the ground (deep compression beyond the bump stops)
    const bbY = this.cy - SYS[1] * Math.cos(this.pitch) - SYS[0] * Math.sin(this.pitch), gBB = this.groundUnder(-SYS[0]);
    const lowest = Math.max(gF - extF - TRAVEL, gR - extR - TRAVEL, gBB + 0.12 - bbY); if (lowest > 0) { this.cy += lowest; if (this.vy < 0) this.vy = 0; this.rim = 0.3; } else this.rim = Math.max(0, this.rim - dt);

    // ---- suspension state for drawing / HUD
    const cfd = clamp(cF, 0, TRAVEL), crd = clamp(cRr, 0, TRAVEL);
    this.sFd = (cfd - this.sF) / dt; this.sF = cfd;
    if (cfd > TRAVEL - 0.008) this.bottomF = 0.3; else this.bottomF = Math.max(0, this.bottomF - dt);
    if (crd > TRAVEL - 0.008) this.bottomR = 0.3; else this.bottomR = Math.max(0, this.bottomR - dt);
    const thN = thForTravel(crd); this.thd = (thN - this.th) / dt; this.th = thN;
    // rider's body: sinks under load, shifts back when braking (drives the animation)
    this.torsoOff = new V(-0.06 * (ip.bF + 0.6 * ip.bR) - 0.12 * ip.pitch, clamp(-0.09 * (this.load - 1), -0.12, 0.05), 0);

    // ---- wheels, cranks, chain
    const ws = (grounded ? this.speed : Math.hypot(this.vxa, this.vza)) / R;
    this.wheelAngF += ws * dt; this.wheelAngR += ws * dt;
    const cog = G.COGS[this.gear], cad = ws * cog / G.RING_T;
    if (ip.thr > 0.05) { if (cad > 11 && this.gear < G.COGS.length - 1) this.gear++; else if (cad < 7 && this.gear > 0) this.gear--;
      const dA = ws * (G.COGS[this.gear] / G.RING_T) * dt; this.crank += dA; this.chainPos += dA * G.cogR(G.RING_T); this.cassette += ws * dt; }
    this.updatePose();
  }

  get forkTravel() { return this.sF; }
  get rearTravel() { return G.rearAt(this.th).ay - G.rearAt(G.LINK.thExt).ay; }
  get shockStroke() { return G.SHOCK.eye - G.rearAt(this.th).len; }
  get ok() { return [this.cx, this.cy, this.cz, this.pitch].every(Number.isFinite); }
}
