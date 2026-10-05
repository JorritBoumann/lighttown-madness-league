// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Run, type RunSummary } from '../src/state/run';
import type { MatchResult, Team } from '../src/state/match';
import { loadBestRun, saveBestRun, clearBestRun, beats } from '../src/state/persistence';
import type { RoundSpec } from '../src/state/round';

/**
 * The run loop and the best-run record. Pure logic: no physics, no rendering.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A finished match. `winner` 0 is the player. */
function result(winner: Team | null, score: [number, number]): MatchResult {
  return { winner, score, overtime: false, reason: 'goal-target' };
}

const win = (score: [number, number] = [2, 0]) => result(0, score);
const loss = (score: [number, number] = [0, 2]) => result(1, score);

/** Clears a round and steps into the next one. */
function clearRound(run: Run, score: [number, number] = [2, 0], seconds = 60): void {
  run.finishRound(win(score), seconds);
  run.advance();
}

beforeEach(() => {
  localStorage.clear();
});

describe('progression', () => {
  it('starts at round one', () => {
    const run = new Run({}, seeded(1));
    run.start();
    expect(run.phase).toBe('round');
    expect(run.round).toBe(1);
  });

  it('advances a round at a time when each is cleared', () => {
    const run = new Run({}, seeded(1));
    run.start();
    for (let i = 1; i <= 5; i++) {
      expect(run.round).toBe(i);
      clearRound(run);
    }
    expect(run.round).toBe(6);
    expect(run.stats.roundsCleared).toBe(5);
  });

  it('holds between rounds rather than starting the next one itself', () => {
    const onRoundStart = vi.fn();
    const run = new Run({ onRoundStart }, seeded(1));
    run.start();
    expect(onRoundStart).toHaveBeenCalledTimes(1);

    run.finishRound(win(), 60);
    expect(run.phase).toBe('between');
    // Nothing starts until something asks for it: step 5 puts the upgrade
    // pick in this gap.
    expect(onRoundStart).toHaveBeenCalledTimes(1);

    run.advance();
    expect(run.phase).toBe('round');
    expect(onRoundStart).toHaveBeenCalledTimes(2);
  });

  it('escalates the rounds it hands out', () => {
    const specs: RoundSpec[] = [];
    const run = new Run({ onRoundStart: (s) => specs.push(s) }, seeded(7));
    run.start();
    for (let i = 0; i < 11; i++) clearRound(run);
    expect(specs).toHaveLength(12);
    expect(specs.at(-1)!.tier).toBeGreaterThan(specs[0]!.tier);
    expect(specs.at(-1)!.opponents).toBeGreaterThan(specs[0]!.opponents);
  });
});

describe('losing', () => {
  it('ends the run on a loss', () => {
    const onRunOver = vi.fn();
    const run = new Run({ onRunOver }, seeded(1));
    run.start();
    clearRound(run);
    run.finishRound(loss(), 45);
    expect(run.phase).toBe('over');
    expect(onRunOver).toHaveBeenCalledTimes(1);
    const summary = onRunOver.mock.calls[0]![0] as RunSummary;
    expect(summary.lost).toBe(true);
    expect(summary.reachedRound).toBe(2);
    expect(summary.roundsCleared).toBe(1);
  });

  it('resets progress to nothing when a new run starts', () => {
    const run = new Run({}, seeded(1));
    run.start();
    for (let i = 0; i < 4; i++) clearRound(run);
    run.finishRound(loss(), 30);
    expect(run.stats.roundsCleared).toBe(4);

    run.start();
    expect(run.round).toBe(1);
    expect(run.stats.roundsCleared).toBe(0);
    expect(run.stats.goalsFor).toBe(0);
    expect(run.stats.goalsAgainst).toBe(0);
  });

  it('counts a draw against the player', () => {
    // Rounds use sudden death so this should not arise, but the gauntlet is
    // cleared by winning, not by not losing.
    const run = new Run({}, seeded(1));
    run.start();
    run.finishRound(result(null, [1, 1]), 90);
    expect(run.phase).toBe('over');
  });

  it('ignores a result once the run is already over', () => {
    const run = new Run({}, seeded(1));
    run.start();
    run.finishRound(loss(), 30);
    const reached = run.summary!.reachedRound;
    run.finishRound(win(), 30);
    expect(run.phase).toBe('over');
    expect(run.summary!.reachedRound).toBe(reached);
  });

  it('ignores advance() unless a round was just cleared', () => {
    const run = new Run({}, seeded(1));
    run.start();
    const before = run.round;
    run.advance();
    expect(run.round).toBe(before);
  });
});

describe('stats', () => {
  it('adds up goals and time across rounds', () => {
    const run = new Run({}, seeded(1));
    run.start();
    clearRound(run, [3, 1], 70);
    clearRound(run, [2, 2], 55);
    expect(run.stats.goalsFor).toBe(5);
    expect(run.stats.goalsAgainst).toBe(3);
    expect(run.stats.duration).toBe(125);
  });

  it('includes the losing round in the totals', () => {
    const run = new Run({}, seeded(1));
    run.start();
    clearRound(run, [2, 0], 60);
    run.finishRound(loss([1, 3]), 80);
    expect(run.stats.goalsFor).toBe(3);
    expect(run.stats.goalsAgainst).toBe(3);
    expect(run.stats.duration).toBe(140);
  });
});

describe('best run', () => {
  it('has no record to begin with', () => {
    expect(loadBestRun()).toBe(null);
  });

  it('records the first run that finishes', () => {
    const run = new Run({}, seeded(1));
    run.start();
    clearRound(run);
    run.finishRound(loss(), 40);
    expect(run.summary!.newBest).toBe(true);
    expect(loadBestRun()!.roundsCleared).toBe(1);
  });

  it('survives into a new Run, as a fresh page load would', () => {
    const first = new Run({}, seeded(1));
    first.start();
    for (let i = 0; i < 3; i++) clearRound(first);
    first.finishRound(loss(), 30);

    const second = new Run({}, seeded(1));
    expect(second.best!.roundsCleared).toBe(3);
  });

  it('only replaces the record when the new run goes further', () => {
    const deep = new Run({}, seeded(1));
    deep.start();
    for (let i = 0; i < 5; i++) clearRound(deep);
    deep.finishRound(loss(), 30);
    expect(deep.summary!.newBest).toBe(true);

    const shallow = new Run({}, seeded(1));
    shallow.start();
    shallow.finishRound(loss(), 30);
    expect(shallow.summary!.newBest).toBe(false);
    expect(loadBestRun()!.roundsCleared).toBe(5);
  });

  it('breaks a tie on goal difference', () => {
    const a = { roundsCleared: 3, reachedRound: 4, goalsFor: 9, goalsAgainst: 2, duration: 100, setAt: '' };
    const b = { roundsCleared: 3, reachedRound: 4, goalsFor: 6, goalsAgainst: 5, duration: 100, setAt: '' };
    expect(beats(a, b)).toBe(true);
    expect(beats(b, a)).toBe(false);
  });

  it('treats a corrupt record as no record', () => {
    localStorage.setItem('rocket-gauntlet:best-run:v1', '{not json');
    expect(loadBestRun()).toBe(null);
    localStorage.setItem('rocket-gauntlet:best-run:v1', '{"roundsCleared":"lots"}');
    expect(loadBestRun()).toBe(null);
  });

  it('survives storage being unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadBestRun()).toBe(null);
    expect(
      saveBestRun({ roundsCleared: 1, reachedRound: 1, goalsFor: 1, goalsAgainst: 0, duration: 1, setAt: '' }),
    ).toBe(false);
    // And a whole run still completes.
    const run = new Run({}, seeded(1));
    run.start();
    expect(() => run.finishRound(loss(), 30)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('can be cleared', () => {
    saveBestRun({ roundsCleared: 2, reachedRound: 3, goalsFor: 4, goalsAgainst: 1, duration: 60, setAt: '' });
    expect(loadBestRun()).not.toBe(null);
    clearBestRun();
    expect(loadBestRun()).toBe(null);
  });
});

/**
 * The run summary's round-by-round log and its driving figures.
 *
 * The log is what turns a summary into an account of the run, so what matters
 * is that it records every round including the one that ended it, that the
 * boss rounds are marked, and — the part that would break silently — that the
 * summary keeps its own copy, since the run's stats are reset the moment
 * someone starts another one.
 */
describe('run summary', () => {
  it('logs every round, cleared and lost', () => {
    const run = new Run({}, seeded(4));
    run.start();
    clearRound(run, [3, 1]);
    clearRound(run, [2, 0]);
    run.finishRound(loss([1, 2]), 40);

    const summary = run.summary!;
    expect(summary.rounds).toHaveLength(3);
    expect(summary.rounds.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(summary.rounds.map((r) => r.cleared)).toEqual([true, true, false]);
    // Player's score first, as everywhere else.
    expect(summary.rounds[0]!.score).toEqual([3, 1]);
    expect(summary.rounds[2]!.score).toEqual([1, 2]);
  });

  it('marks the boss rounds', () => {
    const run = new Run({}, seeded(9));
    run.start();
    for (let i = 0; i < 4; i++) clearRound(run);
    run.finishRound(loss(), 50);

    const summary = run.summary!;
    // Every fifth round is a boss, and round five is where this run died.
    expect(summary.rounds.map((r) => r.boss)).toEqual([false, false, false, false, true]);
  });

  it('keeps its own copy of the stats', () => {
    // The summary is on screen while the player starts another run, and the
    // run resets its stats in place. Sharing the object blanks the screen
    // they are still reading.
    const run = new Run({}, seeded(11));
    run.start();
    run.stats.driving.distance = 123456;
    run.stats.driving.topSpeed = 2300;
    run.finishRound(loss(), 30);

    const summary = run.summary!;
    expect(summary.driving.distance).toBe(123456);
    expect(summary.rounds).toHaveLength(1);

    run.start();
    expect(run.stats.driving.distance).toBe(0);
    expect(summary.driving.distance).toBe(123456);
    expect(summary.driving.topSpeed).toBe(2300);
    expect(summary.rounds).toHaveLength(1);
  });

  it('starts a new run with nothing carried over', () => {
    const run = new Run({}, seeded(13));
    run.start();
    clearRound(run);
    run.stats.driving.pads = 12;
    run.finishRound(loss(), 20);

    run.start();
    expect(run.stats.driving.pads).toBe(0);
    expect(run.stats.roundsCleared).toBe(0);
    run.finishRound(loss(), 10);
    expect(run.summary!.rounds).toHaveLength(1);
  });
});
