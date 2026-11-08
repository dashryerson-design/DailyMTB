// Tyre roost: two layers on one GPU point cloud.
//  - grit: small dark clods/granules flung off the tread, ballistic, short-lived, slightly bouncing
//  - dust: soft billowing puffs that grow, drift, slow down and fade (snow/sand far more than dirt)
// Soft round sprites with per-particle size + alpha, depth-faded and fogged so they sit in the scene.
const T = window.THREE;
// [grit colour, dust colour, grit amount, dust amount, dust opacity]
const LOOK = { Dirt: [0x4a3626, 0x9c8266, 1, 0.8, 0.35], Gravel: [0x6c675f, 0xa49c90, 0.8, 0.5, 0.25], Rock: [0x77746e, 0xb0aca4, 0.15, 0.2, 0.2],
  Grass: [0x4b4a2c, 0x8f8a64, 0.4, 0.2, 0.18], Root: [0x3e2c1e, 0x8a7258, 0.7, 0.5, 0.3], 'Packed snow': [0xe8eef6, 0xf6f9fd, 1.4, 1.6, 0.55],
  Ice: [0xd8e6f2, 0xeef5fb, 0.4, 0.5, 0.35], Sand: [0xb89a68, 0xdcc49a, 1.2, 1.7, 0.45] };
const N = 2400;
const VS = `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; varying float vFog; varying float vSoft;
uniform float scale; uniform vec2 fogR;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float d = -mv.z; gl_PointSize = size * scale / max(d, 0.1); vA = alpha; vC = color; vSoft = size;
  vFog = smoothstep(fogR.x, fogR.y, d) * 0.9 + smoothstep(0.3, 0.0, d); }`;
const FS = `varying float vA; varying vec3 vC; varying float vFog; varying float vSoft; uniform vec3 fogC;
void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
  float a = vSoft < 0.06 ? smoothstep(1.0, 0.55, r) : exp(-r * 3.0) * (1.0 - r);   // grit = hard-ish speck, dust = gaussian puff
  vec3 c = vC * (0.82 + 0.25 * (1.0 - p.y) * 0.5);                                    // light from above
  gl_FragColor = vec4(mix(c, fogC, vFog), a * vA * (1.0 - vFog)); }`;
export class Dust {
  constructor(scene) {
    const g = new T.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.life = new Float32Array(N); this.max = new Float32Array(N);
    this.kind = new Uint8Array(N); this.s0 = new Float32Array(N); this.a0 = new Float32Array(N);
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3)); g.setAttribute('color', new T.BufferAttribute(this.col, 3));
    g.setAttribute('size', new T.BufferAttribute(this.size, 1)); g.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1));
    this.mat = new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 }, fogR: { value: new T.Vector2(70, 280) }, fogC: { value: new T.Color(0xaaaaaa) } } });
    this.pts = new T.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 2; scene.add(this.pts);
    this.scene = scene; this.i = 0; this.acc = [0, 0, 0, 0]; this.pos.fill(-1e4);
  }
  spawn(kind, c, v, k, look) {
    const i = this.i = (this.i + 1) % N, j = i * 3, col = new T.Color(look[kind ? 1 : 0]), sh = 0.85 + Math.random() * 0.3, sp = 0.5 + Math.random();
    this.kind[i] = kind; this.pos[j] = c.p.x + (Math.random() - 0.5) * 0.12; this.pos[j + 1] = c.p.y + 0.02; this.pos[j + 2] = c.p.z + (Math.random() - 0.5) * 0.12;
    if (kind === 0) {   // grit: flung back and up off the tread
      this.vel[j] = v.x * 0.35 - k.x * sp * 2.2 + (Math.random() - 0.5) * 1.2; this.vel[j + 1] = 1 + Math.random() * 2.6; this.vel[j + 2] = v.z * 0.35 - k.z * sp * 2.2 + (Math.random() - 0.5) * 1.2;
      this.s0[i] = 0.018 + Math.random() * 0.03; this.a0[i] = 0.95; this.max[i] = this.life[i] = 0.5 + Math.random() * 0.5;
    } else {             // dust: low, lazy, drifts with the air the bike drags
      this.vel[j] = v.x * 0.45 - k.x * sp * 0.6 + (Math.random() - 0.5) * 0.8; this.vel[j + 1] = 0.25 + Math.random() * 0.6; this.vel[j + 2] = v.z * 0.45 - k.z * sp * 0.6 + (Math.random() - 0.5) * 0.8;
      this.s0[i] = 0.25 + Math.random() * 0.3; this.a0[i] = look[4] * (0.6 + Math.random() * 0.5); this.max[i] = this.life[i] = 1.4 + Math.random() * 1.6;
    }
    this.col[j] = col.r * sh; this.col[j + 1] = col.g * sh; this.col[j + 2] = col.b * sh;
  }
  update(dt, bike, h, cam) {
    if (this.scene.fog && this.scene.fog.near !== undefined) { this.mat.uniforms.fogC.value.copy(this.scene.fog.color); this.mat.uniforms.fogR.value.set(this.scene.fog.near, this.scene.fog.far); }
    if (cam) this.mat.uniforms.scale.value = window.innerHeight * (window.devicePixelRatio || 1) / (2 * Math.tan(cam.fov * Math.PI / 360));
    if (bike && bike.mounted) {
      const v = bike.v, spd = Math.hypot(v.x, v.z), fw = spd > 0.1 ? { x: v.x / spd, z: v.z / spd } : { x: 0, z: 0 };
      [[bike.cR, 1, 0], [bike.cF, 0.3, 2]].forEach(([c, w, ix]) => {
        if (!c || spd < 1.2) return;
        const look = LOOK[c.surf.name] || LOOK.Dirt, slip = Math.min(3, Math.abs(c.slip || 0) * 4 + Math.abs(c.Fy || 0) / 600), brk = (bike.inp.bR * (ix ? 0.3 : 1) + bike.inp.bF * (ix ? 1 : 0.3)) * spd;
        const rate = w * (spd * 3 + slip * 45 + brk * 6);
        for (const kind of [0, 1]) {
          this.acc[ix + kind] += dt * rate * look[2 + kind] * (kind ? 0.8 : 1);
          let n = Math.min(25, Math.floor(this.acc[ix + kind])); this.acc[ix + kind] -= n;
          while (n-- > 0) this.spawn(kind, c, v, fw, look);
        }
      });
    }
    const p = this.pos, vl = this.vel;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { if (this.alpha[i] > 0) { this.alpha[i] = 0; p[j + 1] = -1e4; } continue; }
      this.life[i] -= dt; const u = 1 - this.life[i] / this.max[i];
      if (this.kind[i] === 0) {
        vl[j + 1] -= 9.8 * dt; const dr = Math.exp(-0.6 * dt); vl[j] *= dr; vl[j + 2] *= dr;
        this.size[i] = this.s0[i]; this.alpha[i] = this.a0[i] * Math.min(1, this.life[i] / 0.15);
      } else {
        const dr = Math.exp(-2.6 * dt); vl[j] *= dr; vl[j + 2] *= dr; vl[j + 1] = vl[j + 1] * dr + 0.05 * dt;   // air drag, barely settles
        this.size[i] = this.s0[i] * (1 + 3.2 * Math.sqrt(u)); this.alpha[i] = this.a0[i] * Math.min(1, u / 0.08) * (1 - u) * (1 - u);
      }
      p[j] += vl[j] * dt; p[j + 1] += vl[j + 1] * dt; p[j + 2] += vl[j + 2] * dt;
      const g = h(p[j], p[j + 2]), floor = g + (this.kind[i] ? this.size[i] * 0.3 : 0.01);
      if (p[j + 1] < floor) { p[j + 1] = floor; if (this.kind[i] === 0) { vl[j + 1] = Math.abs(vl[j + 1]) * 0.2; vl[j] *= 0.4; vl[j + 2] *= 0.4; if (Math.abs(vl[j + 1]) < 0.3) this.life[i] = Math.min(this.life[i], 0.15); } else vl[j + 1] = 0; }
    }
    const a = this.pts.geometry.attributes; a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.color.needsUpdate = true;
  }
}
