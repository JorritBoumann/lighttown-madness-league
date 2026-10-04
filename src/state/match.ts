import { cfg } from '../config';

/**
 * Match flow: the clock, the score, goal detection and the phase machine.
 *
 * Deliberately owns no entities. It is told where the ball is and reports what
 * happened; resetting cars and the ball for a kickoff is the caller's job. That
 * keeps it testable without a physics world, and means the gauntlet can drive
 * it with whatever rules a round calls for.
 */

export type Team = 0 | 1;

export type MatchPhase =
  /** Frozen on the kickoff line, clock not running. */
  | 'countdown'
  | 'playing'
  /** Goal scored; play continues for show, then a kickoff. */
  | 'goal'
  | 'ended';

export interface MatchRules {
  durationSeconds: number;
  /** First to this many goals wins immediately. 0 = decided on time alone. */
  goalTarget: number;
  countdown: number;
  goalPause: number;
  suddenDeath: boolean;
}

export interface GoalEvent {
  /** The team the goal counts for. */
  team: Team;
  /** Scored by the conceding team's own last touch. */
  ownGoal: boolean;
  score: readonly [number, number];
  /** True if this goal ended the match. */
  decisive: boolean;
}

export interface MatchResult {
  /** null is a draw, only possible with sudden death off. */
  winner: Team | null;
  score: readonly [number, number];
  /** Whether it was settled in sudden death. */
  overtime: boolean;
  reason: 'goal-target' | 'time' | 'sudden-death';
}

export interface MatchHandlers {
  onGoal?(event: GoalEvent): void;
  /** Fired when the next kickoff should be set up. */
  onKickoff?(): void;
  onEnd?(result: MatchResult): void;
}

/** The minimum the match needs to know about the ball. */
export interface BallLike {
  position: { x: number; y: number; z: number };
  radius: number;
}

/** Team 0 defends the -x end and attacks +x. Team 1 is the mirror. */
export const defendedEnd = (team: Team): 1 | -1 => (team === 0 ? -1 : 1);

export function defaultRules(): MatchRules {
  return {
    durationSeconds: cfg.match.durationSeconds,
    goalTarget: cfg.match.goalTarget,
    countdown: cfg.match.countdown,
    goalPause: cfg.match.goalPause,
    suddenDeath: cfg.match.suddenDeath,
  };
}

export class Match {
  readonly rules: MatchRules;
  phase: MatchPhase = 'countdown';
  /** Seconds remaining. Counts up once sudden death starts. */
  clock: number;
  readonly score: [number, number] = [0, 0];
  overtime = false;
  result: MatchResult | null = null;
  /** Who touched the ball last, for own goals. Null until someone does. */
  lastTouch: Team | null = null;
  /** Goals conceded and scored, for the run summary later. */
  readonly goals: GoalEvent[] = [];

  private phaseTimer: number;

  constructor(
    rules: Partial<MatchRules> = {},
    private readonly handlers: MatchHandlers = {},
  ) {
    this.rules = { ...defaultRules(), ...rules };
    this.clock = this.rules.durationSeconds;
    this.phaseTimer = this.rules.countdown;
  }

  get running(): boolean {
    return this.phase === 'playing';
  }

  get over(): boolean {
    return this.phase === 'ended';
  }

  /** Seconds left on the countdown, for the HUD. */
  get countdownRemaining(): number {
    return this.phase === 'countdown' ? this.phaseTimer : 0;
  }

  /** Records a touch, so an own goal can be attributed. */
  touch(team: Team): void {
    this.lastTouch = team;
  }

  /** One fixed step. `ball` is only read. */
  update(dt: number, ball: BallLike): void {
    switch (this.phase) {
      case 'countdown':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phaseTimer = 0;
          this.phase = 'playing';
        }
        return;

      case 'playing': {
        if (this.overtime) {
          // Sudden death has no clock to run out; show time elapsed instead.
          this.clock += dt;
        } else {
          this.clock -= dt;
        }

        const scoring = this.goalScoredBy(ball);
        if (scoring !== null) {
          this.registerGoal(scoring);
          return;
        }

        if (!this.overtime && this.clock <= 0) {
          this.clock = 0;
          this.finishOnTime();
        }
        return;
      }

      case 'goal':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phase = 'countdown';
          this.phaseTimer = this.rules.countdown;
          this.lastTouch = null;
          this.handlers.onKickoff?.();
        }
        return;

      case 'ended':
        return;
    }
  }

  /**
   * Which team a goal counts for, or null for no goal.
   *
   * The ball has to be *fully* past the line, as in the real game: its centre
   * beyond the line by a full radius. A ball resting on the line is not a goal.
   */
  private goalScoredBy(ball: BallLike): Team | null {
    const line = cfg.arena.goalLine + ball.radius;
    const { x, y, z } = ball.position;
    if (Math.abs(x) < line) return null;
    // Inside the mouth. Redundant while the goal box is sealed, but this is the
    // rule, and it keeps a stray ball behind the net from counting.
    if (Math.abs(z) > cfg.arena.goalWidth / 2) return null;
    if (y > cfg.arena.goalHeight) return null;
    // Ball in the +x goal is a goal for the team attacking that end: team 0.
    return x > 0 ? 0 : 1;
  }

  private registerGoal(team: Team): void {
    this.score[team]++;
    const conceding: Team = team === 0 ? 1 : 0;
    const ownGoal = this.lastTouch === conceding;

    const decisive =
      this.overtime ||
      (this.rules.goalTarget > 0 && this.score[team] >= this.rules.goalTarget);

    const event: GoalEvent = {
      team,
      ownGoal,
      score: [this.score[0], this.score[1]],
      decisive,
    };
    this.goals.push(event);
    this.handlers.onGoal?.(event);

    if (decisive) {
      this.end({
        winner: team,
        score: event.score,
        overtime: this.overtime,
        reason: this.overtime ? 'sudden-death' : 'goal-target',
      });
      return;
    }

    this.phase = 'goal';
    this.phaseTimer = this.rules.goalPause;
  }

  private finishOnTime(): void {
    const [a, b] = this.score;
    if (a === b) {
      if (this.rules.suddenDeath) {
        this.overtime = true;
        this.clock = 0;
        // Straight back to a kickoff for the decider.
        this.phase = 'goal';
        this.phaseTimer = this.rules.goalPause;
        return;
      }
      this.end({ winner: null, score: [a, b], overtime: false, reason: 'time' });
      return;
    }
    this.end({
      winner: a > b ? 0 : 1,
      score: [a, b],
      overtime: false,
      reason: 'time',
    });
  }

  private end(result: MatchResult): void {
    this.result = result;
    this.phase = 'ended';
    this.handlers.onEnd?.(result);
  }
}

/** Clock as m:ss, for the HUD. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
