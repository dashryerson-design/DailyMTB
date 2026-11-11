import { extremeTrackGenerator } from './terrain/track.js';
import { RideSystem } from './physics/system.js';
import { V, Q, clamp } from './core/math.js';
import * as G from './physics/geometry.js';
import { BikeModel } from './render/bikeModel.js';
import { RiderModel } from './render/riderModel.js';
import { buildWorld, envMap } from './render/world.js';
import { CameraRig, CAM_MODES } from './render/camera.js';
import { Sound } from './game/sound.js';
import { Q as GFX, setQuality, applyRenderer, applySun, setStyle, styleModel, buildLowPoly } from './render/quality.js';
import { LOWPOLY } from './render/rider/kit.js';
import { Dust } from './render/dust.js';
import { Input } from './game/input.js';
const T = window.THREE;

const $ = (id) => document.getElementById(id);
const DT = 1 / 1000;
const show = (id) => ['mainMenu', 'biomeMenu', 'helpMenu', 'finish', 'loading', 'hud'].forEach(k => $(k).hidden = k !== id && !(id === 'finish' && k === 'hud'));
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ---- renderer + persistent scene objects
const renderer = new T.WebGLRenderer({ antialias: true, canvas: $('view') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // (overridden by the quality preset below)
renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; applyRenderer(renderer);
const scene = new T.Scene(), cam = new T.PerspectiveCamera(62, 1, 0.05, 700);
scene.environment = envMap(renderer);
const dust = new Dust(scene), input = new Input();
// bike + rider models (and the ghost: translucent copies). Rebuilt when the visual style changes:
// low poly builds the same parts with very few segments. Purely visual - the physics never sees these.
let model, riderModel, ghost;
function buildModels() {
  for (const o of [model && model.root, riderModel && riderModel.group, ghost && ghost.bike.root, ghost && ghost.rider.group]) if (o) { scene.remove(o); o.traverse((m) => m.geometry && m.geometry.dispose()); }
  const lp = GFX.style === 'lowpoly', make = () => { LOWPOLY.on = false; try { return [new BikeModel(scene), new RiderModel(scene), new BikeModel(scene), new RiderModel(scene)]; } finally { LOWPOLY.on = false; } };
  const [b, rr, gb, gr] = make();   // full-detail models in both styles (cartoon look comes from materials)
  model = b; riderModel = rr; ghost = { bike: gb, rider: gr };
  for (const o of [ghost.bike.root, ghost.rider.group]) o.traverse(m => { if (m.material) { m.material = m.material.clone(); Object.assign(m.material, { transparent: true, opacity: 0.32, depthWrite: false }); m.castShadow = false; } });
  showGhost(false);
}
const showGhost = (v) => { if (ghost) ghost.bike.root.visible = ghost.rider.group.visible = v; };
buildModels();
const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

let L = null;            // the loaded level: { track, sys, bike, rider, rig, world, sun, ... }
let paused = false, biome = null, mode = 'menu';
// sound: needs a user gesture to start, so every input event tries to unlock it
const snd = new Sound();
for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'keydown', 'keyup']) addEventListener(ev, () => snd.unlock(), true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') snd.unlock(); });
snd.badge();
function setPause(v) { paused = !!v && mode === 'ride'; $('pauseMenu').hidden = !paused; }

// ---- menus
$('playBtn').onclick = () => show('biomeMenu');
$('backBtn').onclick = () => show('mainMenu');
$('helpBtn').onclick = () => show('helpMenu');
$('helpBack').onclick = () => show('mainMenu');
document.querySelectorAll('.card').forEach(c => c.onclick = () => {
  document.querySelectorAll('.card').forEach(o => o.classList.toggle('sel', o === c));
  biome = c.dataset.biome; $('genBtn').disabled = false;
});
$('genBtn').onclick = () => load(biome);
$('replayBtn').onclick = () => startReplay();
$('replayExit').onclick = () => endReplay();
$('newBtn').onclick = () => load(L.track.biome);
$('againBtn').onclick = () => { show('hud'); restartRun(); mode = 'ride'; };
$('menuBtn2').onclick = $('menuBtn').onclick = () => toMenu();
addEventListener('keydown', (e) => { if (e.code === 'Escape' && mode === 'replay') endReplay(); else if (e.code === 'Escape' && mode === 'ride') setPause(!paused); });
function toMenu() { setPause(false); mode = 'menu'; show('biomeMenu'); }

function disposeTree(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) [].concat(n.material).forEach(m => m.dispose()); }); o.parent && o.parent.remove(o); }

// start / finish gates
// checkpoint marker: a red flag on a slim pole either side of the trail
const flagMat = new T.MeshStandardMaterial({ color: new T.Color(0xd8261c).convertSRGBToLinear(), roughness: 0.8, side: T.DoubleSide });
const poleMat = new T.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.4, metalness: 0.5 });
const flagGeo = (() => { const g = new T.PlaneGeometry(0.85, 0.58, 8, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.425; p.setXYZ(i, x, p.getY(i), 0.06 * Math.sin(x * 7) * x); }   // cloth ripple, fixed at the pole
  g.computeVertexNormals(); return g; })();
function flags(track, s) {
  const grp = new T.Group(), c = track.sampleAt(s);
  for (const sd of [-1, 1]) {
    const p = track.toWorld(s, sd * 2.6), y = track.h(p.x, p.z);
    const pole = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 2.4, 8), poleMat); pole.position.set(p.x, y + 1.2, p.z); pole.castShadow = true; grp.add(pole);
    const f = new T.Mesh(flagGeo, flagMat); f.castShadow = true;
    f.position.set(p.x, y + 2.08, p.z); f.rotation.y = Math.atan2(-sd * Math.cos(c.psi), -sd * Math.sin(c.psi));   // flies outward from the trail, face-on to the approaching rider
    grp.add(f);
  }
  return grp;
}
function gate(track, s, text, color) {
  const g = new T.Group(), p = track.sampleAt(s), y = track.h(p.x, p.z), right = new T.Vector3(-Math.sin(p.psi), 0, Math.cos(p.psi));
  const post = new T.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  for (const sd of [-1, 1]) { const m = new T.Mesh(new T.BoxGeometry(0.18, 3.6, 0.18), post); m.position.set(p.x + right.x * sd * 2.6, track.h(p.x + right.x * sd * 2.6, p.z + right.z * sd * 2.6) + 1.8, p.z + right.z * sd * 2.6); m.castShadow = true; g.add(m); }
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const c = cv.getContext('2d');
  c.fillStyle = color; c.fillRect(0, 0, 512, 96); c.fillStyle = '#160a02'; c.font = 'italic 900 64px "Barlow Condensed", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 52);
  const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
  const ban = new T.Mesh(new T.PlaneGeometry(5.4, 1.0), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }));
  ban.position.set(p.x, y + 3.3, p.z); ban.rotation.y = -p.psi - Math.PI / 2; g.add(ban);
  return g;
}

$('resumeBtn').onclick = () => setPause(false);
$('menuBtn3').onclick = () => toMenu();
for (const [k, id] of Object.entries({ master: 'volMaster', bike: 'volBike', amb: 'volAmb', fx: 'volFx' })) {
  const el = $(id), lab = $(id + 'V'), fill = () => el.style.setProperty('--p', el.value + '%'); el.value = Math.round(snd.vol[k] * 100); lab.textContent = el.value + '%'; fill();
  el.oninput = () => { snd.setVol(k, el.value / 100); lab.textContent = el.value + '%'; fill(); };
  el.onchange = () => { el.blur(); snd.preview(k); };
}
// graphics quality (pause menu): applies instantly
const qualLabel = () => document.querySelectorAll('.qualSel button').forEach(b => b.classList.toggle('on', b.dataset.q === GFX.level));
document.querySelectorAll('.qualSel button').forEach(b => b.onclick = () => { setQuality(b.dataset.q); applyRenderer(renderer); resize(); if (L) applySun(L.sun); qualLabel(); });
qualLabel();
// visual style: REAL or LOW POLY (models restyle now; the world uses it from the next track)
const restyle = () => { for (const o of [model.root, riderModel.group, ghost.bike.root, ghost.rider.group]) styleModel(o); };
const styleLabel = () => document.querySelectorAll('.styleSel button').forEach(b => b.classList.toggle('on', b.dataset.s === GFX.style));
document.querySelectorAll('.styleSel button').forEach(b => b.onclick = () => { if (b.dataset.s === GFX.style) return; setStyle(b.dataset.s); buildModels(); restyle(); styleLabel(); });
restyle(); styleLabel();
// physics telemetry panels (fork/shock travel, lean, gear, graph): off by default, toggled in the pause menu
let showTele = false; try { showTele = localStorage.getItem('dailymtb.tele') === '1'; } catch {}
const teleApply = () => { $('stats').hidden = $('telemetry').hidden = !showTele; $('teleBtn').classList.toggle('on', showTele); $('teleBtn').querySelector('b').textContent = showTele ? 'ON' : 'OFF'; };
$('teleBtn').onclick = () => { showTele = !showTele; try { localStorage.setItem('dailymtb.tele', showTele ? '1' : '0'); } catch {} teleApply(); }; teleApply();
const muteLabel = () => { $('muteBtn').innerHTML = `<span>${snd.muted ? 'Unmute' : 'Mute'}</span>`; }; muteLabel();
$('muteBtn').onclick = () => { snd.setMuted(!snd.muted); muteLabel(); };
// every new track comes from the Extreme track generator (no generator choice for the player)
function load(b) {
  if (mode === 'loading' || !b) return;   // ignore repeat requests while a track is being generated
  const extreme = true;
  setPause(false);
  show('loading'); $('loadBiome').textContent = b.toUpperCase(); $('genBtn').disabled = true; mode = 'loading';
  setTimeout(() => {                    // let the loading screen paint before the heavy work
    if (L) { disposeTree(L.world); }
    const track = extremeTrackGenerator(b), w = buildWorld(scene, track), sys = new RideSystem(track);
    w.root.add(gate(track, 6, 'START', '#f4efe6'), gate(track, track.total - 8, 'FINISH', '#ff6a1a'));
    // 5 checkpoints spread evenly along the run (nudged off jumps/drops so you never respawn on a lip)
    const cps = [1, 2, 3, 4, 5].map(i => { let cs = track.total * i / 6; for (let k = 0; k < 40; k++) { const sg = track.segs.find(g => cs >= g.s0 - 2 && cs < g.s0 + g.len + 2); if (!sg || !sg.feat) break; cs = sg.s0 + sg.len + 4; } return cs; });
    cps.forEach((cs) => w.root.add(flags(track, cs)));
    L = { track, sys, bike: sys.bike, rider: sys.rider, rig: new CameraRig(cam, track), world: w.root, sun: w.sun, clearView: w.clearView, cps, cp: 0, section: 0, hist: [], visLean: 0, runT: 0, started: false, done: false, si: 0, extreme, rec: [], recT: 0, best: null };
    const names = track.sections.slice(0, 9);
    $('sections').innerHTML = names.map((s) => `<li>${s.name}</li>`).join('');
    $('helpTitle').textContent = `${b} · ${(track.total / 1000).toFixed(2)} km`;
    $('trackname').textContent = `${extreme ? 'EXTREME ' : ''}${b.toUpperCase()} · ${(track.total / 1000).toFixed(2)} km · seed ${track.seed}`;
    window.__dbg = { snd, renderer, scene, cam, bike: sys.bike, sys, track, get L() { return L; } };
    restartRun(); show('hud'); mode = 'ride'; $('genBtn').disabled = false;
    const ld = $('loading'); ld.hidden = false; ld.classList.add('out'); setTimeout(() => { ld.hidden = true; ld.classList.remove('out'); }, 450);   // fade into the ride
  }, 220);   // let the generation screen animate in before the heavy work
}
function spawn(i) { const s = L.track.sections[i].s; L.section = i; L.sys.reset(Math.max(4, s - (i ? 10 : 0)), i ? 7 : 0); L.rig.pos = null; L.hist.length = 0; L.si = 0; }
function restartRun() { spawn(0); L.cp = 0; L.runT = 0; L.started = false; L.done = false; L.rec = []; L.recT = 0; toast(''); }
function toCheckpoint() { if (!L.cp) return restartRun(); L.sys.reset(L.cps[L.cp - 1] - 2, 3); L.rig.pos = null; L.si = 0; L.done = false; toast(`CHECKPOINT ${L.cp}`); }
let toastT = 0; function toast(t) { $('toast').textContent = t; $('toast').hidden = !t; toastT = 1.6; }
input.on('KeyR', () => L && toCheckpoint());
input.on('Delete', () => L && restartRun()); input.on('Backspace', () => L && restartRun());
input.on('KeyT', () => L && restartRun());
input.on('KeyC', () => L && L.rig.next());
input.on('KeyP', () => { if (mode === 'ride') setPause(!paused); });

// distance along the trail (windowed search around the last known sample)
function trailS() {
  const { S, X, Z } = L.track.centerline, b = L.bike; let best = 1e18, bi = L.si;
  for (let i = Math.max(0, L.si - 400); i < Math.min(S.length, L.si + 400); i += 2) { const d = (X[i] - b.p.x) ** 2 + (Z[i] - b.p.z) ** 2; if (d < best) { best = d; bi = i; } }
  if (best > 400) for (let i = 0; i < S.length; i += 8) { const d = (X[i] - b.p.x) ** 2 + (Z[i] - b.p.z) ** 2; if (d < best) { best = d; bi = i; } }
  L.si = bi; return S[bi];
}

const gc = $('graph'), gx = gc.getContext('2d');
function drawGraph() {
  const w = gc.width, h = gc.height; gx.clearRect(0, 0, w, h);
  gx.strokeStyle = 'rgba(255,255,255,0.12)'; gx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) { gx.beginPath(); gx.moveTo(0, h * f); gx.lineTo(w, h * f); gx.stroke(); }
  const line = (k, c) => { gx.strokeStyle = c; gx.lineWidth = 2; gx.beginPath(); L.hist.forEach((p, i) => { const x = i / 300 * w, y = h - p[k] * h; i ? gx.lineTo(x, y) : gx.moveTo(x, y); }); gx.stroke(); };
  line(0, '#e3b448'); line(1, '#e8661c');
}

let acc = 0, last = performance.now(), simBudget = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (L && mode === 'ride') {
    const { sys, bike, rider, track } = L;
    if (!paused) {
      acc += dt; let n = 0; const t0 = performance.now();
      while (acc >= DT && n < 60) { sys.step(DT, input.k); acc -= DT; n++; }
      if (n >= 60) acc = 0;
      simBudget = simBudget * 0.95 + (performance.now() - t0) * 0.05;
      L.hist.push([bike.sF / G.FORK.travel, bike.rearTravel / 0.18]); if (L.hist.length > 300) L.hist.shift();
      // run timer: starts when you get going, stops at the finish gate
      const s = trailS();
      if (!L.started && s > 8 && bike.speed > 0.5) L.started = true;
      if (L.cp < 5 && s > L.cps[L.cp] && bike.mounted) { L.cp++; toast(`CHECKPOINT ${L.cp} / 5`); }
      if (bike.cleanLand && bike.cleanLand !== L.lastClean) { L.lastClean = bike.cleanLand; toast('CLEAN LANDING · SPEED BOOST'); }
      if (toastT > 0 && (toastT -= dt) <= 0) $('toast').hidden = true;
      if (L.started && !L.done && !bike.crashed) L.runT += dt;
      if (!L.done && s > track.total - 8 && bike.mounted) { L.done = true; const prev = L.best, pb = !prev || L.runT < prev.t; if (pb) L.best = { t: L.runT, rec: L.rec };
        $('finishTime').textContent = fmt(L.runT); $('finishInfo').textContent = (prev ? (pb ? `NEW BEST −${(prev.t - L.runT).toFixed(2)}s · ` : `+${(L.runT - prev.t).toFixed(2)}s vs best ${fmt(prev.t)} · `) : '') + `${L.extreme ? 'extreme ' : ''}${track.biome} · ${(track.total / 1000).toFixed(2)} km`; mode = 'finished'; $('finish').hidden = false; }
      $('clock').textContent = fmt(L.runT); $('prog').style.width = `${clamp(s / track.total * 100, 0, 100).toFixed(1)}%`;
    }
    $('speed').textContent = `${(Math.max(0, bike.speed) * 3.6).toFixed(0)} km/h`;
    if (showTele) { hud(); drawGraph(); }
  }
  if (L && mode === 'replay') { replayFrame(dt); renderer.render(scene, cam); }
  else if (L) {
    const { bike, rider, track, sys } = L;
    // bike + rider drawn leaning relative to the riding surface on banked turns
    L.visLean += ((bike.mounted && !bike.crashed ? clamp(bike.visBank || 0, -0.6, 0.6) : 0) - L.visLean) * Math.min(1, dt * 3);
    // pedalling sway: the bike rocks a few degrees under each pedal stroke (opposite the hips). Visual only, so it
    // never steers; only when pedalling in a straight line (fades out as soon as a turn or lean is asked for)
    const ip = bike.inp, straight = bike.mounted && !bike.crashed && bike.cF && bike.cR ? clamp(1 - Math.abs(ip.steer) / 0.15, 0, 1) * clamp(1 - Math.abs(ip.lean) / 0.15, 0, 1) * clamp(1 - Math.abs(bike.lean || 0) / 0.08, 0, 1) : 0;
    L.pedS = (L.pedS || 0) + ((ip.thr > 0.05 ? Math.min(1, ip.thr) * straight : 0) - (L.pedS || 0)) * Math.min(1, dt * 4);
    const rock = -0.06 * L.pedS * Math.sin(bike.crank || 0);
    let view = bike;
    if (Math.abs(L.visLean + rock) > 1e-3) {
      const f = bike.q.rot(new V(1, 0, 0)), fh = new V(f.x, 0, f.z).norm(), rq = Q.axis(fh, L.visLean + rock), gp = new V(bike.p.x, track.h(bike.p.x, bike.p.z), bike.p.z);
      view = Object.create(bike); view.q = rq.mul(bike.q); view.p = gp.add(rq.rot(bike.p.sub(gp)));
    }
    const bx = sys.body(dt, view);
    model.update(view); riderModel.update({ x: bx }, view);
    dust.update(paused ? 0 : dt, mode === "ride" && !paused ? bike : null, track.h, cam);
    while (L.started && !L.done && mode === 'ride' && L.rec.length <= L.runT * 30) {
      L.rec.push({ p: view.p, q: view.q, th: bike.th, sF: bike.sF, steer: bike.steer, wheelAngF: bike.wheelAngF, wheelAngR: bike.wheelAngR, crank: bike.crank, cassette: bike.cassette, chainPos: bike.chainPos, gear: bike.gear, x: bx.map(v => new V(v.x, v.y, v.z)), air: bike.air > 0.15 && bike.mounted, v: bike.v }); }
    const gr = L.best && mode === 'ride' && L.started ? L.best.rec : null; showGhost(!!gr && L.runT * 30 < gr.length - 1);
    if (gr && ghost.bike.root.visible) { const g = poseAt(gr, L.runT); ghost.bike.update(g.f); ghost.rider.update({ x: g.x }, g.f); }
    let camT = bike; if (!bike.mounted) { camT = Object.create(bike); camT.p = rider.com; camT.v = rider.v[0].mul(0); }
    L.rig.update(dt, camT); L.clearView(cam);
    L.sun.position.set(bike.p.x + 30, bike.p.y + 60, bike.p.z + 20); L.sun.target.position.set(bike.p.x, bike.p.y, bike.p.z);
    renderer.render(scene, cam);
  }
  snd.update(L, mode, paused);
  requestAnimationFrame(frame);
}
// ---- cinematic replay: interpolated snapshots, rotating camera shots, slow-mo in the air
const R = { t: 0, shot: -1, shotT: 0, anchor: null, pos: null, look: null };
const SHOTS = ['TRACKSIDE', 'LOW CHASE', 'SIDE TRACK', 'DRONE'];
function startReplay() { if (!L || L.rec.length < 10) return; mode = 'replay'; R.t = 0; R.shot = -1; R.shotT = 0; R.pos = null; $('finish').hidden = true; $('hud').hidden = true; $('replayBar').hidden = false; document.body.classList.add('cinema'); }
function endReplay() { mode = 'finished'; $('replayBar').hidden = true; document.body.classList.remove('cinema'); $('hud').hidden = false; $('finish').hidden = false; }
const lv = (a, b, u) => a.add(b.sub(a).mul(u));
const lq = (a, b, u) => { const d = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z, sg = d < 0 ? -1 : 1, q = new Q(a.w + (sg * b.w - a.w) * u, a.x + (sg * b.x - a.x) * u, a.y + (sg * b.y - a.y) * u, a.z + (sg * b.z - a.z) * u), l = Math.hypot(q.w, q.x, q.y, q.z); return new Q(q.w / l, q.x / l, q.y / l, q.z / l); };
function poseAt(rec, t) {
  const n = rec.length, i0 = clamp(Math.floor(t * 30), 0, n - 2), u = clamp(t * 30 - i0, 0, 1), a = rec[i0], b = rec[i0 + 1];
  const f = Object.create(L.bike); for (const k of ['th', 'sF', 'steer', 'wheelAngF', 'wheelAngR', 'crank', 'cassette', 'chainPos']) f[k] = a[k] + (b[k] - a[k]) * u;
  f.gear = a.gear; f.p = lv(a.p, b.p, u); f.q = lq(a.q, b.q, u);
  return { f, a, b, u, i0, x: a.x.map((p, k) => lv(p, b.x[k], u)) };
}
function replayFrame(dt) { showGhost(false);
  const rec = L.rec, tr = L.track, n = rec.length, P = poseAt(rec, R.t), { f, a, b, u, i0 } = P;
  R.t += dt * (a.air ? 0.35 : 1); if (R.t * 30 >= n - 1) { R.t = 0; R.shot = -1; }
  model.update(f); riderModel.update({ x: P.x }, f);
  snd.rf = { i: a, crank: typeof f.crank === 'number' ? f.crank : a.crank, dt: dt * (a.air ? 0.35 : 1) };
  const vel = lv(a.v, b.v, u), fh = new V(vel.x, 0, vel.z).len() > 0.5 ? new V(vel.x, 0, vel.z).norm() : new V(1, 0, 0), rt = new V(-fh.z, 0, fh.x);
  if ((R.shotT -= dt) <= 0 || R.shot < 0) { R.shot = (R.shot + 1 + Math.floor(Math.random() * 3)) % 4; R.shotT = 3.5; R.pos = null;
    const ahead = rec[Math.min(n - 1, i0 + 75)].p, sd = Math.random() < 0.5 ? -1 : 1; R.anchor = ahead.add(rt.mul(sd * (4 + Math.random() * 3)));
    $('replayShot').textContent = SHOTS[R.shot]; }
  let want, look = f.p.add(new V(0, 0.9, 0));
  if (R.shot === 0) want = R.anchor.add(new V(0, 1.2, 0));
  else if (R.shot === 1) want = f.p.sub(fh.mul(3.2)).add(new V(0, 0.55, 0));
  else if (R.shot === 2) want = f.p.add(rt.mul(5.5)).add(fh.mul(1)).add(new V(0, 1.2, 0));
  else { want = f.p.sub(fh.mul(7)).add(new V(0, 7.5, 0)); look = f.p.add(fh.mul(4)); }
  want.y = Math.max(want.y, tr.h(want.x, want.z) + 0.4);
  R.pos = R.pos && R.shot !== 0 ? lv(R.pos, want, Math.min(1, dt * 6)) : want; R.look = R.look && R.pos !== want ? lv(R.look, look, Math.min(1, dt * 8)) : look;
  cam.position.set(R.pos.x, R.pos.y, R.pos.z); cam.lookAt(R.look.x, R.look.y, R.look.z); L.clearView(cam);
  L.sun.position.set(f.p.x + 30, f.p.y + 60, f.p.z + 20); L.sun.target.position.set(f.p.x, f.p.y, f.p.z);
}
const CAUSE = { head: 'head hit the ground', torso: 'body hit the ground', 'upside down': 'bike tipped over' };
function hud() {
  const { bike, sys } = L, f = bike.sF, xs = bike.shockStroke, rt = bike.rearTravel, c = bike.cF || bike.cR;
  const bar = (v) => `<span class="bar"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></span>`;
  $('stats').innerHTML = `
    <div class="big">${(Math.max(0, bike.speed) * 3.6).toFixed(0)}<small> km/h</small></div>
    <div class="row"><span>Fork</span>${bar(f / G.FORK.travel)}<b>${(f * 1000).toFixed(0)} / 180 mm</b></div>
    <div class="row"><span>Rear wheel</span>${bar(rt / 0.18)}<b>${(rt * 1000).toFixed(0)} / 180 mm</b></div>
    <div class="row"><span>Shock shaft</span>${bar(xs / G.SHOCK.stroke)}<b>${(xs * 1000).toFixed(1)} / 63.5 mm</b></div>
    <div class="row"><span>Lean</span><b>${((bike.lean + L.visLean) * 57.3).toFixed(0)}°</b><span>Steer</span><b>${(bike.steer * 57.3).toFixed(0)}°</b></div>
    <div class="row"><span>Gear</span><b>${G.RING_T}×${G.COGS[bike.gear]}</b><span>Surface</span><b>${c ? c.surf.name : 'Airborne'}</b></div>
    <div class="flags">${bike.air > 0.08 ? `<em>AIR ${bike.air.toFixed(2)} s</em>` : ''}${bike.bottomF > 0 ? '<em class="w">FORK BOTTOM-OUT</em>' : ''}${bike.bottomR > 0 ? '<em class="w">SHOCK BOTTOM-OUT</em>' : ''}${bike.rim > 0 ? '<em class="w">RIM STRIKE</em>' : ''}${bike.crashed ? `<em class="c">CRASHED (${CAUSE[bike.crashCause] || bike.crashCause}) · R = checkpoint</em>` : ''}${bike.mounted && sys.pose.s.stand < 0.5 ? '<em>SEATED</em>' : ''}${paused ? '<em>PAUSED</em>' : ''}</div>
    <div class="cam">Camera: ${CAM_MODES[L.rig.mode]} <kbd>C</kbd> · physics ${simBudget.toFixed(1)} ms/frame</div>`;
}
show('mainMenu');
requestAnimationFrame(frame);
