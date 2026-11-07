import { generateTrack } from './terrain/track.js';
import { RideSystem } from './physics/system.js';
import { V, Q, clamp } from './core/math.js';
import * as G from './physics/geometry.js';
import { BikeModel } from './render/bikeModel.js';
import { RiderModel } from './render/riderModel.js';
import { buildWorld, envMap } from './render/world.js';
import { CameraRig, CAM_MODES } from './render/camera.js';
import { Input } from './game/input.js';
const T = window.THREE;

const $ = (id) => document.getElementById(id);
const DT = 1 / 1000;
const show = (id) => ['mainMenu', 'biomeMenu', 'finish', 'loading', 'hud'].forEach(k => $(k).hidden = k !== id && !(id === 'finish' && k === 'hud'));
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ---- renderer + persistent scene objects
const renderer = new T.WebGLRenderer({ antialias: true, canvas: $('view') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
const scene = new T.Scene(), cam = new T.PerspectiveCamera(62, 1, 0.05, 700);
scene.environment = envMap(renderer);
const model = new BikeModel(scene), riderModel = new RiderModel(scene), input = new Input();
const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

let L = null;            // the loaded level: { track, sys, bike, rider, rig, world, sun, ... }
let paused = false, biome = null, mode = 'menu';

// ---- menus
$('playBtn').onclick = () => show('biomeMenu');
$('backBtn').onclick = () => show('mainMenu');
document.querySelectorAll('.card').forEach(c => c.onclick = () => {
  document.querySelectorAll('.card').forEach(o => o.classList.toggle('sel', o === c));
  biome = c.dataset.biome; $('genBtn').disabled = false;
});
$('genBtn').onclick = () => load(biome);
$('newBtn').onclick = () => load(L.track.biome);
$('againBtn').onclick = () => { show('hud'); restartRun(); };
$('menuBtn2').onclick = $('menuBtn').onclick = () => toMenu();
addEventListener('keydown', (e) => { if (e.code === 'Escape' && mode === 'ride') toMenu(); });
function toMenu() { mode = 'menu'; show('biomeMenu'); }

function disposeTree(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) [].concat(n.material).forEach(m => m.dispose()); }); o.parent && o.parent.remove(o); }

// start / finish gates
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

function load(b) {
  show('loading'); $('loadText').textContent = `GENERATING ${b.toUpperCase()} TRAIL…`; mode = 'loading';
  setTimeout(() => {                    // let the loading screen paint before the heavy work
    if (L) { disposeTree(L.world); }
    const track = generateTrack(b), w = buildWorld(scene, track), sys = new RideSystem(track);
    w.root.add(gate(track, 6, 'START', '#f4efe6'), gate(track, track.total - 8, 'FINISH', '#ff6a1a'));
    L = { track, sys, bike: sys.bike, rider: sys.rider, rig: new CameraRig(cam, track), world: w.root, sun: w.sun, section: 0, hist: [], visLean: 0, runT: 0, started: false, done: false, si: 0 };
    const names = track.sections.slice(0, 9);
    $('sections').innerHTML = names.map((s, i) => `<li><kbd>${i + 1}</kbd> ${s.name}</li>`).join('');
    $('helpTitle').textContent = `${b} · ${(track.total / 1000).toFixed(2)} km`;
    $('trackname').textContent = `${b.toUpperCase()} · ${(track.total / 1000).toFixed(2)} km · seed ${track.seed}`;
    window.__dbg = { renderer, scene, cam, bike: sys.bike, sys, track };
    restartRun(); show('hud'); mode = 'ride';
  }, 60);
}
function spawn(i) { const s = L.track.sections[i].s; L.section = i; L.sys.reset(Math.max(4, s - (i ? 10 : 0)), i ? 7 : 0); L.rig.pos = null; L.hist.length = 0; L.si = 0; }
function restartRun() { spawn(0); L.runT = 0; L.started = false; L.done = false; }
input.on('KeyR', () => L && spawn(L.section));
input.on('KeyT', () => L && restartRun());
input.on('KeyC', () => L && L.rig.next());
input.on('KeyP', () => { paused = !paused; });
input.handlers.digit = (n) => { if (L && n <= Math.min(9, L.track.sections.length)) { spawn(n - 1); L.started = false; } };

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
      if (L.started && !L.done && !bike.crashed) L.runT += dt;
      if (!L.done && s > track.total - 8 && bike.mounted) { L.done = true; $('finishTime').textContent = fmt(L.runT); $('finishInfo').textContent = `${track.biome} · ${(track.total / 1000).toFixed(2)} km`; mode = 'finished'; $('finish').hidden = false; }
      $('clock').textContent = fmt(L.runT); $('prog').style.width = `${clamp(s / track.total * 100, 0, 100).toFixed(1)}%`;
    }
    hud(); drawGraph();
  }
  if (L) {
    const { bike, rider, track, sys } = L;
    // bike + rider drawn leaning relative to the riding surface on banked turns
    L.visLean += ((bike.mounted && !bike.crashed ? clamp(bike.visBank || 0, -0.6, 0.6) : 0) - L.visLean) * Math.min(1, dt * 3);
    let view = bike;
    if (Math.abs(L.visLean) > 1e-3) {
      const f = bike.q.rot(new V(1, 0, 0)), fh = new V(f.x, 0, f.z).norm(), rq = Q.axis(fh, L.visLean), gp = new V(bike.p.x, track.h(bike.p.x, bike.p.z), bike.p.z);
      view = Object.create(bike); view.q = rq.mul(bike.q); view.p = gp.add(rq.rot(bike.p.sub(gp)));
    }
    model.update(view); riderModel.update({ x: sys.body(dt, view) }, view);
    let camT = bike; if (!bike.mounted) { camT = Object.create(bike); camT.p = rider.com; camT.v = rider.v[0].mul(0); }
    L.rig.update(dt, camT);
    L.sun.position.set(bike.p.x + 30, bike.p.y + 60, bike.p.z + 20); L.sun.target.position.set(bike.p.x, bike.p.y, bike.p.z);
    renderer.render(scene, cam);
  }
  requestAnimationFrame(frame);
}
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
    <div class="flags">${bike.air > 0.08 ? `<em>AIR ${bike.air.toFixed(2)} s</em>` : ''}${bike.bottomF > 0 ? '<em class="w">FORK BOTTOM-OUT</em>' : ''}${bike.bottomR > 0 ? '<em class="w">SHOCK BOTTOM-OUT</em>' : ''}${bike.rim > 0 ? '<em class="w">RIM STRIKE</em>' : ''}${bike.crashed ? '<em class="c">CRASHED · press R</em>' : ''}${bike.mounted && sys.pose.s.stand < 0.5 ? '<em>SEATED</em>' : ''}${paused ? '<em>PAUSED</em>' : ''}</div>
    <div class="cam">Camera: ${CAM_MODES[L.rig.mode]} <kbd>C</kbd> · physics ${simBudget.toFixed(1)} ms/frame</div>`;
}
show('mainMenu');
requestAnimationFrame(frame);
