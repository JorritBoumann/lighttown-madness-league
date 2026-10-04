import type { CarModifiers } from '../physics/car';
import type { ConfigOverrides } from './configOverride';

/**
 * Run upgrades: between rounds the player picks one of three, and it lasts for
 * the rest of the run.
 *
 * Almost everything goes through the player's own CarModifiers rather than the
 * config, because the config is shared with the bots and an upgrade that made
 * everyone faster would not be an upgrade. The handful that genuinely change
 * the world go through a run-scoped override layer instead, and both are
 * re-applied from scratch each round so stacking cannot drift.
 */

export interface UpgradeContext {
  /** The player's modifiers, already back at standard. */
  mods: CarModifiers;
  /** Run-scoped config layer, applied on top of the round's modifiers. */
  overrides: ConfigOverrides;
}

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  /** Taking it twice is allowed, and the effect compounds. */
  stacks: boolean;
  apply(ctx: UpgradeContext): void;
}

export const UPGRADES: readonly Upgrade[] = [
  {
    id: 'afterburner',
    name: 'Afterburner',
    description: 'Boost pushes 20% harder.',
    stacks: true,
    apply: ({ mods }) => (mods.boostAccel *= 1.2),
  },
  {
    id: 'big-tank',
    name: 'Big Tank',
    description: 'Boost capacity up by half.',
    stacks: true,
    apply: ({ mods }) => (mods.boostMax *= 1.5),
  },
  {
    id: 'thrifty',
    name: 'Thrifty',
    description: 'Boost drains 25% more slowly.',
    stacks: true,
    apply: ({ mods }) => (mods.boostDrain *= 0.75),
  },
  {
    id: 'scavenger',
    name: 'Scavenger',
    description: 'Pads give half again as much boost.',
    stacks: true,
    apply: ({ mods }) => (mods.padYield *= 1.5),
  },
  {
    id: 'quick-feet',
    name: 'Quick Feet',
    description: 'Turn 20% tighter.',
    stacks: true,
    apply: ({ mods }) => (mods.turnRate *= 1.2),
  },
  {
    id: 'launch-control',
    name: 'Launch Control',
    description: 'Accelerate 25% faster off the line.',
    stacks: true,
    apply: ({ mods }) => (mods.accel *= 1.25),
  },
  {
    id: 'top-end',
    name: 'Top End',
    description: 'Raise your speed ceiling by 8%.',
    stacks: true,
    apply: ({ mods }) => (mods.maxSpeed *= 1.08),
  },
  {
    id: 'sticky-tyres',
    name: 'Sticky Tyres',
    description: 'A third more grip through corners.',
    stacks: true,
    apply: ({ mods }) => (mods.grip *= 1.33),
  },
  {
    id: 'spring-loaded',
    name: 'Spring Loaded',
    description: 'Jump 25% higher.',
    stacks: true,
    apply: ({ mods }) => (mods.jump *= 1.25),
  },
  {
    id: 'triple-jump',
    name: 'Triple Jump',
    description: 'One extra jump before you land.',
    stacks: false,
    apply: ({ mods }) => (mods.maxJumps += 1),
  },
  {
    id: 'heavy-hitter',
    name: 'Heavy Hitter',
    description: 'Your touches hit 30% harder.',
    stacks: true,
    apply: ({ mods }) => (mods.hitPower *= 1.3),
  },
  {
    id: 'air-brake',
    name: 'Air Brake',
    description: 'A third more control in the air.',
    stacks: true,
    apply: ({ mods }) => (mods.airControl *= 1.33),
  },
  {
    id: 'kick-off',
    name: 'Kick Off',
    description: 'Dodges and flips carry 25% more punch.',
    stacks: true,
    apply: ({ mods }) => (mods.dodge *= 1.25),
  },
  {
    id: 'full-tank',
    name: 'Full Tank',
    description: 'Start every kickoff with a full tank of boost.',
    stacks: false,
    // Through the car's own modifiers, not boost.start: that figure is shared
    // with the bots, and an upgrade that fills everyone's tank is not an
    // upgrade. Capped at the car's tank, so a round that rations boost still
    // wins over this.
    apply: ({ mods }) => (mods.startBoost = 1000),
  },
  {
    id: 'generous-pads',
    name: 'Generous Pads',
    description: 'Boost pads come back twice as fast. Everyone benefits.',
    stacks: false,
    apply: ({ overrides }) => {
      overrides.scale('boost.smallPadRespawn', 0.5);
      overrides.scale('boost.bigPadRespawn', 0.5);
    },
  },
];

/** Looks one up by id. */
export function upgradeById(id: string): Upgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/**
 * Three to choose from. Excludes anything already taken that cannot stack, and
 * never offers the same thing twice in one set.
 */
export function offerUpgrades(
  owned: readonly Upgrade[],
  count = 3,
  random: () => number = Math.random,
): Upgrade[] {
  const ownedIds = new Set(owned.map((u) => u.id));
  const pool = UPGRADES.filter((u) => u.stacks || !ownedIds.has(u.id));

  const bag = [...pool];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  return bag.slice(0, Math.min(count, bag.length));
}

/**
 * Re-applies a run's upgrades from scratch.
 *
 * Called at the start of every round, after the round's own modifiers, so the
 * two layers stack in a fixed order. Rebuilding from defaults each time rather
 * than applying incrementally is what stops repeated rounds compounding an
 * upgrade the player only took once.
 */
export function applyUpgrades(owned: readonly Upgrade[], ctx: UpgradeContext): void {
  for (const upgrade of owned) upgrade.apply(ctx);
}

/** How many of each upgrade the player holds, for the HUD. */
export function tally(owned: readonly Upgrade[]): { upgrade: Upgrade; count: number }[] {
  const counts = new Map<string, { upgrade: Upgrade; count: number }>();
  for (const u of owned) {
    const entry = counts.get(u.id);
    if (entry) entry.count++;
    else counts.set(u.id, { upgrade: u, count: 1 });
  }
  return [...counts.values()];
}
