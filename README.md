# Rocket Gauntlet

Browser-based, Rocket League-style arcade football, built around a gauntlet run:
a sequence of escalating rounds you have to clear back to back.

TypeScript + Vite + Three.js, physics by Rapier.

## Run it

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Throttle / reverse-brake. In the air: pitch down / up |
| `A` / `D` | Steer. In the air: yaw |
| `Space` | Jump. Hold for height; tap again in the air to flip or double jump |
| `Shift` | Boost |
| `Q` / `E` | Air roll left / right |
| `C` | Powerslide |
| `T` | Ball cam |
| `R` | Reset car and ball |
| `B` | Reset ball only |
| `P` | Tuning panel |

## Tuning

Every constant that affects feel lives in [`src/config.ts`](src/config.ts).

Two ways to change it, both live and interchangeable:

- Press `P` for the in-game panel. Sliders write straight into the live config.
  `Copy values` puts the current numbers on your clipboard in `config.ts` shape.
- Edit `src/config.ts` and save. Vite patches the values in place; no reload, and
  the car keeps its position and momentum.

## Layout

```
src/
  config.ts            all tuning constants, live-reloadable
  game.ts              wires the systems together
  core/      loop, interpolation, arena geometry, math helpers
  physics/   rapier world, arena colliders, car, ball, boost pads
  input/     CarInput contract, keyboard source
  render/    three scene, meshes, chase camera
  ui/        HUD, tuning panel
tests/       headless physics checks (vitest)
```

The arena's colliders and its meshes are both generated from
`core/arenaLayout.ts`, so they cannot drift apart.

## Tests

```bash
npm test
```

38 tests, no browser needed:

- **Car physics** — ride height and chassis clearance, acceleration, both speed
  caps, steering, braking, jump height, hold-for-more-height, double jump, flips,
  boost drain and pad pickup, self-righting from roof/side/tumble, wall climbing.
- **Keyboard** — key mapping, opposing keys cancelling, and the jump latch.
- **Loop** — that the simulated time per second of wall clock is the same at
  30fps and 144fps, and that a long stall cannot spiral.
- **Arena layout** — no solid panel strays into the playing area.

## Debugging

`window.game` is exposed in the console.

- `game.advance(seconds, input?)` steps the simulation a fixed amount and draws
  one frame, without waiting on the render loop. Useful for stepping through a
  specific situation. `input` takes any subset of `CarInput`, e.g.
  `game.advance(1, { throttle: 1, boost: true })`.
- `game.debug` exposes `car`, `ball`, `arena`, `pads` and `phys`.
