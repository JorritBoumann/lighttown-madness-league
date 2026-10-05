import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { GameServer } from '../src/server/gameServer';
import { NetClient } from '../src/net/client';
import { emptyInput, type CarInput } from '../src/input/types';

/**
 * Client-side prediction, with no socket in sight.
 *
 * A server and a client, both real, wired to each other by hand so a test can
 * decide exactly how stale the snapshots are. Latency is the whole subject
 * here, so being able to dial it is the point.
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

/** A server, a client, and a client-side simulation set up the same way. */
function pair(): { server: GameServer; client: NetClient; sim: Simulation; id: number } {
  const server = new GameServer({ maxClients: 1, botOpponents: 0, random: () => 0.5 });
  const joined = server.join()!;
  const client = new NetClient('ws://unused');
  client.ingest(joined.welcome);

  // The client's own world, started where the server's is.
  const sim = new Simulation(() => 0.5);
  sim.addCar(0, 0, null);
  sim.startMatch(server.sim.match.rules, {});
  sim.resetKickoff();
  return { server, client, sim, id: joined.handle.id };
}

describe('prediction', () => {
  it('moves the car on the client before the server has answered', () => {
    const { client, sim } = pair();
    const start = sim.player.car.position.x;

    // Input applied locally, nothing from the server yet.
    for (let i = 0; i < 60; i++) {
      const pending = client.send(drive());
      const inputs = new Map([[0, pending.input]]);
      sim.step(sim.stepSeconds, { driving: true, frozen: false, clock: false, inputs });
    }
    // Half a second of driving has happened on screen with no snapshot at all.
    expect(sim.player.car.position.x - start).toBeGreaterThan(50);
    expect(client.stats.pending).toBe(60);
  });

  it('converges on the server when the server agrees', () => {
    const { server, client, sim, id } = pair();

    // Run both ends on the same inputs, then reconcile.
    for (let i = 0; i < 120; i++) {
      const pending = client.send(drive());
      server.onInput(id, pending.seq, pending.input);
      server.step();
      const inputs = new Map([[0, pending.input]]);
      sim.step(sim.stepSeconds, { driving: true, frozen: false, clock: false, inputs });
    }
    client.ingest(server.snapshotFor(id));
    expect(client.reconcile(sim)).toBe(true);

    // Both ran the same code on the same inputs, so the correction is small.
    expect(client.stats.lastError).toBeLessThan(5);
  });

  it('replays only the inputs the server had not seen', () => {
    const { server, client, sim, id } = pair();

    // Twenty inputs reach the server; ten more are still in flight.
    for (let i = 0; i < 20; i++) {
      const pending = client.send(drive());
      server.onInput(id, pending.seq, pending.input);
      server.step();
    }
    const snapshot = server.snapshotFor(id);
    for (let i = 0; i < 10; i++) client.send(drive());

    client.ingest(snapshot);
    client.reconcile(sim);
    expect(client.stats.lastReplay).toBe(10);
    expect(client.stats.pending).toBe(10);
  });

  it('pulls the car to the server when they disagree', () => {
    const { server, client, sim, id } = pair();

    // The client drives; the server never hears about it. The server's car
    // stays on its line, so the snapshot should drag the client's back.
    for (let i = 0; i < 120; i++) {
      client.send(drive());
      const inputs = new Map([[0, drive()]]);
      sim.step(sim.stepSeconds, { driving: true, frozen: false, clock: false, inputs });
      server.step();
    }
    const drifted = sim.player.car.position.x;
    client.ingest(server.snapshotFor(id));
    client.reconcile(sim);

    // It disagreed badly, and the car ended up nearer the server's answer.
    expect(client.stats.lastError).toBeGreaterThan(100);
    const serverX = server.sim.player.car.position.x;
    expect(Math.abs(sim.player.car.position.x - serverX)).toBeLessThan(
      Math.abs(drifted - serverX),
    );
  });

  it('does not run the match clock on the client', () => {
    // The server owns the clock. A client that also ticked it would count down
    // at twice the rate for every input it replayed.
    const { server, client, sim, id } = pair();
    const before = sim.match.clock;
    for (let i = 0; i < 30; i++) client.send(drive());
    client.ingest(server.snapshotFor(id));
    client.reconcile(sim);
    expect(sim.match.clock).toBe(before);
  });
});
