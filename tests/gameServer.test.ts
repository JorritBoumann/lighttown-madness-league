import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics } from '../src/physics/world';
import { GameServer } from '../src/server/gameServer';
import { decodeClient } from '../src/server/protocol';
import { emptyInput, type CarInput } from '../src/input/types';

/**
 * The server, with no socket attached.
 *
 * Sockets are a transport detail, so the authoritative part is testable without
 * opening a port — which is the whole reason `GameServer` does not know what a
 * WebSocket is.
 */

beforeAll(async () => {
  await initPhysics();
});

const drive = (over: Partial<CarInput> = {}): CarInput => ({
  ...emptyInput(),
  throttle: 1,
  boost: true,
  ...over,
});

describe('seats', () => {
  it('gives each client its own car, and refuses when full', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 0, random: () => 0.5 });
    const a = server.join();
    const b = server.join();
    expect(a!.handle.carIndex).toBe(0);
    expect(b!.handle.carIndex).toBe(1);
    expect(server.join()).toBeNull();
  });

  it('frees a seat when a client leaves, and reuses it', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 0, random: () => 0.5 });
    const a = server.join()!;
    server.join();
    server.leave(a.handle.id);
    expect(server.join()!.handle.carIndex).toBe(0);
  });
});

describe('authority', () => {
  it('moves a car only for the client that owns it', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 0, random: () => 0.5 });
    const a = server.join()!;
    server.join();

    // Taken from a snapshot rather than assumed: the two seats are different
    // kickoff spots, so hard-coding one car's spawn describes the other wrongly.
    const start = server.snapshotFor(a.handle.id).cars.map((c) => [...c.p]);

    server.onInput(a.handle.id, 1, drive());
    for (let i = 0; i < 240; i++) server.step();

    const snap = server.snapshotFor(a.handle.id);
    const shift = (i: number): number =>
      Math.hypot(snap.cars[i]!.p[0] - start[i]![0]!, snap.cars[i]!.p[2] - start[i]![2]!);

    // The driven car has left its spot; the idle one has not.
    expect(shift(0)).toBeGreaterThan(500);
    expect(shift(1)).toBeLessThan(50);
  });

  it('ignores input for a client that has left', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 0, random: () => 0.5 });
    const a = server.join()!;
    const before = server.snapshotFor(a.handle.id).cars[0]!.p;
    server.leave(a.handle.id);
    server.onInput(a.handle.id, 1, drive());
    for (let i = 0; i < 120; i++) server.step();
    const after = server.snapshotFor(a.handle.id).cars[0]!.p;
    expect(Math.abs(after[0] - before[0])).toBeLessThan(50);
  });

  it('drops a packet that arrives out of order', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 0, random: () => 0.5 });
    const a = server.join()!;
    server.onInput(a.handle.id, 5, drive());
    server.onInput(a.handle.id, 3, emptyInput());
    // The stale packet must not have replaced the newer one.
    expect(server.snapshotFor(a.handle.id).ack).toBe(5);
  });

  it('acknowledges the last input it consumed', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 0, random: () => 0.5 });
    const a = server.join()!;
    server.onInput(a.handle.id, 42, drive());
    server.step();
    expect(server.snapshotFor(a.handle.id).ack).toBe(42);
  });
});

describe('a client is not trusted', () => {
  it('clamps an input that is out of range', () => {
    const message = decodeClient(
      JSON.stringify({
        type: 'input',
        seq: 1,
        input: { throttle: 1e9, steer: -50, boost: 'yes', jumpPressed: 1 },
      }),
    );
    expect(message?.type).toBe('input');
    if (message?.type !== 'input') throw new Error('expected an input message');
    // Out-of-range axes are clamped, and anything that is not `true` is false:
    // without this, a client that sends throttle 1e9 gets a car nobody else can
    // have, which is the cheapest cheat there is.
    expect(message!.input.throttle).toBe(1);
    expect(message!.input.steer).toBe(-1);
    expect(message!.input.boost).toBe(false);
    expect(message!.input.jumpPressed).toBe(false);
  });

  it('refuses nonsense rather than throwing', () => {
    expect(decodeClient('not json')).toBeNull();
    expect(decodeClient('{"type":"teleport","x":99999}')).toBeNull();
    expect(decodeClient('null')).toBeNull();
    expect(decodeClient('{"type":"input","seq":"soon","input":{}}')).toBeNull();
  });

  it('has no message a client could use to assert a position', () => {
    // The protocol's shape is the guarantee: the only thing a client can send
    // is input. There is no position field to spoof.
    const message = decodeClient(
      JSON.stringify({ type: 'input', seq: 1, input: { throttle: 1 }, p: [9999, 0, 0] }),
    );
    expect(Object.keys(message!)).toEqual(['type', 'seq', 'input']);
  });
});

describe('snapshots', () => {
  it('describes every car and the ball', () => {
    const server = new GameServer({ maxClients: 2, botOpponents: 1, random: () => 0.5 });
    const a = server.join()!;
    server.step();
    const snap = server.snapshotFor(a.handle.id);
    expect(snap.cars).toHaveLength(3); // two seats plus the bot
    expect(snap.ball.p).toHaveLength(3);
    expect(snap.ball.r).toHaveLength(4);
    expect(snap.score).toEqual([0, 0]);
  });

  it('advances its tick with the simulation', () => {
    const server = new GameServer({ maxClients: 1, botOpponents: 0, random: () => 0.5 });
    const a = server.join()!;
    const before = server.snapshotFor(a.handle.id).tick;
    for (let i = 0; i < 10; i++) server.step();
    expect(server.snapshotFor(a.handle.id).tick).toBe(before + 10);
  });
});
