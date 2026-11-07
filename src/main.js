import { buildTrack } from './terrain/track.js';
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

function start() {
  const track = buildTrack(7), sys = new RideSystem(track), bike = sys.bike, rider = sys.rider;
  const renderer = new T.WebGLRenderer({ antialias: true, canvas: $('view') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(62, 1, 0.05, 600);
  scene.environment = envMap(renderer);
  const { sun } = buildWorld(scene, track), model = new BikeModel(scene), riderModel = new RiderModel(scene), rig = new CameraRig(cam, track), input = new Input();
  const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();

  const sections = track.sections;
  let section = 0, paused = false;
  const spawn = (i) => { section = i; const s = sections[i].s; sys.reset(Math.max(2, s - (i ? 10 : 0)), i ? 7 : 0); rig.pos = null; hist.length = 0; };
  input.on('KeyR', () => spawn(section));
  input.on('KeyC', () => { rig.next(); });
  input.on('KeyP', () => { paused = !paused; });
  input.handlers.digit = (n) => { if (n <= sections.length) spawn(n - 1); };
  $('sections').innerHTML = sections.map((s, i) => `<li><kbd>${i + 1}</kbd> ${s.name}</li>`).join('');

  // telemetry history for the suspension graph
  const hist = [], gc = $('graph'), gx = gc.getContext('2d');
  function drawGraph() {
    const w = gc.width, h = gc.height; gx.clearRect(0, 0, w, h);
    gx.strokeStyle = 'rgba(255,255,255,0.12)'; gx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { gx.beginPath(); gx.moveTo(0, h * f); gx.lineTo(w, h * f); gx.stroke(); }
    const line = (k, c) => { gx.strokeStyle = c; gx.lineWidth = 2; gx.beginPath(); hist.forEach((p, i) => { const x = i / 300 * w, y = h - p[k] * h; i ? gx.lineTo(x, y) : gx.moveTo(x, y); }); gx.stroke(); };
    line(0, '#e3b448'); line(1, '#e8661c');
  }

  let acc = 0, last = performance.now(), simBudget = 0, visLean = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused) {
      acc += dt; let n = 0; const t0 = performance.now();
      while (acc >= DT && n < 60) { sys.step(DT, input.k); acc -= DT; n++; }
      if (n >= 60) acc = 0;
      simBudget = simBudget * 0.95 + (performance.now() - t0) * 0.05;
      hist.push([bike.sF / G.FORK.travel, bike.rearTravel / 0.18]); if (hist.length > 300) hist.shift();
    }
    // draw the bike + rider leaning relative to the riding surface: on a banked turn the bank is added on
    // top of the lean (rolled about the tyre contact line, so the wheels stay on the berm)
    visLean += ((bike.mounted && !bike.crashed ? clamp(bike.visBank || 0, -0.6, 0.6) : 0) - visLean) * Math.min(1, dt * 3);
    let view = bike;
    if (Math.abs(visLean) > 1e-3) {
      const f = bike.q.rot(new V(1, 0, 0)), fh = new V(f.x, 0, f.z).norm(), rq = Q.axis(fh, visLean);
      const gp = new V(bike.p.x, track.h(bike.p.x, bike.p.z), bike.p.z);
      view = Object.create(bike); view.q = rq.mul(bike.q); view.p = gp.add(rq.rot(bike.p.sub(gp)));
    }
    model.update(view); riderModel.update({ x: sys.body(dt, view) }, view);
    // after a crash the camera follows the rider's body, not the bike
    let camT = bike;
    if (!bike.mounted) { camT = Object.create(bike); camT.p = rider.com; camT.v = rider.v[0].mul(0); }
    rig.update(dt, camT);
    sun.position.set(bike.p.x + 30, bike.p.y + 60, bike.p.z + 20); sun.target.position.set(bike.p.x, bike.p.y, bike.p.z);
    renderer.render(scene, cam);
    hud(); drawGraph();
    requestAnimationFrame(frame);
  }
  function hud() {
    const f = bike.sF, xs = bike.shockStroke, rt = bike.rearTravel, c = bike.cF || bike.cR;
    const bar = (v) => `<span class="bar"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></span>`;
    $('stats').innerHTML = `
      <div class="big">${(Math.max(0, bike.speed) * 3.6).toFixed(0)}<small> km/h</small></div>
      <div class="row"><span>Fork</span>${bar(f / G.FORK.travel)}<b>${(f * 1000).toFixed(0)} / 180 mm</b></div>
      <div class="row"><span>Rear wheel</span>${bar(rt / 0.18)}<b>${(rt * 1000).toFixed(0)} / 180 mm</b></div>
      <div class="row"><span>Shock shaft</span>${bar(xs / G.SHOCK.stroke)}<b>${(xs * 1000).toFixed(1)} / 63.5 mm</b></div>
      <div class="row"><span>Lean</span><b>${((bike.lean + visLean) * 57.3).toFixed(0)}°</b><span>Steer</span><b>${(bike.steer * 57.3).toFixed(0)}°</b></div>
      <div class="row"><span>Gear</span><b>${G.RING_T}×${G.COGS[bike.gear]}</b><span>Surface</span><b>${c ? c.surf.name : 'Airborne'}</b></div>
      <div class="flags">${bike.air > 0.08 ? `<em>AIR ${bike.air.toFixed(2)} s</em>` : ''}${bike.bottomF > 0 ? '<em class="w">FORK BOTTOM-OUT</em>' : ''}${bike.bottomR > 0 ? '<em class="w">SHOCK BOTTOM-OUT</em>' : ''}${bike.rim > 0 ? '<em class="w">RIM STRIKE</em>' : ''}${bike.crashed ? '<em class="c">CRASHED · press R</em>' : ''}${bike.mounted && sys.pose.s.stand < 0.5 ? '<em>SEATED</em>' : ''}${paused ? '<em>PAUSED</em>' : ''}</div>
      <div class="cam">Camera: ${CAM_MODES[rig.mode]} <kbd>C</kbd> · physics ${simBudget.toFixed(1)} ms/frame</div>`;
  }
  spawn(0); window.__dbg = { renderer, scene, cam, bike, sys };
  $('loading').hidden = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => setTimeout(start, 30));
