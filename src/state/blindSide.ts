import { cfg } from '../config';

/**
 * The blind side: a hidden weakness in the opposition, for the memory
 * experiment described at `cfg.experiment.blindSide`.
 *
 * Sides are world z, because that is what the bot and the recordings can
 * measure. The people playing are always team 0 and attack +x, so facing the
 * net they attack, +z is on their right.
 */

export type Side = 1 | -1;

export interface BlindSide {
  /** World z sign of the weak side. +1 is the attacker's right. */
  side: Side;
  /** 0 to 1, how much of the handicap applies. */
  strength: number;
}

/** One for a new run, or null with the experiment off. */
export function pickBlindSide(random: () => number): BlindSide | null {
  const b = cfg.experiment.blindSide;
  if (!b.enabled || b.strength <= 0) return null;
  return { side: random() < 0.5 ? 1 : -1, strength: b.strength };
}

/** Which side of the pitch a lateral position is on, or 0 for the middle. */
export function sideOf(z: number): Side | 0 {
  if (Math.abs(z) < cfg.experiment.blindSide.margin) return 0;
  return z > 0 ? 1 : -1;
}

/** As the person attacking would say it. */
export function describeSide(side: Side): 'right' | 'left' {
  return side === 1 ? 'right' : 'left';
}
