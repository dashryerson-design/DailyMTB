// Rider + bike, stepped together at a fixed 1 kHz. The rider produces contact forces on the bike,
// the bike integrates them; both see each other's state from the start of the step.
import { Bike } from './bike.js';
import { Rider } from './rider.js';
export class RideSystem {
  constructor(track) { this.track = track; this.bike = new Bike(track); this.rider = new Rider(); this.reset(0, 0); }
  reset(s, v) { this.bike.reset(s, v); this.rider.reset(this.bike); }
  step(dt, keys) {
    const b = this.bike, r = this.rider;
    b.crashed = r.crashed;
    if (!r.crashed && b.assistT) r.applyTorque(b.assistT.mul(0.85));
    const ext = r.step(dt, b, b.crashed ? {} : keys, this.track);
    b.step(dt, keys, ext);
  }
}
