import type { BotRole } from '../ai/bot';
import type { MatchRules } from './match';

/**
 * Boss rounds, every fifth round.
 *
 * Each one changes the *rules*, not just the numbers. A boss that is only a
 * stronger opponent is a difficulty modifier wearing a hat; these each ask for
 * something different — score past a keeper, hold out under siege, settle it
 * with one goal, win by a margin — so clearing one is a different problem
 * rather than the same problem with more of it.
 */

export interface BossOpponent {
  /** Minimum tier. The round's own curve raises it later in a run. */
  tier: number;
  role: BotRole;
}

export interface BossSpec {
  id: string;
  name: string;
  /** One line telling the player what is different, shown before kickoff. */
  brief: string;
  opponents: BossOpponent[];
  /** Overrides on top of the ordinary round rules. */
  rules: Partial<MatchRules>;
  /** Modifier ids forced on for this round, whatever the round would have rolled. */
  modifiers: string[];
}

export const BOSSES: readonly BossSpec[] = [
  {
    id: 'keeper',
    name: 'The Wall',
    brief: 'One keeper, parked. Score three past it before the clock runs out.',
    opponents: [{ tier: 4, role: 'keeper' }],
    // It never comes forward, so there is nothing to defend: the only question
    // is whether you can finish.
    rules: { objective: 'target', goalTarget: 3, durationSeconds: 90, suddenDeath: false },
    modifiers: [],
  },
  {
    id: 'siege',
    name: 'The Siege',
    brief: 'Three attackers, no keeper of yours. Concede once and the run ends.',
    opponents: [
      { tier: 3, role: 'attacker' },
      { tier: 3, role: 'attacker' },
      { tier: 3, role: 'attacker' },
    ],
    // Cannot be won by scoring. Surviving the clock is the whole objective.
    rules: {
      objective: 'survive',
      concedeLimit: 1,
      goalTarget: 0,
      durationSeconds: 60,
      suddenDeath: false,
    },
    modifiers: [],
  },
  {
    id: 'duel',
    name: 'The Duel',
    brief: 'One champion, one goal. Next goal takes it, and the floor is ice.',
    opponents: [{ tier: 5, role: 'balanced' }],
    rules: { goalTarget: 1, durationSeconds: 75, suddenDeath: true },
    modifiers: ['slick'],
  },
  {
    id: 'swarm',
    name: 'The Swarm',
    brief: 'Four of them, and winning is not enough: win by three clear goals.',
    opponents: [
      { tier: 2, role: 'attacker' },
      { tier: 2, role: 'attacker' },
      { tier: 2, role: 'balanced' },
      { tier: 2, role: 'keeper' },
    ],
    rules: {
      objective: 'target',
      goalTarget: 3,
      winMargin: 3,
      durationSeconds: 90,
      suddenDeath: false,
    },
    modifiers: [],
  },
  {
    id: 'lockout',
    name: 'The Lockout',
    brief: 'A champion keeper behind a narrow net, and a heavy ball. Two goals.',
    opponents: [
      { tier: 5, role: 'keeper' },
      { tier: 3, role: 'balanced' },
    ],
    rules: { objective: 'target', goalTarget: 2, durationSeconds: 90, suddenDeath: false },
    modifiers: ['small-goals', 'heavy-ball'],
  },
];

/** Which boss a round gets. They cycle, so a long run meets each in turn. */
export function bossForRound(index: number): BossSpec {
  const n = Math.max(1, Math.floor(index / 5));
  return BOSSES[(n - 1) % BOSSES.length]!;
}

/** True for a boss round. */
export const isBossRound = (index: number): boolean => index > 0 && index % 5 === 0;
