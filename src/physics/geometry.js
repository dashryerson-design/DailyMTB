// Bike geometry (side view, metres). Origin = bottom bracket, x forward, y up, z right.
// Rear: linkage-driven single pivot. Swingarm pivots at P, drives a link L->K, rocker pivots on frame at R0,
// rocker arm S compresses the shock S->D. Kinematics are solved exactly and tabulated.
const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, s) => [a[0] * s, a[1] * s];
const len = (a) => Math.hypot(a[0], a[1]), nrm = (a) => mul(a, 1 / len(a));
const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const about = (p, c, a) => add(c, rot(sub(p, c), a));

export const R_WHEEL = 0.365;
export const HEAD_ANGLE = 63.5 * D2R;
export const DF = [-Math.cos(HEAD_ANGLE), Math.sin(HEAD_ANGLE)];   // steer axis, up/back (fork compression direction)
export const NF = [Math.sin(HEAD_ANGLE), Math.cos(HEAD_ANGLE)];    // perpendicular, forward
export const FORK = { travel: 0.18, a2c: 0.58, offset: 0.044, sag: 0.045, lowerLen: 0.37, stanchionLen: 0.45, halfWidth: 0.075 };
export const AXLE_F = [0.83, 0.015], AXLE_R = [-0.445, 0.015];
export const WHEELBASE = AXLE_F[0] - AXLE_R[0];
// crown point on the steer axis
export const CROWN = [AXLE_F[0] - NF[0] * FORK.offset + DF[0] * (FORK.a2c - FORK.sag), AXLE_F[1] - NF[1] * FORK.offset + DF[1] * (FORK.a2c - FORK.sag)];
export const HT_BOT = add(CROWN, mul(DF, 0.015)), HT_TOP = add(CROWN, mul(DF, 0.125));
export const SEAT_TOP = [-0.2, 0.62], TT_JOIN = [-0.152, 0.47];
export const SHOCK = { eye: 0.216, stroke: 0.0635, sagFrac: 0.3 };
export const PIVOT = [-0.03, 0.09], LINK_SA = [-0.03, 0.165], ROCKER_P = [0.10, 0.20];
export let ROCKER_K = [0.10, 0.15];
let S_BASE = [0.08, 0.30];
const D_GUESS = [-0.123, 0.38];
const KA = -105 * D2R, SB = 35 * D2R;
export const BRIDGE = [-0.22, 0.38];                 // seatstay bridge (rigid with swingarm)
export const RING_T = 34, COGS = [36, 32, 28, 24, 21, 18, 16, 14, 12, 10];
export const cogR = (n) => n * 0.0127 / (2 * Math.PI);
export const PULLEY_U = [0.005, -0.055], PULLEY_L = [0.03, -0.125]; // relative to rear axle (swingarm frame)

function circleInter(c1, r1, c2, r2, ref) {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1[0] + a * dx / d, my = c1[1] + a * dy / d;
  const p1 = [mx + h * dy / d, my - h * dx / d], p2 = [mx - h * dy / d, my + h * dx / d];
  return len(sub(p1, ref)) < len(sub(p2, ref)) ? p1 : p2;
}

function linkage(kS) {
  const S0 = add(ROCKER_P, mul(sub(S_BASE, ROCKER_P), kS));
  const D = add(S0, mul(nrm(sub(D_GUESS, S0)), SHOCK.eye - SHOCK.sagFrac * SHOCK.stroke));
  const rk = len(sub(ROCKER_K, ROCKER_P)), ll = len(sub(ROCKER_K, LINK_SA)), a0 = Math.atan2(ROCKER_K[1] - ROCKER_P[1], ROCKER_K[0] - ROCKER_P[0]);
  const kin = (th) => {
    const L = about(LINK_SA, PIVOT, -th), K = circleInter(ROCKER_P, rk, L, ll, ROCKER_K);
    const al = Math.atan2(K[1] - ROCKER_P[1], K[0] - ROCKER_P[0]) - a0, S = about(S0, ROCKER_P, al);
    return { L, K, S, al, axle: about(AXLE_R, PIVOT, -th), len: len(sub(S, D)) };
  };
  const solve = (target) => { let lo = -0.6, hi = 0.8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (kin(m).len > target) lo = m; else hi = m; } return (lo + hi) / 2; };
  const thExt = solve(SHOCK.eye), thBot = solve(SHOCK.eye - SHOCK.stroke);
  return { S0, D, kin, thExt, thBot, travel: kin(thBot).axle[1] - kin(thExt).axle[1], rk, ll };
}
// tune the rocker's shock arm so the rear wheel gets 180 mm travel from a 63.5 mm stroke
export function designLinkage(ka, sb) {
  ROCKER_K = [ROCKER_P[0] + 0.05 * Math.cos(ka), ROCKER_P[1] + 0.05 * Math.sin(ka)];
  S_BASE = [ROCKER_P[0] + 0.1 * Math.cos(sb), ROCKER_P[1] + 0.1 * Math.sin(sb)];
  let lo = 0.3, hi = 3;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (linkage(m).travel > 0.18) lo = m; else hi = m; }
  return linkage((lo + hi) / 2);
}
export const LINK = designLinkage(KA, SB);

// lookup table over the rear travel range
const N = 256;
export const REAR_LUT = (() => {
  const t = { th0: LINK.thExt, th1: LINK.thBot, n: N, ax: [], ay: [], tx: [], ty: [], len: [], dlen: [] };
  const e = 1e-5;
  for (let i = 0; i < N; i++) {
    const th = t.th0 + (t.th1 - t.th0) * i / (N - 1), k = LINK.kin(th), kp = LINK.kin(th + e), km = LINK.kin(th - e);
    t.ax.push(k.axle[0]); t.ay.push(k.axle[1]); t.tx.push((kp.axle[0] - km.axle[0]) / (2 * e)); t.ty.push((kp.axle[1] - km.axle[1]) / (2 * e));
    t.len.push(k.len); t.dlen.push((kp.len - km.len) / (2 * e));
  }
  return t;
})();
export function rearAt(th) {
  const t = REAR_LUT, f = Math.min(Math.max((th - t.th0) / (t.th1 - t.th0), 0), 1) * (t.n - 1), i = Math.min(Math.floor(f), t.n - 2), u = f - i, L = (a) => a[i] + (a[i + 1] - a[i]) * u;
  return { ax: L(t.ax), ay: L(t.ay), tx: L(t.tx), ty: L(t.ty), len: L(t.len), dlen: L(t.dlen) };
}
// leverage ratio (wheel vertical travel per unit shock stroke)
export const leverage = (th) => { const r = rearAt(th); return -r.ty / r.dlen; };
export { about, sub, add, mul, len, rot };
