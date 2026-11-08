// Procedural rider animation while mounted. No physics: every frame the 17 joint positions are computed
// from the bike's state (torso mass offset, speed, braking, lean, airtime, crank angle, steering) with a
// few blended posture parameters, then arms/legs are solved with 2-bone IK to the grips and pedals.
import { V, rodr, clamp } from '../core/math.js';
import * as G from '../physics/geometry.js';
import { COM, TORSO } from '../physics/bike.js';
import { J, SEG } from '../physics/rider.js';

const dfl = new V(G.DF[0], G.DF[1], 0), crown = new V(G.CROWN[0], G.CROWN[1], 0);
const ik = (a, t, l1, l2, pole) => {
  const d = t.sub(a), dl = Math.min(d.len(), l1 + l2 - 1e-4), dn = d.norm();
  const x = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pp = pole.sub(dn.mul(pole.dot(dn))).norm();
  return a.add(dn.mul(x)).add(pp.mul(h));
};
const ease = (cur, tgt, rate, dt) => cur + (tgt - cur) * Math.min(1, dt * rate);

export class RiderPose {
  constructor() { this.reset(); }
  reset() { this.s = { stand: 1, brake: 0, accel: 0, corner: 0, air: 0, land: 0 }; this.prev = null; this.x = null; this.v = null; this.wasAir = false; }

  // all positions in the BB frame (x forward, y up, z right), returned in world space
  update(b, dt) {
    const s = this.s, ip = b.inp, spd = Math.max(0, b.speed || 0), air = b.air > 0.06;
    // ---- posture weights (smoothly blended)
    s.stand = ease(s.stand, (spd > 3.5 || air || ip.pitch !== 0 || Math.abs(b.sFd) > 0.4) ? 1 : 0, 3, dt);
    s.brake = ease(s.brake, Math.min(1, ip.bF + 0.6 * ip.bR) * Math.min(1, spd / 3), 6, dt);
    s.accel = ease(s.accel, ip.thr, 4, dt);
    s.corner = ease(s.corner, clamp(b.lean || 0, -0.8, 0.8), 8, dt);
    s.side = ease(s.side ?? 0, ip.lean || 0, 7, dt);
    // pedalling rhythm (driven by the actual crank angle): hips rock and drive side to side with each
    // stroke, the trunk counter-sways and twists, the head stays quiet. Bigger out of the saddle.
    s.pedal = ease(s.pedal ?? 0, (ip.thr > 0.05 && !air) ? Math.min(1, ip.thr) : 0, 5, dt);
    const pa = s.pedal * (0.75 + 0.6 * s.stand), ph = b.crank || 0, sw = Math.sin(ph), sw2 = Math.cos(2 * ph);
    const whip = s.side * s.air;                                       // mid-air style move (0 on the ground)
    s.yawRel = ease(s.yawRel ?? 0, air ? (b.airYaw || 0) : 0, 10, dt);
    s.air = ease(s.air, air ? 1 : 0, 6, dt);
    if (!air && this.wasAir && b.lastAir > 0.15) s.land = Math.min(1.3, 0.55 + 1.1 * b.lastAir);
    this.wasAir = air; s.land = Math.max(0, s.land - dt * 1.5);

    // ---- pelvis: seated/standing base + the physics torso offset (bumps, landings, weight shift)
    const tOff = b.torsoOff || new V();
    let hx = -0.23 + 0.07 * s.stand - 0.13 * s.brake + 0.04 * s.accel + clamp(tOff.x, -0.2, 0.2);
    let hy = 0.785 + 0.095 * s.stand + 0.05 * s.air - 0.17 * s.land + clamp(tOff.y, -0.2, 0.06) - 0.005 * pa * sw2;
    const hz = clamp(tOff.z, -0.05, 0.05) - 0.05 * s.corner + 0.09 * s.side + 0.07 * whip + 0.05 * pa * sw;   // hips throw out in the air; drive over each pedal stroke
    // never further than the legs can reach to either pedal
    const reach = (SEG.thigh + SEG.shin) * 0.97;
    for (const sd of [-1, 1]) { const pd = G.pedalAt(b.crank, sd), ax = pd[0] - 0.04, ay = pd[1] + 0.075;
      hy = Math.min(hy, ay + Math.sqrt(Math.max(0.01, reach * reach - (hx - ax) ** 2 - (sd * (G.PEDAL_Z - SEG.hipW)) ** 2))); }
    const H = new V(hx, hy, hz);
    // ---- torso: forward lean angle from the posture, a little extra inward lean in corners
    const fwdLean = 0.62 + 0.25 * s.stand + 0.12 * s.accel - 0.2 * s.brake + 0.3 * s.land - 0.1 * s.air;
    // lower torso goes with the hips (and the whip); the chest/shoulders stay level with the world in the air
    const tilt = -0.25 * s.corner + 0.3 * s.side - 0.4 * whip - 0.45 * (b.lean || 0) * s.air + 0.03 * pa * sw;
    const tiltU = (-0.25 * s.corner + 0.3 * s.side) * (1 - s.air) - (b.lean || 0) * s.air - 0.09 * pa * sw;   // shoulders counter the hips
    const dir = (a, len, t) => new V(Math.sin(a) * len, Math.cos(a) * len * Math.cos(t), Math.cos(a) * len * Math.sin(t));
    const spine = H.add(dir(fwdLean * 0.55, SEG.lumbar, tilt));
    let neck = spine.add(dir(fwdLean, SEG.thorax, tiltU));
    // keep the shoulders within arm reach of the grips
    const grips = [-1, 1].map(sd => { const g = new V(G.GRIP[0], G.GRIP[1], sd * G.GRIP_Z); return crown.add(rodr(g.sub(crown), dfl, -b.steer)); });
    for (let it = 0; it < 3; it++) for (const [i, sd] of [[0, -1], [1, 1]]) {
      const sh = neck.add(new V(0, -0.03, sd * SEG.shW)), d = grips[i].sub(sh), L = d.len(), max = (SEG.upper + SEG.fore) * 0.97;
      if (L > max) neck = neck.add(d.mul((L - max) / L));
    }
    // head stays steadier than the body: blend its "up" toward world up, look ahead
    const wUp = b.q.inv(new V(0, 1, 0)), headUp = new V(0.35, 1, 0).norm().mul(0.5).add(wUp.mul(0.5)).norm();
    // airborne: upper body counter-rotates to keep facing the direction of travel while the bike whips
    const twist = -(s.yawRel || 0) - 0.1 * pa * sw,   // shoulders keep facing the direction of travel
       rotY = (p) => { const d = p.sub(spine), c = Math.cos(twist), sn = Math.sin(twist); return spine.add(new V(d.x * c + d.z * sn, d.y, -d.x * sn + d.z * c)); };
    neck = rotY(neck);
    const head = neck.add(headUp.mul(SEG.neck)).add(new V(0.06, 0, 0));
    const P = new Array(17);
    const tw = 0.35 * s.side + 0.6 * whip + 0.16 * pa * sw;   // hips turn toward the lean, hard in the air
    P[J.hipL] = H.add(new V(SEG.hipW * Math.sin(tw), 0, -SEG.hipW * Math.cos(tw))); P[J.hipR] = H.add(new V(-SEG.hipW * Math.sin(tw), 0, SEG.hipW * Math.cos(tw)));
    P[J.spine] = spine; P[J.neck] = neck; P[J.head] = head;
    P[J.shL] = rotY(neck.add(new V(0, -0.03, -SEG.shW)).sub(neck).add(spine)).sub(spine).add(neck); P[J.shR] = rotY(neck.add(new V(0, -0.03, SEG.shW)).sub(neck).add(spine)).sub(spine).add(neck);
    for (const [sd, k, gi] of [[-1, 'L', 0], [1, 'R', 1]]) {
      const pd = G.pedalAt(b.crank, sd);
      P[J['hand' + k]] = grips[gi];
      P[J['elb' + k]] = ik(P[J['sh' + k]], grips[gi], SEG.upper, SEG.fore, new V(-0.4, -0.5 - 0.3 * s.land, sd * 0.8));
      P[J['ank' + k]] = new V(pd[0] - 0.04, pd[1] + 0.075, sd * G.PEDAL_Z); P[J['toe' + k]] = new V(pd[0] + 0.11, pd[1] + 0.03, sd * G.PEDAL_Z);
      P[J['knee' + k]] = ik(P[J['hip' + k]], P[J['ank' + k]], SEG.thigh, SEG.shin, new V(1, 0.25, sd * 0.18 + 0.5 * whip));   // knees swing over with the hips
    }
    // ---- to world, plus per-joint velocities (needed if the rider is thrown off)
    const x = P.map(p => b.p.add(b.q.rot(p.sub(new V(COM[0], COM[1], 0)))));
    this.v = this.prev && dt > 0 ? x.map((p, i) => p.sub(this.prev[i]).mul(1 / dt)) : x.map(() => b.v);
    this.prev = x; this.x = x;
    return this;
  }
}
