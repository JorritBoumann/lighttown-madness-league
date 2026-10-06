import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { initPhysics } from '../src/physics/world';
import { GameServer } from '../src/server/gameServer';
import { BUTTON, packInput, Recorder } from '../src/server/recorder';
import { RecordingStore } from '../src/server/recordingStore';
import { emptyInput } from '../src/input/types';

/**
 * Recording: a room's match written down completely enough to be studied, and
 * nothing written that should not be.
 */

beforeAll(async () => {
  await initPhysics();
});

type Line = Record<string, unknown> & { t: string; k: number };

function recordedServer(): { server: GameServer; lines: Line[] } {
  const lines: Line[] = [];
  const recorder = new Recorder((line) => lines.push(JSON.parse(line) as Line));
  const server = new GameServer({ code: 'TEST', recorder, random: () => 0.3 });
  return { server, lines };
}

describe('packing', () => {
  it('keeps the axes to a thousandth and the buttons as bits', () => {
    const packed = packInput({
      ...emptyInput(),
      throttle: 0.12345,
      steer: -1,
      boost: true,
      jumpHeld: true,
    });
    expect(packed).toEqual([0.123, -1, 0, 0, BUTTON.boost | BUTTON.jumpHeld]);
  });
});

describe('a recorded room', () => {
  it('starts with a header that explains the file, then the round', () => {
    const { server, lines } = recordedServer();
    expect(lines[0]!.t).toBe('header');
    expect(lines[0]!.room).toBe('TEST');
    expect(lines[0]!.input).toEqual(['throttle', 'steer', 'pitch', 'roll', 'buttons']);
    const round = lines.find((l) => l.t === 'round')!;
    expect(round.index).toBe(1);
    // The hidden part is in the record, because the record is where it is
    // needed: the analysis has to know which side was weak.
    expect(round.blindSide).toEqual(server.run.blindSide);
    server.dispose();
  });

  it('writes every step’s controls while someone is there, and the world 30 times a second', () => {
    const { server, lines } = recordedServer();
    const joined = server.join()!;
    const welcome = joined.welcome as { recording?: boolean };
    expect(welcome.recording).toBe(true);

    server.onInput(joined.handle.id, 1, { ...emptyInput(), throttle: 1, boost: true });
    for (let i = 0; i < 120; i++) server.step();

    const inputs = lines.filter((l) => l.t === 'in');
    const states = lines.filter((l) => l.t === 'state');
    expect(inputs).toHaveLength(120);
    expect(states).toHaveLength(30);
    // The person's car, as they drove it; the bots' cars beside it.
    const first = inputs[0]!.i as number[][];
    expect(first[joined.handle.carIndex]).toEqual([1, 0, 0, 0, BUTTON.boost]);
    expect(first.length).toBe(server.sim.cars.length);
    // A state line carries every car and the ball.
    const state = states[0]!;
    expect((state.c as number[][]).length).toBe(server.sim.cars.length);
    expect((state.c as number[][])[0]!.length).toBe(15);
    expect((state.b as number[]).length).toBe(13);
    expect(lines.some((l) => l.t === 'join' && l.client === joined.handle.id)).toBe(true);
    server.dispose();
  });

  it('writes nothing per step while the room is empty', () => {
    const { server, lines } = recordedServer();
    for (let i = 0; i < 60; i++) server.step();
    expect(lines.filter((l) => l.t === 'in' || l.t === 'state')).toHaveLength(0);
    server.dispose();
  });

  it('ends with a leave and an end line, and nothing after', () => {
    const { server, lines } = recordedServer();
    const joined = server.join()!;
    for (let i = 0; i < 8; i++) server.step();
    server.leave(joined.handle.id);
    server.dispose();
    expect(lines.some((l) => l.t === 'leave')).toBe(true);
    expect(lines[lines.length - 1]!.t).toBe('end');
  });

  it('keeps nothing about who anyone is', () => {
    const { server, lines } = recordedServer();
    server.join();
    for (let i = 0; i < 8; i++) server.step();
    server.dispose();
    const text = JSON.stringify(lines);
    expect(text).not.toMatch(/origin|address|agent|ip\b|name/i);
  });

  it('says nothing about recording when it is not', () => {
    const server = new GameServer({ code: 'NONE' });
    const welcome = server.join()!.welcome as { recording?: boolean };
    expect(welcome.recording).toBe(false);
    server.dispose();
  });
});

describe('the store', () => {
  it('writes a gzipped file per room that reads back line by line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 50e6);
    const server = new GameServer({ code: 'ABCD', recorder: store.recorderFor('ABCD') });
    server.join();
    for (let i = 0; i < 40; i++) server.step();
    server.dispose();
    await store.settled();

    const [day] = readdirSync(dir);
    const [file] = readdirSync(join(dir, day!));
    expect(file).toMatch(/ABCD\.ndjson\.gz$/);
    const text = gunzipSync(readFileSync(join(dir, day!, file!))).toString();
    const lines = text.trim().split('\n').map((l) => JSON.parse(l) as Line);
    expect(lines[0]!.t).toBe('header');
    expect(lines[lines.length - 1]!.t).toBe('end');
    expect(lines.filter((l) => l.t === 'in')).toHaveLength(40);
    rmSync(dir, { recursive: true, force: true });
  });

  it('stops starting recordings once the folder is full', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-full-'));
    writeFileSync(join(dir, 'old.ndjson.gz'), Buffer.alloc(2000));
    const store = new RecordingStore(dir, 1000);
    expect(store.recorderFor('FULL')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
