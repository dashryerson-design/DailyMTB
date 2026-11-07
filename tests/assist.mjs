// Riding-assist checks: node tests/assist.mjs
import { buildTrack } from '../src/terrain/track.js';
import { RideSystem } from '../src/physics/system.js';
import { maxLatAccel } from '../src/physics/bike.js';
import { ASSIST } from '../src/physics/assist.js';
import { J } from '../src/physics/rider.js';
import { V } from '../src/core/math.js';
import * as G from '../src/physics/geometry.js';
const track = buildTrack(), S = new RideSystem(track), b = S.bike, r = S.rider, dt = 0.001;
const sec = Object.fromEntries(track.sections.map(s => [s.name, s.s]));
const DEF = { ...ASSIST };
const OLD = { steerRate: 4, inputRate: 3, leanRate: 1.3, minRadius: 4.5 };           // settings before this pass
const OFF = { upright: 0, directional: 0, landingAlign: 0, landingRoll: 0, recovery: 0 };
const cfg = (o) => Object.assign(ASSIST, DEF, o);
const run = (secs, k, each) => { for (let i = 0; i < secs / dt; i++) { S.step(dt, typeof k === 'function' ? k(i * dt) : k); if (each) each(i * dt); } };
const head = () => { const f = b.q.rot(new V(1, 0, 0)); return Math.atan2(f.z, f.x); };
const pitch = () => Math.asin(b.q.rot(new V(1, 0, 0)).y);
const res = []; const log = (n, pass, msg) => { res.push(pass); console.log(`${String(n).padStart(2)}. ${pass ? 'PASS' : 'FAIL'}  ${msg}`); };
const deg = (x) => (x * 57.3).toFixed(0) + '°';
const nearestS = (p) => { const { S: SS, X, Z } = track.centerline; let bb = 1e9, bs = 0; for (let i = 0; i < SS.length; i += 2) { const d = (X[i] - p.x) ** 2 + (Z[i] - p.z) ** 2; if (d < bb) { bb = d; bs = SS[i]; } } return bs; };
const pilot = (vt = 8) => (t) => { const v = Math.max(b.speed, 1), L = Math.max(5, 1.4 * v), tp = track.sampleAt(nearestS(b.p) + L), f = b.q.rot(new V(1, 0, 0)), dx = tp.x - b.p.x, dz = tp.z - b.p.z, al = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz);
  const raw = Math.max(-1, Math.min(1, v * v * 2 * Math.sin(al) / Math.hypot(dx, dz) / maxLatAccel(v))); b._ps = (b._ps ?? 0) + (raw - (b._ps ?? 0)) * dt / 0.15;
  const k = { w: b.speed < vt, s: b.speed > vt + 1.5, steer: b._ps }; if (b.cR && !b.cF && b.q.inv(b.w).z < -0.3) k.pitch = 1; return k; };
// roll the whole rider+bike (not just the light frame) by an angular velocity about the bike's forward axis
const kick = (wr) => { const ax = b.q.rot(new V(1, 0, 0)), w = ax.mul(wr), c = (b.cF || b.cR) ? new V(b.p.x, track.h(b.p.x, b.p.z), b.p.z) : b.pr; /* on the ground: tip about the tyre contact line */ b.w = b.w.add(w); b.v = b.v.add(w.cross(b.p.sub(c))); b.vr = b.vr.add(w.cross(b.pr.sub(c))); };
const lift = (h) => { const d = new V(0, h, 0); b.p = b.p.add(d); b.pr = b.pr.add(d); };
const stepTurn = (v, o) => { cfg(o); S.reset(3, v); b._ps = 0; run(0.3, { w: b.speed < v }); const h0 = head(); let t10 = null, h1 = 0;
  run(1.5, (t) => ({ d: true, w: b.speed < v }), (t) => { if (t10 === null && Math.abs(head() - h0) > 0.175) t10 = t; if (Math.abs(t - 1) < 1e-4) h1 = head() - h0; });
  return { t10, h1, h15: head() - h0, lean: b.lean }; };

// 1. turning response, old vs new
const o4 = stepTurn(4, OLD), n4 = stepTurn(4, {}), o7 = stepTurn(7, OLD), n7 = stepTurn(7, {});
log(1, n4.h1 > o4.h1 * 1.25 && n7.t10 < o7.t10, `A/D response: 10° of heading at 7 m/s in ${(n7.t10 * 1000).toFixed(0)} ms (was ${(o7.t10 * 1000).toFixed(0)}); heading after 1 s at 4 m/s ${deg(n4.h1)} (was ${deg(o4.h1)}), at 7 m/s ${deg(n7.h1)} (was ${deg(o7.h1)})`);
// 2. tight corner: radius actually turned at 4 m/s with full input
cfg({}); S.reset(3, 4); run(0.3, { w: true }); let minR = 99; run(2.5, (t) => ({ a: true, w: b.speed < 4 }), (t) => { if (t > 1) minR = Math.min(minR, Math.abs(b.speed / (b.w.y || 1e-6))); });
cfg(OLD); S.reset(3, 4); run(0.3, { w: true }); let minRo = 99; run(2.5, (t) => ({ a: true, w: b.speed < 4 }), (t) => { if (t > 1) minRo = Math.min(minRo, Math.abs(b.speed / (b.w.y || 1e-6))); });
cfg({}); const tight = []; for (const n of ['Berm R (tight)', 'Flat turns']) { S.reset(sec[n] - 6, 7); b._ps = 0; run(6, pilot(7.5)); tight.push(!b.crashed); }
log(2, minR < minRo * 0.85 && tight.every(Boolean), `tight turns: full-lock radius at 4 m/s ${minR.toFixed(1)} m (was ${minRo.toFixed(1)} m); tight berm + technical turns ridden ${tight.every(Boolean) ? 'cleanly' : 'with a crash'}`);
// 3. upright help at low speed without losing lean in corners
const slowRide = (o) => { cfg(o); S.reset(3, 2.2); run(0.3, {}); kick(0.35); let ml = 0; run(5, { w: b.speed < 2.2 }, () => { ml = Math.max(ml, Math.abs(b.lean)); }); return { ml, c: b.crashed }; };
const sOn = slowRide({}), sOff = slowRide(OFF);
cfg({}); S.reset(sec['Berm L (wide)'] - 6, 8); b._ps = 0; let bl = 0; run(4, pilot(8), () => { bl = Math.max(bl, Math.abs(b.lean)); });
log(3, !sOn.c && sOn.ml <= sOff.ml + 0.02 && bl > 0.5, `upright help: walking-pace ride (8 km/h) max lean ${deg(sOn.ml)} with assist vs ${deg(sOff.ml)} without; still leans ${deg(bl)} in the wide berm`);
// 4. straight-line tracking through the rock garden with no steering input
const track4 = (o) => { cfg(o); S.reset(sec['Rock & root garden'], 8); let slip = 0, n = 0; const h0 = head(); run(4, { w: b.speed < 8 }, () => { const f = b.q.rot(new V(1, 0, 0)), vh = new V(b.v.x, 0, b.v.z); if (vh.len() > 1) { slip += Math.abs(Math.atan2(f.x * vh.z - f.z * vh.x, f.x * vh.x + f.z * vh.z)); n++; } }); return { slip: slip / n, dh: Math.abs(head() - h0), c: b.crashed }; };
const tOn = track4({}), tOff = track4(OFF);
log(4, !tOn.c && tOn.slip <= tOff.slip * 1.05 + 0.005 && tOn.dh < 0.35, `hands-off through rocks: mean sideslip ${deg(tOn.slip)} (no assist ${deg(tOff.slip)}), heading wander ${deg(tOn.dh)} (no assist ${deg(tOff.dh)})`);
// 5. small balance disturbance (sideways shove) is recovered
const shove = (o) => { cfg(o); S.reset(3, 6); run(0.5, { w: b.speed < 6 }); kick(0.6); let peak = 0, end = 0; run(1.5, { w: b.speed < 6 }, (t) => { peak = Math.max(peak, Math.abs(b.lean)); if (t > 1.2) end = Math.max(end, Math.abs(b.lean)); }); return { peak, end, c: b.crashed }; };
const shOn = shove({}), shOff = shove(OFF);
log(5, !shOn.c && shOn.end < 0.06 && shOn.peak <= shOff.peak + 0.03, `0.6 rad/s roll shove at 6 m/s: peak lean ${deg(shOn.peak)} (no assist ${deg(shOff.peak)}), settled to ${deg(shOn.end)} after 1.2 s`);
// 6. jump approaches stay composed
cfg({}); const app = []; for (const [n, v] of [['Rollers', 6.5], ['Tabletop', 8.5], ['Big jump', 10.5]]) { S.reset(sec[n] - 4, v); b._ps = 0; let ml = 0, landed = false; run(3, pilot(v), () => { if (b.lastAir > 0.2 && b.air === 0) landed = true; if (!landed) ml = Math.max(ml, Math.abs(b.lean)); }); app.push([n, ml, b.crashed]); }
log(6, app.every(([, ml, c]) => !c && ml < 0.35), `jump approach + airtime (until touchdown): ${app.map(([n, ml, c]) => `${n} max lean ${deg(ml)}${c ? ' CRASH' : ''}`).join(', ')}`);
// 7. airborne: roll is stabilised, but landings are not all forced to the same attitude
const air = (o, v, kk) => { cfg(o); S.reset(sec['Start'] + 8, v); run(0.2, {}); lift(2.5); run(0.02, {}); kick(kk); let land = null; run(1.2, {}, () => { if (land === null && (b.cF || b.cR)) land = { roll: b.lean, pitch: pitch() }; }); return land || { roll: b.lean, pitch: pitch() }; };
const aOn = air({}, 8, 0.8), aOff = air(OFF, 8, 0.8), aSlow = air({}, 4, 0), aNoKick = air({}, 8, 0);
log(7, Math.abs(aOn.roll) < Math.abs(aOff.roll) * 0.6, `airborne roll: knocked-off-balance drop lands at ${deg(aOn.roll)} roll with assist vs ${deg(aOff.roll)} without; landing pitch varies with the jump (${deg(aSlow.pitch)} slow vs ${deg(aNoKick.pitch)} fast, not forced flat)`);
// 8-11. landings: independent suspension, force-dependent compression, rider absorbs, settles
const drop = (h, v, front) => { cfg({}); S.reset(sec['Start'] + 8, v); run(0.3, {}); lift(h);
  if (front) b.q = b.q.mul({ w: Math.cos(-0.12), x: 0, y: 0, z: Math.sin(-0.12) }); // nose-down attitude, front lands first
  const o = { f: 0, rr: 0, tf: null, tr: null, knee: 999, rev: 0, last: 0, wz: 0, t0: null };
  run(2.2, {}, (t) => { if (b.cF && o.tf === null) o.tf = t; if (b.cR && o.tr === null) o.tr = t; o.f = Math.max(o.f, b.sF); o.rr = Math.max(o.rr, b.rearTravel);
    if (o.tf !== null || o.tr !== null) { if (o.t0 === null) o.t0 = t; const X = S.body(dt), k = Math.acos(Math.max(-1, Math.min(1, X[J.hipL].sub(X[J.kneeL]).norm().dot(X[J.ankL].sub(X[J.kneeL]).norm())))) * 57.3; o.knee = Math.min(o.knee, k);
      if (t - o.t0 > 0.15 && Math.sign(b.sFd) !== Math.sign(o.last) && Math.abs(b.sFd) > 0.25) o.rev++; o.last = b.sFd; if (t - o.t0 > 1.0) o.wz = Math.max(o.wz, Math.abs(b.w.dot(b.q.rot(new V(0, 0, 1))))); } });
  o.crash = b.crashed; return o; };
const dNose = drop(1.0, 5, true);
log(8, dNose.tf !== null && dNose.tr !== null && dNose.tr - dNose.tf > 0.02, `nose-down landing: front touches ${((dNose.tr - dNose.tf) * 1000).toFixed(0)} ms before the rear; peak fork ${(dNose.f * 1000).toFixed(0)} mm vs rear ${(dNose.rr * 1000).toFixed(0)} mm`);
const d03 = drop(0.3, 5), d10 = drop(1.0, 5), d18 = drop(1.8, 5);
log(9, d03.f < d10.f && d10.f < d18.f && d03.rr < d10.rr && d10.rr <= d18.rr + 0.002, `compression follows impact: drop 0.3 / 1.0 / 1.8 m -> fork ${[d03, d10, d18].map(d => (d.f * 1000).toFixed(0)).join(' / ')} mm, rear ${[d03, d10, d18].map(d => (d.rr * 1000).toFixed(0)).join(' / ')} mm`);
cfg({}); S.reset(sec['Start'] + 8, 5); let XR; run(1, {}, () => { XR = S.body(dt); }); const kneeRide = Math.acos(XR[J.hipL].sub(XR[J.kneeL]).norm().dot(XR[J.ankL].sub(XR[J.kneeL]).norm())) * 57.3;
log(10, d10.knee < kneeRide - 20 && !d10.crash, `rider absorbs: knee closes from ${kneeRide.toFixed(0)}° riding to ${d10.knee.toFixed(0)}° on a 1 m landing (1.8 m: ${d18.knee.toFixed(0)}°)`);
log(11, d10.rev <= 4 && d10.wz < 0.4 && !d10.crash && !d18.crash, `settling after a 1 m drop: ${d10.rev} fork rebound cycles (>0.25 m/s) after the hit, pitch rate after 1 s ${d10.wz.toFixed(2)} rad/s, no crash (1.8 m drop: ${d18.crash ? 'crash' : 'clean'})`);
// 12. assists don't fight deliberate steering
const sOnT = stepTurn(7, {}), sOffT = stepTurn(7, OFF);
cfg(OFF); S.reset(sec['Berm L (wide)'] - 6, 8); b._ps = 0; let blOff = 0; run(4, pilot(8), () => { blOff = Math.max(blOff, Math.abs(b.lean)); });
log(12, Math.abs(sOnT.h15 - sOffT.h15) < 0.15 * Math.abs(sOffT.h15) && bl > blOff - 0.05, `no fighting: heading change after 1.5 s of D at 7 m/s ${deg(sOnT.h15)} with assists vs ${deg(sOffT.h15)} without; berm lean ${deg(bl)} vs ${deg(blOff)}`);
cfg({});
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
