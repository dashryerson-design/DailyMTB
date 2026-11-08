# Rules (from Lord Dash)
1. Use as few tokens as possible. Keep change summaries minimal.
2. Start every response with "Okay Lord Dash…"
3. End every response with the direct link to the test Artifact.
   - Test build: index.html + src/**/*.js (republish to https://claude.ai/artifact/UcdcJeHBX43WvoHYQLbUTh)
4. Validation: `node tests/ride.mjs [seed]` (scripted rider on generated tracks), `node tests/sim.mjs` (test track). Bike physics = src/physics/bike.js (arcadeBike.js is an unused simplified experiment).
