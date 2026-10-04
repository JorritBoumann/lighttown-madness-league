import { cfg } from '../config';
import type { MatchRules } from './match';
import { pickModifiers, MODIFIERS, type Modifier } from './modifiers';
import { bossForRound, isBossRound, type BossSpec } from './bosses';
import type { BotRole } from '../ai/bot';

/**
 * Round generation and the escalation curve.
 *
 * A round is fully described by this spec, so the same code can play round one
 * or round twenty, and a test can assert the curve without playing anything.
 * The three axes the brief asks for escalate independently: opponent skill,
 * opponent count, and modifiers.
 */

/** One opponent in a round. */
export interface RoundOpponent {
  tier: number;
  role: BotRole;
}

export interface RoundSpec {
  /** One-based. */
  index: number;
  /** Every fifth round, with its own rule set. */
  isBoss: boolean;
  /** The boss, on a boss round. */
  boss: BossSpec | null;
  /** The opposition, one entry per car. */
  lineup: RoundOpponent[];
  /** How many bots line up. Kept for convenience; same as lineup.length. */
  opponents: number;
  /** The highest tier on the field, for display. */
  tier: number;
  modifiers: Modifier[];
  rules: MatchRules;
  /** Short label for the HUD, e.g. "Pro x2" or the boss's name. */
  label: string;
}

/** Caps, so the curve flattens rather than running away. */
const MAX_TIER = 5;
const MAX_OPPONENTS = 3;

/** Opponent skill: up one tier every three rounds. */
export function tierForRound(index: number): number {
  return Math.min(MAX_TIER, 1 + Math.floor((index - 1) / 3));
}

/** Opponent count: one, then two from round four, three from round nine. */
export function opponentsForRound(index: number): number {
  if (index >= 9) return Math.min(MAX_OPPONENTS, 3);
  if (index >= 4) return 2;
  return 1;
}

/** Modifier count: none at first, one from round three, two from round eight. */
export function modifierCountForRound(index: number): number {
  if (index >= 8) return 2;
  if (index >= 3) return 1;
  return 0;
}

/** Match length: 90 seconds early, tightening to 60. */
export function durationForRound(index: number): number {
  return Math.max(60, 90 - (index - 1) * 3);
}

/** Goals needed: two early, three from round five. */
export function goalTargetForRound(index: number): number {
  return index >= 5 ? 3 : 2;
}

export function buildRound(index: number, random: () => number = Math.random): RoundSpec {
  const curveTier = tierForRound(index);

  const baseRules: MatchRules = {
    durationSeconds: durationForRound(index),
    goalTarget: goalTargetForRound(index),
    countdown: cfg.match.countdown,
    goalPause: cfg.match.goalPause,
    // A draw cannot stand in a gauntlet: the run has to resolve one way or the
    // other, so an ordinary round goes to sudden death rather than ending level.
    suddenDeath: true,
    objective: 'goals',
    winMargin: 1,
    concedeLimit: 0,
  };

  if (isBossRound(index)) {
    const boss = bossForRound(index);
    // The boss's own tiers are a floor; a boss met later in a run is stronger.
    const lineup = boss.opponents.map((o) => ({
      tier: Math.max(o.tier, curveTier),
      role: o.role,
    }));
    const modifiers = boss.modifiers
      .map((id) => MODIFIERS.find((m) => m.id === id))
      .filter((m): m is Modifier => m !== undefined);

    return {
      index,
      isBoss: true,
      boss,
      lineup,
      opponents: lineup.length,
      tier: Math.max(...lineup.map((o) => o.tier)),
      modifiers,
      rules: { ...baseRules, ...boss.rules },
      label: boss.name,
    };
  }

  const count = opponentsForRound(index);
  const lineup: RoundOpponent[] = Array.from({ length: count }, () => ({
    tier: curveTier,
    role: 'balanced' as BotRole,
  }));

  return {
    index,
    isBoss: false,
    boss: null,
    lineup,
    opponents: count,
    tier: curveTier,
    modifiers: pickModifiers(index, modifierCountForRound(index), random),
    rules: baseRules,
    label: labelFor(curveTier, count),
  };
}

const TIER_NAMES = ['Rookie', 'Amateur', 'Pro', 'Veteran', 'Champion'];

function labelFor(tier: number, opponents: number): string {
  const name = TIER_NAMES[Math.min(TIER_NAMES.length, Math.max(1, tier)) - 1]!;
  return opponents > 1 ? `${name} x${opponents}` : name;
}
