import { describe, it, expect } from 'vitest';
import { cfg } from '../src/config';
import { BOSSES, bossForRound, isBossRound } from '../src/state/bosses';
import { buildRound } from '../src/state/round';
import { Match, type BallLike, type MatchResult } from '../src/state/match';
import { MODIFIERS } from '../src/state/modifiers';

/**
 * Boss rules, run without physics: feed the match a ball position and a clock
 * and check each boss's objective resolves the way its brief promises.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const R = cfg.ball.radius;
const ball = (x: number, y = R, z = 0): BallLike => ({ position: { x, y, z }, radius: R });
const CENTRE = ball(0);
/** Past the line at one end: +1 is the net the player attacks. */
const inNet = (sign: 1 | -1): BallLike => ball(sign * (cfg.arena.goalLine + R + 1));

function advance(match: Match, seconds: number, at: BallLike = CENTRE): void {
  const dt = cfg.physics.fixedDt;
  for (let i = 0; i < Math.round(seconds / dt); i++) match.update(dt, at);
}

/** Plays a match to a finish, scoring the given sequence of goals. */
function playOut(match: Match, goals: (1 | -1)[], thenRunClock = true): MatchResult | null {
  advance(match, match.rules.countdown + 0.05);
  for (const side of goals) {
    if (match.over) break;
    advance(match, 0.1, inNet(side));
    // Through the celebration and the next countdown.
    advance(match, match.rules.goalPause + match.rules.countdown + 0.2, CENTRE);
  }
  if (thenRunClock && !match.over) advance(match, match.rules.durationSeconds + 5, CENTRE);
  return match.result;
}

describe('boss scheduling', () => {
  it('lands on every fifth round and nowhere else', () => {
    for (const i of [5, 10, 15, 20, 25, 30]) expect(isBossRound(i)).toBe(true);
    for (const i of [0, 1, 4, 6, 9, 11, 14]) expect(isBossRound(i)).toBe(false);
  });

  it('cycles through the bosses so a long run meets each one', () => {
    const seen = new Set<string>();
    for (let i = 5; i <= 5 * BOSSES.length; i += 5) seen.add(bossForRound(i).id);
    expect(seen.size).toBe(BOSSES.length);
    // And it wraps rather than running out.
    expect(bossForRound(5 * (BOSSES.length + 1)).id).toBe(BOSSES[0]!.id);
  });

  it('gives a boss round the boss, and an ordinary round none', () => {
    expect(buildRound(5, seeded(1)).boss?.id).toBe(BOSSES[0]!.id);
    expect(buildRound(4, seeded(1)).boss).toBe(null);
  });

  it('raises a boss met later in a run above its own floor', () => {
    const early = buildRound(5, seeded(1));
    const late = buildRound(5 * (BOSSES.length + 1), seeded(1));
    expect(late.tier).toBeGreaterThanOrEqual(early.tier);
    expect(late.lineup.every((o) => o.tier >= 1)).toBe(true);
  });

  it('forces each boss its own modifiers and no others', () => {
    for (let n = 1; n <= BOSSES.length; n++) {
      const index = n * 5;
      const spec = buildRound(index, seeded(index));
      const wanted = bossForRound(index).modifiers;
      expect(spec.modifiers.map((m) => m.id).sort()).toEqual([...wanted].sort());
    }
  });

  it('names modifiers that actually exist', () => {
    for (const boss of BOSSES) {
      for (const id of boss.modifiers) {
        expect(MODIFIERS.some((m) => m.id === id), `${boss.id} wants missing "${id}"`).toBe(true);
      }
    }
  });

  it('describes itself: every boss has a brief and a lineup', () => {
    for (const boss of BOSSES) {
      expect(boss.name.length).toBeGreaterThan(0);
      expect(boss.brief.length).toBeGreaterThan(10);
      expect(boss.opponents.length).toBeGreaterThan(0);
    }
  });

  it('keeps every boss round inside the brief’s time window', () => {
    for (let n = 1; n <= BOSSES.length; n++) {
      const d = buildRound(n * 5, seeded(1)).rules.durationSeconds;
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(90);
    }
  });
});

describe('The Wall: score three or fail', () => {
  const rules = () => buildRound(5, seeded(1)).rules;

  it('is cleared by reaching the target', () => {
    const m = new Match(rules(), {});
    const result = playOut(m, [1, 1, 1]);
    expect(result?.winner).toBe(0);
    expect(result?.reason).toBe('goal-target');
  });

  it('is failed by leading but falling short', () => {
    // Two goals and a clean sheet would win an ordinary round. Not this one.
    const m = new Match(rules(), {});
    const result = playOut(m, [1, 1]);
    expect(result?.winner).toBe(1);
    expect(result?.reason).toBe('target-missed');
  });

  it('is failed by scoring nothing at all', () => {
    const m = new Match(rules(), {});
    const result = playOut(m, []);
    expect(result?.winner).toBe(1);
  });

  it('parks a keeper and nothing else', () => {
    const spec = buildRound(5, seeded(1));
    expect(spec.lineup).toHaveLength(1);
    expect(spec.lineup[0]!.role).toBe('keeper');
  });
});

describe('The Siege: survive without conceding', () => {
  const rules = () => buildRound(10, seeded(1)).rules;

  it('is cleared by reaching full time', () => {
    const m = new Match(rules(), {});
    const result = playOut(m, []);
    expect(result?.winner).toBe(0);
    expect(result?.reason).toBe('survived');
  });

  it('ends the moment one is conceded', () => {
    const m = new Match(rules(), {});
    advance(m, m.rules.countdown + 0.05);
    advance(m, 0.1, inNet(-1));
    expect(m.over).toBe(true);
    expect(m.result?.winner).toBe(1);
    expect(m.result?.reason).toBe('conceded');
  });

  it('cannot be won early by scoring', () => {
    const m = new Match(rules(), {});
    advance(m, m.rules.countdown + 0.05);
    advance(m, 0.1, inNet(1));
    // Scoring is allowed but settles nothing: the clock is the objective.
    expect(m.over).toBe(false);
    expect(m.score[0]).toBe(1);
  });

  it('fields three attackers', () => {
    const spec = buildRound(10, seeded(1));
    expect(spec.lineup).toHaveLength(3);
    expect(spec.lineup.every((o) => o.role === 'attacker')).toBe(true);
  });
});

describe('The Duel: next goal takes it', () => {
  const rules = () => buildRound(15, seeded(1)).rules;

  it('is settled by a single goal either way', () => {
    const won = new Match(rules(), {});
    expect(playOut(won, [1])?.winner).toBe(0);

    const lost = new Match(rules(), {});
    expect(playOut(lost, [-1])?.winner).toBe(1);
  });

  it('goes to sudden death if nobody scores', () => {
    const m = new Match(rules(), {});
    advance(m, m.rules.countdown + m.rules.durationSeconds + 0.5);
    expect(m.over).toBe(false);
    expect(m.overtime).toBe(true);
  });

  it('is played on a slick floor', () => {
    expect(buildRound(15, seeded(1)).modifiers.map((m) => m.id)).toContain('slick');
  });
});

describe('The Swarm: win by three clear', () => {
  const rules = () => buildRound(20, seeded(1)).rules;

  it('is cleared by a three goal margin', () => {
    const m = new Match(rules(), {});
    expect(playOut(m, [1, 1, 1])?.winner).toBe(0);
  });

  it('is failed by winning by less', () => {
    // Conceded first, so three goals only makes it three to one: the target is
    // reached but the margin is not, and the clock decides it.
    const m = new Match(rules(), {});
    const result = playOut(m, [-1, 1, 1, 1]);
    expect(m.score).toEqual([3, 1]);
    expect(result?.winner).toBe(1);
    expect(result?.reason).toBe('target-missed');
  });

  it('does not end the moment the target is reached if the margin is short', () => {
    const m = new Match(rules(), {});
    advance(m, m.rules.countdown + 0.05);
    advance(m, 0.1, inNet(-1)); // concede first
    advance(m, m.rules.goalPause + m.rules.countdown + 0.2, CENTRE);
    for (let i = 0; i < 3; i++) {
      advance(m, 0.1, inNet(1));
      advance(m, m.rules.goalPause + m.rules.countdown + 0.2, CENTRE);
    }
    // 3-1 reaches the target but is only two clear, so it is still live.
    expect(m.score).toEqual([3, 1]);
    expect(m.over).toBe(false);
  });

  it('fields four, including a keeper', () => {
    const spec = buildRound(20, seeded(1));
    expect(spec.lineup).toHaveLength(4);
    expect(spec.lineup.some((o) => o.role === 'keeper')).toBe(true);
  });
});

describe('The Lockout', () => {
  it('needs two past a champion keeper behind a narrow net', () => {
    const spec = buildRound(25, seeded(1));
    expect(spec.rules.goalTarget).toBe(2);
    expect(spec.rules.objective).toBe('target');
    expect(spec.lineup.some((o) => o.role === 'keeper')).toBe(true);
    const ids = spec.modifiers.map((m) => m.id);
    expect(ids).toContain('small-goals');
    expect(ids).toContain('heavy-ball');
  });

  it('is cleared by two goals', () => {
    const m = new Match(buildRound(25, seeded(1)).rules, {});
    expect(playOut(m, [1, 1])?.winner).toBe(0);
  });
});
