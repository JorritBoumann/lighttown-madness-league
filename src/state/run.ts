import { buildRound, type RoundSpec } from './round';
import { isBossRound } from './bosses';
import type { MatchResult } from './match';
import { loadBestRun, saveBestRun, type BestRun } from './persistence';
import { offerUpgrades, type Upgrade } from './upgrades';
import { pickBlindSide, type BlindSide } from './blindSide';

/**
 * A run: a sequence of escalating rounds that have to be cleared back to back.
 * Losing one ends the run and resets progress to nothing.
 *
 * Owns no entities and runs no physics, like Match. It is told how a round
 * finished and says what happens next.
 */

export type RunPhase =
  /** Waiting at the menu. */
  | 'idle'
  /** A round is being played. */
  | 'round'
  /** Round cleared; the player is choosing an upgrade. */
  | 'between'
  /** Run finished, for better or worse. */
  | 'over';

export interface RunStats {
  roundsCleared: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Seconds of play across the run. */
  duration: number;
  /**
   * Things the player did, accumulated by the game rather than the run.
   *
   * The run owns the score because it decides the score; it does not own how
   * far you drove, so these are handed in. Kept in one bag so adding another
   * does not mean threading another argument through three layers.
   */
  driving: DrivingStats;
}

/** Accumulated across a whole run, not reset between rounds. */
export interface DrivingStats {
  /** Unreal units travelled on the ground and in the air. */
  distance: number;
  /** Fastest the car went, in uu/s. */
  topSpeed: number;
  /** Seconds above supersonic, and seconds with no wheel on a surface. */
  supersonicSeconds: number;
  airborneSeconds: number;
  /** Touches on the ball, and the fastest the ball left one of them. */
  touches: number;
  hardestTouch: number;
  /** Boost pads taken, and boost burned. */
  pads: number;
  boostSpent: number;
}

export function emptyDrivingStats(): DrivingStats {
  return {
    distance: 0,
    topSpeed: 0,
    supersonicSeconds: 0,
    airborneSeconds: 0,
    touches: 0,
    hardestTouch: 0,
    pads: 0,
    boostSpent: 0,
  };
}

/** One round as it turned out, for the summary's round-by-round list. */
export interface RoundRecord {
  index: number;
  label: string;
  /** Player first. */
  score: readonly [number, number];
  cleared: boolean;
  /** True for a boss round, so the summary can mark it. */
  boss: boolean;
}

export interface RunSummary extends RunStats {
  /** The round the run ended on. */
  reachedRound: number;
  /** How every round went, in order. */
  rounds: readonly RoundRecord[];
  /** True if the player lost rather than quitting. */
  lost: boolean;
  /** True if this beat the stored best. */
  newBest: boolean;
}

export interface RunHandlers {
  /** A round is ready to be played. */
  onRoundStart?(spec: RoundSpec): void;
  /** A round was cleared, and these are the upgrades on offer. */
  onRoundCleared?(spec: RoundSpec, stats: RunStats, offer: readonly Upgrade[]): void;
  /** The player took an upgrade. */
  onUpgradeTaken?(upgrade: Upgrade, owned: readonly Upgrade[]): void;
  onRunOver?(summary: RunSummary): void;
}

export class Run {
  phase: RunPhase = 'idle';
  /** The round being played, or the one just finished. */
  spec: RoundSpec | null = null;
  readonly stats: RunStats = {
    roundsCleared: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    duration: 0,
    driving: emptyDrivingStats(),
  };
  /** How each round went, in order, for the summary. */
  private readonly rounds: RoundRecord[] = [];
  summary: RunSummary | null = null;
  best: BestRun | null;
  /** Upgrades taken this run, in the order they were taken. */
  readonly upgrades: Upgrade[] = [];
  /** The three on offer while between rounds; empty otherwise. */
  offer: Upgrade[] = [];
  /** The opposition's hidden weak side for this run; see blindSide.ts. */
  blindSide: BlindSide | null = null;

  constructor(
    private readonly handlers: RunHandlers = {},
    private readonly random: () => number = Math.random,
  ) {
    this.best = loadBestRun();
  }

  /** Current round number, one-based. 0 before the run starts. */
  get round(): number {
    return this.spec?.index ?? 0;
  }

  /** Starts a fresh run at round one. */
  start(): void {
    this.stats.roundsCleared = 0;
    this.stats.goalsFor = 0;
    this.stats.goalsAgainst = 0;
    this.stats.duration = 0;
    Object.assign(this.stats.driving, emptyDrivingStats());
    this.rounds.length = 0;
    this.summary = null;
    this.upgrades.length = 0;
    this.offer = [];
    this.blindSide = pickBlindSide(this.random);
    this.beginRound(1);
  }

  /** Called when the round's match ends. */
  finishRound(result: MatchResult, playedSeconds: number): void {
    if (this.phase !== 'round' || !this.spec) return;

    this.stats.goalsFor += result.score[0];
    this.stats.goalsAgainst += result.score[1];
    this.stats.duration += playedSeconds;

    // Logged whatever the outcome: the round that ended the run is the one the
    // summary most wants to show.
    this.rounds.push({
      index: this.spec.index,
      label: this.spec.label,
      score: [result.score[0], result.score[1]],
      cleared: result.winner === 0,
      boss: isBossRound(this.spec.index),
    });

    // Team 0 is the player. A draw cannot happen while rounds use sudden death,
    // but if one ever does it counts against the player: the gauntlet is
    // cleared by winning, not by not losing.
    if (result.winner === 0) {
      this.stats.roundsCleared++;
      this.phase = 'between';
      this.offer = offerUpgrades(this.upgrades, 3, this.random);
      this.handlers.onRoundCleared?.(this.spec, { ...this.stats }, this.offer);
      return;
    }

    this.endRun(true);
  }

  /**
   * Takes one of the offered upgrades and starts the next round.
   * Out-of-range picks are ignored rather than skipping the choice.
   */
  choose(index: number): void {
    if (this.phase !== 'between' || !this.spec) return;
    const upgrade = this.offer[index];
    if (!upgrade) return;
    this.upgrades.push(upgrade);
    this.handlers.onUpgradeTaken?.(upgrade, this.upgrades);
    this.offer = [];
    this.beginRound(this.spec.index + 1);
  }

  /** Starts the next round without taking anything. */
  advance(): void {
    if (this.phase !== 'between' || !this.spec) return;
    this.offer = [];
    this.beginRound(this.spec.index + 1);
  }

  /** Gives up on the current run. */
  abandon(): void {
    if (this.phase === 'idle' || this.phase === 'over') return;
    this.endRun(false);
  }

  private beginRound(index: number): void {
    this.spec = buildRound(index, this.random, this.blindSide);
    this.phase = 'round';
    this.handlers.onRoundStart?.(this.spec);
  }

  private endRun(lost: boolean): void {
    const summary: RunSummary = {
      ...this.stats,
      // Copied, not shared: the summary outlives the run and the run's own
      // stats are reset the moment the player starts another one.
      driving: { ...this.stats.driving },
      rounds: this.rounds.map((r) => ({ ...r })),
      reachedRound: this.spec?.index ?? 0,
      lost,
      newBest: false,
    };
    summary.newBest = saveBestRun({
      roundsCleared: summary.roundsCleared,
      reachedRound: summary.reachedRound,
      goalsFor: summary.goalsFor,
      goalsAgainst: summary.goalsAgainst,
      duration: summary.duration,
      setAt: new Date().toISOString(),
    });
    if (summary.newBest) this.best = loadBestRun();

    this.summary = summary;
    this.phase = 'over';
    this.handlers.onRunOver?.(summary);
  }
}
