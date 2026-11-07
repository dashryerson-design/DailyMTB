// Riding-assist layer. It sits beside the physics and only adds small, state-dependent torques to the
// bike chassis (the rider then follows through their hand/foot contacts). Nothing is locked or scripted:
// every assist has a deadband, scales with the situation, and fades out once the bike is settled.
import { V, clamp } from '../core/math.js';

export const ASSIST = {
  steerRate: 6,
  minRadius: 3.5,        // tightest turn radius a full input asks for (m)
  latG: 0.85,            // max cornering g a full input asks for          // max steering angle rate (rad/s) at the bars
  inputRate: 6,          // how fast A/D input ramps (1/s)
  leanRate: 3,
  leanBandwidth: 7,      // how tightly the rider's steering tracks the wanted lean (rad/s)         // how fast the rider can change target lean (rad/s)
  upright: 1.0,          // upright stability strength (0 = off)
  directional: 1.0,      // directional (heading follows velocity) strength
  landingAlign: 1.0,     // airborne pitch/roll alignment toward the landing surface
  landingRoll: 1.0,      // airborne roll correction
  recovery: 1.0,         // post-landing roll/yaw settling
  surface: 1.0,          // keeps the bike's angle to a banked surface in a sane band and calm
};

const deadband = (e, d) => Math.abs(e) < d ? 0 : e - Math.sign(e) * d;

export class Assist {
  constructor() { this.reset(); }
  reset() { this.yawF = 0; this.post = 0; this.wasAir = false; this.land = null; this.info = {}; }

  // returns a world torque to add to the chassis
  torque(b, dt, ctx) {
    const A = ASSIST, { fh, rh, up, lean, leanRate, vf, grounded, steerIn } = ctx;
    let T = new V();
    const v = Math.max(0, vf), w = b.w;
    // impacts make the instantaneous yaw rate spiky; the assists look at a ~0.1 s average
    this.yawF = (this.yawF ?? 0) + (w.y - (this.yawF ?? 0)) * Math.min(1, dt / 0.1); const yawRate = this.yawF;
    const info = this.info = { upright: 0, dir: 0, landP: 0, landR: 0, post: 0 };

    if (grounded) {
      // -- upright: compare lean with the lean the current turn actually needs (from measured yaw rate);
      //    only the unexplained part is corrected, so committed corners and berms are left alone
      const needed = Math.atan(clamp(-v * yawRate / 9.81, -1.2, 1.2));          // yaw right is -w.y
      const target = (Math.abs(steerIn) > 0.05 ? b.leanT * 0.5 + needed * 0.5 : needed) + 0.3 * b.inp.lean;   // deliberate ←/→ lean is not 'unexplained'
      // at speed the steering balance already does the work: assist only for clearly unexplained lean;
      // below ~5 m/s (where steering can't balance) it becomes the main helper
      const slow = clamp((5 - v) / 4, 0, 1);
      const raw = lean - target, err = deadband(raw, 0.05 + 0.07 * (1 - slow));
      // catch zone: firm help for anything recoverable, fading out only for a massive mistake (> ~60° off)
      const save = 1 - clamp((Math.abs(raw) - 0.8) / 0.3, 0, 1);
      const k = A.upright * save * (1100 * slow + 520), c = A.upright * save * (220 * slow + 70);
      const tu = -(k * err + c * leanRate * (slow + (Math.abs(err) > 0 ? 0.6 : 0.15)));
      T = T.add(fh.mul(tu)); info.upright = tu;

      // -- surface angle: on a bank, keep the bike within ~25° of square to the riding surface and damp
      //    roll wobble relative to it, so berms feel planted instead of twitchy
      const bk = b.bankF || 0, onBank = clamp(Math.abs(bk) / 0.15, 0, 1);
      if (onBank > 0) {
        const rel = lean - bk, ex = rel > 0.6 ? rel - 0.6 : rel < -0.6 ? rel + 0.6 : 0;
        const ts = -A.surface * onBank * (700 * ex + leanRate * (ex !== 0 ? 120 : 60));
        T = T.add(fh.mul(ts)); info.surface = ts;
      }
      // -- directional: line the bike up with its direction of travel (sideslip), weaker while steering
      const vel = new V(b.v.x, 0, b.v.z), vl = vel.len();
      if (vl > 1.5) {
        const slip = Math.atan2(vel.dot(rh), vel.dot(fh));                    // + = sliding to the right
        const s = A.directional * (1 - 0.7 * Math.min(1, Math.abs(steerIn))) * Math.min(1, vl / 4);
        const ty = -s * (160 * deadband(slip, 0.03)) - s * 25 * (yawRate - (-v * Math.tan(b.steer * 0.9) / 1.275)) * 0.5;
        T = T.add(new V(0, ty, 0)); info.dir = ty;
      }
    }

    // -- landing: airborne alignment toward the surface we are about to land on
    if (!grounded && b.air > 0.04) {
      const L = this.predictLanding(b, ctx);
      if (L) {
        this.land = L;
        // only correct what is clearly off: pitch error beyond +-10 deg, roll beyond +-4 deg
        const pitch = Math.asin(clamp(ctx.fwd.y, -1, 1)), pe = deadband(pitch - L.slope, 0.12);
        const urg = clamp(1.2 - L.t, 0.3, 1);                                   // closer to landing = firmer
        const pr = w.dot(ctx.right);
        const tp = -A.landingAlign * urg * (1 - Math.min(1, Math.abs(b.inp.pitch))) *   // player's own pitch input takes priority
           (650 * pe + 110 * pr * (Math.abs(pe) > 0 ? 1 : 0.3));
        const re = deadband(lean - L.bank - 0.75 * b.inp.lean, 0.07);   // ←/→ holds a mid-air tilt; released = back to level
        const tr = -A.landingRoll * Math.max(urg, 0.7 * Math.abs(b.inp.lean)) * (650 * re + 150 * leanRate);
        // ←/→ whip: the bike also yaws out of line with the direction of travel (pure torques - the flight
        // path stays the one set at take-off); released, it swings back in line for the landing
        const vb = b.q.inv(b.v), rel = -Math.atan2(vb.z, vb.x);                // + = nose pointing right of travel
        const yerr = rel - 0.8 * b.inp.lean, ky = Math.max(urg, 0.8 * Math.abs(b.inp.lean));
        const ty = ky * (320 * yerr - 70 * w.y);
        b.airYaw = rel;
        T = T.add(ctx.right.mul(tp)).add(fh.mul(tr)).add(new V(0, ty, 0));
        info.landP = tp; info.landR = tr;
      }
    }

    // -- post-landing recovery: extra roll/yaw damping that decays over ~0.7 s
    if (grounded && this.wasAir && b.lastAir > 0.2) this.post = Math.min(1, b.lastAir);
    this.wasAir = !grounded;
    if (this.post > 0 && grounded) {
      const tr = -A.recovery * this.post * (220 * leanRate) , ty = -A.recovery * this.post * 60 * yawRate;
      T = T.add(fh.mul(tr)).add(new V(0, ty, 0)); info.post = this.post;
      this.post = Math.max(0, this.post - dt / 0.7);
    }
    return T;
  }

  // march the current ballistic path forward until it meets the ground; return slope/bank there
  predictLanding(b, ctx) {
    const t = b.track, p = b.p, v = b.v;
    for (let tt = 0.02; tt < 1.5; tt += 0.02) {
      const x = p.x + v.x * tt, z = p.z + v.z * tt, y = p.y + v.y * tt - 4.905 * tt * tt;
      if (y - 0.62 <= t.h(x, z)) {
        const n = t.normal(x, z), fh = ctx.fh, rh = ctx.rh;
        const slope = -Math.atan2(n.x * fh.x + n.z * fh.z, n.y);              // + = landing uphill
        const bank = Math.atan2(n.x * rh.x + n.z * rh.z, n.y);
        return { t: tt, slope, bank };
      }
    }
    return null;
  }
}
