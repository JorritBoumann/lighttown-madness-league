import { Simulation } from '../sim/simulation';
import { buildRound } from '../state/round';
import { emptyInput, type CarInput } from '../input/types';
import { cfg } from '../config';
import type { BodyState, ServerMessage, SnapshotMessage } from './protocol';

/**
 * The authoritative game, with no transport attached.
 *
 * Sockets are deliberately absent: this takes clients joining, inputs arriving
 * and time passing, and produces messages to send. That makes the whole server
 * testable without opening a port, and it means swapping WebSockets for
 * anything else touches one file that is not this one.
 *
 * Authoritative in the real sense — a client's input is the only thing it is
 * allowed to contribute. It never sends a position, so it cannot claim one.
 */

export interface ClientHandle {
  id: number;
  /** Which car in the simulation this client drives. */
  carIndex: number;
  /** Highest input sequence consumed for this client. */
  ack: number;
  pending: CarInput;
}

export interface ServerOptions {
  /** Opponent bots to fill the pitch with. 0 for a purely human match. */
  botOpponents?: number;
  /** How many human players to make room for. */
  maxClients?: number;
  /** Seeded for reproducibility; defaults to Math.random. */
  random?: () => number;
}

export class GameServer {
  readonly sim: Simulation;
  readonly stepSeconds = cfg.physics.fixedDt;
  private readonly clients = new Map<number, ClientHandle>();
  private readonly inputs = new Map<number, CarInput>();
  private nextId = 1;
  private tick = 0;

  constructor(private readonly options: ServerOptions = {}) {
    const random = options.random ?? Math.random;
    this.sim = new Simulation(random);

    // One car per seat, created up front: a car appearing mid-match would have
    // to be announced, and there is no message for that yet.
    const seats = options.maxClients ?? 2;
    for (let i = 0; i < seats; i++) this.sim.addCar(0, i, null);

    const spec = buildRound(1, random);
    const lineup = spec.lineup.slice(0, options.botOpponents ?? 0);
    this.sim.setOpponents(lineup);
    this.sim.startMatch(spec.rules, { onKickoff: () => this.sim.resetKickoff() });
    this.sim.resetKickoff();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Returns null when every seat is taken. */
  join(): { handle: ClientHandle; welcome: ServerMessage } | null {
    const seats = this.options.maxClients ?? 2;
    const taken = new Set([...this.clients.values()].map((c) => c.carIndex));
    let carIndex = -1;
    for (let i = 0; i < seats; i++) {
      if (!taken.has(i)) {
        carIndex = i;
        break;
      }
    }
    if (carIndex < 0) return null;

    const handle: ClientHandle = {
      id: this.nextId++,
      carIndex,
      ack: 0,
      pending: emptyInput(),
    };
    this.clients.set(handle.id, handle);
    return {
      handle,
      welcome: {
        type: 'welcome',
        carIndex,
        stepSeconds: this.stepSeconds,
        snapshotHz: SNAPSHOT_HZ,
      },
    };
  }

  leave(id: number): void {
    const handle = this.clients.get(id);
    if (!handle) return;
    this.clients.delete(id);
    // The car stays where it is and simply stops being driven, which is the
    // least surprising thing for everyone still playing.
    this.inputs.set(handle.carIndex, emptyInput());
  }

  /** Latest input wins. A late packet for an older sequence is dropped. */
  onInput(id: number, seq: number, input: CarInput): void {
    const handle = this.clients.get(id);
    if (!handle) return;
    if (seq <= handle.ack) return;
    handle.ack = seq;
    handle.pending = input;
  }

  /** One authoritative step. */
  step(): void {
    for (const handle of this.clients.values()) {
      this.inputs.set(handle.carIndex, handle.pending);
      // Jump is a one-shot: left latched it would fire every step until the
      // next packet, which at 60 inputs a second against 120 steps is every
      // other one.
      handle.pending = { ...handle.pending, jumpPressed: false };
    }
    this.sim.step(this.stepSeconds, {
      driving: true,
      frozen: false,
      clock: true,
      inputs: this.inputs,
    });
    this.tick++;
  }

  /** The state to send one client. Identical but for the acknowledgement. */
  snapshotFor(id: number): SnapshotMessage {
    const handle = this.clients.get(id);
    return {
      type: 'snapshot',
      tick: this.tick,
      ack: handle?.ack ?? 0,
      cars: this.sim.cars.map((c) => bodyState(c.car.position, c.car.body.rotation())),
      ball: bodyState(this.sim.ball.position, this.sim.ball.body.rotation()),
      clock: this.sim.match.clock,
      score: [...this.sim.match.score] as [number, number],
    };
  }

  clientIds(): number[] {
    return [...this.clients.keys()];
  }
}

/** Snapshots a tenth as often as the simulation steps; clients interpolate. */
export const SNAPSHOT_HZ = 30;

function bodyState(
  p: { x: number; y: number; z: number },
  r: { x: number; y: number; z: number; w: number },
): BodyState {
  // Rounded on the way out. At a tenth of a unit the difference is far below
  // anything visible on a car 120 long, and it takes a third off the JSON.
  const round = (n: number): number => Math.round(n * 10) / 10;
  const fine = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    p: [round(p.x), round(p.y), round(p.z)],
    r: [fine(r.x), fine(r.y), fine(r.z), fine(r.w)],
  };
}
