import type { Simulation, StepEvents } from '../sim/simulation';
import type { CarInput } from '../input/types';
import type { RoundSpec } from '../state/round';
import type { RunMessage } from './protocol';

/**
 * A room's match, written down: every car's controls at every step, the world
 * at a fixed rate, and what happened.
 *
 * For research. What makes a multiplayer game useful as data is that each
 * player's actions are known exactly, at the moment they were taken, in one
 * shared world -- and a server-authoritative game has all of that already,
 * because it is what the server runs on. Footage of a game has to infer the
 * actions back out of the pictures, and loses most of it; this never has them
 * as anything but numbers. And because the world's state is kept, any view of
 * it -- each player's camera, or one nobody had -- can be drawn afterwards.
 *
 * One JSON object per line, gzipped by whoever stores it. Every line has `t`,
 * its type, and `k`, the simulation tick it belongs to. Types:
 *
 * - `header`  once, first: format version, room, start time, step length
 * - `round`   each round: index, label, modifiers, rules, opposition, and the
 *             hidden blind side, which the players were not told
 * - `join` / `leave`  a client taking or leaving a car
 * - `in`      every step: each car's controls, people and bots alike
 * - `state`   every `stateEvery` steps: every body, the match clock and score
 * - `touch`   a car touching the ball, `goal`, `kickoff`
 * - `run`     the gauntlet's state, when it changes: phase, upgrades, score
 * - `end`     last, if the room closed cleanly
 *
 * Nothing about the people is kept: no address, no name, no device -- a
 * client is a number that is only unique within its room.
 */

export const RECORDING_VERSION = 1;

export type RecordingSink = (line: string) => void;

/**
 * Controls as [throttle, steer, pitch, roll, buttons]. No yaw: in the air the
 * steer turns the car, as on the ground.
 */
export type PackedInput = [number, number, number, number, number];

/** Button bits in a packed input. */
export const BUTTON = { jumpPressed: 1, jumpHeld: 2, boost: 4, drift: 8 } as const;

export function packInput(i: CarInput): PackedInput {
  const r = (n: number): number => Math.round(n * 1000) / 1000;
  const buttons =
    (i.jumpPressed ? BUTTON.jumpPressed : 0) |
    (i.jumpHeld ? BUTTON.jumpHeld : 0) |
    (i.boost ? BUTTON.boost : 0) |
    (i.drift ? BUTTON.drift : 0);
  return [r(i.throttle), r(i.steer), r(i.pitch), r(i.roll), buttons];
}

export class Recorder {
  private closed = false;

  constructor(
    private readonly sink: RecordingSink,
    /** Steps between state lines: 4 is 30 a second at 120Hz. */
    private readonly stateEvery = 4,
    /** Called once after the last line, so the store can close the file. */
    private readonly onClose: (() => void) | null = null,
  ) {}

  private line(object: Record<string, unknown>): void {
    if (this.closed) return;
    this.sink(JSON.stringify(object));
  }

  header(info: { room: string; stepSeconds: number; seats: number }): void {
    this.line({
      t: 'header',
      k: 0,
      v: RECORDING_VERSION,
      room: info.room,
      startedAt: new Date().toISOString(),
      stepSeconds: info.stepSeconds,
      stateEvery: this.stateEvery,
      seats: info.seats,
      // What a packed input and a packed body mean, so the file explains
      // itself to whoever opens it without this source to hand.
      input: ['throttle', 'steer', 'pitch', 'roll', 'buttons'],
      buttons: BUTTON,
      body: ['px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz'],
      car: ['...body', 'boost', 'grounded'],
      axes: 'x along the pitch (team 0 attacks +x), y up, z across (+z is the attacker’s right)',
    });
  }

  round(tick: number, spec: RoundSpec, sim: Simulation): void {
    this.line({
      t: 'round',
      k: tick,
      index: spec.index,
      label: spec.label,
      boss: spec.boss?.id ?? null,
      modifiers: spec.modifiers.map((m) => m.id),
      rules: spec.rules,
      lineup: spec.lineup,
      blindSide: spec.blindSide,
      cars: sim.cars.map((c) => ({ team: c.car.team, bot: c.bot ? c.bot.tier.level : null })),
    });
  }

  join(tick: number, client: number, car: number): void {
    this.line({ t: 'join', k: tick, client, car });
  }

  leave(tick: number, client: number, car: number): void {
    this.line({ t: 'leave', k: tick, client, car });
  }

  /** After a simulation step: the controls it ran on, and what it did. */
  step(tick: number, sim: Simulation, events: StepEvents): void {
    this.line({ t: 'in', k: tick, i: sim.cars.map((c) => packInput(c.car.input)) });
    for (const touch of events.ballTouches) {
      const car = sim.cars.indexOf(touch.by);
      const p = sim.ball.position;
      const v = sim.ball.velocity;
      this.line({
        t: 'touch',
        k: tick,
        car,
        closing: r1(touch.closing),
        p: [r1(p.x), r1(p.y), r1(p.z)],
        v: [r1(v.x), r1(v.y), r1(v.z)],
      });
    }
    if (tick % this.stateEvery === 0) this.state(tick, sim);
  }

  private state(tick: number, sim: Simulation): void {
    const m = sim.match;
    this.line({
      t: 'state',
      k: tick,
      c: sim.cars.map((c) => [...packBody(c.car.body), Math.round(c.car.boost), c.car.grounded ? 1 : 0]),
      b: packBody(sim.ball.body),
      clock: Math.round(m.clock * 1000) / 1000,
      score: [m.score[0], m.score[1]],
      phase: m.phase,
    });
  }

  goal(tick: number, team: 0 | 1, ownGoal: boolean, score: readonly number[], sim: Simulation): void {
    const p = sim.ball.position;
    this.line({ t: 'goal', k: tick, team, own: ownGoal, score: [...score], p: [r1(p.x), r1(p.y), r1(p.z)] });
  }

  kickoff(tick: number): void {
    this.line({ t: 'kickoff', k: tick });
  }

  run(tick: number, run: RunMessage): void {
    const { type: _type, ...rest } = run;
    this.line({ t: 'run', k: tick, ...rest });
  }

  close(tick: number): void {
    if (this.closed) return;
    this.line({ t: 'end', k: tick, endedAt: new Date().toISOString() });
    this.closed = true;
    this.onClose?.();
  }
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function packBody(body: {
  translation(): { x: number; y: number; z: number };
  rotation(): { x: number; y: number; z: number; w: number };
  linvel(): { x: number; y: number; z: number };
  angvel(): { x: number; y: number; z: number };
}): number[] {
  const p = body.translation();
  const q = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  const f = (n: number): number => Math.round(n * 10000) / 10000;
  return [r1(p.x), r1(p.y), r1(p.z), f(q.x), f(q.y), f(q.z), f(q.w), r1(v.x), r1(v.y), r1(v.z), f(w.x), f(w.y), f(w.z)];
}
