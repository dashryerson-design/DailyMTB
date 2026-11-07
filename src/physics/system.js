// Rider + bike. While mounted the bike is the only physics object (it carries the rider's mass as one
// torso point); the rider's body is procedural animation. Only after a crash does the rider become a
// ragdoll, started from the animated pose and moving with the bike.
import { Bike } from './bike.js';
import { Rider } from './rider.js';
import { RiderPose } from '../game/riderPose.js';
export class RideSystem {
  constructor(track) { this.track = track; this.bike = new Bike(track); this.rider = new Rider(); this.pose = new RiderPose(); this.reset(0, 0); }
  get mounted() { return this.bike.mounted; }
  get crashed() { return this.bike.crashed; }
  reset(s, v) { this.bike.reset(s, v); this.rider.crashed = false; this.pose.reset(); this.pose.update(this.bike, 0); }
  step(dt, keys) {
    const b = this.bike;
    if (b.mounted) {
      b.step(dt, keys, []);
      if (b.crashed) {                                   // thrown off: hand the body over to the ragdoll
        const p = this.pose.update(b, 0), v = p.x.map(() => b.vr);   // the body carries on with the torso's momentum, not the frame's spin
        this.rider.fromPose(p.x, v); b.mounted = false;
      }
    } else {
      this.rider.step(dt, b, {}, this.track);
      b.step(dt, {}, []);
    }
  }
  // joint positions for drawing
  body(dt) { return this.bike.mounted ? this.pose.update(this.bike, dt).x : this.rider.x; }
}
