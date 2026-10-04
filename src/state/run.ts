import { buildRound, type RoundSpec } from './round';
import type { MatchResult } from './match';
import { loadBestRun, saveBestRun, type BestRun } from './persistence';

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
  /** Round cleared, picking an upgrade. Step 5 fills this in. */
  | 'between'
  /** Run finished, for better or worse. */
  | 'over';

export interface RunStats {
  roundsCleared: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Seconds of play across the run. */
  duration: number;
}

export interface RunSummary extends RunStats {
  /** The round the run ended on. */
  reachedRound: number;
  /** True if the player lost rather than quitting. */
  lost: boolean;
  /** True if this beat the stored best. */
  newBest: boolean;
}

export interface RunHandlers {
  /** A round is ready to be played. */
  onRoundStart?(spec: RoundSpec): void;
  /** A round was cleared. */
  onRoundCleared?(spec: RoundSpec, stats: RunStats): void;
  onRunOver?(summary: RunSummary): void;
}

export class Run {
  phase: RunPhase = 'idle';
  /** The round being played, or the one just finished. */
  spec: RoundSpec | null = null;
  readonly stats: RunStats = { roundsCleared: 0, goalsFor: 0, goalsAgainst: 0, duration: 0 };
  summary: RunSummary | null = null;
  best: BestRun | null;

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
    this.summary = null;
    this.beginRound(1);
  }

  /** Called when the round's match ends. */
  finishRound(result: MatchResult, playedSeconds: number): void {
    if (this.phase !== 'round' || !this.spec) return;

    this.stats.goalsFor += result.score[0];
    this.stats.goalsAgainst += result.score[1];
    this.stats.duration += playedSeconds;

    // Team 0 is the player. A draw cannot happen while rounds use sudden death,
    // but if one ever does it counts against the player: the gauntlet is
    // cleared by winning, not by not losing.
    if (result.winner === 0) {
      this.stats.roundsCleared++;
      this.phase = 'between';
      this.handlers.onRoundCleared?.(this.spec, { ...this.stats });
      return;
    }

    this.endRun(true);
  }

  /** Moves from the between-rounds screen into the next round. */
  advance(): void {
    if (this.phase !== 'between' || !this.spec) return;
    this.beginRound(this.spec.index + 1);
  }

  /** Gives up on the current run. */
  abandon(): void {
    if (this.phase === 'idle' || this.phase === 'over') return;
    this.endRun(false);
  }

  private beginRound(index: number): void {
    this.spec = buildRound(index, this.random);
    this.phase = 'round';
    this.handlers.onRoundStart?.(this.spec);
  }

  private endRun(lost: boolean): void {
    const summary: RunSummary = {
      ...this.stats,
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
