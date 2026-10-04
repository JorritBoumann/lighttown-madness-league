import * as THREE from 'three';
import { cfg } from './config';
import { initPhysics, PhysicsWorld, type RAPIER } from './physics/world';
import { createArena, type Arena } from './physics/arena';
import { kickoffSpawns } from './core/arenaLayout';
import { Ball } from './physics/ball';
import { Car } from './physics/car';
import { BoostPads } from './physics/boostPads';
import { CarBallInteraction } from './physics/carBall';
import { Keyboard } from './input/keyboard';
import { emptyInput, type CarInput } from './input/types';
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
 * Wires the systems together: physics, rendering, input, match flow.
 *
 * Stage 2: one car, the ball, goals, a clock and a score. AI opponents and the
 * gauntlet hang off this next.
 */
export class Game {
  private readonly phys: PhysicsWorld;
  private readonly arena: Arena;
  private readonly ball: Ball;
  private readonly car: Car;
  private readonly pads: BoostPads;
  private readonly carBall = new CarBallInteraction();

  private readonly render: Renderer;
  private readonly chase: ChaseCamera;
  private readonly carMesh: THREE.Group;
  private readonly ballMesh: THREE.Mesh;
  private readonly padVisuals: PadVisuals;
  private readonly carInterp: TransformInterpolator;
  private readonly ballInterp: TransformInterpolator;
  private readonly flame: THREE.Mesh;

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
    const start = this.spawn();
    this.car = new Car(this.phys, start.pos, start.yaw);
    this.pads = new BoostPads();

    this.render = createRenderer(canvas);
    this.chase = new ChaseCamera(this.render.camera);
    this.carMesh = createCarMesh();
    this.ballMesh = createBallMesh();
    this.padVisuals = createBoostPadVisuals(this.pads.pads);
    this.render.scene.add(this.carMesh, this.ballMesh, this.padVisuals.group);
    this.flame = this.carMesh.getObjectByName('flame') as THREE.Mesh;

    this.carInterp = new TransformInterpolator(this.carMesh);
    this.ballInterp = new TransformInterpolator(this.ballMesh);
    this.carInterp.snap(this.car.position, this.car.body.rotation());
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());

    this.keyboard = new Keyboard();
    this.hud = new Hud(ui);
    this.matchHud = new MatchHud(ui);
    this.startMatch();
    this.panel = new TweakPanel(ui);
    this.panel.onChange(() => this.syncConfig());

    this.chase.snapTo(this.car.position, this.car.forward());

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

  /** Kickoff spot for the player: the middle one at their own end. */
  private spawn(): { pos: { x: number; y: number; z: number }; yaw: number } {
    const spot = kickoffSpawns(-1)[4]!;
    return {
      pos: { x: spot.x, z: spot.z, y: cfg.car.hitbox.height / 2 + cfg.car.rideHeight },
      yaw: spot.yaw,
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
    const start = this.spawn();
    this.car.reset(start.pos, start.yaw);
    this.ball.reset();
    this.pads.resetAll();
    this.carInterp.snap(this.car.position, this.car.body.rotation());
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());
    this.chase.snapTo(this.car.position, this.car.forward());
  }

  /** Holds a body still, for the countdown and after full time. */
  private freeze(body: RAPIER.RigidBody): void {
    const zero = { x: 0, y: 0, z: 0 };
    body.setLinvel(zero, false);
    body.setAngvel(zero, false);
  }

  private fixedStep(dt: number): void {
    this.time += dt;

    this.carInterp.record(this.car.position, this.car.body.rotation());
    this.ballInterp.record(this.ball.position, this.ball.body.rotation());

    const phase = this.match.phase;
    // Only 'playing' hands control over. The countdown holds everyone on their
    // line; after a goal the ball keeps rolling for show but nobody drives.
    const driving = phase === 'playing';
    if (driving) {
      this.car.input = this.inputOverride
        ? { ...emptyInput(), ...this.inputOverride }
        : this.keyboard.read();
    } else {
      this.car.input = emptyInput();
      // Reading anyway keeps the jump latch from banking a press for later.
      if (!this.inputOverride) this.keyboard.read();
    }

    if (phase === 'countdown' || phase === 'ended') {
      this.freeze(this.car.body);
      this.freeze(this.ball.body);
    }

    this.car.update(dt);
    this.ball.update();
    if (driving) this.pads.update(dt, [this.car]);

    this.phys.step();
    this.drainContactEvents();

    this.match.update(dt, { position: this.ball.position, radius: cfg.ball.radius });
  }

  /** Car-on-ball touches get the speed-dependent bounce on top of the contact. */
  private drainContactEvents(): void {
    const ballHandle = this.ball.collider.handle;
    const carHandle = this.car.collider.handle;
    this.phys.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const pair =
        (h1 === ballHandle && h2 === carHandle) || (h2 === ballHandle && h1 === carHandle);
      if (!pair) return;
      this.carBall.apply(this.car, this.ball);
      // Needed to tell an own goal from a goal.
      this.match.touch(this.car.team);
    });
  }

  private renderFrame(dt: number, alpha: number): void {
    this.carInterp.apply(alpha);
    this.ballInterp.apply(alpha);
    this.padVisuals.sync(this.pads.pads, this.time);

    const boosting = this.car.input.boost && this.car.boost > 0;
    this.flame.visible = boosting;
    if (boosting) {
      this.flame.scale.setScalar(0.8 + Math.random() * 0.4);
    }

    this.chase.update(
      dt,
      this.carMesh.position,
      this.car.velocity,
      this.car.forward(),
      this.ballMesh.position,
    );

    this.handleHotkeys();
    this.hud.update(this.car, this.chase.ballCam);
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
    this.car.syncConfig();
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
    this.carInterp.apply(1);
    this.ballInterp.apply(1);
    this.padVisuals.sync(this.pads.pads, this.time);
    this.flame.visible = this.car.input.boost && this.car.boost > 0;
    this.chase.update(
      dt,
      this.carMesh.position,
      this.car.velocity,
      this.car.forward(),
      this.ballMesh.position,
    );
    this.hud.update(this.car, this.chase.ballCam);
    this.render.renderer.render(this.render.scene, this.render.camera);
  }

  /** Exposed for debugging from the console and for tests. */
  get debug(): {
    readonly car: Car;
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
        return game.car;
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
