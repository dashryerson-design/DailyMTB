// Rider-bike integration checks: node tests/rider.mjs
import { buildTrack } from '../src/terrain/track.js';
import { RideSystem } from '../src/physics/system.js';
import { maxLatAccel } from '../src/physics/bike.js';
import { J } from '../src/physics/rider.js';
import { V } from '../src/core/math.js';
const track = buildTrack(), S = new RideSystem(track), b = S.bike, r = S.rider, dt = 0.001;
const sec = Object.fromEntries(track.sections.map(s => [s.name, s.s]));
const hipL = () => { const h = b.q.inv(r.x[J.hipL].add(r.x[J.hipR]).mul(0.5).sub(b.p)); return { x: h.x + 0.25, y: h.y + 0.3 }; };
const pitch = () => Math.asin(b.q.rot(new V(1, 0, 0)).y);
const run = (secs, k, each) => { for (let i = 0; i < secs / dt; i++) { S.step(dt, typeof k === 'function' ? k(i * dt) : k); if (each) each(i * dt); } };
const ok = (c) => c ? 'PASS' : 'FAIL';
const res = [];
const log = (n, pass, msg) => { res.push(pass); console.log(`${String(n).padStart(2)}. ${ok(pass)}  ${msg}`); };
const angle = (a, c, d) => { const u = r.x[a].sub(r.x[c]).norm(), w = r.x[d].sub(r.x[c]).norm(); return Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 57.3; };

// 1 + 2: grip and pedal tracking while pedalling hard (cranks turning)
S.reset(3, 0); let gE = 0, fE = 0, crank0 = b.crank;
run(5, { w: true }, () => { gE = Math.max(gE, r.gripErr); fE = Math.max(fE, r.footErr); });
log(1, gE < 0.05 && !r.crashed, `hands stay on grips while pedalling/steering: max error ${(gE * 100).toFixed(1)} cm`);
log(2, fE < 0.06 && b.crank - crank0 > 20, `feet follow pedals: ${((b.crank - crank0) / 6.283).toFixed(1)} crank revs, max foot error ${(fE * 100).toFixed(1)} cm`);
// 3: seated at low speed
S.reset(3, 0); let sad = 0, n = 0; run(4, (t) => ({ s: b.speed > 2 }), (t) => { if (t > 2) { n++; if (r.saddleLoad > 50) sad++; } });
log(3, sad / n > 0.8, `sits on the saddle when slow: saddle loaded ${(100 * sad / n).toFixed(0)}% of the time, hips at ${(hipL().y * 100).toFixed(0)} cm (saddle top ~73 cm)`);
// 4: stands at speed
S.reset(sec['Start'] + 5, 7); let up = 0; run(2, {}, (t) => { if (t > 1) up = hipL().y; });
log(4, up > 0.85 && r.saddleLoad === 0, `stands on the pedals at speed: hips ${(up * 100).toFixed(0)} cm, saddle load ${r.saddleLoad.toFixed(0)} N`);
// 5: weight shift accelerating vs braking
S.reset(sec['Start'] + 5, 7); let xa = 0, xb = 0; run(1.5, { w: true }, (t) => { xa = hipL().x; });
S.reset(sec['Start'] + 5, 9); run(0.8, { s: true, space: true }, (t) => { xb = Math.min(xb || 9, hipL().x); });
log(5, xb < xa - 0.08, `hips move back under braking: accel hips x ${(xa * 100).toFixed(0)} cm, braking ${(xb * 100).toFixed(0)} cm (BB = 0)`);
// 6: leans with the bike in a berm (torso roll vs bike roll)
S.reset(sec['Berm L (wide)'] - 6, 8); let lb = 0, lr = 0;
const pil = (look) => (t) => { const { S: SS, X, Z } = track.centerline; let bb = 1e9, bs = 0; for (let i = 0; i < SS.length; i += 2) { const d = (X[i] - b.p.x) ** 2 + (Z[i] - b.p.z) ** 2; if (d < bb) { bb = d; bs = SS[i]; } }
  const v = Math.max(b.speed, 1), L = Math.max(look, 1.4 * v), tp = track.sampleAt(bs + L), f = b.q.rot(new V(1, 0, 0)), dx = tp.x - b.p.x, dz = tp.z - b.p.z, al = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz);
  const vt = bs > sec['Rollers'] - 15 && bs < sec['Rollers'] + 32 ? 6.5 : 8; const raw = Math.max(-1, Math.min(1, v * v * 2 * Math.sin(al) / Math.hypot(dx, dz) / maxLatAccel(v))); b._ps = (b._ps ?? 0) + (raw - (b._ps ?? 0)) * 0.001 / 0.15;
  const k = { w: b.speed < vt, s: b.speed > vt + 1.5, steer: b._ps };
  if (b.cR && !b.cF && b.q.inv(b.w).z < -0.3) k.pitch = 1;
  return k; };
run(4, pil(5), () => { const fh = new V(b.q.rot(new V(1, 0, 0)).x, 0, b.q.rot(new V(1, 0, 0)).z).norm(), rh = new V(-fh.z, 0, fh.x), tor = r.x[J.neck].sub(r.x[J.hipL].add(r.x[J.hipR]).mul(0.5)).norm();
  const rl = Math.atan2(tor.dot(rh), tor.y); if (Math.abs(b.lean) > Math.abs(lb)) { lb = b.lean; lr = rl; } });
log(6, Math.abs(lb) > 0.4 && Math.sign(lr) === Math.sign(lb) && Math.abs(lr) > 0.5 * Math.abs(lb), `leans with the bike in the berm: bike ${(lb * 57.3).toFixed(0)}°, rider torso ${(lr * 57.3).toFixed(0)}°`);
// 7: elbows/knees work over bumps
S.reset(sec['Rock & root garden'], 7); let kn = [999, 0], el = [999, 0];
run(5, pil(6), () => { const k = angle(J.hipL, J.kneeL, J.ankL), e = angle(J.shR, J.elbR, J.handR); kn = [Math.min(kn[0], k), Math.max(kn[1], k)]; el = [Math.min(el[0], e), Math.max(el[1], e)]; });
log(7, kn[1] - kn[0] > 15 && el[1] - el[0] > 10 && !r.crashed, `knees ${kn[0].toFixed(0)}-${kn[1].toFixed(0)}°, elbows ${el[0].toFixed(0)}-${el[1].toFixed(0)}° through the rock garden`);
// 8 + 11: jump - hips leave the saddle in the air, legs compress on landing
S.reset(sec['Tabletop'] - 4, 9); let airMax = 0, landMin = 9, sawAir = false, kneeLand = 999;
run(3, (t) => { const k = pil(6)(t); if (b.cR && !b.cF && b.q.inv(b.w).z < -0.3) k.pitch = 1; return k; }, () => {
  if (b.air > 0.1) { sawAir = true; airMax = Math.max(airMax, hipL().y); }
  if (sawAir && b.air === 0) { landMin = Math.min(landMin, r.x[J.hipL].sub(r.x[J.ankL]).len()); kneeLand = Math.min(kneeLand, angle(J.hipL, J.kneeL, J.ankL)); } });
log(8, airMax > 0.84, `hips off the saddle in the air: up to ${(airMax * 100).toFixed(0)} cm above BB (saddle 73 cm)`);
log(11, landMin < 0.82 && !r.crashed, `landing absorbed by the legs: hip-ankle shortened to ${(landMin * 100).toFixed(0)} cm, knee closed to ${kneeLand.toFixed(0)}°, no crash`);
// 9 + 10: weight shift in free flight. Launch the whole rider+bike 3 m up at speed (no ground), then the
// only way to change the bike's pitch is the rider moving relative to it (angular momentum is shared)
const airTest = (pitchIn) => { S.reset(sec['Start'] + 8, 8); const lift = new V(0, 3, 0); b.p = b.p.add(lift); r.x = r.x.map(p => p.add(lift));
  let p0 = pitch(), hx = 0; run(0.6, { pitch: pitchIn }, () => { hx = hipL().x; }); return { dp: (pitch() - p0) * 57.3, hx }; };
const a0 = airTest(0), aBack = airTest(1), aFwd = airTest(-1);
log(9, aBack.hx < a0.hx - 0.05 && aFwd.hx > a0.hx + 0.05, `weight shift in the air: hips x neutral ${(a0.hx * 100).toFixed(0)}, back ${(aBack.hx * 100).toFixed(0)}, forward ${(aFwd.hx * 100).toFixed(0)} cm`);
log(10, aBack.dp > a0.dp + 5 && aFwd.dp < a0.dp - 5, `rider rotates the bike in free flight: neutral ${a0.dp.toFixed(0)}°, pull back ${aBack.dp > 0 ? '+' : ''}${aBack.dp.toFixed(0)}°, push forward ${aFwd.dp.toFixed(0)}° in 0.6 s`);
// 12: crash - grab the front brake hard at speed
S.reset(sec['Start'] + 5, 10); let sep = 0;
run(3, (t) => (t < 1 ? { space: true } : {}), () => { sep = Math.max(sep, r.com.sub(b.p).len()); });
log(12, r.crashed && sep > 1.2, `over-the-bars crash: crashed=${r.crashed}, hands/feet released=${!r.attached}, rider separated ${sep.toFixed(1)} m from the bike`);
// 13: stability - no NaN / no exploding velocities over a full run
S.reset(3, 0); let vmax = 0, bad = false, st13 = 0;
run(40, pil(5), (t) => { if (r.crashed && !st13) { st13 = t; console.log('    crash at track s≈', (b.p.x).toFixed(0), 'speed', b.speed.toFixed(1), 'air', b.air.toFixed(2), 'grip', r.gripErr.toFixed(2), 'foot', r.footErr.toFixed(2), 'up', b.q.rot(new V(0,1,0)).y.toFixed(2)); } r.v.forEach((v, j) => { const l = v.len(); if (!Number.isFinite(l)) bad = true; const rel = Math.abs(l - b.v.len()); if (rel > vmax) { vmax = rel; if (process.env.DBG && rel > 15) console.log('t', t.toFixed(3), 'part', j, 'v', l.toFixed(1), 'crashed', r.crashed, 'y-h', (r.x[j].y - track.h(r.x[j].x, r.x[j].z)).toFixed(2), 'bike y-h', (b.p.y - track.h(b.p.x, b.p.z)).toFixed(2), 'bike v', b.v.len().toFixed(1)); } }); });
log(13, !bad && vmax < 30 && b.ok, `no explosions over 40 s (riding + any crash): max body-part speed relative to bike ${vmax.toFixed(1)} m/s, finite=${!bad}, crashed=${r.crashed}${st13 ? ' at ' + st13.toFixed(1) + 's' : ''}`);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
