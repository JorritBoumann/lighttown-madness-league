/**
 * Bot difficulty tiers.
 *
 * Each tier is the same brain with different limits, rather than a different
 * brain: that way a harder opponent reads as a better player and not as a
 * different kind of thing. The gauntlet escalates by walking up these.
 *
 * The knobs that actually make a bot feel weaker, in rough order of how much
 * they matter:
 *
 *  - `reactionDelay` makes it act on a stale picture of the ball. This is what
 *    makes a low tier look like it is thinking slowly rather than playing badly.
 *  - `aimError` scatters where it tries to hit the ball, so its shots miss the
 *    net rather than its driving looking broken.
 *  - `predictionHorizon` is how far ahead it will intercept. At zero it chases
 *    where the ball is now, which is the classic bad-bot look.
 */

export interface BotTier {
  /** 1 is the weakest. Used for labels and for the gauntlet's escalation. */
  level: number;
  name: string;

  /** Seconds of stale ball state the bot acts on. */
  reactionDelay: number;
  /**
   * Sideways scatter on its chosen hit point, in uu.
   *
   * Deliberately a distance and not an angle: an angular error applied from the
   * car is tiny up close and enormous from the halfway line, where a tenth of a
   * radian is a couple of hundred uu and the bot simply drives past the ball.
   * As a distance it means the same thing wherever the bot is standing, and it
   * reads as a player who hits the ball slightly off-centre.
   */
  aimError: number;
  /** How often the scatter is re-rolled, in seconds. */
  aimErrorInterval: number;
  /**
   * Seconds ahead it will look to intercept. 0 chases the ball's position.
   *
   * Capped around 1.4 even at the top tier: the predictor ignores the corner
   * panels and every car, so past that its answer is a guess, and a bot that
   * commits to a bad guess plays *worse* than one that chases what it can see.
   */
  predictionHorizon: number;

  /** Caps throttle, so weak tiers are slower without being made clumsy. */
  throttleCap: number;
  /** Willingness to boost at all. */
  usesBoost: boolean;
  /** Keeps this much boost in reserve rather than burning it all. */
  boostReserve: number;
  /** Detours to collect boost pads when low. */
  managesBoost: boolean;
  /** Boost level below which collecting becomes worth a detour. */
  boostLowMark: number;

  /** Falls back to defend its own net instead of always chasing. */
  defends: boolean;
  /** Flips into the ball for power, and jumps at high balls. */
  usesDodges: boolean;
  /**
   * Leaves the ground to meet a ball in the air.
   *
   * Off everywhere at present. The air control underneath works — a car asked
   * to point somewhere gets there and holds it, and will climb over a thousand
   * units under boost — but choosing *when* to go and arriving with the right
   * speed does not, and measured over fifty lofted balls a bot that tries
   * touches the ball less often than one that stays down: eleven times out of
   * fifty against eighteen. Turning it on is a regression until the launch is
   * planned properly. See README.
   */
  usesAerials: boolean;
  /** Powerslides through tight turns. */
  usesPowerslide: boolean;
}

/** The tiers, weakest first. */
export const TIERS: readonly BotTier[] = [
  {
    level: 1,
    name: 'Rookie',
    reactionDelay: 0.34,
    aimError: 260,
    aimErrorInterval: 0.6,
    predictionHorizon: 0,
    throttleCap: 0.72,
    usesBoost: false,
    boostReserve: 0,
    managesBoost: false,
    boostLowMark: 0,
    defends: false,
    usesDodges: false,
    usesAerials: false,
    usesPowerslide: false,
  },
  {
    level: 2,
    name: 'Amateur',
    reactionDelay: 0.22,
    aimError: 150,
    aimErrorInterval: 0.5,
    predictionHorizon: 0.5,
    throttleCap: 0.88,
    usesBoost: true,
    boostReserve: 20,
    managesBoost: false,
    boostLowMark: 0,
    defends: false,
    usesDodges: false,
    usesAerials: false,
    usesPowerslide: true,
  },
  {
    level: 3,
    name: 'Pro',
    reactionDelay: 0.13,
    aimError: 75,
    aimErrorInterval: 0.45,
    predictionHorizon: 1.0,
    throttleCap: 1,
    usesBoost: true,
    boostReserve: 10,
    managesBoost: true,
    boostLowMark: 20,
    defends: true,
    usesDodges: true,
    usesAerials: false,
    usesPowerslide: true,
  },
  {
    level: 4,
    name: 'Veteran',
    reactionDelay: 0.07,
    aimError: 35,
    aimErrorInterval: 0.4,
    predictionHorizon: 1.2,
    throttleCap: 1,
    usesBoost: true,
    boostReserve: 0,
    managesBoost: true,
    boostLowMark: 30,
    defends: true,
    usesDodges: true,
    usesAerials: false,
    usesPowerslide: true,
  },
  {
    level: 5,
    name: 'Champion',
    reactionDelay: 0.03,
    // Not zero on purpose: a dead-centre strike sends the ball straight back
    // down the line the bot is already on, so it arrives at its own rebound.
    // A little scatter keeps it out of its own way.
    aimError: 22,
    aimErrorInterval: 0.35,
    predictionHorizon: 1.4,
    throttleCap: 1,
    usesBoost: true,
    boostReserve: 0,
    managesBoost: true,
    boostLowMark: 25,
    defends: true,
    usesDodges: true,
    usesAerials: false,
    usesPowerslide: true,
  },
];

/** Clamps to the available tiers, so escalation past the top just stays there. */
export function tier(level: number): BotTier {
  const i = Math.max(1, Math.min(TIERS.length, Math.round(level))) - 1;
  return TIERS[i]!;
}
