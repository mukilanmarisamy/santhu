# Santhu — Deepavali Simulator

A Vite + Three.js project migrated from the supplied single-file prototype. The existing environment, nine cracker types, audio, particle system, player movement, day/night mode and hospital/home respawn flow are retained as the baseline.

## Run locally

1. Install Node.js (LTS).
2. In this folder run `npm install`.
3. Run `npm run dev`.
4. Open the local URL printed by Vite.

## Build for free static hosting

Run `npm run build`. Upload the generated `dist/` folder to Cloudflare Pages, Netlify or GitHub Pages. No backend is required for the current single-player game.

## Controls

- WASD: move
- Mouse: look
- E: stairs / rooftop access
- 1–9: select firework
- Left mouse: existing place/use behaviour
- Right mouse tap: throw the selected Paper / Lakshmi or Hydro bomb at default power (unlit; fuse begins on landing)
- Right mouse hold: after 190 ms the selected bomb ignites in the hand; the power meter rises while held; release to throw. The fuse continues counting during flight and is never reset on landing.

## Veranda chase mechanic

Each house now has a raised front thinnai/veranda. A thrown bomb landing on one triggers that specific house's neighbour. The neighbour exits the veranda and chases the player for up to 18 seconds. The player escapes if the timer expires; being caught retains the existing caught/home-respawn behaviour.

## Notes

The game is a fictional, non-operational simulation. Firework effects are visual/audio game effects only. The current world layout is a first procedural pass; exact dimensions and house/vegetation distributions remain tunable.
