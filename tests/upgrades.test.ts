// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cfg } from '../src/config';
import {
  UPGRADES,
  offerUpgrades,
  applyUpgrades,
  upgradeById,
  tally,
  type Upgrade,
} from '../src/state/upgrades';
import { defaultModifiers, type CarModifiers } from '../src/physics/car';
import { ConfigOverrides } from '../src/state/configOverride';
import { Run } from '../src/state/run';
import type { MatchResult, Team } from '../src/state/match';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const result = (winner: Team | null, score: [number, number]): MatchResult => ({
  winner,
  score,
  overtime: false,
  reason: 'goal-target',
});

/** Applies upgrades the way a round start does. */
function applyFresh(owned: readonly Upgrade[]): { mods: CarModifiers; o: ConfigOverrides } {
  const mods = defaultModifiers();
  const o = new ConfigOverrides();
  applyUpgrades(owned, { mods, overrides: o });
  return { mods, o };
}

beforeEach(() => {
  localStorage.clear();
});

describe('the offer', () => {
  it('offers three distinct upgrades', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const offer = offerUpgrades([], 3, seeded(seed));
      expect(offer).toHaveLength(3);
      expect(new Set(offer.map((u) => u.id)).size).toBe(3);
    }
  });

  it('stops offering a one-off upgrade once it is owned', () => {
    const once = UPGRADES.filter((u) => !u.stacks);
    expect(once.length).toBeGreaterThan(0);
    for (const upgrade of once) {
      for (let seed = 1; seed <= 20; seed++) {
        const offer = offerUpgrades([upgrade], 3, seeded(seed));
        expect(offer.map((u) => u.id)).not.toContain(upgrade.id);
      }
    }
  });

  it('keeps offering ones that stack', () => {
    const stacking = UPGRADES.find((u) => u.stacks)!;
    let seen = false;
    for (let seed = 1; seed <= 40; seed++) {
      const offer = offerUpgrades([stacking, stacking], 3, seeded(seed));
      if (offer.some((u) => u.id === stacking.id)) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('runs out gracefully rather than repeating itself', () => {
    // Everything one-off already taken, so only stacking ones are left.
    const owned = UPGRADES.filter((u) => !u.stacks);
    const offer = offerUpgrades(owned, 3, seeded(1));
    expect(new Set(offer.map((u) => u.id)).size).toBe(offer.length);
  });

  it('is deterministic for a given seed', () => {
    const a = offerUpgrades([], 3, seeded(99)).map((u) => u.id);
    const b = offerUpgrades([], 3, seeded(99)).map((u) => u.id);
    expect(a).toEqual(b);
  });
});

describe('effects', () => {
  it('every upgrade changes something', () => {
    const base = JSON.stringify(defaultModifiers());
    for (const upgrade of UPGRADES) {
      const { mods, o } = applyFresh([upgrade]);
      const changedMods = JSON.stringify(mods) !== base;
      const changedWorld = o.active;
      expect(changedMods || changedWorld, `${upgrade.id} changed nothing`).toBe(true);
      o.revert();
    }
  });

  it('never buffs the car config, which the bots read too', () => {
    // An upgrade written as a config write to car.* would quietly make every
    // bot faster as well. Only deliberate world changes are allowed, and none
    // of them may touch the car.
    for (const upgrade of UPGRADES) {
      const { o } = applyFresh([upgrade]);
      for (const path of o.paths) {
        expect(path.startsWith('car.'), `${upgrade.id} writes ${path}`).toBe(false);
      }
      o.revert();
    }
  });

  it('stacks multiplicatively when taken twice', () => {
    const afterburner = upgradeById('afterburner')!;
    const once = applyFresh([afterburner]);
    const twice = applyFresh([afterburner, afterburner]);
    expect(twice.mods.boostAccel).toBeCloseTo(once.mods.boostAccel ** 2 / 1, 6);
    expect(twice.mods.boostAccel).toBeGreaterThan(once.mods.boostAccel);
  });

  it('does not compound across rounds when re-applied from standard', () => {
    // Rounds re-apply the whole set every time. If that drifted, an upgrade
    // taken once would keep growing for the rest of the run.
    const owned = [upgradeById('afterburner')!, upgradeById('quick-feet')!];
    const first = applyFresh(owned);
    const tenth = applyFresh(owned);
    expect(tenth.mods).toEqual(first.mods);
    first.o.revert();
    tenth.o.revert();
  });

  it('gives Triple Jump a genuine third jump', () => {
    const { mods } = applyFresh([upgradeById('triple-jump')!]);
    expect(mods.maxJumps).toBe(3);
  });

  it('fills the tank with Full Tank, through the car and not the config', () => {
    const { mods, o } = applyFresh([upgradeById('full-tank')!]);
    expect(mods.startBoost).toBeGreaterThan(1);
    expect(o.paths).not.toContain('boost.start');
    o.revert();
  });

  it('reverts its world changes cleanly', () => {
    const before = JSON.stringify(cfg);
    const { o } = applyFresh([upgradeById('generous-pads')!]);
    expect(JSON.stringify(cfg)).not.toBe(before);
    o.revert();
    expect(JSON.stringify(cfg)).toBe(before);
  });
});

describe('tally', () => {
  it('rolls repeats up into counts', () => {
    const a = upgradeById('afterburner')!;
    const b = upgradeById('quick-feet')!;
    const rolled = tally([a, b, a]);
    expect(rolled).toHaveLength(2);
    expect(rolled.find((e) => e.upgrade.id === 'afterburner')!.count).toBe(2);
    expect(rolled.find((e) => e.upgrade.id === 'quick-feet')!.count).toBe(1);
  });
});

describe('picking between rounds', () => {
  it('offers three after a cleared round', () => {
    const onRoundCleared = vi.fn();
    const run = new Run({ onRoundCleared }, seeded(1));
    run.start();
    run.finishRound(result(0, [2, 0]), 60);
    expect(run.phase).toBe('between');
    expect(run.offer).toHaveLength(3);
    expect(onRoundCleared.mock.calls[0]![2]).toHaveLength(3);
  });

  it('takes the chosen one and starts the next round', () => {
    const onUpgradeTaken = vi.fn();
    const run = new Run({ onUpgradeTaken }, seeded(1));
    run.start();
    run.finishRound(result(0, [2, 0]), 60);
    const wanted = run.offer[1]!;
    run.choose(1);
    expect(run.upgrades).toEqual([wanted]);
    expect(run.phase).toBe('round');
    expect(run.round).toBe(2);
    expect(run.offer).toHaveLength(0);
    expect(onUpgradeTaken).toHaveBeenCalledTimes(1);
  });

  it('ignores a pick that is not on offer, rather than skipping the choice', () => {
    const run = new Run({}, seeded(1));
    run.start();
    run.finishRound(result(0, [2, 0]), 60);
    run.choose(7);
    run.choose(-1);
    expect(run.phase).toBe('between');
    expect(run.upgrades).toHaveLength(0);
  });

  it('ignores a pick when no round has been cleared', () => {
    const run = new Run({}, seeded(1));
    run.start();
    run.choose(0);
    expect(run.upgrades).toHaveLength(0);
    expect(run.round).toBe(1);
  });

  it('accumulates one upgrade per cleared round', () => {
    const run = new Run({}, seeded(5));
    run.start();
    for (let i = 0; i < 6; i++) {
      run.finishRound(result(0, [2, 0]), 60);
      run.choose(0);
    }
    expect(run.upgrades).toHaveLength(6);
    expect(run.round).toBe(7);
  });

  it('drops every upgrade when a new run starts', () => {
    const run = new Run({}, seeded(1));
    run.start();
    run.finishRound(result(0, [2, 0]), 60);
    run.choose(0);
    expect(run.upgrades).toHaveLength(1);

    run.finishRound(result(1, [0, 2]), 40);
    run.start();
    expect(run.upgrades).toHaveLength(0);
    expect(run.offer).toHaveLength(0);
  });

  it('clears the offer when a run ends mid-choice', () => {
    const run = new Run({}, seeded(1));
    run.start();
    run.finishRound(result(0, [2, 0]), 60);
    run.advance();
    expect(run.offer).toHaveLength(0);
  });
});
