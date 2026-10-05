import type { Simulation } from '../sim/simulation';
import type { CarInput } from '../input/types';
import {
  decodeServer,
  encode,
  type BodyState,
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

  /** Which car in the snapshot is ours. Null until the server says. */
  carIndex: number | null = null;
  readonly stats: ClientStats = { snapshots: 0, lastReplay: 0, lastError: 0, pending: 0 };

  private socket: WebSocket | null = null;
  private seq = 0;
  private readonly unacked: PendingInput[] = [];
  private latest: SnapshotMessage | null = null;
  private lastCarCount = 0;
  private connected = false;

  constructor(private readonly url: string) {}

  get isConnected(): boolean {
    return this.connected && this.carIndex !== null;
  }

  connect(onReady?: () => void): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.connected = true;
    };
    socket.onclose = () => {
      this.connected = false;
      this.carIndex = null;
    };
    socket.onmessage = (event: MessageEvent) => {
      const message = decodeServer(String(event.data));
      if (message) this.ingest(message, onReady);
    };
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
      onReady?.();
      return;
    }
    this.latest = message;
    this.lastCarCount = message.cars.length;
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
