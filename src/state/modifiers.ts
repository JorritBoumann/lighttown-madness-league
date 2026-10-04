import { cfg } from '../config';
import type { ConfigOverrides } from './configOverride';

/**
 * Round modifiers: the third axis of difficulty, alongside opponent skill and
 * opponent count.
 *
 * Each one states what it changes and whether the change touches arena
 * geometry, because that needs the colliders and meshes rebuilt rather than a
 * value written.
 */

export interface Modifier {
  id: string;
  name: string;
  /** Shown to the player when the round starts. */
  description: string;
  /** Earliest round this can turn up in. */
  minRound: number;
  /** Changes arena dimensions, so the arena has to be rebuilt. */
  rebuildsArena?: boolean;
  /** Applies the change through the overrides, so it can be reverted. */
  apply(o: ConfigOverrides): void;
}

export const MODIFIERS: readonly Modifier[] = [
  {
    id: 'small-goals',
    name: 'Narrow Goals',
    description: 'Both nets are a third narrower.',
    minRound: 3,
    rebuildsArena: true,
    apply: (o) => o.scale('arena.goalWidth', 0.67),
  },
  {
    id: 'tiny-goals',
    name: 'Tiny Goals',
    description: 'Both nets are half width and lower.',
    minRound: 9,
    rebuildsArena: true,
    apply: (o) => {
      o.scale('arena.goalWidth', 0.5);
      o.scale('arena.goalHeight', 0.8);
    },
  },
  {
    id: 'heavy-ball',
    name: 'Heavy Ball',
    description: 'The ball is twice the weight and barely bounces.',
    minRound: 3,
    apply: (o) => {
      o.scale('ball.mass', 2.2);
      o.scale('ball.restitution', 0.7);
    },
  },
  {
    id: 'beach-ball',
    name: 'Beach Ball',
    description: 'The ball is light, lively and hard to settle.',
    minRound: 4,
    apply: (o) => {
      o.scale('ball.mass', 0.45);
      o.set('ball.restitution', 0.85);
      o.scale('ball.drag', 2.5);
    },
  },
  {
    id: 'low-gravity',
    name: 'Low Gravity',
    description: 'Everything floats. Aerials last twice as long.',
    minRound: 4,
    apply: (o) => o.scale('physics.gravity', 0.45),
  },
  {
    id: 'heavy-gravity',
    name: 'Heavy Gravity',
    description: 'Hard to get off the floor, and you come down fast.',
    minRound: 6,
    apply: (o) => o.scale('physics.gravity', 1.7),
  },
  {
    id: 'limited-boost',
    name: 'Rationed Boost',
    description: 'A third of the usual tank, and pads give less back.',
    minRound: 3,
    apply: (o) => {
      o.scale('boost.max', 0.33);
      o.set('boost.start', 12);
      o.scale('boost.smallPadAmount', 0.5);
      o.scale('boost.bigPadAmount', 0.33);
    },
  },
  {
    id: 'no-boost',
    name: 'Dry Tank',
    description: 'No boost at all. Flips only.',
    minRound: 8,
    apply: (o) => {
      o.set('boost.start', 0);
      o.set('boost.max', 0);
      o.set('boost.smallPadAmount', 0);
      o.set('boost.bigPadAmount', 0);
    },
  },
  {
    id: 'slick',
    name: 'Slick Floor',
    description: 'Almost no grip. The car slides through every turn.',
    minRound: 5,
    apply: (o) => o.scale('car.lateralGrip', 0.35),
  },
  {
    id: 'big-ball',
    name: 'Giant Ball',
    description: 'The ball is half again as large.',
    minRound: 6,
    rebuildsArena: false,
    apply: (o) => {
      o.scale('ball.radius', 1.5);
      o.scale('ball.mass', 1.6);
    },
  },
];

/** Modifiers that could appear in a round, given how far in it is. */
export function availableModifiers(round: number): Modifier[] {
  return MODIFIERS.filter((m) => round >= m.minRound);
}

/**
 * Picks `count` modifiers for a round, avoiding pairs that pull the same knob
 * in opposite directions (two gravity changes, two ball weights, and so on).
 */
export function pickModifiers(round: number, count: number, random: () => number): Modifier[] {
  if (count <= 0) return [];
  const pool = availableModifiers(round);
  const chosen: Modifier[] = [];
  const groups = new Set<string>();

  // Shuffle a copy, then take the first few that do not clash.
  const bag = [...pool];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }

  for (const m of bag) {
    if (chosen.length >= count) break;
    const group = conflictGroup(m.id);
    if (groups.has(group)) continue;
    groups.add(group);
    chosen.push(m);
  }
  return chosen;
}

/** Modifiers in the same group fight each other, so only one is used. */
function conflictGroup(id: string): string {
  if (id === 'small-goals' || id === 'tiny-goals') return 'goals';
  if (id === 'heavy-ball' || id === 'beach-ball' || id === 'big-ball') return 'ball';
  if (id === 'low-gravity' || id === 'heavy-gravity') return 'gravity';
  if (id === 'limited-boost' || id === 'no-boost') return 'boost';
  return id;
}

/** True if any of these needs the arena rebuilt. */
export function needsArenaRebuild(mods: readonly Modifier[]): boolean {
  return mods.some((m) => m.rebuildsArena === true);
}

/** Guards against a modifier set that would make a round unplayable. */
export function sanityCheck(): string[] {
  const problems: string[] = [];
  if (cfg.arena.goalWidth < cfg.ball.radius * 2.2) {
    problems.push('goal is too narrow for the ball to fit through');
  }
  if (cfg.arena.goalHeight < cfg.ball.radius * 1.5) {
    problems.push('goal is too low for the ball');
  }
  return problems;
}
