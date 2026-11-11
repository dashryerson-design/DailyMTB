// Graphics quality presets. Read live by the renderer setup and the world's LOD/culling every frame,
// so a change applies immediately (no reload). Saved per device.
const PRESETS = {
  high:   { label: 'High',   pixelRatio: 2,    shadows: true,  shadowMap: 2048, shadowDist: 1,   soft: true,  lod: 1,    grass: 1,   tree: 1,    bush: 1 },
  medium: { label: 'Medium', pixelRatio: 1.25, shadows: true,  shadowMap: 1024, shadowDist: 0.5, soft: false, lod: 0.75, grass: 0.6, tree: 0.5,  bush: 0.5 },
  low:    { label: 'Low',    pixelRatio: 1,    shadows: false, shadowMap: 512,  shadowDist: 0,   soft: false, lod: 0.55, grass: 0.35, tree: 0.35, bush: 0.35 },
};
const KEY = 'dailymtb.quality';
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;   // tablets/phones start on Medium
let level = 'high';
try { level = localStorage.getItem(KEY) || (touch ? 'medium' : 'high'); } catch { level = touch ? 'medium' : 'high'; }
if (!PRESETS[level]) level = 'high';
export const Q = { ...PRESETS[level], level };
export const LEVELS = Object.keys(PRESETS);
export function setQuality(l) { if (!PRESETS[l]) return; Object.assign(Q, PRESETS[l], { level: l }); try { localStorage.setItem(KEY, l); } catch {} }
// apply renderer-side settings (pixel ratio, shadow filtering); the sun's map size is applied by applySun
export function applyRenderer(r) {
  r.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  r.shadowMap.type = Q.soft ? window.THREE.PCFSoftShadowMap : window.THREE.PCFShadowMap; r.shadowMap.needsUpdate = true;
}
export function applySun(sun) {
  if (!sun) return; sun.castShadow = Q.shadows;
  if (sun.shadow.mapSize.x !== Q.shadowMap) { sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
}
