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
| 4. Gauntlet structure and round escalation | Done |
| 5. Upgrades between rounds | Done |
| 6. Boss rounds | Done |
| 7. Menus, run summary, polish | Done |

All seven steps are in. The game opens on a title screen, a run escalates
through rounds and bosses, upgrades are picked between them, a loss ends the run
and shows a summary, and the best run persists.

The known gaps are listed at the end.

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
| `B` | Reset the ball only |
| `1` `2` `3` | Take the matching upgrade between rounds |
| `Esc` | Pause |
| `M` | Mute |
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

## Screens

Title, pause and run summary are the same keyboard menu overlay with different
contents, in [`src/ui/shell.ts`](src/ui/shell.ts). The shell reports which item
was chosen and nothing else; the game decides what that means, so screens change
in one place. Arrows or number keys to move, Enter to select.

**Free play** is on the title screen: no clock, no opponents, nothing to lose.
It exists because judging how the car feels is its own task, and doing it inside
a round that can be lost is a different experience.

The title and summary screens hide the gameplay HUD behind them — a scoreboard
and a round number describing a round nobody is playing read as a bug. The pause
screen keeps it, so you can see the state you are returning to.

## Sound and effects

**Sound** ([`src/audio/sound.ts`](src/audio/sound.ts)) is synthesised with Web
Audio rather than loaded from files. No assets to ship, and every sound scales
with what caused it: a hit at 2000uu/s is a different noise from a nudge, which
one fixed sample cannot be. Boost is a filtered noise loop held open and tracked
to speed; hits are a low thump plus a noise crack, both weighted by closing
speed; a goal rises for one scored and falls for one conceded.

Browsers will not start an AudioContext without a gesture, so it is created
lazily on the first keypress — which the title screen provides. Everything
no-ops before then, and after any failure: a game that throws because audio is
unavailable is worse than a quiet one.

**Particles** ([`src/render/particles.ts`](src/render/particles.ts)) are one
pooled point system for every effect — boost trails, impact sparks, goal
bursts, pad pickups. A fixed pool written into a single buffer, so the whole
lot is one draw call however much is happening and emitting never allocates.
Dead particles are parked at zero size rather than removed, which keeps the
buffers contiguous. The point size is computed from the viewport and field of
view, so a particle of a given world size holds that size on screen.

The camera takes a kick on goals and on the player's own heavy touches — only
the player's, because a shake for every contact in a four-car scrum is
unreadable.

## The gauntlet

A run is a sequence of rounds cleared back to back. Lose one and the run is
over; progress resets to nothing.

Difficulty escalates on the three axes the brief asks for, independently:

| | |
| --- | --- |
| Opponent skill | Up one tier every three rounds, capped at five |
| Opponent count | One, then two from round four, three from round nine |
| Modifiers | None at first, one from round three, two from round eight |
| Match length | 90 seconds, tightening by three a round to a floor of 60 |
| Goals needed | First to two, then first to three from round five |

Every round goes to sudden death rather than ending level: a gauntlet has to
resolve one way or the other, and it is cleared by winning, not by not losing.

Ten modifiers in [`src/state/modifiers.ts`](src/state/modifiers.ts) — narrow and
tiny goals, heavy, light and giant balls, low and heavy gravity, rationed and no
boost, a slick floor. Each one unlocks at a round of its own, and two that pull
the same knob in opposite directions are never picked together.

Modifiers write through [`ConfigOverrides`](src/state/configOverride.ts), which
keeps a baseline so a round always builds on the values the file shipped with
rather than on whatever the last round left behind. Most changes are live, but
goal dimensions are baked into colliders and meshes, so those rebuild the arena.

[`src/state/run.ts`](src/state/run.ts) owns no entities, like `Match`: it is told
how a round finished and says what happens next. The best run is kept in
localStorage, guarded so a corrupt record or blocked storage reads as no record
rather than breaking the game.

## Boss rounds

Every fifth round. Each one changes the **rules**, not just the numbers — a boss
that is only a stronger opponent is a difficulty modifier wearing a hat. They
cycle, so a long run meets each in turn, and a boss met later in a run is
stronger because the round's own tier curve raises its floor.

| Round | | What is different |
| --- | --- | --- |
| 5 | **The Wall** | One keeper, parked. Score three past it or fail — leading is not enough |
| 10 | **The Siege** | Three attackers. Cannot be won by scoring: survive 60 seconds, concede once and the run ends |
| 15 | **The Duel** | One champion, first goal takes it, on a slick floor |
| 20 | **The Swarm** | Four of them. Win by three clear goals |
| 25 | **The Lockout** | A champion keeper behind a narrow net, heavy ball, two goals needed |

Two things had to exist for these to be distinct rather than cosmetic:

- **Match objectives.** `goals` is the ordinary thing. `target` means reaching
  the goal target or failing, so a boss can say "score three past this keeper"
  and mean it — a 2-0 at full time is a loss, where in an ordinary round it
  would be a win. `survive` cannot be won by scoring at all.
- **Bot roles**, in [`src/ai/bot.ts`](src/ai/bot.ts). Tiers say how *good* a bot
  is; the role says what *job* it does. A keeper hugs its line and only comes
  out to clear a ball that has got close; an attacker never drops back whatever
  its tier would do. Without roles, The Wall would just be a good bot that
  happens to be standing in the way.

## Upgrades

Clear a round and three upgrades are offered; take one with `1`, `2` or `3` and
it lasts the rest of the run. The run waits for the choice rather than timing
out: nothing is lost by thinking about it.

Fifteen of them in [`src/state/upgrades.ts`](src/state/upgrades.ts) — boost
strength, capacity and economy, acceleration, top speed, grip, turn rate, jump
height, dodge power, air control, how hard your touches hit, pad yield, and an
extra jump. Most stack, and compound when taken twice. The one-offs (Triple
Jump, Full Tank, Generous Pads) stop being offered once held.

Two things about how they are applied are worth knowing, because the obvious
approach is wrong in both cases:

- **Upgrades go through the player's own `CarModifiers`, not the config.** The
  config is shared with the bots, so an upgrade written as a config write would
  quietly make every opponent faster too. There is a test that no upgrade
  writes a `car.*` config path for exactly this reason. The one upgrade that
  deliberately helps everyone, Generous Pads, says so in its description.
- **They are rebuilt from standard at the start of every round**, rather than
  applied once when taken. Applying incrementally would compound an upgrade the
  player took once, a little more every round, for the rest of the run.

Round modifiers and run upgrades are two separate override layers. Each round
unwinds both, applies the round's modifiers, then applies the run's upgrades on
top — so the order is fixed and a modifier reverting cannot wipe an upgrade.

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

Two benchmarks, because one was not enough to see the problem.

**Finishing**: a hundred randomised chances from all over the pitch, twelve
seconds each, measuring whether the bot converts.

| Tier | | Converted | Ball direction error |
| --- | --- | --- | --- |
| 1 | Rookie | 7% | 39 degrees |
| 2 | Amateur | 14% | 22 degrees |
| 3 | Pro | 34% | 12 degrees |
| 4 | Veteran | 36% | 12 degrees |
| 5 | Champion | 44% | 10 degrees |

**Match**: goals in ninety seconds against an idle opponent, over six seeds —
1.2, 1.7, 9.8, 13.2, 12.8 for tiers one to five. This one saturates at the top,
because the ball returns to the centre spot after every goal and the ceiling is
the goal-and-kickoff cycle rather than the bot's skill. It cannot separate tiers
four and five; the finishing benchmark can.

### How the finishing was fixed

The first version of this converted 13 to 25% at *every* tier, with no ordering
at all: tier five finished no better than tier one. Three measurements found it,
after two wrong guesses:

1. Sweeping the approach distance changed nothing, so the approach was not the
   problem. Nor was the deliberate aim scatter: at 75uu it converted the same as
   at 4uu.
2. Counting touches showed the bot was striking the ball at a healthy 1145uu/s,
   so the shots were not weak.
3. Measuring the car's direction of travel at contact against the ball's
   direction afterwards showed the error *growing* across the touch, from 24
   degrees to 41, with the strike landing 106uu off the shot line against a
   ball radius of 91.

That last one is the whole answer. The bot aimed at a point *past* the ball so
as to drive through it, which sounds right and is wrong: the car cuts the corner
toward that point, clips the ball's edge, and an off-centre strike amplifies
whatever approach error there was instead of absorbing it. Aiming at the contact
point on the near side instead — one and a half ball radii back along the shot
line — halved the offset and nearly doubled conversion on its own.

The second fix was to treat a touch as a change in the ball's velocity rather
than a push toward the goal. A ball drifting across at a few hundred uu/s
carries the shot wide however cleanly it is struck, so the strike direction is
the one that cancels that drift: `shotSpeed * toGoal - ballVelocity`. That took
the direction error from 25 degrees to 15.

Together they took tier three from 20% to 34%, and restored the ordering, which
matters more: the aim scatter per tier now shows up as direction error the way
it was always meant to, from 39 degrees at Rookie to 10 at Champion.

**Where it is still weak:** aerials are a jump at a high ball and nothing more.
A bot will not go up for a ball that needs real air play, and cannot defend one.

## Layout

```
src/
  config.ts            all tuning constants, live-reloadable
  game.ts              wires the systems together
  core/      loop, interpolation, arena geometry, curves, math helpers
  physics/   rapier world, arena colliders, car, ball, boost pads
  ai/        bots, difficulty tiers, ball prediction
  input/     CarInput contract, keyboard source
  state/     match flow, run and rounds, modifiers, upgrades, persistence
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

229 tests, no browser needed.

The handling tests check against the published figures rather than just checking
it does not crash: that throttle tops out at 1410 and boost carries you to 2300,
that acceleration collapses near the top end, that braking stops the car inside
half a second, that turn radius widens with speed, that jump heights match their
closed-form values, that a dodge adds its own 500, that roll is far faster than
pitch or yaw, and that a fast car transitions onto the side wall and climbs it
with its wheels down. Upgrade effects are checked the same way: Triple Jump has
to actually lift the car a third time, more grip has to mean measurably less
slide.

The boss tests play each boss out to a finish with no physics, feeding the match
a ball position and a clock, and check the objective resolves the way the brief
promises: that The Wall is failed by two goals and a clean sheet, that The Siege
cannot be won early by scoring and ends the moment one is conceded, that The
Swarm at three to one has reached its target but not its margin and so is still
live. Role behaviour is tested by putting two bots of the same tier in the same
situation and checking only the role changes what they do.

The match, round, run and upgrade tests run the rules with no physics at all:
goal detection, own goals, the kickoff cycle, win conditions, sudden death, the
escalation curve, modifier conflicts, offer generation, stacking, and the
best-run record surviving a corrupt entry or storage being unavailable. Several
are guards rather than checks — that every round the generator can produce
leaves the ball able to fit through the goal, that no bot tier starts a match
already hunting boost, that no upgrade touches a config path the bots read, and
that re-applying a run's upgrades is idempotent.

The menu and particle tests cover things that fail quietly: a pool that never
frees anything simply stops showing new effects, which looks like the effect was
never written. The sound tests check it stays silent and throws nothing with no
AudioContext at all, since that is a real browser state and not a hypothetical.

The bot is tested by what it achieves rather than what it intends: put it on the
pitch with the real physics, seed its randomness so a flaky bot fails rather
than fails occasionally, and check that it scores, defends, collects boost,
recovers from a tumble, frees itself from the back of a net, and does not score
on itself. Three of them pin the strike geometry, since that was worth two
wrong guesses to find: that a committed bot aims at the near side of the ball
rather than past it, that it leads the shot to cancel a drifting ball, and that
conversion stays ordered by tier.

## Known gaps

Honest list of what is not there, in rough order of how much it matters:

- **Bots cannot play in the air.** An aerial is a jump at a high ball and
  nothing more: a bot will not go up for a ball that needs real air play, and
  cannot defend one. No boss leans on this, so it has not bitten, but it is the
  largest remaining hole in the AI.
- **No gamepad support.** The brief asked for keyboard first and gamepad
  afterwards; the afterwards has not happened. `CarInput` is the single contract
  every driver produces, so a pad is a new source rather than a change to
  anything downstream.
- **Finishing from wide angles is a coin flip at best** even at the top tier:
  44% of randomised chances. See the AI section for the measurements.
- **The bundle is 5MB** because `rapier3d-compat` inlines its WebAssembly as
  base64. Fine for development; worth moving to the non-compat build with a wasm
  loader before this is served to anyone.
- **No replays, no camera options, no key rebinding.**

## Debugging

`window.game` is exposed in the console.

- `game.advance(seconds, input?)` steps the simulation a fixed amount and draws
  one frame, without waiting on the render loop. Useful for stepping through a
  specific situation. `input` takes any subset of `CarInput`, e.g.
  `game.advance(1, { throttle: 1, boost: true })`.
- `game.debug` exposes `car` (the player's), `cars`, `bots`, `ball`, `arena`,
  `pads`, `phys`, `match`, `run` and `overrides`. It is a live view, not a
  snapshot: the match is replaced every round, so a held reference would go
  stale and quietly report a dead one.
- `game.restartRun(seed)` makes a run's modifier and upgrade picks repeatable,
  which is the only practical way to chase a bug that only shows up in one
  round's particular combination.
- `game.pickUpgrade(i)` takes an offered upgrade without a keypress.
- `game.debug.screen` and `.freePlay` say which screen is up, which is worth
  having because "nothing is moving" has several possible causes.
- `bot.reasoning` shows why a bot chose its current target — alignment, whether
  it is behind the ball, whether it has committed to a shot.
