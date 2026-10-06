import type { Simulation } from '../sim/simulation';
import type { CarInput } from '../input/types';
import {
  decodeServer,
  encode,
  type BodyState,
  type GoalMessage,
  type RoundMessage,
  type RunMessage,
  type ServerMessage,
  type SnapshotMessage,
} from '../server/protocol';

/**
 * The client half: talk to the server, and hide the distance to it.
 *
 * The naive version of this is to draw whatever the last snapshot said. It is
 * also unplayable: at 30 snapshots a second over any real connection your own
 * car answers the wheel a tenth of a second late, which in a game about
 * touching a moving ball is the difference between a sport and a slideshow.
 *
 * So the client runs the same simulation the server does. Every input is
 * applied locally at once and kept; when a snapshot arrives, the world is set
 * back to what the server confirmed and the inputs it had not yet seen are
 * replayed on top. If the server agreed with the prediction, that replay lands
 * where the car already was and nothing moves. If it disagreed — a bump, a
 * dropped packet — the car arrives at the server's answer, having been
 * controllable the whole time.
 *
 * This is why `Simulation` had to be free of the renderer. The same code runs
 * on both ends, so a prediction and the authority it is checked against cannot
 * disagree about the rules.
 */

/** Two seconds of input at the simulation rate. */
const MAX_UNACKED = 240;

export interface PendingInput {
  seq: number;
  input: CarInput;
}

export interface ClientStats {
  /** Snapshots applied. */
  snapshots: number;
  /** Steps replayed on the most recent correction. */
  lastReplay: number;
  /** How far the prediction was out, in world units, on the last correction. */
  lastError: number;
  /** Inputs sent but not yet acknowledged. */
  pending: number;
}

export class NetClient {
  /**
   * How many cars the server last described.
   *
   * The client does not decide this. The server already knows how many cars
   * exist, so anything the client assumes about it is a thing it can get wrong.
   */
  get snapshotCarCount(): number {
    return this.lastCarCount;
  }

  /** Each car's team as the server last described them, by index. */
  get snapshotTeams(): readonly (0 | 1)[] {
    return this.lastTeams;
  }

  /** Which car in the snapshot is ours. Null until the server says. */
  carIndex: number | null = null;
  readonly stats: ClientStats = { snapshots: 0, lastReplay: 0, lastError: 0, pending: 0 };

  private socket: WebSocket | null = null;
  private seq = 0;
  private readonly unacked: PendingInput[] = [];
  private latest: SnapshotMessage | null = null;
  private lastCarCount = 0;
  private lastTeams: (0 | 1)[] = [];
  private lastClock = 0;
  private lastScore: [number, number] = [0, 0];
  private lastPhase = 'countdown';
  /** The round in force, and the run around it. Null until the server says. */
  round: RoundMessage | null = null;
  run: RunMessage | null = null;
  /** Fired when a new round arrives, so the client can rebuild to match. */
  onRound: ((round: RoundMessage) => void) | null = null;
  /** Fired when the run's state changes, so the client can mirror it. */
  onRun: ((run: RunMessage) => void) | null = null;
  /** This client's id on the server, which the run's chooser is named by. */
  clientId: number | null = null;
  /** The room this client is in, once the server has said. */
  room: string | null = null;
  /** Whether the server records this room, which the player is shown. */
  recording = false;
  /** The server turned the connection away, with its reason as a close code. */
  onRefused: ((code: number) => void) | null = null;
  /** The connection went after the match had started. */
  onDropped: (() => void) | null = null;
  /** Fired the moment the server counts a goal, and when it resets a kickoff. */
  onGoal: ((goal: GoalMessage) => void) | null = null;
  onKickoff: (() => void) | null = null;
  private connected = false;

  constructor(readonly url: string) {}

  get isConnected(): boolean {
    return this.connected && this.carIndex !== null;
  }

  connect(onReady?: () => void): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.connected = true;
    };
    socket.onclose = (event: CloseEvent) => {
      const wasIn = this.carIndex !== null;
      this.connected = false;
      this.carIndex = null;
      // Refused and dropped are different things to tell a person. A refusal
      // comes before any welcome and carries a reason the server chose; a drop
      // comes after one, mid-match, and usually means the network.
      if (wasIn) this.onDropped?.();
      else this.onRefused?.(event.code);
    };
    socket.onmessage = (event: MessageEvent) => {
      const message = decodeServer(String(event.data));
      if (message) this.ingest(message, onReady);
    };
  }

  /** Match clock and score from the last snapshot, for the read-out. */
  get clock(): number {
    return this.lastClock;
  }
  get score(): [number, number] {
    return this.lastScore;
  }
  get phase(): string {
    return this.lastPhase;
  }

  /** Takes an offered upgrade. The server ignores it unless we are the host. */
  choose(index: number): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encode({ type: 'choose', index }));
    }
  }

  /**
   * Takes a server message, whether it came from a socket or a test.
   *
   * Separated for the reason the server's own core has no socket in it: the
   * interesting half is the prediction, and prediction you can only exercise
   * over a real connection is prediction you will not exercise.
   */
  ingest(message: ServerMessage, onReady?: () => void): void {
    if (message.type === 'welcome') {
      this.carIndex = message.carIndex;
      this.room = message.room;
      this.clientId = message.clientId;
      this.recording = message.recording === true;
      onReady?.();
      return;
    }
    if (message.type === 'round') {
      this.round = message;
      this.onRound?.(message);
      return;
    }
    if (message.type === 'run') {
      this.run = message;
      this.onRun?.(message);
      return;
    }
    if (message.type === 'goal') {
      this.onGoal?.(message);
      return;
    }
    if (message.type === 'kickoff') {
      this.onKickoff?.();
      return;
    }
    this.latest = message;
    this.lastCarCount = message.cars.length;
    this.lastTeams = message.teams;
    this.lastClock = message.clock;
    this.lastScore = message.score;
    this.lastPhase = message.phase;
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }

  /**
   * Sends an input and records it, so it can be replayed after a correction.
   *
   * Called once per simulation step rather than once per frame: the replay has
   * to re-run exactly the steps the server has not seen, and a history kept at
   * a different rate from the simulation cannot do that.
   */
  send(input: CarInput): PendingInput {
    const pending = { seq: ++this.seq, input: { ...input } };
    this.unacked.push(pending);
    // Capped, because nothing else bounds it. If the server stops
    // acknowledging — it went away, or this tab was backgrounded long enough
    // for the socket to stall — this list otherwise grows for as long as the
    // page is open, and every reconcile replays all of it. Two seconds of
    // inputs is far more than any correction legitimately needs, and dropping
    // the oldest is right: they are the ones the server is least likely to
    // still be waiting for.
    while (this.unacked.length > MAX_UNACKED) this.unacked.shift();
    this.stats.pending = this.unacked.length;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encode({ type: 'input', seq: pending.seq, input }));
    }
    return pending;
  }

  /**
   * Folds in whatever the server last said, and replays what it had not seen.
   *
   * Returns true when a snapshot was applied, so the caller knows the world
   * moved underneath it.
   */
  reconcile(sim: Simulation): boolean {
    const snapshot = this.latest;
    if (!snapshot || this.carIndex === null) return false;
    this.latest = null;
    this.stats.snapshots++;

    // How far out the prediction was, measured before anything is overwritten.
    const ours = snapshot.cars[this.carIndex];
    const car = sim.cars[this.carIndex];
    if (ours && car) {
      const p = car.car.position;
      this.stats.lastError = Math.hypot(p.x - ours.p[0], p.y - ours.p[1], p.z - ours.p[2]);
    }

    for (let i = 0; i < snapshot.cars.length && i < sim.cars.length; i++) {
      applyBody(sim.cars[i]!.car.body, snapshot.cars[i]!);
    }
    applyBody(sim.ball.body, snapshot.ball);

    // Everything the server has already accounted for can go.
    while (this.unacked.length > 0 && this.unacked[0]!.seq <= snapshot.ack) {
      this.unacked.shift();
    }
    this.stats.pending = this.unacked.length;

    // Replay the rest. Only our own car is driven; the others stay where the
    // server put them, because we have no idea what they are about to do and
    // guessing is worse than being a frame behind.
    const inputs = new Map<number, CarInput>();
    for (const pending of this.unacked) {
      inputs.set(this.carIndex, pending.input);
      sim.step(sim.stepSeconds, {
        driving: true,
        frozen: false,
        // The server owns the clock. Running it here too would make the HUD
        // count down at twice the rate on the client.
        clock: false,
        inputs,
      });
    }
    this.stats.lastReplay = this.unacked.length;
    return true;
  }
}

function applyBody(
  body: {
    setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void;
    setRotation(q: { x: number; y: number; z: number; w: number }, wake: boolean): void;
    setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
    setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  },
  state: BodyState,
): void {
  body.setTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] }, true);
  body.setRotation({ x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] }, true);
  body.setLinvel({ x: state.v[0], y: state.v[1], z: state.v[2] }, true);
  body.setAngvel({ x: state.w[0], y: state.w[1], z: state.w[2] }, true);
}
