import * as THREE from 'three';
import { cfg } from './config';
import { initPhysics, PhysicsWorld, type RAPIER } from './physics/world';
import { createArena, destroyArena, type Arena } from './physics/arena';
import { kickoffSpawns, type Spawn } from './core/arenaLayout';
import { Ball } from './physics/ball';
import { Car } from './physics/car';
import { BoostPads } from './physics/boostPads';
import { CarBallInteraction } from './physics/carBall';
import { Keyboard } from './input/keyboard';
import { emptyInput, type CarInput } from './input/types';
import { Bot } from './ai/bot';
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
import type { RoundSpec } from './state/round';
import { ConfigOverrides } from './state/configOverride';
import { needsArenaRebuild } from './state/modifiers';
import { RunHud } from './ui/runHud';

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

  private readonly keyboard: Keyboard;
  private readonly hud: Hud;
  private readonly matchHud: MatchHud;
  private readonly runHud: RunHud;
  private readonly panel: TweakPanel;
  private readonly loop: Loop;

  private match!: Match;
  private run: Run;
  /** Set to make a run's modifier picks repeatable; see restartRun. */
  private runSeed: number | null = null;
  private readonly overrides = new ConfigOverrides();
  /** Counts down the pause after a cleared round. */
  private betweenTimer = 0;
  /** Stands in for the keyboard while `advance()` drives the game. */
  private inputOverride: Partial<CarInput> | null = null;
  private time = 0;

  private constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
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
    this.render.scene.add(this.ballMesh, this.padVisuals.group);
    this.ballInterp = new TransformInterpolator(this.ballMesh);
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());

    this.addCar(0, 0, null);

    this.keyboard = new Keyboard();
    this.hud = new Hud(ui);
    this.matchHud = new MatchHud(ui);
    this.runHud = new RunHud(ui);
    this.panel = new TweakPanel(ui);
    this.panel.onChange(() => this.syncConfig());

    this.run = this.makeRun();
    this.runHud.showBest(this.run.best);
    this.run.start();
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
  private addCar(team: 0 | 1, slot: number, botLevel: number | null): CarEntry {
    const spawn = this.spawnFor(team, slot);
    const car = new Car(this.phys, this.spawnPosition(spawn), spawn.yaw, team);
    const mesh = createCarMesh(TEAM_COLOUR[team]);
    this.render.scene.add(mesh);

    const entry: CarEntry = {
      car,
      mesh,
      interp: new TransformInterpolator(mesh),
      flame: mesh.getObjectByName('flame') as THREE.Mesh,
      bot: botLevel === null ? null : new Bot(car, botLevel),
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
    this.overrides.revert();
    for (const mod of spec.modifiers) mod.apply(this.overrides);

    // Goal dimensions are baked into colliders and meshes, so those modifiers
    // need the arena rebuilt rather than a value written.
    if (needsArenaRebuild(spec.modifiers) || this.rebuiltArena) {
      this.rebuildArena();
      this.rebuiltArena = needsArenaRebuild(spec.modifiers);
    }

    this.setOpponents(spec.opponents, spec.tier);
    this.syncConfig();

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

  /** Adds or removes bot cars so the count matches, and sets their tier. */
  private setOpponents(count: number, tier: number): void {
    const bots = this.entries.filter((e) => e.bot !== null);
    for (let i = bots.length; i < count; i++) this.addCar(1, i, tier);
    for (let i = bots.length; i > count; i--) {
      const entry = this.entries.pop();
      if (!entry) break;
      this.byCollider.delete(entry.car.collider.handle);
      this.render.scene.remove(entry.mesh);
      entry.car.destroy();
    }
    for (const entry of this.entries) entry.bot?.setLevel(tier);
  }

  private onGoal(event: GoalEvent): void {
    this.matchHud.goal(event);
  }

  private onMatchEnd(result: MatchResult): void {
    // No match-level win/lose banner: in a gauntlet the run card says what
    // happened ("Round cleared", "Run over"), and both at once collide.
    this.run.finishRound(result, this.match.playedSeconds);
    // A cleared round holds briefly before the next one starts. Step 5 puts the
    // upgrade pick here instead of a timer.
    if (this.run.phase === 'between') this.betweenTimer = cfg.match.betweenRounds;
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
    const driving = phase === 'playing' && this.run.phase === 'round';

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
          : this.keyboard.read();
      }
    }
    if (!driving && !this.inputOverride) {
      // Keeps the jump latch from banking a press for after the countdown.
      this.keyboard.read();
    }

    if (phase === 'countdown' || phase === 'ended' || this.run.phase !== 'round') {
      for (const entry of this.entries) this.freeze(entry.car.body);
      this.freeze(this.ball.body);
    }

    const cars: Car[] = [];
    for (const entry of this.entries) {
      entry.car.update(dt);
      cars.push(entry.car);
    }
    this.ball.update();
    if (driving) this.pads.update(dt, cars);

    this.phys.step();
    this.drainContactEvents();

    this.match.update(dt, { position: this.ball.position, radius: cfg.ball.radius });

    if (this.betweenTimer > 0) {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) {
        this.betweenTimer = 0;
        this.run.advance();
      }
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
    });
  }

  /** Holds a body still, for the countdown and after full time. */
  private freeze(body: RAPIER.RigidBody): void {
    const zero = { x: 0, y: 0, z: 0 };
    body.setLinvel(zero, false);
    body.setAngvel(zero, false);
  }

  // --- rendering ---------------------------------------------------------

  private renderFrame(dt: number, alpha: number): void {
    for (const entry of this.entries) {
      entry.interp.apply(alpha);
      const boosting = entry.car.input.boost && entry.car.boost > 0;
      entry.flame.visible = boosting;
      if (boosting) entry.flame.scale.setScalar(0.8 + Math.random() * 0.4);
    }
    this.ballInterp.apply(alpha);
    this.padVisuals.sync(this.pads.pads, this.time);

    const player = this.player;
    this.chase.update(
      dt,
      player.mesh.position,
      player.car.velocity,
      player.car.forward(),
      this.ballMesh.position,
    );

    this.handleHotkeys();
    this.hud.update(player.car, this.chase.ballCam);
    this.matchHud.update(this.match, dt);
    this.runHud.update(this.run, dt);
    this.keyboard.endFrame();

    this.render.renderer.render(this.render.scene, this.render.camera);
  }

  private handleHotkeys(): void {
    if (this.keyboard.wasPressed('KeyT')) this.chase.toggleBallCam();
    if (this.keyboard.wasPressed('KeyP')) this.panel.toggle();
    if (this.keyboard.wasPressed('KeyR')) this.restartRun();
    if (this.keyboard.wasPressed('KeyB')) this.ball.reset();
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
    this.betweenTimer = 0;
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
      onRoundCleared: (spec: RoundSpec) => this.runHud.roundCleared(spec),
      onRunOver: (summary: RunSummary) => {
        this.runHud.runOver(summary);
        // The record may have just changed, so refresh the line that shows it.
        this.runHud.showBest(this.run.best);
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
    this.drawOnly(seconds);
  }

  /** Renders the current state without advancing physics. */
  private drawOnly(dt: number): void {
    for (const entry of this.entries) {
      entry.interp.apply(1);
      entry.flame.visible = entry.car.input.boost && entry.car.boost > 0;
    }
    this.ballInterp.apply(1);
    this.padVisuals.sync(this.pads.pads, this.time);
    const player = this.player;
    this.chase.update(
      dt,
      player.mesh.position,
      player.car.velocity,
      player.car.forward(),
      this.ballMesh.position,
    );
    this.hud.update(player.car, this.chase.ballCam);
    this.matchHud.update(this.match, dt);
    this.render.renderer.render(this.render.scene, this.render.camera);
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
        return game.overrides;
      },
    };
  }
}
