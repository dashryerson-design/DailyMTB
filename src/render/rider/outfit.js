// Rider gear components. Each component is a function (slots, opts) -> list of meshes it added, so any
// one can later be swapped (another helmet, a jacket instead of a jersey, ...) without touching the rest.
// Slots (see riderModel.js), all with X = front, Y = along the bone, Z = right:
//   pelvis, belly, chest, neck, head, shoulderL/R, upperL/R, elbowL/R, foreL/R, handL/R, thighL/R, kneeL/R, shinL/R, footL/R
import { tube, paint, solid, mats, mesh, mix, hex, nz } from './kit.js';
import { fullFaceHelmet } from './helmet.js';
import { SEG } from '../../physics/rider.js';
const T = window.THREE;
const SIDES = ['L', 'R'];
// soft fabric creases: low-frequency folds plus bunching in the given zones (t ranges)
const folds = (amp, zones = []) => (t, a) => {
  let d = amp * (0.6 * nz(a * 1.6 + t * 3, t * 7) + 0.4 * Math.sin(a * 3 + t * 11));
  for (const [t0, t1, k] of zones) if (t > t0 && t < t1) d += k * Math.max(0, Math.sin((t - t0) / (t1 - t0) * Math.PI)) * (0.5 + 0.5 * Math.sin(a * 5 + t * 40));
  return d;
};
const seam = (v, w = 0.04) => Math.abs(v) < w;   // thin seam line test

// ---- head under the helmet + neck (skin; mostly hidden by collar and helmet)
export function body(S) {
  const M = mats(), out = [];
  out.push(mesh(tube([[0, 0.05, 0.05], [0.5, 0.048, 0.05], [1, 0.05, 0.052]], SEG.neck * 0.7, { n: 10, color: () => hex(0x16181c) }), M.skin, S.neck));
  return out;
}

// ---- helmet (full-face by default)
export function helmet(S, o) { const h = fullFaceHelmet(o); S.head.add(h); h.traverse((m) => { if (m.isMesh) m.castShadow = true; }); return [h]; }

// ---- jersey: loose long-sleeve technical top with side panels, shoulder yoke, accent bands, collar;
// shaped over light body armour (shoulder caps, back protector) so it doesn't look skin-tight
export function jersey(S, o = {}) {
  const M = mats(), out = [], C = { main: hex(o.main ?? 0x1d3a72), panel: hex(o.panel ?? 0x26508f), accent: hex(o.accent ?? 0xf26b1d), seam: hex(0x10203f), cuff: hex(o.cuff ?? 0x111317) };
  const torsoCol = (t, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    if (t > 0.97) return C.cuff;                                                     // collar
    if (seam(Math.abs(s) - 0.8, 0.035) || seam(t - 0.62, 0.012)) return C.seam;       // side + yoke seams
    if (t > 0.64 && t < 0.72) return C.accent;                                         // shoulder yoke band
    if (t > 0.72) return Math.abs(s) > 0.6 ? C.panel : C.main;
    if (Math.abs(s) > 0.8) return C.panel;                                             // side panels (mesh)
    if (c > 0 && t > 0.3 && t < 0.42) return C.accent;                                 // chest band
    return C.main;
  };
  // lower torso (hips -> mid back): hem hangs a little loose
  out.push(mesh(tube([[-0.18, 0.1, 0.165, -0.005], [-0.05, 0.115, 0.172], [0.4, 0.108, 0.158, 0.004], [0.9, 0.115, 0.165], [1.12, 0.118, 0.17]], SEG.lumbar,
    { n: 22, color: (t, a) => (t < -0.1 ? C.cuff : torsoCol(0.2 + t * 0.2, a)), disp: folds(0.004, [[0.1, 0.7, 0.004]]) }), M.fabric, S.belly));
  // chest + shoulders (back protector adds a little hump behind, shoulders broad)
  out.push(mesh(tube([[-0.12, 0.118, 0.168], [0.15, 0.124, 0.18, 0.004], [0.5, 0.13, 0.198, -0.002], [0.78, 0.118, 0.205, -0.012], [0.95, 0.085, 0.165, -0.012], [1.03, 0.055, 0.075, -0.004], [1.12, 0.052, 0.062, -0.002]], SEG.thorax,
    { n: 24, color: (t, a) => torsoCol(0.3 + t * 0.7, a), disp: (t, a) => folds(0.003)(t, a) + (Math.cos(a) < -0.5 && t > 0.2 && t < 0.85 ? 0.012 * Math.sin((t - 0.2) / 0.65 * Math.PI) * (-Math.cos(a) - 0.5) : 0) }), M.fabric, S.chest));
  for (const s of SIDES) {
    // shoulder cap (armour under the fabric) blends torso into sleeve
    const cap = new T.SphereGeometry(0.068, 14, 10); cap.scale(1.05, 0.95, 1);
    out.push(mesh(solid(cap, C.main), M.fabric, S['shoulder' + s]));
    // sleeves: roomy upper, tapering to a stretch cuff, creases bunching at the elbow
    out.push(mesh(tube([[-0.1, 0.064, 0.066], [0.05, 0.062, 0.062], [0.55, 0.055, 0.054], [0.95, 0.05, 0.05], [1.08, 0.048, 0.048]], SEG.upper,
      { n: 14, color: (t, a) => (Math.cos(a) < -0.85 && t > 0.15 ? C.panel : t < 0.18 ? C.accent : C.main), disp: folds(0.003, [[0.75, 1.08, 0.004]]) }), M.fabric, S['upper' + s]));
    out.push(mesh(tube([[-0.06, 0.05, 0.05], [0.08, 0.047, 0.048], [0.6, 0.04, 0.041], [0.84, 0.034, 0.036], [0.88, 0.035, 0.037], [0.97, 0.034, 0.035]], SEG.fore,
      { n: 12, color: (t, a) => (t > 0.84 ? C.cuff : t > 0.72 && t < 0.78 ? C.accent : C.main), disp: folds(0.0025, [[0, 0.3, 0.003]]) }), M.fabric, S['fore' + s]));
  }
  return out;
}

// ---- trousers: relaxed DH pants with a reinforced, articulated knee panel and tapered, cuffed hem
export function pants(S, o = {}) {
  const M = mats(), out = [], C = { main: hex(o.main ?? 0x2a2d33), knee: hex(o.knee ?? 0x16181b), accent: hex(o.accent ?? 0xf26b1d), seam: hex(0x17191c) };
  out.push(mesh(tube([[-0.42, 0.09, 0.13, -0.012], [-0.25, 0.108, 0.168, -0.014], [0.0, 0.112, 0.178, -0.01], [0.3, 0.104, 0.162, 0], [0.42, 0.1, 0.156]], 0.2,
    { n: 18, color: (t, a) => (t > 0.33 ? C.knee : seam(Math.sin(a) - 0.97, 0.02) ? C.seam : C.main), disp: folds(0.003) }), M.fabric, S.pelvis));
  for (const s of SIDES) {
    out.push(mesh(tube([[-0.12, 0.086, 0.088], [0.02, 0.092, 0.09], [0.35, 0.083, 0.078], [0.75, 0.068, 0.064], [0.95, 0.062, 0.06], [1.06, 0.06, 0.058]], SEG.thigh,
      { n: 16, color: (t, a) => { const c = Math.cos(a); if (c > 0.35 && t > 0.8) return C.knee; if (seam(Math.sin(a) * (s === 'L' ? -1 : 1) - 0.98, 0.02) && t < 0.9) return C.accent; return C.main; },
        disp: folds(0.004, [[0.0, 0.25, 0.005], [0.8, 1.06, 0.004]]) }), M.fabric, S['thigh' + s]));
    out.push(mesh(tube([[-0.07, 0.062, 0.06], [0.06, 0.064, 0.058], [0.4, 0.056, 0.052], [0.82, 0.05, 0.049], [0.9, 0.049, 0.048], [0.97, 0.047, 0.046]], SEG.shin,
      { n: 14, color: (t, a) => { const c = Math.cos(a); if (t > 0.88) return C.knee; if (c > 0.35 && t < 0.22) return C.knee; return C.main; },
        disp: folds(0.0035, [[0.55, 0.9, 0.006]]) }), M.fabric, S['shin' + s]));
  }
  return out;
}

// ---- protection: knee pads and elbow pads under the fabric (they shape the trousers/sleeves at the joint)
export function protection(S, o = {}) {
  const M = mats(), out = [], pant = hex(o.knee ?? 0x16181b), sleeve = hex(o.elbow ?? 0x1d3a72);
  for (const s of SIDES) {
    const kp = new T.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62); kp.rotateZ(-Math.PI / 2); kp.scale(0.034, 0.09, 0.064);
    const k = mesh(paint(kp, (x, y) => (Math.abs(y) < 0.008 ? hex(0x0b0c0e) : pant)), M.fabric, S['knee' + s]); k.position.set(0.04, 0.025, 0); out.push(k);
    const ep = new T.SphereGeometry(1, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6); ep.rotateZ(-Math.PI / 2); ep.scale(0.028, 0.065, 0.048);
    const e = mesh(solid(ep, sleeve), M.fabric, S['elbow' + s]); e.position.set(0.03, 0.02, 0); out.push(e);
  }
  return out;
}

// ---- gloves: full-finger MTB gloves wrapped round the grip (bar runs along Z through the hand origin)
export function gloves(S, o = {}) {
  const M = mats(), out = [], C = { main: hex(o.main ?? 0x16181b), accent: hex(o.accent ?? 0xf26b1d), palm: hex(0x3a3d42) };
  for (const s of SIDES) {
    const H = S['hand' + s];
    // back of the hand, sitting on top of / behind the bar
    out.push(mesh(tube([[-0.75, 0.024, 0.036, 0.008], [-0.45, 0.03, 0.042, 0.016], [0, 0.028, 0.045, 0.022], [0.35, 0.02, 0.043, 0.024], [0.5, 0.012, 0.03, 0.024]], 0.1,
      { n: 12, color: (t, a) => (Math.cos(a) > 0.6 && t > -0.1 && t < 0.25 ? C.accent : C.main) }), M.stretch, H));
    // four fingers curled round the bar + thumb underneath
    for (let f = 0; f < 4; f++) {
      const tor = new T.TorusGeometry(0.021, 0.0092 - f * 0.0004, 6, 10, 3.9); tor.rotateY(0); tor.rotateZ(1.25);
      const fm = mesh(solid(tor, f === 0 ? C.main : C.main), M.rubber, H); fm.position.set(0.004, 0.035, (f - 1.5) * 0.019); out.push(fm);
    }
    const th = new T.CylinderGeometry(0.009, 0.008, 0.05, 8);
    const tm = mesh(solid(th, C.main), M.rubber, H); tm.position.set(-0.012, 0.01, (s === 'L' ? 1 : -1) * 0.045); tm.rotation.set(0.9, 0, 0.5); out.push(tm);
    // knuckle guard + wrist cuff with a velcro tab
    const kg = new T.Mesh(solid(new T.BoxGeometry(0.008, 0.022, 0.07), C.palm), M.rubber); kg.position.set(0.033, 0.02, 0); H.add(kg); out.push(kg);
    out.push(mesh(tube([[-0.98, 0.036, 0.038], [-0.82, 0.037, 0.04], [-0.7, 0.033, 0.036]], 0.1, { n: 12, color: (t, a) => (Math.cos(a) > 0.5 ? C.accent : C.main) }), M.stretch, H));
  }
  return out;
}

// ---- shoes: flat-pedal DH shoes (low-profile, padded collar, toe cap, thick grippy sole)
export function shoes(S, o = {}) {
  const M = mats(), out = [], C = { upper: hex(o.upper ?? 0x2b2e33), accent: hex(o.accent ?? 0xf26b1d), toe: hex(0x16181b), sole: hex(o.sole ?? 0x121212), mid: hex(0xd9d6cf) };
  for (const s of SIDES) {
    const F = S['foot' + s];
    // foot frame: origin at the ankle, Y toward the toe, X up
    out.push(mesh(tube([[-0.11, 0.03, 0.032, -0.012], [-0.075, 0.052, 0.04, 0.0], [0.0, 0.056, 0.045, -0.012], [0.08, 0.042, 0.05, -0.03], [0.15, 0.032, 0.048, -0.042], [0.2, 0.024, 0.04, -0.048], [0.218, 0.013, 0.024, -0.05]], 1,
      { n: 14, color: (t, a, p) => { const c = Math.cos(a); if (t > 0.15 && c > -0.2) return C.toe; if (c > 0.6 && t > -0.02 && t < 0.12) return mix(C.upper, [0, 0, 0], 0.3); if (Math.abs(Math.sin(a)) > 0.9 && t > -0.05 && t < 0.1) return C.accent; if (c > 0.85 && t < -0.05) return C.toe; return C.upper; },
        disp: (t) => 0 }), M.fabric, F));
    // midsole + outsole
    out.push(mesh(tube([[-0.105, 0.007, 0.034, -0.045], [-0.07, 0.009, 0.042, -0.052], [0.08, 0.009, 0.051, -0.076], [0.19, 0.008, 0.044, -0.077], [0.215, 0.005, 0.03, -0.074]], 1,
      { n: 12, color: (t, a) => (Math.cos(a) > 0.2 ? C.mid : C.sole) }), M.rubber, F));
    // padded ankle collar
    const col = new T.TorusGeometry(0.043, 0.012, 6, 14); col.rotateY(Math.PI / 2); col.scale(1, 1, 0.95);
    const cm = mesh(solid(col, C.upper), M.fabric, F); cm.position.set(0.03, -0.035, 0); cm.rotation.z = -0.5; out.push(cm);
  }
  return out;
}

export const DEFAULT_OUTFIT = { body, helmet, jersey, pants, protection, gloves, shoes };
