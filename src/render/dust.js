// Dirt / snow / sand roost kicked up by the tyres: a pooled THREE.Points cloud. Emission scales with speed,
// tyre slip and braking, per surface (snow and sand throw a lot, rock almost nothing).
const T = window.THREE;
const LOOK = { Dirt: [0x8a6a48, 1], Gravel: [0x9a9286, 0.6], Rock: [0xa8a49c, 0.15], Grass: [0x6f6a42, 0.35], Root: [0x6e5238, 0.7], 'Packed snow': [0xf4f7fb, 1.6], Ice: [0xdfeaf4, 0.5], Sand: [0xd8bd88, 1.7] };
const N = 1600;
export class Dust {
  constructor(scene) {
    const g = new T.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.base = new Float32Array(N * 3);
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3)); g.setAttribute('color', new T.BufferAttribute(this.col, 3));
    this.pts = new T.Points(g, new T.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    this.pts.frustumCulled = false; scene.add(this.pts); this.i = 0; this.acc = [0, 0]; this.life.fill(0); this.pos.fill(-1e4);
  }
  emit(c, v, n, look, k) {
    const col = new T.Color(look[0]);
    for (let e = 0; e < n; e++) {
      const i = this.i = (this.i + 1) % N, j = i * 3, sp = 0.6 + Math.random();
      this.pos[j] = c.p.x + (Math.random() - 0.5) * 0.15; this.pos[j + 1] = c.p.y + 0.03; this.pos[j + 2] = c.p.z + (Math.random() - 0.5) * 0.15;
      // thrown backwards/up off the tyre, inheriting part of the bike's velocity
      this.vel[j] = v.x * 0.25 - k.x * sp * 1.6 + (Math.random() - 0.5) * 1.4; this.vel[j + 1] = 0.8 + Math.random() * 1.8 * Math.min(1.5, look[1]);
      this.vel[j + 2] = v.z * 0.25 - k.z * sp * 1.6 + (Math.random() - 0.5) * 1.4;
      const sh = 0.85 + Math.random() * 0.3; this.base[j] = col.r * sh; this.base[j + 1] = col.g * sh; this.base[j + 2] = col.b * sh;
      this.life[i] = 0.6 + Math.random() * 0.7;
    }
  }
  update(dt, bike, h) {
    if (bike && bike.mounted) {
      const v = bike.v, spd = Math.hypot(v.x, v.z), fw = spd > 0.1 ? { x: v.x / spd, z: v.z / spd } : { x: 0, z: 0 };
      [[bike.cR, 1, 0], [bike.cF, 0.35, 1]].forEach(([c, w, ix]) => {
        if (!c || spd < 1.5) return;
        const look = LOOK[c.surf.name] || LOOK.Dirt, slip = Math.min(3, Math.abs(c.slip || 0) * 4 + Math.abs(c.Fy || 0) / 600);
        this.acc[ix] += dt * w * look[1] * (spd * 10 + slip * 60 + (bike.inp.bR + bike.inp.bF) * spd * 8);
        const n = Math.floor(this.acc[ix]); this.acc[ix] -= n; if (n) this.emit(c, v, Math.min(n, 30), look, fw);
      });
    }
    const p = this.pos, vl = this.vel, c = this.col;
    for (let i = 0; i < N; i++) {
      const j = i * 3; if (this.life[i] <= 0) { if (p[j + 1] > -1e3) p[j + 1] = -1e4; continue; }
      this.life[i] -= dt; const dr = Math.exp(-2.2 * dt);
      vl[j] *= dr; vl[j + 2] *= dr; vl[j + 1] = vl[j + 1] * dr - 4.5 * dt;
      p[j] += vl[j] * dt; p[j + 1] += vl[j + 1] * dt; p[j + 2] += vl[j + 2] * dt;
      const g = h(p[j], p[j + 2]); if (p[j + 1] < g + 0.02) { p[j + 1] = g + 0.02; vl[j + 1] = 0; vl[j] *= 0.5; vl[j + 2] *= 0.5; }
      c[j] = this.base[j]; c[j + 1] = this.base[j + 1]; c[j + 2] = this.base[j + 2];
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
  }
}
