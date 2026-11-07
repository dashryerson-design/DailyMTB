// Headless physics validation: node tests/sim.mjs
import { buildTrack } from '../src/terrain/track.js';
import { ASSIST } from '../src/physics/assist.js';
if (process.env.ASSIST) Object.assign(ASSIST, JSON.parse(process.env.ASSIST));
import { RideSystem } from '../src/physics/system.js';
import { maxLatAccel } from '../src/physics/bike.js';
import { J } from '../src/physics/rider.js';
import * as G from '../src/physics/geometry.js';
const track = buildTrack(), sys = new RideSystem(track), bike = sys.bike, rider = sys.rider, dt = 1 / 1000;
const sec = Object.fromEntries(track.sections.map(s => [s.name, s.s]));
function run(name, s0, v0, secs, keysFn) {
  sys.reset(s0, v0);
  const st = { fMin: 1, fMax: 0, rMin: 1, rMax: 0, air: 0, leanMax: 0, leanMin: 0, upMin: 1, vMax: 0, rim: 0, bF: 0, bR: 0, fSum: 0, n: 0, fRev: 0, gE: 0, fE: 0, hMin: 9, hMax: -9, hxMin: 9, hxMax: -9, kMin: 9, kMax: 0, sad: 0, gap: 0 };
  let lastFd = 0; const log = []; let dumped = !process.env.DUMP;
  for (let i = 0; i < secs / dt; i++) {
    const t = i * dt; sys.step(dt, keysFn(t, bike));
    if (!bike.ok) { console.log(name, 'NaN at', t); return st; }
    if (bike.crashed) { st.crash = st.crash ?? t; }
    if (i % 20 === 0) { const f = bike.q.rot({ x: 1, y: 0, z: 0 }); log.push(`${t.toFixed(2)} s${nearestS(bike.p).toFixed(1)} v${bike.speed.toFixed(1)} lean${(bike.lean * 57.3).toFixed(0)} lt${(bike.leanT * 57.3).toFixed(0)} st${(bike.steer * 57.3).toFixed(0)} in${bike.inp.steer.toFixed(2)} pitch${(Math.asin(f.y) * 57.3).toFixed(0)} pF${bike.cF ? (bike.cF.pen * 1000).toFixed(0) + bike.cF.surf.name[0] : '-'} pR${bike.cR ? (bike.cR.pen * 1000).toFixed(0) + bike.cR.surf.name[0] : '-'} sF${(bike.sF * 1000).toFixed(0)} th${bike.th.toFixed(2)} aU${(bike.assist.info.upright || 0).toFixed(0)} aD${(bike.assist.info.dir || 0).toFixed(0)} aL${(bike.assist.info.landR || 0).toFixed(0)}`); }
    if (!dumped && bike.q.rot({ x: 0, y: 1, z: 0 }).y < 0.7) { dumped = true; console.log(log.slice(-150).filter((_, i) => i % 3 === 0).join('\n')); }
    if (t < 0.6) continue;
    const f = bike.sF / G.FORK.travel, r = bike.rearTravel / 0.18;
    st.fMin = Math.min(st.fMin, f); st.fMax = Math.max(st.fMax, f); st.rMin = Math.min(st.rMin, r); st.rMax = Math.max(st.rMax, r);
    st.air = Math.max(st.air, bike.air); st.leanMax = Math.max(st.leanMax, bike.lean); st.leanMin = Math.min(st.leanMin, bike.lean);
    st.upMin = Math.min(st.upMin, bike.q.rot({ x: 0, y: 1, z: 0 }).y); st.vMax = Math.max(st.vMax, bike.speed);
    if (bike.rim > 0.29) st.rim++; if (bike.bottomF > 0.29) st.bF++; if (bike.bottomR > 0.29) st.bR++;
    if (Math.sign(bike.sFd) !== Math.sign(lastFd) && Math.abs(bike.sFd) > 0.05) st.fRev++; lastFd = bike.sFd;
  }
  const p = bike.p, near = nearestS(p);
  const d = (x) => (x * 100).toFixed(0) + '%';
  console.log(`${name.padEnd(14)} fork ${d(st.fMin)}-${d(st.fMax)} rear ${d(st.rMin)}-${d(st.rMax)} air ${st.air.toFixed(2)}s lean ${(st.leanMin * 57.3).toFixed(0)}/${(st.leanMax * 57.3).toFixed(0)}° upMin ${st.upMin.toFixed(2)} vMax ${st.vMax.toFixed(1)} rim ${st.rim} bottom F${st.bF}/R${st.bR} forkRev ${st.fRev} ${st.crash !== undefined ? 'CRASH@' + st.crash.toFixed(1) + 's' : 'ok'} endS ${near.toFixed(0)} v ${bike.speed.toFixed(1)}`);
  return st;
}
function nearestS(p) { const { S, X, Z } = track.centerline; let b = 1e9, bs = 0; for (let i = 0; i < S.length; i += 2) { const d = (X[i] - p.x) ** 2 + (Z[i] - p.z) ** 2; if (d < b) { b = d; bs = S[i]; } } return bs; }
// steering autopilot following the centerline (used to drive the A/D keys like a rider would)
function pilot(look = 6, extra = {}) {
  // pure-pursuit rider: picks a point ahead on the trail and asks for the lateral accel to reach it
  return (t, b) => {
    const v = Math.max(b.speed, 1), L = Math.max(look, (+process.env.LOOK || 1.4) * v), s = nearestS(b.p), tp = track.sampleAt(s + L), f = b.q.rot({ x: 1, y: 0, z: 0 });
    const dx = tp.x - b.p.x, dz = tp.z - b.p.z, alpha = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz);
    const aLat = v * v * 2 * Math.sin(alpha) / Math.hypot(dx, dz), aMax = maxLatAccel(v);
    const k = { ...extra }; for (const key of ['w', 's']) if (typeof extra[key] === 'function') k[key] = extra[key](t, b);
    // human-like: the test rider's hands react with ~0.15 s smoothing
    const raw = Math.max(-1, Math.min(1, aLat / aMax)); b._ps = (b._ps ?? 0) + (raw - (b._ps ?? 0)) * Math.min(1, 0.001 / 0.15); k.steer = b._ps;
    // rider pitch technique: in the air, hold the nose roughly parallel to a downhill landing
    if (b.cR && !b.cF && b.q.inv(b.w).z < -0.3) k.pitch = 1;   // lip technique: pull up while the rear is still on the ramp
    // in the air the landing assist lines the bike up; the test rider gives no pitch input
    return k;
  };
}
console.log('track build', track.buildMs, 'ms');
// 1. static sag
sys.reset(5, 0); for (let i = 0; i < 3000; i++) sys.step(dt, {});
console.log(`static sag   fork ${(bike.sF * 1000).toFixed(0)}mm (${(bike.sF / 0.18 * 100).toFixed(0)}%)  rear ${(bike.rearTravel * 1000).toFixed(0)}mm (${(bike.rearTravel / 0.18 * 100).toFixed(0)}%)  shock ${(bike.shockStroke * 1000).toFixed(1)}mm  v ${bike.speed.toFixed(2)}`);
// 2. accelerate on start straight
sys.reset(2, 0); let t5 = 0; for (let i = 0; i < 5000; i++) { sys.step(dt, { w: true }); if (i === 4999) t5 = bike.speed; }
console.log(`accel 5s W   speed ${t5.toFixed(1)} m/s gear ${G.COGS[bike.gear]}T`);
// 3. braking
sys.reset(2, 8); for (let i = 0; i < 1500; i++) sys.step(dt, { s: true });
console.log(`rear brake 1.5s from 8 -> ${bike.speed.toFixed(1)} m/s; `);
sys.reset(2, 8); let maxF = 0; for (let i = 0; i < 1500; i++) { sys.step(dt, { s: true, space: true }); maxF = Math.max(maxF, bike.sF); }
console.log(`both brakes 1.5s from 8 -> ${bike.speed.toFixed(1)} m/s; fork dive max ${(maxF * 1000).toFixed(0)}mm`);
// sections
run('bumps 5m/s', sec['Rock & root garden'] - 3, 5, 12, pilot(6, { w: (t, b) => b.speed < 5 }));
run('bumps 9m/s', sec['Rock & root garden'] - 3, 9, 8, pilot(6, { w: (t, b) => b.speed < 9 }));
run('rollers', sec['Rollers'] - 3, 7, 6, pilot(6, { w: (t, b) => b.speed < 7 }));
run('tabletop', sec['Tabletop'] - 4, 8.5, 5, pilot(6));
run('big jump', sec['Big jump'] - 4, 10.8, 5, pilot(6));
run('berm L', sec['Berm L (wide)'] - 6, 8, 6, pilot(5, { w: (t, b) => b.speed < 8 }));
run('berm R', sec['Berm R (tight)'] - 6, 6.5, 6, pilot(4, { w: (t, b) => b.speed < 6.5 }));
run('sweeper', sec['Sweeper'] - 6, 9, 9, pilot(6, { w: (t, b) => b.speed < 9 }));
run('flat turns', sec['Flat turns'] - 4, 5, 12, pilot(4, { w: (t, b) => b.speed < 5, s: undefined }));
run('drop', sec['Rocky drop'] - 2, 6, 5, pilot(6));
const vT = (b) => { const s = nearestS(b.p); return s > sec['Rollers'] - 15 && s < sec['Rollers'] + 32 ? 6.5 : s > sec['Big jump'] - 25 && s < sec['Big jump'] + 6 ? 10.5 : s > sec['Berm R (tight)'] - 15 && s < sec['Berm R (tight)'] + 20 ? 6.5 : s > sec['Rocky drop'] - 10 && s < sec['Rocky drop'] + 10 ? 6.5 : s > sec['Flat turns'] - 5 && s < sec['Flat turns'] + 45 ? 6.5 : 8; };
run('full run', 3, 0, 56, pilot(5, { w: (t, b) => b.speed < vT(b), s: (t, b) => b.speed > vT(b) + 1.5 }));
