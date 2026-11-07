# DailyMTB

A hyper-realistic mountain biking game that runs in the browser, with a new procedurally generated trail every day.

## Vision
- **Physics-first realism**: a rigid-body bike with front and rear suspension, a tire grip model that depends on surface, a rider whose weight shifts (pumping, preloading, leaning into berms), and independent front and rear brakes.
- **Real dirt**: hardpack, loam, loose gravel, roots, wet rock and mud, each with its own grip and sound.
- **Daily trail**: a date-based seed generates the same mountain for every player that day, with a daily leaderboard and ghost replays.
- **Trail-builder generation**: trails follow the fall line, features are placed so they flow, and every line is rideable.

## Planned stack
- Rendering: Three.js (WebGL/WebGPU)
- Physics: Rapier (WASM) with a custom tire and suspension model
- Build: Vite + TypeScript

## Layout
- `src/physics`: bike, rider and tire/suspension simulation
- `src/trailgen`: seeded daily trail and terrain generation
- `src/render`: scene, materials, cameras, effects
- `src/game`: timing, input, replays, leaderboard client

## Roadmap
1. **Feel prototype**: grey hillside, one bike, physics tuned until it feels great
2. **Trail generator v1**: daily seed, spline trail, carved terrain, basic features
3. **Looks and sound**: forest, materials, lighting, audio
4. **Game layer**: timing, ghosts, daily leaderboard backend
5. **Depth**: bike setup tuning, weather, more features, gamepad/mobile

## Open design decisions
- Controls: keyboard, gamepad, or both
- Sim vs. forgiving realism
- Downhill only, or enduro/climbing too
