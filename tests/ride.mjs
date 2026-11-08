// Scripted rider on freshly generated tracks: node tests/ride.mjs [seed]
import { generateTrack } from '../src/terrain/track.js';
import { RideSystem } from '../src/physics/system.js';
import { V } from '../src/core/math.js';
const seed = +process.argv[2] || 4242;
for (const b of ['forest', 'snow', 'desert']) {
  const t = generateTrack(b, seed), S = new RideSystem(t), bk = S.bike; S.reset(5, 0);
  const { S: SS, X, Z } = t.centerline; let si = 0, ps = 0, crashes = 0, tEnd = null, maxAir = 0, maxF = 0, maxR = 0;
  const nS = () => { let bb = 1e9, bs = si; for (let i = Math.max(0, si - 200); i < Math.min(SS.length, si + 400); i += 2) { const d = (X[i] - bk.cx) ** 2 + (Z[i] - bk.cz) ** 2; if (d < bb) { bb = d; bs = i; } } si = bs; return SS[bs]; };
  for (let i = 0; i < 400000; i++) {
    const s = nS(); if (s > t.total - 5) { tEnd = i / 1000; break; }
    const sg = t.segs.find(g => s >= g.s0 - 45 && s < g.s0 + g.len && g.feat), vt = sg?.v ?? 9;
    const v = Math.max(bk.speed, 1), L = Math.max(5, 1.3 * v), tp = t.sampleAt(s + L), dx = tp.x - bk.cx, dz = tp.z - bk.cz;
    const al = Math.atan2(Math.cos(bk.psi) * dz - Math.sin(bk.psi) * dx, Math.cos(bk.psi) * dx + Math.sin(bk.psi) * dz);
    ps += (Math.max(-1, Math.min(1, al * 2.2)) - ps) * 0.001 / 0.12;
    S.step(0.001, { steer: ps, w: bk.speed < vt, s: bk.speed > vt + 2 });
    maxAir = Math.max(maxAir, bk.air); maxF = Math.max(maxF, bk.sF); maxR = Math.max(maxR, bk.rearTravel);
    if (bk.crashed) { crashes++; if (crashes < 3) console.log(`  crash at ${s.toFixed(0)} m: ${bk.crashCause} pitch ${(bk.pitch * 57.3).toFixed(0)} lean ${(bk.lean * 57.3).toFixed(0)} lastAir ${bk.lastAir.toFixed(2)} speed ${bk.speed.toFixed(1)} vy ${bk.vy.toFixed(1)}`); S.reset(Math.max(5, s - 40), 8); si = 0; }
  }
  console.log(`${b.padEnd(6)} ${t.total.toFixed(0)} m | ${tEnd ? 'finished in ' + tEnd.toFixed(0) + ' s' : 'DID NOT FINISH'} | crashes ${crashes} | max air ${maxAir.toFixed(2)} s | fork used ${(maxF * 1000).toFixed(0)} mm, rear ${(maxR * 1000).toFixed(0)} mm`);
}
