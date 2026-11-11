// Game audio (Web Audio). Looped beds (pedalling, coasting, surface roll, biome ambience) are always
// playing and mixed by gain each frame; one-shots for landings (by fall speed) and braking.
// Buses: master -> compressor -> out; bike / amb / fx groups each with a user volume (saved locally).
const FILES = ['forest_ambience', 'big_wheels_impact', 'moderate_wheels_impact', 'coasting', 'small_wheels_impact', 'desert_ambience',
  'pedaling', 'riding_on_snow', 'braking', 'snow_ambience', 'riding_on_dirt', 'riding_on_sand', 'suspension_returning_to_normal_after_a_big_landing'];
const url = (n) => `assets/audio/${n}.mp3`;
const PED_SWELL = 0.7, TC = 0.12;                                   // pedal-stroke swell, gain smoothing (s)
const IMPACTS = [['big_wheels_impact', 7], ['moderate_wheels_impact', 4], ['small_wheels_impact', 2.2]];   // min fall speed (m/s)
const SETTLE = 'suspension_returning_to_normal_after_a_big_landing', SETTLE_DELAY = 0.4;
const LOOP_GAIN = { pedaling: 11, coasting: 11, riding_on_dirt: 8, riding_on_sand: 1, riding_on_snow: 2.5 };
const AMB = { snow: ['snow_ambience', 2.1], forest: ['forest_ambience', 2.7], desert: ['desert_ambience', 6.9] };
const ROLL = { forest: 'riding_on_dirt', desert: 'riding_on_sand', snow: 'riding_on_snow' };
const DEF_VOL = { master: 0.8, bike: 1, amb: 1, fx: 1 }, KEY = 'dailymtb.audio', MIN_AIR = 0.2, SMALL_GAP = 0.6;

export class Sound {
  constructor() {
    this.ctx = null; this.g = {}; this.src = {}; this.buf = {}; this.lbuf = {}; this.bus = {};
    this.loading = false; this.ready = false; this.pedEnv = 0; this.fall = 0; this.prevAir = 0; this.crankRps = 0;
    this.pc = null; this.pcT = null; this.lastSmall = -9; this.vol = { ...DEF_VOL }; this.muted = false; this.biome = null; this.rf = null;
    try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k in DEF_VOL) if (typeof s[k] === 'number') this.vol[k] = Math.min(1, Math.max(0, s[k])); this.muted = !!s.muted; } catch {}
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ ...this.vol, muted: this.muted })); } catch {} }
  applyVol() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master ** 2, t, 0.03);
    for (const k of ['bike', 'amb', 'fx']) this.bus[k].gain.setTargetAtTime(this.vol[k] ** 2, t, 0.03);
  }
  setVol(k, v) { this.vol[k] = Math.min(1, Math.max(0, v)); this.applyVol(); this.save(); }
  setMuted(m) { this.muted = !!m; this.applyVol(); this.save(); }
  // short sample of a bus after its slider is moved
  preview(k) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime, g = c.createGain(), name = k === 'bike' ? 'pedaling' : k === 'amb' ? (AMB[this.biome] || AMB.forest)[0] : null;
    const b = name ? this.lbuf[name] : this.buf.moderate_wheels_impact; if (!b) return;
    const s = c.createBufferSource(); s.buffer = b; s.connect(g); g.connect(this.bus[k === 'master' ? 'fx' : k]);
    g.gain.value = name ? LOOP_GAIN[name] || (AMB[this.biome] || AMB.forest)[1] : 1; s.start();
    if (name) { g.gain.setTargetAtTime(0, t + 1, 0.15); s.stop(t + 1.8); }
  }
  // browsers only allow audio after a user gesture: called from every input event
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC(); c.onstatechange = () => this.badge();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.master = c.createGain(); this.master.connect(comp); comp.connect(c.destination);
      for (const k of ['bike', 'amb', 'fx']) { this.bus[k] = c.createGain(); this.bus[k].connect(this.master); }
      this.applyVol(); this.load();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().then(() => this.badge(), () => {});
    this.badge();
  }
  badge() {
    try {
      let e = document.getElementById('sndBadge');
      if (!e) { e = document.createElement('div'); e.id = 'sndBadge'; e.textContent = '🔊 Click or press any key to enable sound';
        e.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#000c;color:#fff;font:600 13px sans-serif;padding:8px 14px;border-radius:20px;z-index:99999;pointer-events:none';
        document.body.appendChild(e); }
      e.style.display = this.ctx && this.ctx.state === 'running' ? 'none' : 'block';
    } catch {}
  }
  async dec(n) {
    try { const ab = await this.pre[n]; return await new Promise((r) => this.ctx.decodeAudioData(ab, r, (e) => { console.warn('audio decode failed', n, e); r(null); })); }
    catch (e) { console.warn('audio load failed', n, e); return null; }
  }
  async load() {
    if (this.loading) return; this.loading = true; const c = this.ctx;
    this.pre = Object.fromEntries(FILES.map((n) => [n, fetch(url(n)).then((r) => r.arrayBuffer())]));   // download all at once
    const loops = ['pedaling', 'coasting', 'snow_ambience', 'forest_ambience', 'desert_ambience', 'riding_on_dirt', 'riding_on_sand', 'riding_on_snow'];
    for (const n of loops) { const g = c.createGain(); g.gain.value = 0; g.connect(this.bus[n.endsWith('ambience') ? 'amb' : 'bike']); this.g[n] = g; }
    const dl = await Promise.all(FILES.map((n) => this.dec(n))), B = Object.fromEntries(FILES.map((n, i) => [n, dl[i]]));
    for (const n of loops) { const b = B[n]; if (b) { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.connect(this.g[n]); s.start(); this.lbuf[n] = b; this.src[n] = s; } }
    for (const n of [...IMPACTS.map(([n]) => n), SETTLE, 'braking']) this.buf[n] = B[n];
    this.ready = true;
  }
  // L = level state, mode = 'ride' | 'finished' | 'replay' | ..., paused
  update(L, mode, paused) {
    if (!this.ready) return;
    const riding = L && mode === 'ride' && !paused, RP = mode === 'replay' && this.rf ? this.rf : null, t = this.ctx.currentTime;
    let ped = 0, coast = 0, roll = 0;
    if (riding) {
      const b = L.bike, gr = !!(b.cF || b.cR);
      if (b.mounted && !b.crashed && gr) { if (b.inp.thr > 0.05 && b.Tdrive > 0.5) ped = 1; else if (b.speed > 0.5) coast = Math.min(1, b.speed / 4); roll = Math.min(1, Math.max(0, b.speed) / 5); }
      const st = ped ? Math.pow(Math.max(0, Math.cos(2 * (b.crank || 0))), 3) : 0;   // swell on each pedal stroke
      this.pedEnv += (st - this.pedEnv) * 0.35;
    } else this.pedEnv *= 0.8;
    // biome ambience (also on the finish screen and in replays)
    const amb = L && (mode === 'ride' || mode === 'finished' || mode === 'replay') && AMB[L.track.biome];
    for (const [, a] of Object.entries(AMB)) this.g[a[0]].gain.setTargetAtTime(amb && amb[0] === a[0] ? a[1] : 0, t, 0.3);
    // landings: biggest downward speed during the airtime picks the impact sound
    if (riding) { const b = L.bike; if (b.air > 0) this.fall = Math.max(this.fall, -b.v.y); else if (this.fall > 0) { if (this.prevAir >= MIN_AIR) this.impact(this.fall); this.fall = 0; } this.prevAir = b.air; }
    else if (!RP) { this.fall = 0; this.prevAir = 0; }
    // braking loop
    const brake = !!(riding && L.bike.mounted && !L.bike.crashed && (L.bike.cF || L.bike.cR) && Math.max(L.bike.inp.bF, L.bike.inp.bR) > 0.3 && L.bike.speed > 1.5);
    if (brake && !this.brk && this.buf.braking) {
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = this.buf.braking; s.connect(g).connect(this.bus.bike);
      s.onended = () => { if (this.brk && this.brk.src === s) this.brk = null; }; s.start(); this.brk = { src: s, g };
    } else if (!brake && this.brk) { const { src, g } = this.brk; this.brk = null; g.gain.setTargetAtTime(0, t, 0.04); src.stop(t + 0.2); }
    this.biome = L ? L.track.biome : this.biome;
    // replay: drive the same mix from the recorded frames
    if (RP) {
      const F = RP.i, V = F.v || { x: 0, y: 0, z: 0 }, sp = Math.hypot(V.x, V.z), gr = !F.air, pd = gr && this.crankRps > 0.3;
      ped = pd ? 1 : 0; coast = gr && !pd && sp > 0.5 ? Math.min(1, sp / 4) : 0; roll = gr ? Math.min(1, sp / 5) : 0;
      this.pedEnv += ((pd ? Math.pow(Math.max(0, Math.cos(2 * (RP.crank || 0))), 3) : 0) - this.pedEnv) * 0.35;
      if (F.air) { this.fall = Math.max(this.fall, -V.y); this.prevAir += RP.dt; }
      else { if (this.fall > 0 && this.prevAir >= MIN_AIR) this.impact(this.fall); this.fall = 0; this.prevAir = 0; }
    }
    // pedalling loop pitch follows cadence
    const B = RP ? { crank: RP.crank || 0 } : L && L.bike, now = performance.now(), cr = B ? B.crank || 0 : 0;
    if (this.pcT != null && now > this.pcT && B) { const d = (now - this.pcT) / 1000; if (d < 0.25) this.crankRps += (Math.abs(cr - this.pc) / d / 6.2832 - this.crankRps) * 0.25; }
    this.pc = cr; this.pcT = now; this.crankRps = this.crankRps || 0;
    const P = this.src.pedaling;
    if (P && ped) P.playbackRate.setTargetAtTime(Math.min(1.15, Math.max(0.88, 1 + 0.3 * (this.crankRps / 1.5 - 1))), t, 0.06);
    this.g.pedaling.gain.setTargetAtTime(ped * (1 + PED_SWELL * this.pedEnv) * LOOP_GAIN.pedaling, t, TC);
    this.g.coasting.gain.setTargetAtTime(coast * LOOP_GAIN.coasting, t, TC);
    const rl = L && ROLL[L.track.biome];
    for (const n of Object.values(ROLL)) this.g[n].gain.setTargetAtTime(n === rl ? roll * LOOP_GAIN[n] : 0, t, TC);
  }
  impact(fall) {
    const hit = IMPACTS.find(([, v]) => fall >= v); if (!hit) return;
    const t = this.ctx.currentTime;
    if (hit[0].startsWith('small')) { if (t - this.lastSmall < SMALL_GAP) return; this.lastSmall = t; }
    if (!this.buf[hit[0]]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[hit[0]]; s.connect(this.bus.fx); s.start();
    if (hit[0].startsWith('big')) { const s2 = this.ctx.createBufferSource(); s2.buffer = this.buf[SETTLE]; s2.connect(this.bus.fx); s2.start(t + SETTLE_DELAY); }
  }
  silence() { if (this.ready) for (const k in this.g) this.g[k].gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }
}
