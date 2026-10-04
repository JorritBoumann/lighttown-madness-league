import * as THREE from 'three';
import { cfg } from './config';
import { initPhysics, PhysicsWorld } from './physics/world';
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
import { TweakPanel } from './ui/tweakPanel';

/**
 * Stage 1 slice: arena, one car, the ball, the camera and the tuning loop.
 * Match flow, AI and the gauntlet hang off this later.
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
  private readonly panel: TweakPanel;
  private readonly loop: Loop;

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

  /** Kickoff spot for the player: the middle one at the -x end. */
  private spawn(): { pos: { x: number; y: number; z: number }; yaw: number } {
    const spot = kickoffSpawns(-1)[4]!;
    return {
      pos: { x: spot.x, z: spot.z, y: cfg.car.hitbox.height / 2 + cfg.car.rideHeight },
      yaw: spot.yaw,
    };
  }

  private fixedStep(dt: number): void {
    this.time += dt;

    this.carInterp.record(this.car.position, this.car.body.rotation());
    this.ballInterp.record(this.ball.position, this.ball.body.rotation());

    this.car.input = this.keyboard.read();
    this.car.update(dt);
    this.ball.update();
    this.pads.update(dt, [this.car]);

    this.phys.step();
    this.drainContactEvents();
  }

  /** Car-on-ball touches get the speed-dependent bounce on top of the contact. */
  private drainContactEvents(): void {
    const ballHandle = this.ball.collider.handle;
    const carHandle = this.car.collider.handle;
    this.phys.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const pair =
        (h1 === ballHandle && h2 === carHandle) || (h2 === ballHandle && h1 === carHandle);
      if (pair) this.carBall.apply(this.car, this.ball);
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
    this.keyboard.endFrame();

    this.render.renderer.render(this.render.scene, this.render.camera);
  }

  private handleHotkeys(): void {
    if (this.keyboard.wasPressed('KeyT')) this.chase.toggleBallCam();
    if (this.keyboard.wasPressed('KeyP')) this.panel.toggle();
    if (this.keyboard.wasPressed('KeyR')) this.resetPlay();
    if (this.keyboard.wasPressed('KeyB')) this.ball.reset();
  }

  /** Re-reads every tunable that is cached rather than read per step. */
  private syncConfig(): void {
    this.ball.syncConfig();
    this.car.syncConfig();
    this.carBall.syncConfig();
  }

  /** Kick-off state: car on its line, ball in the middle, pads back up. */
  resetPlay(): void {
    const start = this.spawn();
    this.car.reset(start.pos, start.yaw);
    this.ball.reset();
    this.pads.resetAll();
    this.carInterp.snap(this.car.position, this.car.body.rotation());
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());
    this.chase.snapTo(this.car.position, this.car.forward());
  }

  /**
   * Advances the simulation by a fixed amount and draws one frame, without
   * waiting on requestAnimationFrame. Used for scripted verification and for
   * stepping through a situation while tuning.
   */
  advance(seconds: number, input?: Partial<CarInput>): void {
    const dt = cfg.physics.fixedDt;
    const steps = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) {
      this.time += dt;
      this.carInterp.record(this.car.position, this.car.body.rotation());
      this.ballInterp.record(this.ball.position, this.ball.body.rotation());
      this.car.input = input ? { ...emptyInput(), ...input } : this.keyboard.read();
      this.car.update(dt);
      this.ball.update();
      this.pads.update(dt, [this.car]);
      this.phys.step();
      this.drainContactEvents();
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
    car: Car;
    ball: Ball;
    arena: Arena;
    pads: BoostPads;
    phys: PhysicsWorld;
  } {
    return { car: this.car, ball: this.ball, arena: this.arena, pads: this.pads, phys: this.phys };
  }
}
