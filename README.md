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

Gamepad, on Rocket League's own defaults, because anyone reaching for a pad for
this game already has those in their hands:

| Button | Action |
| --- | --- |
| `RT` / `LT` | Throttle / reverse, analog |
| Left stick | Steer; pitch and yaw in the air |
| `A` | Jump, hold for height, tap again to flip |
| `B` | Boost |
| `X` | Powerslide |
| `LB` / `RB` | Air roll left / right |
| `Y` | Ball cam |
| `Start` | Pause · `Back` Mute |
| D-pad, `A` | Navigate menus |

Both devices are live at once rather than one being selected: switching should
be a matter of picking the other one up. The controls reminder in the corner
swaps to whichever was used last, since showing keyboard hints to someone
holding a pad is worse than showing nothing.

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

## Walls and the ceiling

Driving up a wall and carrying on onto the ceiling both work, and both were
broken for unrelated reasons that only measuring found.

**The floor-wall seam was eating the speed.** A car crossing it at 2300 arrived
with all of that pointing horizontally, the surface turned ninety degrees under
it, and the contact absorbed the part of the velocity now heading into the ramp.
Measured, it left the seam at 719 — two thirds of the speed gone into the wall —
and nothing it did afterwards could climb 2000 units. The velocity is now turned
onto the new surface before the contact gets to flatten it, keeping its
magnitude instead of its direction.

Two traps in that, both found by measurement:

- **A fractional carry factor compounds.** `0.94` looks like a reasonable "a
  transition should cost something" knob, and it applies on every frame the
  velocity is being turned: a tenth of a second at 120Hz is `0.94` to the
  twelfth, which is under half the speed. It reached 1365 up the wall against
  1996 for keeping the speed exactly. There is no factor any more.
- **It must only fire on a real transition.** The suspension leaves a few units
  a second of motion into the floor every frame, and rescaling the speed around
  that fights the damping — the ride height went from holding inside three units
  to wandering over four. There is a threshold, and a test on the ride height.

**The wall-ceiling seam did not exist.** The floor-wall join has a 45-degree
chamfer; the top of the wall was a square right angle, so a car climbed
perfectly, arrived at the top and had nothing to roll over. Both seams are now
generated from the same figures, so they cannot drift apart. At the ends the
upper seam is one piece rather than the two the floor needs either side of the
goal mouth: reusing the split up there leaves a hole in the middle of the seam
exactly where a car driving down the pitch arrives.

**And gravity beats the stick force on a ceiling.** Stick is 325 and gravity is
650, so an overhead surface peeled the car away at 325 whatever it did. The
component of gravity that peels the car off a surface is now cancelled, which is
nothing on the floor and nothing on a vertical wall — gravity slides you down a
wall, it does not pull you off one — so only the ceiling changes.

Where it ends up: a boosted approach from 600 uu/s or more gets fully onto the
ceiling and drives there, an unboosted 2000 gets most of the way over, and
trundling at the wall at 600 puts you part way up and no further, which is what
stops every loose ball turning into a wall drive.

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

## Input

Everything above the input layer deals in **actions**, not keys or button
numbers: `pause`, `ballCam`, `menuSelect`, `pick1`. Without that, adding a pad
means every hotkey and every menu key in the game grows a second branch; with
it, a device is a source that produces the same actions.

Three pieces in [`src/input`](src/input): the keyboard, the pad, and
[`controls.ts`](src/input/controls.ts) which merges them. Analog axes take
whichever input is pushed further rather than adding, so holding a key while a
stick is half over does not overshoot; buttons are an or; and the jump latch is
consumed from both, so a tap on either is acted on exactly once.

A pad is polled rather than pushed — the browser hands out immutable snapshots,
so there is nothing to subscribe to and a fresh read is needed every frame.
Pads are also invisible to the page until one is touched, which is why the title
screen says "press any button to connect" rather than claiming there is no
controller.

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

## The look

A floodlit arena at night. No image files: everything on screen is geometry or
a texture painted onto a canvas at startup, the same decision as the synthesised
audio, which is also why the pitch can be repainted when a round narrows the
nets rather than leaving markings where the posts used to be.

Night is the deliberate choice, and it is not the same thing as the first
version being dark. That one was dark *and* flat — one navy everywhere, nothing
brighter than anything else. Night only works if the pitch is the brightest
thing in the frame and the sky is genuinely dark behind it, so the floodlights
are the light source rather than decoration.

### Why it felt empty, and the one change that fixed it

The first stadium pass added stands, a crowd and floodlights, and the arena
still read as a lot with seating around it. The reason turned out to be
structural rather than a matter of adding more detail.

The playfield is a sealed box 2044 tall and its walls are driveable, so nothing
can stand proud of them without implying collision that is not there. That left
twenty metres of blank opaque wall at exactly the height the chase camera looks
at, with the entire crowd hidden behind it. No amount of detail further out
could fix that, because none of it was visible.

So the wall is now two bands: solid hoardings up to 620, glass from there to the
ceiling. It is still a driveable surface for its whole height — only its
appearance changed — and the bowl starts at 520, just behind the boards. From a
car on the floor you are now looking through glass at several thousand people.

Three things followed from that:

- **The volume is closed.** A roof with trusses and banks of lights hanging
  under it, rather than four corner masts and open sky. Open to the sky, an
  arena at night reads as a car park.
- **The crowd is instanced and varied.** Around 14,500 spectators in two decks
  across two instanced meshes, each nudged along its row and in depth, with
  gangways cut through. Evenly spaced boxes of one size read as brickwork; the
  gaps and the mismatched heights are what make a crowd. They carry a little
  emissive, standing in for house lights over the seating — the four keys are
  aimed at the pitch, so a crowd lit off them alone is nearly black at
  gameplay distance, and a crowd you cannot see is the same as no crowd.
- **A few hundred camera flashes** pop at random through the seating. The
  cheapest trick available and the one that does the most: a still crowd reads
  as scenery, a flickering one reads as people.

Also from that pass: a hanging scoreboard at each end showing the live score and
clock (repainted only when the text changes, not every frame), a lit surround
around each goal mouth so it can be found from the far end of a pitch ten
thousand units long, and painted reflections of the light banks on the floor.
Those last ones are faked deliberately — a real reflection means drawing the
scene again into a render target, and at the glancing angle the camera actually
sees the floor, painted streaks read the same for nothing.

Two mistakes worth recording, because both looked like the same bug:

- **Double-sided glass with depth writing off stacks.** The view passes through
  the near wall, both side walls and the far wall, and four layers of a 12 per
  cent tint is an opaque white sheet. Front faces only, at 7 per cent.
- **Fourteen double-sided additive light shafts do the same thing.** Each cone
  is drawn twice over, and together they laid a pale sheet across the whole
  pitch. Back faces only, at about a quarter of the opacity and half the width.

The building is built once rather than per round: a modifier can change the
goals, which rebuilds the arena, but it never changes the stands. Verified
across five rebuilds — one arena, one stadium, texture count flat.

### Surface detail, made rather than downloaded

Every material here was a flat colour, which is the real reason the car and ball
read as shapes rather than objects: with no surface detail, geometry is all the
eye has to go on, and no amount of geometry substitutes for a surface that
looks like a material.

The fix is generated normal maps. `normalMapFromHeight` takes a greyscale height
field drawn on a canvas and differences it into a normal map with a Sobel
kernel, sampling wrapped so a tiling map has no seam. It costs no triangles.

- **The ball** gets its panel seams in relief, a roughness map that leaves the
  panels polished and the seams dull, and a clear coat. This is the single
  biggest change: the ball is the object the eye tracks for the whole match.
- **The car** gets body creases, a vent, and the faint orange peel of sprayed
  paint, under a clear coat. Car paint is pigment under lacquer, and the two
  highlights that gives — broad from the colour, tight from the coat — are most
  of why a painted surface looks painted. The map tiles across the bodywork
  rather than being laid out per panel, which a real model would do with proper
  UVs; at chase-camera distance what reads is that the surface has grain at all.
- **The wall** gets its hoardings standing proud with lit edges, and a scuffed
  kickplate. It earns a map more than anything else, being the surface that
  fills the view at eye level while driving.
- **The floor** gets fine grain so a glancing highlight breaks up instead of
  sliding across a sheet of glass.

One figure worth keeping: grain has to be smaller than the things standing on
it. Tiled 48 times across a pitch this wide, each speck is the size of a car and
the floor reads as crumpled paper; at 130 it reads as a surface.

Normal maps carry vectors, not colour, so they are left in linear space —
tagging one as sRGB bends every normal in it.

**What this does not do** is replace a modelled car. An artist's bodywork is out
of reach of code written by hand, and the references that look better than this
use downloaded Rocket League models. Those are Epic's, so they are not an option
here whatever they look like.

### Art files are optional

There is a loader for a radiance map and a car model, and neither is present.
`public/assets` is empty, the game generates everything it needs, and anything
dropped in that folder is an upgrade rather than a requirement — see the note in
that folder for what the two files change and which is worth doing first.

The fallback is the design, not a convenience. The repository stays asset-free
and licence-free by default, an art file is never a build dependency, and a
missing or malformed one degrades to the generated version instead of a blank
screen. Files are probed with a HEAD request first, because a loader pointed at
a missing file logs a network error and throws — and a console full of red on
every boot of a game that is working perfectly is its own kind of bug.

A supplied radiance map is prefiltered through `PMREMGenerator` and used for
reflections only; the night sky behind the stands stays as it is, since an
indoor radiance map used as a backdrop puts someone else's building behind ours.
A supplied car is measured and fitted to the hitbox — scaled so its longest
horizontal axis matches the hitbox length, turned to face +x, and dropped so its
underside sits on the wheel contact line — so a file does not have to be
prepared to this game's conventions to work.

### Holding the frame rate

The renderer measures its own frame time and moves the render resolution to
suit, between the display's own pixel ratio and a floor of 0.7. There is no
quality setting, because a quality setting is a question the player cannot
answer any better than the game can.

The policy lives in [`resolutionScaler.ts`](src/render/resolutionScaler.ts) with
no renderer in it, because the part that is easy to get subtly wrong is the
policy: a scaler that drops a step, measures the faster frames, climbs back,
measures the slower ones and repeats for ever is much worse than one that
settles slightly soft. What stops that here is a gap between the thresholds it
drops at and climbs at, a median rather than a mean over a 45-frame window, a
cooldown after every change, and discarding the window on a change so the new
resolution is never judged on the old one's samples. Long frames are discarded
outright — a tab waking up or a round rebuilding is not the frame rate.

It is tested on the behaviour rather than the picture: that it settles, that it
ignores a stutter, that it respects the floor and never climbs past the display.

**This exists because the frame cost could not be measured honestly from
outside.** Two attempts with `EXT_disjoint_timer_query_webgl2`, one of them
alternating conditions to cancel drift, produced numbers whose variance was
larger than the effect — 11.1 to 11.9ms at full resolution against 9.3 to
12.4ms at seventy per cent, which says nothing. A renderer that measures itself
on the machine it is actually running on does not have that problem.

Alongside it, two reductions that need no measurement to justify: the light
shafts are additive cones that cover much of the screen and blend rather than
occlude, so there are half as many; and the fascia panels and light banks are
merged into one mesh each rather than eight and fourteen.

Cost: around 215 draw calls and 180,000 triangles for the whole arena, crowd
included.

What was actually wrong with the first version, in order of how much it mattered:

- **No stadium.** The arena floated in a void, and a stadium is mostly the
  stadium. There is now a raked bowl of fourteen tiers starting at the top of
  the wall, a crowd, and floodlights at the corners. The crowd is a single
  instanced mesh, so several thousand spectators cost one draw call.
- **No pitch.** Markings were drawn as lines, and a line cannot carry surface
  banding, a tinted end, or enough thickness to read at speed — at a distance a
  one-pixel line either shimmers or vanishes. The pitch is now a painted
  texture: bands across the short axis, halfway line, centre circles, goal
  areas, keeper arcs, corner arcs, and a tinted area at each end so which way
  you are attacking is readable without looking at the scoreboard.

  The floor is a cool synthetic surface rather than grass, so the bands are
  panels rather than mowing stripes — but they stay either way, because
  alternating bands passing under the car are a large part of how fast the game
  feels. One consequence worth knowing: the attacking end is tinted **cyan**,
  not the team's own blue. A blue tint on a blue floor is almost no tint at all.
  Measured as distance from the centre of the pitch in RGB, the orange end sat
  at 61 and blue at 26 until it was shifted to cyan, which brings it to 49.
- **Flat lighting.** There was no tone mapping, so the bright end crushed to
  white and everything else read as the same navy. ACES filmic tone mapping now,
  a night sky gradient used as the environment map — metal with nothing to
  reflect is just its base colour, however many lights you point at it — and a
  shadow camera fitted to the pitch rather than loosely around it.

  There is no sun. Four cool keys angle in from above the corners where the
  floodlight masts are, which is why a car's shadows splay outward from the
  middle of the pitch instead of all lying the same way. Only the brightest of
  the four casts a shadow: four shadow maps is four extra passes over the scene
  for a second and third shadow nobody reads at this camera distance. The rigs
  themselves are drawn at pure white so the bloom catches them — a floodlight
  lit to the same value as a wall looks like a grey box on a pole.
- **The car was a box.** See below.
- **Nothing glowed.** A bloom pass, thresholded at 0.72. Lower and the white
  pitch markings start to glow, which reads as a bug rather than an effect; at
  night the threshold has less room above it, so the lit hoardings are kept
  below white on purpose to stop them competing with the floodlights.

**The car took three attempts, and the first two failed the same way.** Placing
the corners of a hull by hand is easy to get wrong in a way that is hard to
read back from the code: one station's width wrong and the body comes out as a
splayed flat plate with a dark box sitting on it, which is what shipped in both
early versions. It is now an extruded side profile — low nose, rising bonnet,
a greenhouse set back and inset from the shoulders — because a car is
recognisable by its silhouette, so the silhouette is the thing worth describing
directly. A few units of bevel on every edge is what stops it looking like cut
card.

Two things worth knowing if you change any of this:

- **The vertical layout comes from the ride height, not from taste.** The hitbox
  floats `rideHeight` above the ground, so in the mesh's own frame the ground is
  at `-(hy + rideHeight)` and a wheel of radius r sits exactly r above it. The
  first version used `-hy + radius * 0.2`, which buries the wheels inside the
  bodywork.
- **Wheel x positions are the real suspension stations; the z is not.** The
  suspension sits 26-30 units off centre inside a hitbox 87 wide, and a wheel
  drawn there is invisible. The visible track is pushed out to the bodyside.

Textures are disposed along with the arena when a round rebuilds it. The pitch
alone is a 2560 by 2048 canvas, so leaving the maps behind leaks megabytes per
round — the sort of thing that only shows twenty rounds into a run, by which
point nothing obviously points at the arena.

The bundle carries roughly 20kB gzipped for three's postprocessing and geometry
utilities.

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

Three benchmarks, because no one of them told the whole story.

**Finishing**: randomised chances from all over the pitch, twelve seconds each.
**Wide finishing**: the same, but with the ball out near a side wall in the
attacking half. **Match**: goals in ninety seconds against an idle opponent.

| Tier | | Finishing | Wide | Goals / 90s |
| --- | --- | --- | --- | --- |
| 1 | Rookie | 10% | 10% | 1.0 |
| 2 | Amateur | 20% | 22% | 2.4 |
| 3 | Pro | 33% | 36% | 12.5 |
| 4 | Veteran | 36% | 47% | 13.1 |
| 5 | Champion | 42% | 47% | 13.8 |

Having all three mattered: a change that looked like a five-point regression on
one of them turned out to be noise once the sample was doubled, and a change
that helped two of them cost a third of tier three's goals on the one that
counted most.

### Wide-angle finishing

Wide chances convert at 47 per cent at the top two tiers, up from about 44. The
whole gain came from one line — bots used to stop boosting 900 units out and
coast the final approach, so their shots arrived at roughly half the pace they
could and stopped short of the net. Boosting right up to the ball is worth
between a third and half a goal a match at the top tiers, and at tier three it
is worth four and a half: 8.1 goals a match to 12.5.

Two things that sound obviously right measured worse and were dropped:

- **Aiming nearer the close post.** From out wide the middle of the goal is the
  longest diagonal on the pitch, so a shorter shot ought to help. It converted
  36 against 46. The reason is in the diagnosis: *every* ball that reaches the
  back wall goes in — not one in a hundred attempts finished wide of the mouth —
  so distance is not what beats these chances. The ball never arriving is, and
  the middle has the most goal behind it when the touch is imperfect.
- **Capping the arrival speed** to stop the car overshooting the ball. Flat out
  does cost touches, 250 against 348 over two hundred chances. But fast strikes
  are the *accurate* ones — off-centre by 17 units at 1600uu/s against 57 at
  800, because a car at speed travels in a straight line and has no time to
  wander off it — and capping cost tier three a third of its goals for about
  half a goal gained at tier four.

What limits these chances is touches in the time available, not accuracy. A
typical miss is one touch, the ball travelling the right way, and the clock
running out before a second one.

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

### Aerials

The top two tiers leave the ground for a ball they cannot reach by driving.
Over 150 lofted balls, a Veteran goes from **no** aerial contact at all to **36**
touches in the air, and goals roughly double, from four to seven. Grounded
finishing is unaffected: 33 / 37 / 44 per cent against 34 / 36 / 44 before.

Three parts, each harder than the one before.

**Air control** ([`src/ai/aerial.ts`](src/ai/aerial.ts)) points the nose at a
direction and holds it, at any attitude, including straight up. Each axis runs a
rate profile rather than a proportional push: never ask for more rotation than
can be arrested in the error remaining, which is `sqrt(2 * accel * error)`. A
proportional term cannot work here — the car builds four or five radians a
second covering ninety degrees and needs a third of a second to stop, by which
point it has sailed tens of degrees past.

**Launch planning** decides *when* to leave the ground, and getting it wrong is
what made the first attempt a regression. Jumping when *close* to the spot under
the ball is the obvious rule and it is hopeless: a car launches with whatever
ground speed it had and keeps it, so it drifts horizontally for the whole climb
and sails past. The launch has to happen at the distance that drift will cover —
`speed * climbTime`, often well over a thousand units out — and the same figure
decides which interceptions are reachable at all. Replacing a fixed reach radius
with that criterion took the launch distance from 811 to 1418, the horizontal
miss from 399 to 163, and produced the first aerial contact there had ever been.

**Aiming the touch** is the difference between reaching the ball and shooting
it, and it was still missing once the first two worked: connections were landing
but going 43 degrees off the goal, against 12 on the ground. Two changes, each
measured over 120 lofted balls:

- **Meet the ball on the far side, not at its centre.** `aerialContact` takes
  the impulse that would leave the ball heading for the net — the ball's own
  velocity subtracted, which matters far more in the air than on the ground —
  and backs off along it by 1.2 radii. Touches rose from 28 to 30 per cent of
  attempts at tier four and 33 to 38 at tier five, goals from 11 to 13 and 10 to
  12, closest approach from 216 to 185.
- **Turn onto the shot line before contact.** A touch sends the ball where the
  car is *travelling*, and after a climb that is mostly upward, so the last
  0.45 seconds thrust along the shot line instead of at the ball. Median touch
  direction error 43 degrees to 39 at tier four, 43 to 37 at tier five.

Two plausible refinements measured as nothing and were dropped: clamping the
shot flatter when it points steeply downward is identical from 1.0 down to 0.25
and worse below, and aiming further through the ball (2.0 radii) buys no extra
touches while costing direction error. Longer strike windows are actively bad —
0.7 seconds drops connections to 26 per cent and 1.0 to 14.

Five bugs were found along the way, in rough order of how much they mattered:

- **A directional second jump is a dodge, not a jump.** The bot held its nose-up
  command through the frame it pressed jump again, so the car snapped into a
  front flip and locked out air control — it was flipping itself *nose-down*
  every single time. Peak climb 219 to 490 on that fix alone.
- **A fixed lateral reach limit made a correct launch impossible.** Added to
  tame an earlier regression, it only considered interceptions within about 660
  units, when the launch needs to happen at 1400. One guess papering over
  another.
- **Holding jump for height blocks the double jump**, because a car needs it
  released before the second registers.
- **A per-axis `atan2` attitude error is wrong past ninety degrees**: the pitch
  error of a ball overhead keeps growing as the nose passes vertical rather than
  reversing, so the car rotated through and ended up inverted.
- **The "upside down, do nothing" guard abandoned every aerial**, because
  pointing the nose up tilts the roof by the same angle.

A bot also only goes up when driving is not on: if the ball will be at a
drivable height soon enough to reach, it drives. Being able to fly is not a
reason to, and without that check a bot goes up for nearly every loose ball and
gives up more on the ground than it wins in the air.

### Aerial defence

The Champion also leaves the ground to cut out a shot heading into its own net.
It is the last thing a bot learns, and the top tier only: going up in defence is
the riskiest thing in the game, because a miss leaves the car behind the play,
out of boost, with the ball in an empty net.

**The trigger is the threat, not the mode.** This was the mistake worth writing
down. A defensive aerial looks like it belongs in the `defend` mode, and putting
it there does nothing at all: `defend` means the ball is *deeper* than the car,
so the bot is chasing back and an aerial has no hope of catching up. A shot
flying over a goalside defender's head — the one ball most worth going up for —
reads as `attack`, because the bot is between the ball and its net and the ball
is simply the thing to go and hit. `threatensGoal` in
[`src/ai/ballPrediction.ts`](src/ai/ballPrediction.ts) decides it instead: if
the predicted path crosses the defended line inside the mouth, the defensive
search runs whatever the bot thought it was doing.

**A keeper is where it shows.** A keeper sits in `defend` permanently, so the
attacking search never ran for it: it stood on its line and watched lofted shots
sail over. Over 120 shots lofted into its net, with the defender goalside and
the ball passing some 630 units above its roof:

| | Veteran keeper | Champion keeper |
|---|---|---|
| Conceded | 116 / 120 | **76 / 120** |
| Air saves | 4 | **46** |

The same shots against a bot with no aerials at all go in 120 times out of 120,
which is the point: these are not saves being made better, they are saves that
could not be attempted.

Outside the keeper role the gain is small — a balanced defender already went up
for these balls through the attacking search, and measures the same 19 saves
either way — and for shots arriving low in the mouth it is 12 saves against 16.

**The search differs from the attacking one in what it is asking.** The
attacking search asks whether a chance is worth the boost; this one starts from
the fact that the ball is going in unless something intervenes, so it asks only
whether the save is possible: a height floor at 0.6 of the attacking one, a
longer horizon to see the shot early, and a budget that will empty the tank.

It takes the *earliest* interception that works, not the latest. The latest has
the most climb time in it and is much worse — 3 saves against 19 — because the
launch is planned *from* the interception, so a late interception is a late
launch and the car is still rolling along the floor as the ball goes over it.

A clearance is aimed up-field, high, and toward the wall the ball is already
nearest, rather than at the opposing goal. A clear that has to reverse the
ball's sideways motion as well as its approach asks far more of the touch, and
what it gets wrong it leaves sitting in front of the net it just came from.

**None of this changes a bot-versus-bot match.** With the flag on and off, a
Champion attacker against a Champion keeper produces byte-identical results,
because bots shoot low and flat and the threat test never fires. A full Lockout
round simulated with a Champion standing in for the player — narrow nets, heavy
ball, both opponents, and the upgrades a run holds by round 25 — clears 3 times
in 20 either way, with the keeper never once leaving the ground. It is a change
for playing against a human, who lofts.

**Which leaves the question of whether The Lockout is still winnable**, since it
is a Champion keeper behind a net a third narrower. Lofted shots at that net,
aimed inside the mouth, with the heavy ball:

| | Before | After |
| --- | --- | --- |
| Lofted shots scored | 113 / 120 (94%) | **81 / 120 (68%)** |
| Ground shots scored | 120 / 120 (100%) | **119 / 120 (99%)** |

So the keeper now stops about one lofted shot in three, where it used to stop
one in seventeen — and the ground route is untouched, because it only leaves the
floor for a ball it cannot drive into. Two goals in ninety seconds against a
keeper that saves a third of the lofts and none of the low shots is a harder
round than it was, and not a wall. That ground route is pinned by a test, since
it is the property the boss rounds rest on.

The Wall is a Veteran keeper and is untouched.

## Layout

```
src/
  config.ts            all tuning constants, live-reloadable
  game.ts              wires the systems together
  core/      loop, interpolation, arena geometry, curves, math helpers
  physics/   rapier world, arena colliders, car, ball, boost pads
  ai/        bots, difficulty tiers, ball prediction, air control
  input/     CarInput contract, actions, keyboard and gamepad, merged controls
  state/     match flow, run and rounds, modifiers, upgrades, persistence
  render/    three scene, meshes, chase camera
  ui/        car HUD, scoreboard and banners, tuning panel
tests/       headless physics checks (vitest)
```

The arena's colliders and its meshes are both generated from
`core/arenaLayout.ts`, so they cannot drift apart.

## Build

```bash
npm run build     # production build into dist/
npm run preview   # serve it
```

| | Raw | Gzipped |
| --- | --- | --- |
| Game code | 98 kB | 32 kB |
| Three | 537 kB | 133 kB |
| Rapier glue | 283 kB | 49 kB |
| Rapier WebAssembly | 3,082 kB | 1,188 kB |
| CSS and HTML | 9 kB | 3 kB |

The JavaScript used to be **4,968 kB** in one file, because the `-compat` Rapier
build inlines its WebAssembly as base64 — a third larger than the binary, inside
the bundle, impossible to stream, and re-downloaded whenever a line of game code
changes. Switching to the ordinary build and splitting the chunks took the
JavaScript to 918 kB, and gzipped from 1,831 kB to 206 kB.

Rapier is loaded two ways for one import. The browser gets the ordinary build,
whose WebAssembly is a separate file: smaller, compiled while the rest of the
bundle parses, and cached on its own. The test runner gets the `-compat` build,
because WebAssembly module imports are not instantiated under Node here. That is
safe rather than merely convenient — the two packages ship a byte-identical
`rapier_wasm3d_bg.wasm`, same SHA-256, so the tests exercise exactly the physics
that ships and only the loading differs.

Three and Rapier are separate chunks because they change far less often than the
game does, so a deploy does not invalidate them.

## Tests

```bash
npm test
```

299 tests, no browser needed.

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

The aerial tests fly a real car at a target and check it arrives and stays
there, at every attitude including straight up — the first version passed every
test that aimed at forty-five degrees and fell over at ninety, which is why the
near-vertical cases are now pinned explicitly. The launch planning is tested on
the property that matters: that the launch distance grows with speed and with
climb time, because treating it as a fixed radius is exactly the mistake that
made aerials useless. Two more pin the car's own rule that a second jump with
the stick held is a dodge rather than a jump, since that distinction cost four
rounds of diagnosis.

Where the touch is aimed is pinned exactly, on `aerialContact`: that the contact
point sits on the far side of the ball from the goal, at the asked-for distance
from its centre, that it leans into a ball crossing from the side, that it goes
*above* a ball which has to come down into the net, and that a ball already
travelling at the goal at shot speed produces a flat fallback rather than a NaN.
Whether the touches actually go goalward is checked separately, over eighty
lofted balls, but with a loose bound: twenty-odd touches cannot separate 33
degrees from 40 without flaking, so that test guards the failure that really
happens — a sign or frame error sending touches sideways — and the tuning is
measured out of tree.

A bot is also run at a spread of twenty lofted balls and has to meet a few of
them in the air. One favourable scenario would pass with the launch planning
deleted; a spread will not.

The gamepad tests matter more than most, because I have no pad to try this with:
a fake one is just an object returned from `navigator.getGamepads`, which makes
the whole mapping testable without a device — analog trigger pressure, the
deadzone curve, the press-release-press edge on jump, and both devices driving
together.

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

- **Aerials are simple ones only.** A bot will go up for a ball it can meet on
  a mostly ballistic path, and about a third of its attempts connect. It aims
  the touch now, but only roughly: the median leaves 37 degrees off the goal
  against 12 on the ground, so an aerial is a chance created rather than a shot
  taken. It will not double-touch or redirect, and aerial defence is the
  Champion's alone — every tier below it is beaten by a lofted shot it can see
  coming.
  Good enough that the top tiers feel like they play above the floor; a long way
  from good.
- **The gamepad mapping has never been tried on a real pad.** It is tested
  against a faked one down to analog trigger pressure and deadzone curves, and
  driven in the browser through a synthetic pad, but no physical controller has
  touched it. Button numbering follows the W3C standard mapping, which most
  pads report; anything exotic may be mapped oddly.
- **The WebAssembly is 1.1MB gzipped** and there is no obvious way around it:
  it is Rapier's own build, and most of the size is features this game never
  touches, soft bodies among them. It downloads once and caches, but a first
  visit still waits on it, which is why there is a boot screen.
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
