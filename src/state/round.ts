import { cfg } from '../config';
import type { MatchRules } from './match';
import { pickModifiers, type Modifier } from './modifiers';

/**
 * Round generation and the escalation curve.
 *
 * A round is fully described by this spec, so the same code can play round one
 * or round twenty, and a test can assert the curve without playing anything.
 * The three axes the brief asks for escalate independently: opponent skill,
 * opponent count, and modifiers.
 */

export interface RoundSpec {
  /** One-based. */
  index: number;
  /** Every fifth round. The distinct rule set lands in step 6. */
  isBoss: boolean;
  /** How many bots line up. */
  opponents: number;
  /** Their difficulty tier. */
  tier: number;
  modifiers: Modifier[];
  rules: MatchRules;
  /** Short label for the HUD, e.g. "Pro x2". */
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
  const tier = tierForRound(index);
  const opponents = opponentsForRound(index);
  const modifiers = pickModifiers(index, modifierCountForRound(index), random);

  const rules: MatchRules = {
    durationSeconds: durationForRound(index),
    goalTarget: goalTargetForRound(index),
    countdown: cfg.match.countdown,
    goalPause: cfg.match.goalPause,
    // A draw cannot stand in a gauntlet: the run has to resolve one way or the
    // other, so every round goes to sudden death rather than ending level.
    suddenDeath: true,
  };

  return {
    index,
    isBoss: index % 5 === 0,
    opponents,
    tier,
    modifiers,
    rules,
    label: labelFor(tier, opponents),
  };
}

const TIER_NAMES = ['Rookie', 'Amateur', 'Pro', 'Veteran', 'Champion'];

function labelFor(tier: number, opponents: number): string {
  const name = TIER_NAMES[Math.min(TIER_NAMES.length, Math.max(1, tier)) - 1]!;
  return opponents > 1 ? `${name} x${opponents}` : name;
}
