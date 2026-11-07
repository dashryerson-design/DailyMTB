// Minimal vector / quaternion math for the physics core (no THREE dependency).
export class V {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  add(b) { return new V(this.x + b.x, this.y + b.y, this.z + b.z); }
  sub(b) { return new V(this.x - b.x, this.y - b.y, this.z - b.z); }
  mul(s) { return new V(this.x * s, this.y * s, this.z * s); }
  addS(b, s) { return new V(this.x + b.x * s, this.y + b.y * s, this.z + b.z * s); }
  dot(b) { return this.x * b.x + this.y * b.y + this.z * b.z; }
  cross(b) { return new V(this.y * b.z - this.z * b.y, this.z * b.x - this.x * b.z, this.x * b.y - this.y * b.x); }
  len() { return Math.hypot(this.x, this.y, this.z); }
  norm() { const l = this.len() || 1; return this.mul(1 / l); }
}
export const X = new V(1, 0, 0), Y = new V(0, 1, 0), Z = new V(0, 0, 1);

export class Q {
  constructor(w = 1, x = 0, y = 0, z = 0) { this.w = w; this.x = x; this.y = y; this.z = z; }
  static axis(a, ang) { const s = Math.sin(ang / 2); return new Q(Math.cos(ang / 2), a.x * s, a.y * s, a.z * s); }
  mul(b) {
    const a = this;
    return new Q(
      a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w);
  }
  rot(v) {
    const { w, x: qx, y: qy, z: qz } = this;
    const tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
    return new V(v.x + w * tx + qy * tz - qz * ty, v.y + w * ty + qz * tx - qx * tz, v.z + w * tz + qx * ty - qy * tx);
  }
  inv(v) { return new Q(this.w, -this.x, -this.y, -this.z).rot(v); }
  // integrate world angular velocity w over dt
  integrate(w, dt) {
    const h = 0.5 * dt, a = this;
    const n = new Q(
      a.w + h * (-w.x * a.x - w.y * a.y - w.z * a.z),
      a.x + h * (w.x * a.w + w.y * a.z - w.z * a.y),
      a.y + h * (w.y * a.w + w.z * a.x - w.x * a.z),
      a.z + h * (w.z * a.w + w.x * a.y - w.y * a.x));
    const l = Math.hypot(n.w, n.x, n.y, n.z);
    n.w /= l; n.x /= l; n.y /= l; n.z /= l; return n;
  }
}

// Rodrigues rotation of u about unit axis a by angle b
export function rodr(u, a, b) {
  const c = Math.cos(b), s = Math.sin(b);
  return u.mul(c).add(a.cross(u).mul(s)).add(a.mul(a.dot(u) * (1 - c)));
}
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
