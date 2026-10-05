import * as THREE from 'three';
import { createRenderer, buildArenaMesh, type Renderer } from '../render/scene';
import { buildStadium } from '../render/stadium';
import { createCarMesh, createBallMesh } from '../render/entities';
import { ChaseCamera } from '../render/chaseCamera';
import { TransformInterpolator } from '../core/interpolate';
import { buildArenaLayout } from '../core/arenaLayout';
import { initPhysics } from '../physics/world';
import { Simulation } from '../sim/simulation';
import { Loop } from '../core/loop';
import { Controls } from '../input/controls';
import { NetClient } from './client';
import { cfg } from '../config';

/**
 * A networked client.
 *
 * Deliberately not the single-player `Game`. That one owns a run, upgrades,
 * round modifiers and a replay system, and every one of those is a decision the
 * server would have to own instead. Rather than thread a second authority
 * through all of it, this is the smallest thing that proves the protocol: the
 * same renderer, the same simulation, the same car — driven over a socket.
 */

const TEAM_COLOUR = [0x4fc3f7, 0xff7043] as const;

export class NetGame {
  private readonly sim: Simulation;
  private readonly net: NetClient;
  private readonly render: Renderer;
  private readonly chase: ChaseCamera;
  private readonly controls = new Controls();
  private readonly loop: Loop;
  private readonly carMeshes: THREE.Group[] = [];
  private readonly carInterp: TransformInterpolator[] = [];
  private readonly ballMesh: THREE.Mesh;
  private readonly ballInterp: TransformInterpolator;
  private readonly status: HTMLElement;

  private constructor(canvas: HTMLCanvasElement, status: HTMLElement, url: string) {
    this.status = status;
    this.sim = new Simulation();
    this.net = new NetClient(url);

    this.render = createRenderer(canvas);
    this.render.scene.add(buildArenaMesh());
    this.render.scene.add(buildStadium(buildArenaLayout()).group);
    this.ballMesh = createBallMesh();
    this.render.scene.add(this.ballMesh);
    this.ballInterp = new TransformInterpolator(this.ballMesh);
    this.chase = new ChaseCamera(this.render.camera);

    this.loop = new Loop(
      { fixed: (dt) => this.fixedStep(dt), render: (dt, alpha) => this.renderFrame(dt, alpha) },
      () => cfg.physics.fixedDt,
      () => cfg.physics.maxStepsPerFrame,
    );
  }

  static async create(canvas: HTMLCanvasElement, status: HTMLElement, url: string): Promise<NetGame> {
    await initPhysics();
    const game = new NetGame(canvas, status, url);
    game.net.connect(() => game.onWelcome());
    return game;
  }

  start(): void {
    this.loop.start();
  }

  /**
   * The server said which car is ours. The number of cars is not negotiated —
   * it comes from the first snapshot, because the server already knows and
   * anything the client assumes here it can get wrong.
   */
  private onWelcome(): void {
    this.say('connected, waiting for the first snapshot');
  }

  /** Builds local cars to match the count the server is sending. */
  private matchCarCount(count: number): void {
    while (this.sim.cars.length < count) {
      const index = this.sim.cars.length;
      const sim = this.sim.addCar(index === this.net.carIndex ? 0 : 1, index, null);
      const mesh = createCarMesh(TEAM_COLOUR[sim.car.team]);
      this.render.scene.add(mesh);
      const interp = new TransformInterpolator(mesh);
      interp.snap(sim.car.position, sim.car.body.rotation());
      this.carMeshes.push(mesh);
      this.carInterp.push(interp);
    }
  }

  private fixedStep(dt: number): void {
    if (!this.net.isConnected) return;

    for (let i = 0; i < this.sim.cars.length; i++) {
      this.carInterp[i]?.record(this.sim.cars[i]!.car.position, this.sim.cars[i]!.car.body.rotation());
    }
    this.ballInterp.record(this.sim.ball.position, this.sim.ball.body.rotation());

    // Applied locally the instant it is read, and sent at the same moment. The
    // car answers the wheel now; the server's opinion arrives later and is
    // folded in below.
    const input = this.controls.read();
    const pending = this.net.send(input);
    const index = this.net.carIndex ?? 0;
    if (this.sim.cars.length > index) {
      const inputs = new Map([[index, pending.input]]);
      this.sim.step(dt, { driving: true, frozen: false, clock: false, inputs });
    }

    this.net.reconcile(this.sim);
    this.controls.endFrame();
  }

  private renderFrame(dt: number, alpha: number): void {
    const pendingCars = this.net.snapshotCarCount;
    if (pendingCars > this.sim.cars.length) this.matchCarCount(pendingCars);

    for (const interp of this.carInterp) interp.apply(alpha);
    this.ballInterp.apply(alpha);

    const index = this.net.carIndex;
    if (index !== null && this.sim.cars.length > index) {
      const car = this.sim.cars[index]!.car;
      this.chase.update(dt, car.position, car.velocity, car.fwd, this.sim.ball.position, {
        grounded: car.grounded,
        normal: car.groundNormal,
      });
      this.say(
        `car ${index} · ${Math.round(car.speed)} uu/s · ` +
          `${this.net.stats.pending} unacked · ` +
          `replayed ${this.net.stats.lastReplay} · ` +
          `off by ${this.net.stats.lastError.toFixed(1)} uu`,
      );
    }
    this.render.draw();
  }

  private say(text: string): void {
    this.status.textContent = text;
  }
}
