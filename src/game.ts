import * as THREE from 'three';
import { cfg } from './config';
import { initPhysics, PhysicsWorld, type RAPIER } from './physics/world';
import { createArena, destroyArena, type Arena } from './physics/arena';
import { kickoffSpawns, type Spawn } from './core/arenaLayout';
import { Ball } from './physics/ball';
import { Car } from './physics/car';
import { BoostPads } from './physics/boostPads';
import { CarBallInteraction } from './physics/carBall';
import { Controls } from './input/controls';
import { emptyInput, type CarInput } from './input/types';
import { Bot, type BotRole } from './ai/bot';
import { createRenderer, buildArenaMesh, disposeArenaMesh, type Renderer } from './render/scene';
import { createCarMesh, createBallMesh, createBoostPadVisuals, type PadVisuals } from './render/entities';
import { ChaseCamera } from './render/chaseCamera';
import { TransformInterpolator } from './core/interpolate';
import { Loop } from './core/loop';
import { Hud } from './ui/hud';
import { MatchHud } from './ui/matchHud';
import { TweakPanel } from './ui/tweakPanel';
import { Match, type GoalEvent, type MatchResult } from './state/match';
import { Run, type RunSummary } from './state/run';
import { buildRound, type RoundSpec, type RoundOpponent } from './state/round';
import { ConfigOverrides } from './state/configOverride';
import { needsArenaRebuild } from './state/modifiers';
import { applyUpgrades, type Upgrade } from './state/upgrades';
import { resetModifiers } from './physics/car';
import { RunHud } from './ui/runHud';
import { Shell, type Screen } from './ui/shell';
import { Particles } from './render/particles';
import { Sound } from './audio/sound';

/**
 * Wires the systems together: physics, rendering, input, AI, match flow, run.
 *
 * Stage 4: a gauntlet run. Each round builds its own match rules, opponent set
 * and modifiers from a RoundSpec; losing one ends the run. Upgrades between
 * rounds are step 5, so for now a cleared round pauses briefly and carries on.
 */

/** Everything that belongs to one car on the pitch. */
interface CarEntry {
  car: Car;
  mesh: THREE.Group;
  interp: TransformInterpolator;
  flame: THREE.Mesh;
  /** Null for the player. */
  bot: Bot | null;
  spawn: Spawn;
}

/** Centre first, then wide, then the inside pair. */
const SPAWN_ORDER = [4, 2, 3, 0, 1];

const TEAM_COLOUR = { 0: 0x4fc3f7, 1: 0xff7043 } as const;

const IMPACT_COLOUR = new THREE.Color(0xfff2d0);
const GOAL_COLOUR_BLUE = new THREE.Color(0x7fd4ff);
const GOAL_COLOUR_ORANGE = new THREE.Color(0xffa070);
const TRAIL_COLOUR_BLUE = new THREE.Color(0xffc14d);
const TRAIL_COLOUR_ORANGE = new THREE.Color(0xff8a50);

export class Game {
  private readonly phys: PhysicsWorld;
  private arena: Arena;
  private arenaMesh: THREE.Group;
  private readonly ball: Ball;
  private readonly pads: BoostPads;
  private readonly carBall = new CarBallInteraction();

  private readonly entries: CarEntry[] = [];
  /** Index 0 is always the player. */
  private get player(): CarEntry {
    return this.entries[0]!;
  }
  /** Collider handle to entry, for attributing ball contacts. */
  private readonly byCollider = new Map<number, CarEntry>();

  private readonly render: Renderer;
  private readonly chase: ChaseCamera;
  private readonly ballMesh: THREE.Mesh;
  private readonly padVisuals: PadVisuals;
  private readonly ballInterp: TransformInterpolator;

  private readonly controls: Controls;
  private readonly hud: Hud;
  private readonly matchHud: MatchHud;
  private readonly runHud: RunHud;
  private readonly shell: Shell;
  private readonly particles = new Particles();
  private readonly sound = new Sound();
  private readonly panel: TweakPanel;
  private readonly loop: Loop;

  private match!: Match;
  private run: Run;
  /** Set to make a run's modifier picks repeatable; see restartRun. */
  private runSeed: number | null = null;
  /** Which screen the player is looking at. */
  private screen: Screen = 'title';
  /** True while free play is running instead of a gauntlet round. */
  private freePlay = false;
  /** Last countdown number announced, so the beep fires once per number. */
  private lastCountdownBeep = -1;
  /** Tracks supersonic, so the whoosh fires on crossing rather than per frame. */
  private wasSupersonic = false;
  /** What the title screen last said about a pad, so it can be refreshed. */
  private titleShowedPad = false;
  /** Round modifiers. Reverted and re-applied every round. */
  private readonly roundOverrides = new ConfigOverrides();
  /**
   * Run upgrades that change the world rather than just the player's car.
   * A separate layer so it can sit on top of the round's modifiers and be
   * rebuilt in a fixed order.
   */
  private readonly runOverrides = new ConfigOverrides();
  /** Stands in for the keyboard while `advance()` drives the game. */
  private inputOverride: Partial<CarInput> | null = null;
  private time = 0;
  private readonly scratch = new THREE.Vector3();

  private readonly ui: HTMLElement;

  private constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.phys = new PhysicsWorld();
    this.arena = createArena(this.phys);
    this.ball = new Ball(this.phys);
    this.pads = new BoostPads();

    this.render = createRenderer(canvas);
    this.arenaMesh = buildArenaMesh();
    this.render.scene.add(this.arenaMesh);
    this.chase = new ChaseCamera(this.render.camera);
    this.ballMesh = createBallMesh();
    this.padVisuals = createBoostPadVisuals(this.pads.pads);
    this.render.scene.add(this.ballMesh, this.padVisuals.group, this.particles.points);
    this.ballInterp = new TransformInterpolator(this.ballMesh);
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());

    this.addCar(0, 0, null);

    this.controls = new Controls();
    this.hud = new Hud(ui);
    this.matchHud = new MatchHud(ui);
    this.runHud = new RunHud(ui);
    this.shell = new Shell(ui);
    this.panel = new TweakPanel(ui);
    this.panel.onChange(() => this.syncConfig());

    this.run = this.makeRun();
    this.runHud.showBest(this.run.best);
    // The game opens on the title screen rather than mid-round: a run should
    // start because the player asked for one.
    this.applyRound(buildRound(1, Math.random));
    // One poll before the title screen is drawn, so a pad that is already
    // connected is reported as such instead of only after the first frame.
    this.controls.poll();
    this.shell.showTitle(this.run.best, this.sound.muted, this.controls.padConnected);
    this.syncHudVisibility();
    this.chase.snapTo(this.player.car.position, this.player.car.forward());

    this.loop = new Loop(
      { fixed: (dt) => this.fixedStep(dt), render: (dt, alpha) => this.renderFrame(dt, alpha) },
      () => cfg.physics.fixedDt,
      () => cfg.physics.maxStepsPerFrame,
    );

    window.addEventListener('config:hot', () => this.syncConfig());
  }

  static async create(canvas: HTMLCanvasElement, ui: HTMLElement): Promise<Game> {
    await initPhysics();
    return new Game(canvas, ui);
  }

  start(): void {
    this.loop.start();
  }

  // --- setup -------------------------------------------------------------

  /** Adds a car. `botLevel` null makes it the player's. */
  private addCar(
    team: 0 | 1,
    slot: number,
    botLevel: number | null,
    role: BotRole = 'balanced',
  ): CarEntry {
    const spawn = this.spawnFor(team, slot);
    const car = new Car(this.phys, this.spawnPosition(spawn), spawn.yaw, team);
    const mesh = createCarMesh(TEAM_COLOUR[team]);
    this.render.scene.add(mesh);

    const entry: CarEntry = {
      car,
      mesh,
      interp: new TransformInterpolator(mesh),
      flame: mesh.getObjectByName('flame') as THREE.Mesh,
      bot: botLevel === null ? null : new Bot(car, botLevel, Math.random, role),
      spawn,
    };
    entry.interp.snap(car.position, car.body.rotation());
    this.entries.push(entry);
    this.byCollider.set(car.collider.handle, entry);
    return entry;
  }

  private spawnFor(team: 0 | 1, slot: number): Spawn {
    const spots = kickoffSpawns(team === 0 ? -1 : 1);
    return spots[SPAWN_ORDER[slot % SPAWN_ORDER.length]!]!;
  }

  private spawnPosition(spawn: Spawn): { x: number; y: number; z: number } {
    return {
      x: spawn.x,
      z: spawn.z,
      y: cfg.car.hitbox.height / 2 + cfg.car.rideHeight,
    };
  }

  /**
   * Sets the world up for a round: modifiers, arena, opponents, match rules.
   *
   * Modifiers are reverted first, so a round always builds on the config the
   * file shipped with rather than on whatever the last round left behind.
   */
  private applyRound(spec: RoundSpec): void {
    // Unwound in the reverse of the order it was applied, so each layer puts
    // back exactly what it found.
    this.runOverrides.revert();
    this.roundOverrides.revert();

    for (const mod of spec.modifiers) mod.apply(this.roundOverrides);

    // Upgrades go on top of the round's modifiers, and are rebuilt from
    // standard every round: applying them incrementally would compound an
    // upgrade the player only took once.
    resetModifiers(this.player.car.mods);
    applyUpgrades(this.run.upgrades, {
      mods: this.player.car.mods,
      overrides: this.runOverrides,
    });

    // Goal dimensions are baked into colliders and meshes, so those modifiers
    // need the arena rebuilt rather than a value written.
    if (needsArenaRebuild(spec.modifiers) || this.rebuiltArena) {
      this.rebuildArena();
      this.rebuiltArena = needsArenaRebuild(spec.modifiers);
    }

    this.setOpponents(spec.lineup);
    this.syncConfig();
    this.runHud.showOwned(this.run.upgrades);

    this.match = new Match(spec.rules, {
      onGoal: (e) => this.onGoal(e),
      onKickoff: () => this.setUpKickoff(),
      onEnd: (r) => this.onMatchEnd(r),
    });
    this.matchHud.reset();
    this.runHud.roundStart(spec);
    this.setUpKickoff();
  }

  /** True while the arena is built at non-default dimensions. */
  private rebuiltArena = false;

  private rebuildArena(): void {
    destroyArena(this.phys, this.arena);
    this.render.scene.remove(this.arenaMesh);
    disposeArenaMesh(this.arenaMesh);
    this.arena = createArena(this.phys);
    this.arenaMesh = buildArenaMesh();
    this.render.scene.add(this.arenaMesh);
  }

  /** Matches the opposition to the round's lineup: count, tiers and roles. */
  private setOpponents(lineup: readonly RoundOpponent[]): void {
    const existing = this.entries.filter((e) => e.bot !== null).length;
    for (let i = existing; i < lineup.length; i++) {
      const spot = lineup[i]!;
      this.addCar(1, i, spot.tier, spot.role);
    }
    for (let i = existing; i > lineup.length; i--) {
      const entry = this.entries.pop();
      if (!entry) break;
      this.byCollider.delete(entry.car.collider.handle);
      this.render.scene.remove(entry.mesh);
      entry.car.destroy();
    }
    // Re-stamp tier and role on everyone, since cars are reused across rounds.
    let i = 0;
    for (const entry of this.entries) {
      if (!entry.bot) continue;
      const spot = lineup[i++];
      if (!spot) continue;
      entry.bot.setLevel(spot.tier);
      entry.bot.setRole(spot.role);
    }
  }

  private onGoal(event: GoalEvent): void {
    this.matchHud.goal(event);
    const forPlayer = event.team === 0;
    this.sound.goal(forPlayer);
    this.chase.kick(26);
    this.particles.burst(this.ball.position, 90, {
      colour: forPlayer ? GOAL_COLOUR_BLUE : GOAL_COLOUR_ORANGE,
      speed: 1600,
      size: 40,
      life: 1.1,
      gravity: -500,
    });
  }

  private onMatchEnd(result: MatchResult): void {
    // No match-level win/lose banner: in a gauntlet the run card says what
    // happened ("Round cleared", "Run over"), and both at once collide.
    this.run.finishRound(result, this.match.playedSeconds);
  }

  /** Everyone back to their lines, ball on the spot, pads back up. */
  private setUpKickoff(): void {
    for (const entry of this.entries) {
      entry.car.reset(this.spawnPosition(entry.spawn), entry.spawn.yaw);
      entry.interp.snap(entry.car.position, entry.car.body.rotation());
      entry.bot?.reset();
    }
    this.ball.reset();
    this.pads.resetAll();
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());
    this.chase.snapTo(this.player.car.position, this.player.car.forward());
  }

  // --- simulation --------------------------------------------------------

  private fixedStep(dt: number): void {
    this.time += dt;

    for (const entry of this.entries) {
      entry.interp.record(entry.car.position, entry.car.body.rotation());
    }
    this.ballInterp.record(this.ball.position, this.ball.body.rotation());

    const phase = this.match.phase;
    // Only 'playing' hands control over. The countdown holds everyone on their
    // line; after a goal the ball keeps rolling for show but nobody drives.
    const live = this.screen === 'playing';
    const driving = live && (this.freePlay || (phase === 'playing' && this.run.phase === 'round'));

    const world = {
      ball: {
        position: this.ball.position,
        velocity: this.ball.velocity,
        radius: cfg.ball.radius,
      },
      pads: this.pads.pads,
    };

    for (const entry of this.entries) {
      if (!driving) {
        entry.car.input = emptyInput();
        continue;
      }
      if (entry.bot) {
        entry.car.input = entry.bot.think(dt, world);
      } else {
        entry.car.input = this.inputOverride
          ? { ...emptyInput(), ...this.inputOverride }
          : this.controls.read();
      }
    }
    if (!driving && !this.inputOverride) {
      // Keeps the jump latch from banking a press for after the countdown.
      this.controls.read();
    }

    const frozen =
      !live || (!this.freePlay && (phase === 'countdown' || phase === 'ended' || this.run.phase !== 'round'));
    if (frozen) {
      for (const entry of this.entries) this.freeze(entry.car.body);
      this.freeze(this.ball.body);
    }

    const cars: Car[] = [];
    for (const entry of this.entries) {
      entry.car.update(dt);
      cars.push(entry.car);
    }
    this.ball.update();
    if (driving) {
      this.pads.update(dt, cars);
      for (const picked of this.pads.justPicked) {
        this.sound.pad(picked.pad.big);
        this.particles.burst({ x: picked.pad.x, y: 40, z: picked.pad.z }, picked.pad.big ? 18 : 8, {
          colour: TRAIL_COLOUR_BLUE,
          speed: 420,
          size: 24,
          life: 0.45,
        });
      }
    }

    this.phys.step();
    this.drainContactEvents();

    if (live && !this.freePlay) {
      this.match.update(dt, { position: this.ball.position, radius: cfg.ball.radius });
    }
  }

  /** Car-on-ball touches get the speed-dependent bounce, and set last touch. */
  private drainContactEvents(): void {
    const ballHandle = this.ball.collider.handle;
    this.phys.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other = h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;
      if (other === null) return;
      const entry = this.byCollider.get(other);
      if (!entry) return;
      this.carBall.apply(entry.car, this.ball);
      // Needed to tell an own goal from a goal.
      this.match.touch(entry.car.team);
      this.onBallTouched(entry);
    });
  }

  /** Sound and sparks for a car-on-ball touch, scaled by how hard it was. */
  private onBallTouched(entry: CarEntry): void {
    const cv = entry.car.velocity;
    const bv = this.ball.velocity;
    const closing = Math.hypot(cv.x - bv.x, cv.y - bv.y, cv.z - bv.z);
    this.sound.hit(closing);
    this.particles.burst(this.ball.position, closing > 900 ? 16 : 8, {
      colour: IMPACT_COLOUR,
      speed: 200 + closing * 0.3,
      size: 26,
      life: 0.35,
    });
    // Only the player's own touches shake the view, or a scrum is unreadable.
    if (!entry.bot) this.chase.kick(Math.min(14, closing / 220));
  }

  /** Holds a body still, for the countdown and after full time. */
  private freeze(body: RAPIER.RigidBody): void {
    const zero = { x: 0, y: 0, z: 0 };
    body.setLinvel(zero, false);
    body.setAngvel(zero, false);
  }

  // --- rendering ---------------------------------------------------------

  private renderFrame(dt: number, alpha: number): void {
    // Gamepads are polled, not pushed: the browser hands out snapshots, so a
    // fresh read is needed every frame before anything asks for input.
    this.controls.poll();

    for (const entry of this.entries) {
      entry.interp.apply(alpha);
      const boosting = entry.car.input.boost && entry.car.boost > 0;
      entry.flame.visible = boosting;
      if (boosting) {
        entry.flame.scale.setScalar(0.8 + Math.random() * 0.4);
        this.emitBoostTrail(entry, dt);
      }
    }
    this.ballInterp.apply(alpha);
    this.padVisuals.sync(this.pads.pads, this.time);
    this.particles.setProjection(
      this.render.renderer.domElement.clientHeight || window.innerHeight,
      this.render.camera.fov,
    );
    this.particles.update(dt);
    this.updateContinuousAudio();

    const player = this.player;
    this.chase.update(
      dt,
      player.mesh.position,
      player.car.velocity,
      player.car.forward(),
      this.ballMesh.position,
    );

    this.handleHotkeys();
    this.hud.setDevice(this.controls.device);
    this.hud.update(player.car, this.chase.ballCam);
    this.matchHud.update(this.match, dt);
    this.runHud.update(this.run, dt);
    this.controls.endFrame();

    this.render.renderer.render(this.render.scene, this.render.camera);
  }

  private handleHotkeys(): void {
    // Any input at all is a gesture, which is what an AudioContext needs.
    if (this.controls.anyPressed) this.sound.unlock();

    if (this.shell.visible) {
      // A pad connected while the title screen is up should show there without
      // needing the screen to be reopened.
      if (this.screen === 'title' && this.controls.padConnected !== this.titleShowedPad) {
        this.titleShowedPad = this.controls.padConnected;
        this.shell.showTitle(this.run.best, this.sound.muted, this.titleShowedPad);
      }
      this.handleMenuKeys();
      return;
    }

    if (this.controls.pressed('pause')) {
      this.pause();
      return;
    }
    if (this.controls.pressed('ballCam')) this.chase.toggleBallCam();
    if (this.controls.pressed('tuning')) this.panel.toggle();
    if (this.controls.pressed('mute')) this.sound.toggleMute();
    if (this.controls.pressed('resetBall')) this.ball.reset();

    // Between rounds, 1 to 3 take an upgrade. The run waits rather than being
    // timed out: the pick is the player's, and nothing is lost by waiting.
    if (!this.freePlay && this.run.phase === 'between') {
      for (let i = 0; i < 3; i++) {
        if (this.controls.pressed(`pick${i + 1}` as 'pick1' | 'pick2' | 'pick3')) {
          this.pickUpgrade(i);
          break;
        }
      }
    }
  }

  // --- screens -----------------------------------------------------------

  private handleMenuKeys(): void {
    if (this.controls.pressed('menuUp')) {
      this.shell.move(-1);
      this.sound.menuMove();
    }
    if (this.controls.pressed('menuDown')) {
      this.shell.move(1);
      this.sound.menuMove();
    }
    const picks: readonly ('pick1' | 'pick2' | 'pick3' | 'pick4')[] = [
      'pick1',
      'pick2',
      'pick3',
      'pick4',
    ];
    for (const [i, action] of picks.entries()) {
      if (this.controls.pressed(action)) {
        const id = this.shell.pick(i + 1);
        if (id) {
          this.sound.menuSelect();
          this.choose(id);
        }
        return;
      }
    }
    if (this.controls.pressed('menuSelect')) {
      const id = this.shell.selectedId;
      if (id) {
        this.sound.menuSelect();
        this.choose(id);
      }
      return;
    }
    // Pause resumes from the pause menu, which is where it was triggered.
    if (this.controls.pressed('pause') && this.screen === 'paused') this.choose('resume');
  }

  /** Acts on a menu item. The shell reports the choice; this one makes it. */
  private choose(id: string): void {
    switch (id) {
      case 'start':
      case 'again':
        this.beginRun();
        return;
      case 'freeplay':
        this.beginFreePlay();
        return;
      case 'resume':
        this.screen = 'playing';
        this.shell.hide();
        this.syncHudVisibility();
        return;
      case 'restart':
        this.beginRun();
        return;
      case 'quit':
        this.toTitle();
        return;
      case 'mute': {
        const muted = this.sound.toggleMute();
        // Redraw the screen so the label matches.
        if (this.screen === 'title') {
          this.shell.showTitle(this.run.best, muted, this.controls.padConnected);
        }
        else if (this.screen === 'paused') this.shell.showPause(this.roundLabel, muted);
        return;
      }
    }
  }

  /**
   * Hides the gameplay HUD behind the title and summary screens, where a
   * scoreboard and a round number are describing a round nobody is playing.
   * The pause screen keeps it, so you can see the state you are returning to.
   */
  private syncHudVisibility(): void {
    const hide = this.screen === 'title' || this.screen === 'summary';
    this.ui.classList.toggle('menu-open', hide);
    // Free play has no clock and no opposition, so a scoreboard and a frozen
    // countdown would both be describing something that is not happening.
    this.ui.classList.toggle('free-play', this.freePlay);
  }

  private get roundLabel(): string {
    if (this.freePlay) return 'Free play';
    const spec = this.run.spec;
    return spec ? `Round ${spec.index} · ${spec.label}` : '';
  }

  private beginRun(): void {
    this.freePlay = false;
    this.screen = 'playing';
    this.shell.hide();
    this.particles.clear();
    this.runHud.showBest(this.run.best);
    this.syncHudVisibility();
    this.run.start();
  }

  /** No clock, no opponents, no way to lose: somewhere to learn the car. */
  private beginFreePlay(): void {
    this.freePlay = true;
    this.screen = 'playing';
    this.shell.hide();
    this.particles.clear();
    const spec = buildRound(1, Math.random);
    this.applyRound({ ...spec, lineup: [], opponents: 0, modifiers: [], label: 'Free play' });
    this.runHud.freePlay();
    this.syncHudVisibility();
  }

  private pause(): void {
    if (this.screen !== 'playing') return;
    this.screen = 'paused';
    this.sound.setBoost(0);
    this.shell.showPause(this.roundLabel, this.sound.muted);
    this.syncHudVisibility();
  }

  private toTitle(): void {
    this.screen = 'title';
    this.freePlay = false;
    this.sound.setBoost(0);
    this.particles.clear();
    this.shell.showTitle(this.run.best, this.sound.muted, this.controls.padConnected);
    this.syncHudVisibility();
  }

  // --- effects -----------------------------------------------------------

  /** Exhaust plume behind a boosting car. */
  private emitBoostTrail(entry: CarEntry, dt: number): void {
    const count = Math.min(6, Math.max(2, Math.round(dt * 420)));
    const back = entry.car.forward(this.scratch).multiplyScalar(-1);
    const p = entry.car.position;
    const v = entry.car.velocity;
    const exhaust = cfg.car.hitbox.length * 0.6;
    for (let i = 0; i < count; i++) {
      this.particles.emit({
        position: {
          x: p.x + back.x * exhaust,
          y: p.y + back.y * exhaust + 4,
          z: p.z + back.z * exhaust,
        },
        // Thrown backwards, but carrying some of the car's own speed so the
        // plume streams behind rather than hanging where it was made.
        velocity: {
          x: back.x * 520 + v.x * 0.3,
          y: back.y * 520 + v.y * 0.3,
          z: back.z * 520 + v.z * 0.3,
        },
        colour: entry.bot ? TRAIL_COLOUR_ORANGE : TRAIL_COLOUR_BLUE,
        size: 55,
        life: 0.42,
        spread: 90,
        drag: 2.0,
      });
    }
  }

  /** Sounds that track state rather than events. */
  private updateContinuousAudio(): void {
    const car = this.player.car;
    const live = this.screen === 'playing';
    const boosting = live && car.input.boost && car.boost > 0;
    this.sound.setBoost(boosting ? 0.5 + 0.5 * Math.min(1, car.speed / cfg.car.maxSpeed) : 0);

    if (live && car.isSupersonic && !this.wasSupersonic) this.sound.supersonic();
    this.wasSupersonic = car.isSupersonic;

    // One beep per number of the countdown.
    if (live && !this.freePlay && this.match.phase === 'countdown') {
      const n = Math.ceil(this.match.countdownRemaining);
      if (n !== this.lastCountdownBeep) {
        this.lastCountdownBeep = n;
        this.sound.countdown(n);
      }
    } else {
      this.lastCountdownBeep = -1;
    }
  }

  /** Takes the nth offered upgrade. Exposed for the console and for tests. */
  pickUpgrade(index: number): void {
    this.run.choose(index);
  }

  /** Re-reads every tunable that is cached rather than read per step. */
  private syncConfig(): void {
    this.ball.syncConfig();
    for (const entry of this.entries) entry.car.syncConfig();
    this.carBall.syncConfig();
  }

  /**
   * Starts a fresh run from round one. Bound to R.
   *
   * Pass a seed to make the modifier picks repeatable, which is the only way to
   * chase a bug that only shows up in one round's particular combination.
   */
  restartRun(seed?: number): void {
    if (seed !== undefined) {
      this.runSeed = seed;
      this.run = this.makeRun();
    }
    this.runHud.showBest(this.run.best);
    this.run.start();
  }

  private makeRun(): Run {
    const handlers = {
      onRoundStart: (spec: RoundSpec) => this.applyRound(spec),
      onRoundCleared: (spec: RoundSpec, _stats: unknown, offer: readonly Upgrade[]) =>
        this.runHud.offerUpgrades(spec, offer),
      onUpgradeTaken: (_upgrade: Upgrade, owned: readonly Upgrade[]) =>
        this.runHud.showOwned(owned),
      onRunOver: (summary: RunSummary) => {
        // The record may have just changed, so refresh the line that shows it.
        this.runHud.showBest(this.run.best);
        this.screen = 'summary';
        this.shell.showSummary(summary, this.run.upgrades, this.run.best);
        this.syncHudVisibility();
      },
    };
    if (this.runSeed === null) return new Run(handlers);
    let s = this.runSeed >>> 0;
    return new Run(handlers, () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    });
  }

  /** Kept for the console and for scripted checks. */
  resetPlay(): void {
    this.restartRun();
  }

  /**
   * Advances the simulation by a fixed amount and draws one frame, without
   * waiting on requestAnimationFrame. Used for scripted verification and for
   * stepping through a situation while tuning.
   */
  advance(seconds: number, input?: Partial<CarInput>): void {
    const dt = cfg.physics.fixedDt;
    const steps = Math.max(1, Math.round(seconds / dt));
    // Goes through the real fixed step, so this cannot drift from normal play.
    this.inputOverride = input ?? null;
    try {
      for (let i = 0; i < steps; i++) this.fixedStep(dt);
    } finally {
      this.inputOverride = null;
    }
    // The real render path, so stepping the game cannot drift from playing it.
    // Keeping a second cut-down version of this is how the boost trail, the
    // hotkeys and the match update each went missing from scripted checks in
    // turn; there is now only one.
    this.renderFrame(seconds, 1);
  }

  /** Live view for the console and for scripted checks. */
  get debug(): {
    readonly car: Car;
    readonly cars: readonly Car[];
    readonly bots: readonly Bot[];
    readonly ball: Ball;
    readonly arena: Arena;
    readonly pads: BoostPads;
    readonly phys: PhysicsWorld;
    readonly match: Match;
    readonly run: Run;
    readonly overrides: ConfigOverrides;
    readonly runOverrides: ConfigOverrides;
    readonly screen: Screen;
    readonly freePlay: boolean;
    readonly controls: Controls;
  } {
    // Getters rather than a snapshot: the match is replaced on every restart,
    // and a held reference to the old one silently reports stale state.
    const game = this;
    return {
      get car() {
        return game.player.car;
      },
      get cars() {
        return game.entries.map((e) => e.car);
      },
      get bots() {
        return game.entries.flatMap((e) => (e.bot ? [e.bot] : []));
      },
      get ball() {
        return game.ball;
      },
      get arena() {
        return game.arena;
      },
      get pads() {
        return game.pads;
      },
      get phys() {
        return game.phys;
      },
      get match() {
        return game.match;
      },
      get run() {
        return game.run;
      },
      get overrides() {
        return game.roundOverrides;
      },
      get runOverrides() {
        return game.runOverrides;
      },
      get screen() {
        return game.screen;
      },
      get freePlay() {
        return game.freePlay;
      },
      get controls() {
        return game.controls;
      },
    };
  }
}
