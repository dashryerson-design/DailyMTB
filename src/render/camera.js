// Cameras: smoothed chase cam, plus side and close-up views for inspecting suspension.
const T = window.THREE;
export const CAM_MODES = ['Chase', 'Side', 'Fork close-up', 'Shock close-up'];

export class CameraRig {
  constructor(cam, track) { this.cam = cam; this.track = track; this.mode = 0; this.pos = null; this.look = null; this.head = null; }
  next() { this.mode = (this.mode + 1) % CAM_MODES.length; this.pos = null; }
  update(dt, b) {
    const bp = new T.Vector3(b.p.x, b.p.y, b.p.z), q = new T.Quaternion(b.q.x, b.q.y, b.q.z, b.q.w);
    const fwd = new T.Vector3(1, 0, 0).applyQuaternion(q), right = new T.Vector3(0, 0, 1).applyQuaternion(q);
    const hf = new T.Vector3(fwd.x, 0, fwd.z).normalize(), vel = new T.Vector3(b.v.x, 0, b.v.z);
    if (vel.length() > 2) hf.lerp(vel.normalize(), 0.5).normalize();
    if (!this.head) this.head = hf.clone();
    this.head.lerp(hf, 1 - Math.exp(-dt * 3)).normalize();
    let tgt, look, k = 6;
    if (this.mode === 0) {
      tgt = bp.clone().addScaledVector(this.head, -4.4).add(new T.Vector3(0, 1.7, 0));
      look = bp.clone().addScaledVector(this.head, 3).add(new T.Vector3(0, 0.3, 0)); k = 5;
    } else {
      const rh = new T.Vector3(-this.head.z, 0, this.head.x);
      const cfg = [null, [2.6, 0.2, 0.2, 0], [1.0, 0.25, 0.55, 0.15], [0.9, 0.0, -0.05, 0.05]][this.mode];
      const focus = bp.clone().addScaledVector(fwd, cfg[1]).add(new T.Vector3(0, cfg[3], 0));
      tgt = focus.clone().addScaledVector(rh, cfg[0]).addScaledVector(this.head, cfg[2]).add(new T.Vector3(0, 0.15, 0));
      look = focus; k = 12;
    }
    const gh = this.track.h(tgt.x, tgt.z) + 0.6; if (tgt.y < gh) tgt.y = gh;
    if (!this.pos) { this.pos = tgt.clone(); this.look = look.clone(); }
    const a = 1 - Math.exp(-dt * k);
    this.pos.x += (tgt.x - this.pos.x) * a; this.pos.z += (tgt.z - this.pos.z) * a;
    this.pos.y += (tgt.y - this.pos.y) * (1 - Math.exp(-dt * k * 1.6));
    this.look.lerp(look, 1 - Math.exp(-dt * 10));
    const gh2 = this.track.h(this.pos.x, this.pos.z) + 0.5; if (this.pos.y < gh2) this.pos.y = gh2;
    this.cam.position.copy(this.pos); this.cam.lookAt(this.look);
  }
}
