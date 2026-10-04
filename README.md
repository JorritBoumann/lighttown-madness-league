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

## Where this is up to

Build order from the brief, and what exists:

| Step | Status |
| --- | --- |
| 1. Arena, car, ball, camera | Done |
| 2. Goals, scoring, match flow | Done |
| 3. AI bots with tiered difficulty | Done |
| 4. Gauntlet structure and round escalation | Next |
| 5. Upgrades between rounds | Not started |
| 6. Boss rounds | Not started |
| 7. Menus, run summary, polish | Not started |

A match is you against bots, with a countdown, clock, kickoffs, win conditions
and sudden death. Opponent count and tier come from the `match` block of the
config for now; the gauntlet will set them per round.

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
| `R` | Restart the match |
| `B` | Reset the ball only |
| `P` | Tuning panel |

## Tuning

Every constant that affects feel lives in [`src/config.ts`](src/config.ts).

**Units are Unreal Units, as Rocket League itself uses: 1 uu = 1 cm.** The pitch
is 10240 x 8192 x 2044, the ball is 91.25 across the radius, and the car hitbox
is 120.5 x 86.7 x 38.7. Working at this scale means the published Rocket League
handling figures drop straight in rather than being re-derived at some other
scale, which is what makes the car feel like a car.

The figures the handling is built on:

| | |
| --- | --- |
| Gravity | 650 (not Earth's 981 — this is what makes aerials floaty and committed) |
| Throttle acceleration | 1600 at rest, 160 at 1400, nothing at 1410 |
| Throttle top speed | 1410 |
| Boost acceleration | 991.67, burning 33.3 boost/second |
| Hard speed cap | 2300; supersonic from 2200 |
| Braking | 3500. Coasting | 525 |
| Jump | 291.67 impulse, then 1458.33 held for 0.2s |
| Dodge | 500 in the dodge direction |
| Air control | pitch 12.46, yaw 9.11, roll 38.34 rad/s^2, capped at 5.5 rad/s |
| Ball | radius 91.25, mass 30, restitution 0.6, 3% drag/s, capped at 6000 |

Two interchangeable ways to change any of it, both live:

- Press `P` for the in-game panel. Sliders write straight into the live config.
  `Copy values` puts the current numbers on your clipboard in `config.ts` shape.
- Edit `src/config.ts` and save. Vite patches the values in place; no reload, and
  the car keeps its position and momentum.

The throttle and steering curves are lookup tables rather than single numbers,
so they live in the file rather than on a slider.

## Match rules

Set in the `match` block of [`src/config.ts`](src/config.ts): 90 seconds, first
to 3, a 3 second countdown, 2.5 seconds of goal celebration, sudden death on a
draw. The gauntlet will drive these per round rather than reading the defaults.

A goal needs the ball *fully* past the line, as in the real game: its centre a
full radius beyond `goalLine`, inside the mouth and under the bar. The clock
holds during the celebration and the countdown, so only playing time counts.
Own goals are attributed from the last touch and credited to the other side.

[`src/state/match.ts`](src/state/match.ts) owns no entities — it is told where
the ball is and reports what happened, and the caller does the resetting. That
is what makes it testable without a physics world, and it is why the gauntlet
can drive it with whatever rules a round needs.

## The AI

[`src/ai/bot.ts`](src/ai/bot.ts) produces a `CarInput`, exactly like the keyboard
does, so nothing downstream knows a car is driven by it rather than a player.

The shape of it: pick a thing to go to — an interception, a defensive post, a
boost pad — then run one steering controller that drives there. Keeping the
"what" and the "how" apart is what stops the behaviour becoming a pile of
special cases.

Five tiers in [`src/ai/tiers.ts`](src/ai/tiers.ts), all the same brain with
different limits, so a harder opponent reads as a better player rather than a
different kind of thing. The knobs that matter, in order:

- **Reaction delay** — the bot acts on a stale picture of the ball. This is what
  makes a weak tier look like it is thinking slowly rather than playing badly.
- **Aim error** — sideways scatter on its chosen hit point, as a *distance* and
  not an angle. An angular error is tiny up close and enormous from the halfway
  line, where it makes the bot drive straight past the ball.
- **Prediction horizon** — how far ahead it will intercept. Capped near 1.4s
  even at the top: the predictor ignores the corner panels and every car, so
  past that its answer is a guess, and a bot that commits to a bad guess plays
  worse than one that chases what it can see.

Measured over six seeds, goals in a 90-second match against an idle opponent:

| Tier | | Goals / 90s |
| --- | --- | --- |
| 1 | Rookie | 1.0 |
| 2 | Amateur | 2.7 |
| 3 | Pro | 12.2 |
| 4 | Veteran | 17.0 |
| 5 | Champion | 14.8 |

Tiers four and five both saturate that benchmark — tier four scores exactly 17
on every seed, which is close to the most the goal-and-kickoff cycle allows — so
it cannot separate them. They should diverge against an opponent that fights
back, which is step 4's problem.

**Where it is still weak:** scoring from an off-centre position in one movement
is roughly a coin flip. It gets behind the ball and works it up the pitch
reliably, but a first touch from a wide angle often sends the ball across rather
than at the net, and it then has to reset. Aerials are a jump at a high ball and
nothing more. Both are worth revisiting once round difficulty depends on them.

## Layout

```
src/
  config.ts            all tuning constants, live-reloadable
  game.ts              wires the systems together
  core/      loop, interpolation, arena geometry, curves, math helpers
  physics/   rapier world, arena colliders, car, ball, boost pads
  ai/        bots, difficulty tiers, ball prediction
  input/     CarInput contract, keyboard source
  state/     match flow: clock, score, goals, win conditions
  render/    three scene, meshes, chase camera
  ui/        car HUD, scoreboard and banners, tuning panel
tests/       headless physics checks (vitest)
```

The arena's colliders and its meshes are both generated from
`core/arenaLayout.ts`, so they cannot drift apart.

## Tests

```bash
npm test
```

107 tests, no browser needed.

The handling tests check against the published figures rather than just checking
it does not crash: that throttle tops out at 1410 and boost carries you to 2300,
that acceleration collapses near the top end, that braking stops the car inside
half a second, that turn radius widens with speed, that jump heights match their
closed-form values, that a dodge adds its own 500, that roll is far faster than
pitch or yaw, and that a fast car transitions onto the side wall and climbs it
with its wheels down.

The match tests run the rules with no physics at all — a ball position and a
clock is all the state machine needs: full crossing of the line, balls wide of
the mouth and over the bar, own goal attribution, the kickoff cycle, the goal
target, time expiry, sudden death, and that nothing scores before kickoff or
after full time.

The bot is tested by what it achieves rather than what it intends: put it on the
pitch with the real physics, seed its randomness so a flaky bot fails rather
than fails occasionally, and check that it scores, defends, collects boost,
recovers from a tumble and does not score on itself.

## Debugging

`window.game` is exposed in the console.

- `game.advance(seconds, input?)` steps the simulation a fixed amount and draws
  one frame, without waiting on the render loop. Useful for stepping through a
  specific situation. `input` takes any subset of `CarInput`, e.g.
  `game.advance(1, { throttle: 1, boost: true })`.
- `game.debug` exposes `car` (the player's), `cars`, `bots`, `ball`, `arena`,
  `pads`, `phys` and `match`. It is a live view, not a snapshot: the match is
  replaced on every restart, so a held reference would go stale.
- `bot.reasoning` shows why a bot chose its current target — alignment, whether
  it is behind the ball, whether it has committed to a shot.
