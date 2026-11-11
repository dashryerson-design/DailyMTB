<div align="center">

# DailyMTB

**Downhill mountain biking in your browser.** A brand-new trail is generated every ride: massive jumps, big drops, steep chutes and berms, across Snow, Desert and Forest.

<br>

<a href="https://dashryerson-design.github.io/DailyMTB/"><img src="https://img.shields.io/badge/%E2%96%B6%20%20PLAY%20NOW-2ea8ff?style=for-the-badge&labelColor=0b6fd1" alt="Play now" height="64"></a>

<sub>Runs in any modern browser — desktop, tablet or phone. No install.</sub>

</div>

---

## Controls

| Key | Action |
|---|---|
| <kbd>W</kbd> | Pedal |
| <kbd>S</kbd> | Rear brake |
| <kbd>Space</kbd> | Front brake |
| <kbd>A</kbd> / <kbd>D</kbd> | Steer (the bike leans into the turn) |
| <kbd>←</kbd> / <kbd>→</kbd> | Extra lean · whip the bike in the air |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Shift weight forward / back · pitch in the air |
| <kbd>↓</kbd> before a lip | Pop off the jump for more height |
| <kbd>R</kbd> | Back to last checkpoint |
| <kbd>Del</kbd> | Restart run |
| <kbd>C</kbd> | Change camera |
| <kbd>P</kbd> / <kbd>Esc</kbd> | Pause · settings |

**Tips:** steer and lean the same way to carve berms · land on both wheels with the bike square to the slope for a speed boost · press **Help** on the main menu for how every force in the game works.

## Features

- **Real bike physics** — 1 kHz simulation of the frame, fork and linkage rear suspension, tyre grip per surface, braking, lean-to-turn balance and aerodynamic drag.
- **Extreme track generator** — every track is new: designed tabletops and step-downs, drops, chutes, berms, rock gardens, checkpoints.
- **Three biomes** — Snow, Desert, Forest.
- **Two visual styles** — *Real* or a cel-shaded *Low poly* cartoon look, each with Low / Medium / High graphics.
- **Race your ghost**, watch a **cinematic replay**, full sound.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. No build step.

## Development

- `src/physics` — bike, suspension, rider ragdoll, assists
- `src/terrain` — Extreme track generator and terrain
- `src/render` — world, flora, bike/rider models, quality presets
- `src/game` — input, procedural rider pose, sound
- Tests: `node tests/ride.mjs [seed]` (scripted rider on generated tracks), `node tests/sim.mjs` (physics test track)
