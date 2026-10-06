import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics } from '../src/physics/world';
import { RoomRegistry, generateCode, normaliseCode, CODE_LENGTH } from '../src/server/rooms';

/**
 * Rooms and their codes.
 *
 * A code is read off one screen and typed into another, often by somebody
 * else, so most of what matters here is that a code survives being passed
 * between people.
 */

beforeAll(async () => {
  await initPhysics();
});

describe('codes', () => {
  it('never uses a character that looks like another', () => {
    // 0/O and 1/I/L are the pairs people misread. A code containing one fails
    // for a reason nobody can see.
    let all = '';
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) all += generateCode(random);
    for (const bad of ['0', 'O', '1', 'I', 'L']) expect(all).not.toContain(bad);
    expect(generateCode(random)).toHaveLength(CODE_LENGTH);
  });

  it('accepts a code however it is typed', () => {
    expect(normaliseCode('abcd')).toBe('ABCD');
    expect(normaliseCode(' ab cd ')).toBe('ABCD');
    expect(normaliseCode('Q7R2')).toBe('Q7R2');
  });

  it('refuses rather than guesses', () => {
    // Correcting an O to a 0 would be guessing, and there is no 0 to mean.
    expect(normaliseCode('ABC')).toBeNull();
    expect(normaliseCode('ABCDE')).toBeNull();
    expect(normaliseCode('AB0D')).toBeNull();
    expect(normaliseCode('ABOD')).toBeNull();
    expect(normaliseCode('AB-D')).toBeNull();
  });
});

describe('the registry', () => {
  it('gives every room its own code and its own match', () => {
    const registry = new RoomRegistry();
    const a = registry.create()!;
    const b = registry.create()!;
    expect(a.code).not.toBe(b.code);
    // Separate simulations: a car in one room is not a car in the other.
    expect(a.game.sim).not.toBe(b.game.sim);
  });

  it('finds a room by the code as a person would type it', () => {
    const registry = new RoomRegistry();
    const room = registry.create()!;
    expect(registry.get(room.code.toLowerCase())).toBe(room);
    expect(registry.get('ZZZZ')).toBeNull();
    expect(registry.get('nonsense')).toBeNull();
  });

  it('tells a client which room it joined', () => {
    const registry = new RoomRegistry();
    const room = registry.create()!;
    const joined = room.game.join()!;
    expect(joined.welcome.type).toBe('welcome');
    if (joined.welcome.type === 'welcome') expect(joined.welcome.room).toBe(room.code);
  });

  it('keeps rooms apart', () => {
    // Driving in one room must not move anything in another.
    const registry = new RoomRegistry({ room: { botOpponents: 0 } });
    const a = registry.create()!;
    const b = registry.create()!;
    const ja = a.game.join()!;
    b.game.join();
    const before = { ...b.game.sim.cars[0]!.car.position };
    a.game.onInput(ja.handle.id, 1, {
      throttle: 1, steer: 0, pitch: 0, roll: 0,
      jumpPressed: false, jumpHeld: false, boost: true, drift: false,
    });
    for (let i = 0; i < 480; i++) {
      a.game.step();
      b.game.step();
    }
    const after = b.game.sim.cars[0]!.car.position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(5);
  });

  it('refuses new rooms past its cap', () => {
    const registry = new RoomRegistry({ maxRooms: 2 });
    expect(registry.create()).not.toBeNull();
    expect(registry.create()).not.toBeNull();
    expect(registry.create()).toBeNull();
  });
});

describe('empty rooms', () => {
  it('keeps an empty room for a while, so a dropped player can come back', () => {
    const registry = new RoomRegistry({ idleTimeout: 60 });
    const room = registry.create()!;
    expect(registry.sweep(30)).toEqual([]);
    expect(registry.get(room.code)).toBe(room);
  });

  it('throws an abandoned room away, and frees its world', () => {
    const registry = new RoomRegistry({ idleTimeout: 60 });
    const room = registry.create()!;
    let freed = false;
    const free = room.game.sim.phys.free.bind(room.game.sim.phys);
    room.game.sim.phys.free = () => {
      freed = true;
      free();
    };
    expect(registry.sweep(61)).toEqual([room.code]);
    expect(registry.get(room.code)).toBeNull();
    // Without this the WebAssembly world leaks: the collector cannot see it.
    expect(freed).toBe(true);
  });

  it('does not age a room someone is in', () => {
    const registry = new RoomRegistry({ idleTimeout: 60 });
    const room = registry.create()!;
    room.game.join();
    expect(registry.sweep(500)).toEqual([]);
  });

  it('restarts the clock when someone comes back', () => {
    const registry = new RoomRegistry({ idleTimeout: 60 });
    const room = registry.create()!;
    registry.sweep(50);
    const joined = room.game.join()!;
    registry.sweep(1);
    room.game.leave(joined.handle.id);
    // 50 earlier seconds must not count against it now it is empty again.
    expect(registry.sweep(30)).toEqual([]);
  });
});
