import * as THREE from 'three';
import { cfg } from './config';
import { initPhysics, PhysicsWorld, type RAPIER } from './physics/world';
import { createArena, type Arena } from './physics/arena';
import { kickoffSpawns, type Spawn } from './core/arenaLayout';
import { Ball } from './physics/ball';
import { Car } from './physics/car';
import { BoostPads } from './physics/boostPads';
import { CarBallInteraction } from './physics/carBall';
import { Keyboard } from './input/keyboard';
import { emptyInput, type CarInput } from './input/types';
import { Bot } from './ai/bot';
import { createRenderer, type Renderer } from './render/scene';
import { createCarMesh, createBallMesh, createBoostPadVisuals, type PadVisuals } from './render/entities';
import { ChaseCamera } from './render/chaseCamera';
import { TransformInterpolator } from './core/interpolate';
import { Loop } from './core/loop';
import { Hud } from './ui/hud';
import { MatchHud } from './ui/matchHud';
import { TweakPanel } from './ui/tweakPanel';
import { Match, type GoalEvent, type MatchResult } from './state/match';

/**
 * Wires the systems together: physics, rendering, input, AI, match flow.
 *
 * Stage 3: a match against bots. The gauntlet's rounds and upgrades hang off
 * this next, and will drive the match rules and bot tiers per round rather than
 * reading the config defaults.
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
  private readonly arena: Arena;
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
  private readonly panel: TweakPanel;
  private readonly loop: Loop;

  private match!: Match;
  /** Stands in for the keyboard while `advance()` drives the game. */
  private inputOverride: Partial<CarInput> | null = null;
  private time = 0;

  private constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.phys = new PhysicsWorld();
    this.arena = createArena(this.phys);
    this.ball = new Ball(this.phys);
    this.pads = new BoostPads();

    this.render = createRenderer(canvas);
    this.chase = new ChaseCamera(this.render.camera);
    this.ballMesh = createBallMesh();
    this.padVisuals = createBoostPadVisuals(this.pads.pads);
    this.render.scene.add(this.ballMesh, this.padVisuals.group);
    this.ballInterp = new TransformInterpolator(this.ballMesh);
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());

    this.addCar(0, 0, null);
    for (let i = 0; i < cfg.match.opponents; i++) {
      this.addCar(1, i, cfg.match.opponentTier);
    }

    this.keyboard = new Keyboard();
    this.hud = new Hud(ui);
    this.matchHud = new MatchHud(ui);
    this.panel = new TweakPanel(ui);
    this.panel.onChange(() => this.syncConfig());

    this.startMatch();
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

  /** Starts a fresh match and puts everyone on the kickoff line. */
  private startMatch(): void {
    this.match = new Match(
      {},
      {
        onGoal: (e) => this.onGoal(e),
        onKickoff: () => this.setUpKickoff(),
        onEnd: (r) => this.onMatchEnd(r),
      },
    );
    this.matchHud.reset();
    this.setUpKickoff();
  }

  private onGoal(event: GoalEvent): void {
    this.matchHud.goal(event);
  }

  private onMatchEnd(result: MatchResult): void {
    this.matchHud.end(result);
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
    const driving = phase === 'playing';

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

    if (phase === 'countdown' || phase === 'ended') {
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
    this.keyboard.endFrame();

    this.render.renderer.render(this.render.scene, this.render.camera);
  }

  private handleHotkeys(): void {
    if (this.keyboard.wasPressed('KeyT')) this.chase.toggleBallCam();
    if (this.keyboard.wasPressed('KeyP')) this.panel.toggle();
    if (this.keyboard.wasPressed('KeyR')) this.startMatch();
    if (this.keyboard.wasPressed('KeyB')) this.ball.reset();
  }

  /** Re-reads every tunable that is cached rather than read per step. */
  private syncConfig(): void {
    this.ball.syncConfig();
    for (const entry of this.entries) entry.car.syncConfig();
    this.carBall.syncConfig();
  }

  /** Restarts the match from nothing. Bound to R. */
  resetPlay(): void {
    this.startMatch();
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
    };
  }
}
