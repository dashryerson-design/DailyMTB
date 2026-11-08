// Scripted rider on freshly generated tracks: node tests/ride.mjs [seed]
import { generateTrack } from '../src/terrain/track.js';
import { RideSystem } from '../src/physics/system.js';
import { V } from '../src/core/math.js';
import { maxLatAccel } from '../src/physics/bike.js';
const seed = +process.argv[2] || 4242;
for (const b of ['forest', 'snow', 'desert']) {
  const t = generateTrack(b, seed), S = new RideSystem(t), bk = S.bike; S.reset(5, 0);
  const { S: SS, X, Z } = t.centerline; let si = 0, ps = 0, crashes = 0, minClear = 0, tEnd = null, maxAir = 0, maxF = 0, maxR = 0;
  const nS = () => { let bb = 1e9, bs = si; for (let i = Math.max(0, si - 200); i < Math.min(SS.length, si + 400); i += 2) { const d = (X[i] - bk.p.x) ** 2 + (Z[i] - bk.p.z) ** 2; if (d < bb) { bb = d; bs = i; } } si = bs; return SS[bs]; };
  for (let i = 0; i < 400000; i++) {
    const s = nS(); if (s > t.total - 5) { tEnd = i / 1000; break; }
    const sg = t.segs.find(g => s >= g.s0 - 45 && s < g.s0 + g.len && g.feat), vt = sg?.v ?? 9;
    const v = Math.max(bk.speed || 0, 1), L = Math.max(5, 1.4 * v), tp = t.sampleAt(s + L), f = bk.q.rot(new V(1, 0, 0)), dx = tp.x - bk.p.x, dz = tp.z - bk.p.z;
    const al = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz);
    ps += (Math.max(-1, Math.min(1, v * v * 2 * Math.sin(al) / Math.hypot(dx, dz) / maxLatAccel(v))) - ps) * 0.001 / 0.15;
    const k = { steer: ps, w: (bk.speed || 0) < vt, s: (bk.speed || 0) > vt + 2 }; if (bk.cR && !bk.cF && bk.q.inv(bk.w).z < -0.3) k.pitch = 1; S.step(0.001, k);
    maxAir = Math.max(maxAir, bk.air); maxF = Math.max(maxF, bk.sF); maxR = Math.max(maxR, bk.rearTravel); if (bk.cF) minClear = Math.min(minClear, -bk.cF.pen); if (bk.cR) minClear = Math.min(minClear, -bk.cR.pen);
    if (bk.crashed) { crashes++; if (crashes < 3) console.log(`  crash at ${s.toFixed(0)} m: ${bk.crashCause} lean ${(bk.lean * 57.3).toFixed(0)} speed ${bk.speed.toFixed(1)}`); S.reset(Math.max(5, s - 40), 8); si = 0; }
  }
  console.log(`${b.padEnd(6)} ${t.total.toFixed(0)} m | ${tEnd ? 'finished in ' + tEnd.toFixed(0) + ' s' : 'DID NOT FINISH'} | crashes ${crashes} | max air ${maxAir.toFixed(2)} s | fork used ${(maxF * 1000).toFixed(0)} mm, rear ${(maxR * 1000).toFixed(0)} mm | deepest tyre squish ${(-minClear * 1000).toFixed(0)} mm`);
}
