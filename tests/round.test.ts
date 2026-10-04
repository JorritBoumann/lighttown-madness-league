import { describe, it, expect } from 'vitest';
import { cfg } from '../src/config';
import {
  buildRound,
  tierForRound,
  opponentsForRound,
  modifierCountForRound,
  durationForRound,
  goalTargetForRound,
} from '../src/state/round';
import {
  MODIFIERS,
  availableModifiers,
  pickModifiers,
  needsArenaRebuild,
  sanityCheck,
} from '../src/state/modifiers';
import { ConfigOverrides } from '../src/state/configOverride';

/** Deterministic stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('escalation curve', () => {
  it('never gets easier as rounds go on', () => {
    for (let i = 2; i <= 40; i++) {
      expect(tierForRound(i)).toBeGreaterThanOrEqual(tierForRound(i - 1));
      expect(opponentsForRound(i)).toBeGreaterThanOrEqual(opponentsForRound(i - 1));
      expect(modifierCountForRound(i)).toBeGreaterThanOrEqual(modifierCountForRound(i - 1));
      expect(durationForRound(i)).toBeLessThanOrEqual(durationForRound(i - 1));
    }
  });

  it('starts gently: one weak opponent, no modifiers', () => {
    const first = buildRound(1, seeded(1));
    expect(first.tier).toBe(1);
    expect(first.opponents).toBe(1);
    expect(first.modifiers).toHaveLength(0);
  });

  it('flattens out rather than running away', () => {
    const late = buildRound(60, seeded(1));
    expect(late.tier).toBeLessThanOrEqual(5);
    expect(late.opponents).toBeLessThanOrEqual(3);
    expect(late.modifiers.length).toBeLessThanOrEqual(2);
  });

  it('keeps every round inside the brief’s 60 to 90 second window', () => {
    for (let i = 1; i <= 40; i++) {
      const d = durationForRound(i);
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(90);
    }
  });

  it('asks for more goals later on', () => {
    expect(goalTargetForRound(1)).toBeLessThan(goalTargetForRound(10));
  });

  it('marks every fifth round as a boss round', () => {
    for (const i of [5, 10, 15, 20]) expect(buildRound(i, seeded(1)).isBoss).toBe(true);
    for (const i of [1, 4, 6, 9, 11]) expect(buildRound(i, seeded(1)).isBoss).toBe(false);
  });

  it('cannot end level: every round resolves one way or the other', () => {
    // Ordinary rounds go to sudden death. Boss rounds resolve on the clock
    // instead, because their objective decides it: survive it or do not, reach
    // the target or do not.
    for (let i = 1; i <= 40; i++) {
      const r = buildRound(i, seeded(i));
      const resolves =
        r.rules.suddenDeath ||
        r.rules.objective === 'survive' ||
        r.rules.objective === 'target';
      expect(resolves, `round ${i} could end level`).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = buildRound(9, seeded(42));
    const b = buildRound(9, seeded(42));
    expect(a.modifiers.map((m) => m.id)).toEqual(b.modifiers.map((m) => m.id));
  });
});

describe('modifier selection', () => {
  it('only offers modifiers the round has reached', () => {
    for (let i = 1; i <= 12; i++) {
      for (const mod of availableModifiers(i)) {
        expect(mod.minRound).toBeLessThanOrEqual(i);
      }
    }
  });

  it('gives the asked-for count once enough are unlocked', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(pickModifiers(12, 2, seeded(seed))).toHaveLength(2);
    }
  });

  it('never picks two that pull the same knob opposite ways', () => {
    const clashes: [string, string][] = [
      ['low-gravity', 'heavy-gravity'],
      ['heavy-ball', 'beach-ball'],
      ['limited-boost', 'no-boost'],
      ['small-goals', 'tiny-goals'],
    ];
    for (let seed = 1; seed <= 60; seed++) {
      const ids = pickModifiers(20, 2, seeded(seed)).map((m) => m.id);
      for (const [a, b] of clashes) {
        expect(ids.includes(a) && ids.includes(b)).toBe(false);
      }
    }
  });

  it('returns nothing when asked for nothing', () => {
    expect(pickModifiers(20, 0, seeded(1))).toEqual([]);
  });

  it('flags the ones that change arena dimensions', () => {
    const goals = MODIFIERS.filter((m) => m.id === 'small-goals' || m.id === 'tiny-goals');
    expect(needsArenaRebuild(goals)).toBe(true);
    expect(needsArenaRebuild(MODIFIERS.filter((m) => m.id === 'low-gravity'))).toBe(false);
  });
});

describe('modifier effects', () => {
  it('each one actually changes something, and reverts cleanly', () => {
    for (const mod of MODIFIERS) {
      const before = JSON.stringify(cfg);
      const o = new ConfigOverrides();
      mod.apply(o);
      expect(JSON.stringify(cfg), `${mod.id} changed nothing`).not.toBe(before);
      o.revert();
      expect(JSON.stringify(cfg), `${mod.id} did not revert`).toBe(before);
    }
  });

  it('leaves every round playable: the ball still fits in the goal', () => {
    for (let round = 1; round <= 30; round++) {
      for (let seed = 1; seed <= 10; seed++) {
        const spec = buildRound(round, seeded(seed));
        const o = new ConfigOverrides();
        for (const mod of spec.modifiers) mod.apply(o);
        const problems = sanityCheck();
        o.revert();
        expect(problems, `round ${round} seed ${seed}: ${problems.join('; ')}`).toEqual([]);
      }
    }
  });

  it('low gravity really does weaken gravity, and heavy strengthens it', () => {
    const base = cfg.physics.gravity;
    const low = new ConfigOverrides();
    MODIFIERS.find((m) => m.id === 'low-gravity')!.apply(low);
    expect(Math.abs(cfg.physics.gravity)).toBeLessThan(Math.abs(base));
    low.revert();

    const heavy = new ConfigOverrides();
    MODIFIERS.find((m) => m.id === 'heavy-gravity')!.apply(heavy);
    expect(Math.abs(cfg.physics.gravity)).toBeGreaterThan(Math.abs(base));
    heavy.revert();
    expect(cfg.physics.gravity).toBe(base);
  });

  it('a dry tank leaves no boost to be had anywhere', () => {
    const o = new ConfigOverrides();
    MODIFIERS.find((m) => m.id === 'no-boost')!.apply(o);
    expect(cfg.boost.start).toBe(0);
    expect(cfg.boost.max).toBe(0);
    expect(cfg.boost.smallPadAmount).toBe(0);
    expect(cfg.boost.bigPadAmount).toBe(0);
    o.revert();
  });
});

describe('config overrides', () => {
  it('reverts to the file’s value, not to the last round’s', () => {
    const base = cfg.ball.mass;
    const first = new ConfigOverrides();
    first.scale('ball.mass', 2);
    const doubled = cfg.ball.mass;

    // A second override layer applied on top, then both reverted.
    const second = new ConfigOverrides();
    second.scale('ball.mass', 3);
    expect(cfg.ball.mass).toBe(doubled * 3);
    second.revert();
    expect(cfg.ball.mass).toBe(doubled);
    first.revert();
    expect(cfg.ball.mass).toBe(base);
  });

  it('remembers the first value when a path is written twice', () => {
    const base = cfg.physics.gravity;
    const o = new ConfigOverrides();
    o.scale('physics.gravity', 0.5);
    o.scale('physics.gravity', 0.5);
    expect(cfg.physics.gravity).toBe(base * 0.5);
    o.revert();
    expect(cfg.physics.gravity).toBe(base);
  });

  it('reports which paths it is holding', () => {
    const o = new ConfigOverrides();
    expect(o.active).toBe(false);
    o.scale('ball.mass', 2);
    expect(o.active).toBe(true);
    expect(o.paths).toContain('ball.mass');
    o.revert();
    expect(o.active).toBe(false);
  });

  it('refuses a path that does not exist, rather than inventing one', () => {
    const o = new ConfigOverrides();
    expect(() => o.set('ball.nonsense', 1)).toThrow();
    expect(() => o.set('nope.mass', 1)).toThrow();
  });
});
