import { Simulation } from '../sim/simulation';
import { Run } from '../state/run';
import { needsArenaRebuild } from '../state/modifiers';
import { ConfigOverrides } from '../state/configOverride';
import { applyUpgrades } from '../state/upgrades';
import { resetModifiers } from '../physics/car';
import type { RoundSpec } from '../state/round';
import { emptyInput, type CarInput } from '../input/types';
import type {
  BodyState,
  RoundMessage,
  RunMessage,
  ServerMessage,
  SnapshotMessage,
} from './protocol';

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
  /** Taken from the simulation, so both ends cannot disagree about the rate. */
  readonly stepSeconds: number;
  private readonly clients = new Map<number, ClientHandle>();
  private readonly inputs = new Map<number, CarInput>();
  private nextId = 1;
  private tick = 0;

  /** The gauntlet. The server owns it, so nobody can disagree about the round. */
  readonly run: Run;
  private readonly roundOverrides = new ConfigOverrides();
  private readonly runOverrides = new ConfigOverrides();
  private spec: RoundSpec | null = null;
  private rebuiltArena = false;
  /** Set when the round changed, so the next broadcast carries it. */
  private pendingRound: RoundMessage | null = null;
  private runDirty = true;

  constructor(private readonly options: ServerOptions = {}) {
    const random = options.random ?? Math.random;
    this.sim = new Simulation(random);
    this.stepSeconds = this.sim.stepSeconds;

    // One car per seat, created up front: a car appearing mid-match would have
    // to be announced, and there is no message for that yet.
    const seats = options.maxClients ?? 2;
    for (let i = 0; i < seats; i++) this.sim.addCar(0, i, null);
    this.seats = seats;

    this.run = new Run(
      {
        onRoundStart: (spec) => this.applyRound(spec),
        onRunOver: () => {
          this.runDirty = true;
        },
      },
      random,
    );
    this.run.start();
  }

  private readonly seats: number;

  /**
   * Sets the world up for a round: modifiers, upgrades, arena, opposition.
   *
   * The same sequence the single-player game runs, for the same reason — each
   * layer has to be unwound in the reverse of the order it went on, or a round
   * inherits whatever the last one left behind.
   */
  private applyRound(spec: RoundSpec): void {
    this.spec = spec;
    this.runOverrides.revert();
    this.roundOverrides.revert();
    for (const mod of spec.modifiers) mod.apply(this.roundOverrides);

    // Upgrades rebuild from standard every round rather than compounding, and
    // in a shared run they apply to every human car rather than to one.
    for (let i = 0; i < this.seats; i++) {
      const seat = this.sim.cars[i];
      if (!seat) continue;
      resetModifiers(seat.car.mods);
      applyUpgrades(this.run.upgrades, { mods: seat.car.mods, overrides: this.runOverrides });
    }

    const rebuild = needsArenaRebuild(spec.modifiers) || this.rebuiltArena;
    if (rebuild) {
      this.sim.rebuildArena();
      this.rebuiltArena = needsArenaRebuild(spec.modifiers);
    }

    this.sim.setOpponents(spec.lineup.slice(0, this.options.botOpponents ?? spec.lineup.length));
    this.sim.syncConfig();
    this.sim.startMatch(spec.rules, {
      onKickoff: () => this.sim.resetKickoff(),
      onEnd: (result) => this.run.finishRound(result, this.sim.match.playedSeconds),
    });
    this.sim.resetKickoff();

    this.pendingRound = this.roundMessage(rebuild);
    this.runDirty = true;
  }

  /** The round message, once, for whoever has not had it. */
  takeRoundMessage(): RoundMessage | null {
    const message = this.pendingRound;
    this.pendingRound = null;
    return message;
  }

  /** The round message again, for a client that just joined. */
  currentRound(): RoundMessage | null {
    return this.spec ? this.roundMessage(this.rebuiltArena) : null;
  }

  private roundMessage(rebuild: boolean): RoundMessage {
    const spec = this.spec!;
    return {
      type: 'round',
      index: spec.index,
      label: spec.label,
      isBoss: spec.isBoss,
      // The numbers in force, not the names they came from.
      config: { ...this.roundOverrides.effective(), ...this.runOverrides.effective() },
      rebuildArena: rebuild,
      modifierIds: spec.modifiers.map((m) => m.id),
      bossId: spec.boss?.id ?? null,
      rules: spec.rules,
      opponents: spec.lineup.length,
      tier: spec.tier,
    };
  }

  /** Run state, when it has changed since it was last asked for. */
  takeRunMessage(): RunMessage | null {
    if (!this.runDirty) return null;
    this.runDirty = false;
    return this.runState();
  }

  runState(): RunMessage {
    return {
      type: 'run',
      phase: this.run.phase,
      round: this.run.round,
      roundsCleared: this.run.stats.roundsCleared,
      offer: this.run.offer.map((u) => u.id),
      taken: this.run.upgrades.map((u) => u.id),
      goalsFor: this.run.stats.goalsFor,
      goalsAgainst: this.run.stats.goalsAgainst,
      chooser: this.run.phase === 'between' ? this.hostId() : null,
    };
  }

  /**
   * Who picks an upgrade.
   *
   * The lowest client id still connected — whoever has been here longest. In a
   * shared run somebody has to choose, and picking the host is the only rule
   * that needs no negotiation and cannot deadlock when someone leaves.
   */
  private hostId(): number | null {
    const ids = [...this.clients.keys()].sort((a, b) => a - b);
    return ids[0] ?? null;
  }

  /** Takes an offered upgrade, if this client is the one allowed to. */
  choose(id: number, index: number): void {
    if (id !== this.hostId()) return;
    if (this.run.phase !== 'between') return;
    this.run.choose(index);
    this.runDirty = true;
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
      cars: this.sim.cars.map((c) => bodyState(c.car.body)),
      ball: bodyState(this.sim.ball.body),
      clock: this.sim.match.clock,
      score: [...this.sim.match.score] as [number, number],
      phase: this.sim.match.phase,
    };
  }

  clientIds(): number[] {
    return [...this.clients.keys()];
  }
}

/** Snapshots a tenth as often as the simulation steps; clients interpolate. */
export const SNAPSHOT_HZ = 30;

function bodyState(body: {
  translation(): { x: number; y: number; z: number };
  rotation(): { x: number; y: number; z: number; w: number };
  linvel(): { x: number; y: number; z: number };
  angvel(): { x: number; y: number; z: number };
}): BodyState {
  const p = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  // Rounded on the way out. At a tenth of a unit the difference is far below
  // anything visible on a car 120 long, and it takes a third off the JSON.
  const round = (n: number): number => Math.round(n * 10) / 10;
  const fine = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    p: [round(p.x), round(p.y), round(p.z)],
    r: [fine(r.x), fine(r.y), fine(r.z), fine(r.w)],
    v: [round(v.x), round(v.y), round(v.z)],
    w: [fine(w.x), fine(w.y), fine(w.z)],
  };
}
