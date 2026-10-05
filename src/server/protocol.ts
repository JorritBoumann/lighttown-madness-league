import type { CarInput } from '../input/types';

/**
 * What the wire carries.
 *
 * Deliberately plain: a client sends the same `CarInput` the keyboard and the
 * bots already produce, and the server sends transforms. Nothing here knows
 * about Three.js or the DOM, and nothing in the simulation knows about this.
 */

/** Server's reply to a connection, before any state arrives. */
export interface WelcomeMessage {
  type: 'welcome';
  /** Which car in the snapshot is this client's. */
  carIndex: number;
  /** Fixed step the server runs at, so a client can predict at the same rate. */
  stepSeconds: number;
  /** Ticks per second the server sends snapshots at. */
  snapshotHz: number;
}

/**
 * One body's full state. Arrays rather than objects: smaller, and JSON-cheap.
 *
 * Velocity is in here because a client cannot predict without it. Replaying
 * your own unacknowledged inputs means re-running the simulation from the last
 * state the server confirmed, and a position with no velocity is not a state
 * you can run anything from — the car would start every correction from a dead
 * stop. It costs six numbers a body and it is the difference between prediction
 * working and not existing.
 */
export interface BodyState {
  /** x, y, z */
  p: [number, number, number];
  /** quaternion x, y, z, w */
  r: [number, number, number, number];
  /** linear velocity x, y, z */
  v: [number, number, number];
  /** angular velocity x, y, z */
  w: [number, number, number];
}

export interface SnapshotMessage {
  type: 'snapshot';
  /** Server tick this describes. */
  tick: number;
  /**
   * The last input sequence the server had consumed from *this* client.
   *
   * The hook client-side prediction hangs on: a client replays its unconsumed
   * inputs on top of the snapshot rather than snapping to it.
   */
  ack: number;
  cars: BodyState[];
  ball: BodyState;
  /** Match clock and score, so a client needs no second channel for the HUD. */
  clock: number;
  score: [number, number];
}

export type ServerMessage = WelcomeMessage | SnapshotMessage;

export interface InputMessage {
  type: 'input';
  /** Monotonic per client, so the server can acknowledge progress. */
  seq: number;
  input: CarInput;
}

export type ClientMessage = InputMessage;

export function encode(message: ServerMessage | ClientMessage): string {
  return JSON.stringify(message);
}

/**
 * The mirror of `decodeClient`, for the client reading the server.
 *
 * Less defensive on purpose: a client trusts the server it chose to connect to
 * in a way the server can never trust a client. This still refuses malformed
 * JSON, because a truncated frame is not an attack and should not throw inside
 * a socket handler.
 */
export function decodeServer(raw: string): ServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const m = parsed as { type?: unknown };
    if (m.type !== 'welcome' && m.type !== 'snapshot') return null;
    return parsed as ServerMessage;
  } catch {
    return null;
  }
}

/** Returns null rather than throwing: a peer can send anything at all. */
export function decodeClient(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const m = parsed as Record<string, unknown>;
    if (m.type !== 'input') return null;
    if (typeof m.seq !== 'number' || !Number.isFinite(m.seq)) return null;
    if (typeof m.input !== 'object' || m.input === null) return null;
    return { type: 'input', seq: m.seq, input: sanitise(m.input as Record<string, unknown>) };
  } catch {
    return null;
  }
}

/**
 * Forces a received input into range.
 *
 * A client is not trusted. Without this, one sending `throttle: 1e9` gets a car
 * that behaves differently from everyone else's — the cheapest possible cheat,
 * and it costs one function to close.
 */
function sanitise(raw: Record<string, unknown>): CarInput {
  const axis = (v: unknown): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(-1, Math.min(1, n));
  };
  const flag = (v: unknown): boolean => v === true;
  return {
    throttle: axis(raw.throttle),
    steer: axis(raw.steer),
    pitch: axis(raw.pitch),
    roll: axis(raw.roll),
    jumpPressed: flag(raw.jumpPressed),
    jumpHeld: flag(raw.jumpHeld),
    boost: flag(raw.boost),
    drift: flag(raw.drift),
  };
}
