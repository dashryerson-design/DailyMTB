// Spring-damper models. Forces are positive when they resist compression.
// Damping is two-stage (low/high speed knee) with separate compression and rebound circuits.
function damper(v, c) {
  if (v >= 0) return v < c.knee ? c.ls * v : c.ls * c.knee + c.hs * (v - c.knee);
  const u = -v; return -(u < c.rknee ? c.rls * u : c.rls * c.rknee + c.rhs * (u - c.rknee));
}

export class AirFork {
  // F(s) = F0 + k s + k3 s^3 (air-spring progression), F0 set so static sag hits target
  constructor(travel, staticLoad, sag) {
    this.travel = travel; this.k = 4200; this.k3 = 290000;
    this.F0 = staticLoad - this.k * sag - this.k3 * sag ** 3;
    this.damp = { ls: 250, hs: 75, knee: 0.35, rls: 430, rhs: 240, rknee: 0.5 };
    this.bumper = 0.012; this.kBump = 3e6;
  }
  spring(s) { return this.F0 + this.k * s + this.k3 * s * s * s; }
  force(s, v) {
    let f = this.spring(s) + damper(v, this.damp);
    const b = s - (this.travel - this.bumper);
    if (b > 0) f += this.kBump * b * b / this.bumper + 2000 * Math.max(v, 0); // elastomer + hydraulic bottom-out
    return f;
  }
}

export class CoilShock {
  // x = shock compression (m). Spring rate set from linkage so static sag hits target.
  constructor(stroke, k, lev) {
    this.stroke = stroke; this.k = k; this.preload = 0;
    const L2 = lev * lev;  // convert wheel-referenced damping to shaft-referenced
    this.damp = { ls: 330 * L2, hs: 100 * L2, knee: 0.35 / lev, rls: 560 * L2, rhs: 270 * L2, rknee: 0.5 / lev };
    this.bumper = 0.006; this.kBump = 3.2e7;
  }
  force(x, v) {
    let f = this.preload + this.k * x + damper(v, this.damp);
    const b = x - (this.stroke - this.bumper);
    if (b > 0) f += this.kBump * b * b / this.bumper + 20000 * Math.max(v, 0);
    return f;
  }
}
