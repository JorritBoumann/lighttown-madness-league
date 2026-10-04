import { formatClock, type GoalEvent, type Match, type MatchResult } from '../state/match';

/**
 * Scoreboard, clock and the banners: countdown, goal, full time.
 *
 * Reads the match each frame rather than being pushed to, except for the
 * one-off banners which are driven by the match's own events.
 */
export class MatchHud {
  private readonly root: HTMLElement;
  private readonly scoreBlue: HTMLElement;
  private readonly scoreOrange: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;

  /** Seconds the transient banner stays up; 0 means hidden. */
  private bannerTimer = 0;
  /** Set for full time, which stays up until the match restarts. */
  private bannerSticky = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'match-hud';
    this.root.innerHTML = `
      <div class="scoreboard">
        <div class="side blue"><span class="label">Blue</span><b data-blue>0</b></div>
        <div class="clock" data-clock>1:30</div>
        <div class="side orange"><b data-orange>0</b><span class="label">Orange</span></div>
      </div>
      <div class="banner" data-banner hidden>
        <div class="banner-title" data-banner-title></div>
        <div class="banner-sub" data-banner-sub></div>
      </div>`;
    parent.appendChild(this.root);

    this.scoreBlue = this.root.querySelector('[data-blue]') as HTMLElement;
    this.scoreOrange = this.root.querySelector('[data-orange]') as HTMLElement;
    this.clock = this.root.querySelector('[data-clock]') as HTMLElement;
    this.banner = this.root.querySelector('[data-banner]') as HTMLElement;
    this.bannerTitle = this.root.querySelector('[data-banner-title]') as HTMLElement;
    this.bannerSub = this.root.querySelector('[data-banner-sub]') as HTMLElement;
  }

  update(match: Match, dt: number): void {
    this.scoreBlue.textContent = String(match.score[0]);
    this.scoreOrange.textContent = String(match.score[1]);

    if (match.overtime) {
      this.clock.textContent = '+' + formatClock(match.clock);
      this.clock.classList.add('overtime');
    } else {
      this.clock.textContent = formatClock(match.clock);
      this.clock.classList.toggle('low', match.clock <= 10 && match.running);
    }

    // The countdown owns the banner while it runs.
    if (match.phase === 'countdown') {
      const n = Math.ceil(match.countdownRemaining);
      this.show(n > 0 ? String(n) : 'Go', match.overtime ? 'Sudden death' : '', 0);
      return;
    }

    if (this.bannerSticky) return;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hide();
    }
  }

  goal(event: GoalEvent): void {
    const who = event.team === 0 ? 'Blue' : 'Orange';
    this.show(
      event.ownGoal ? 'Own goal' : 'Goal',
      `${who} ${event.score[0]} - ${event.score[1]}`,
      2.2,
    );
  }

  end(result: MatchResult): void {
    const title =
      result.winner === null ? 'Draw' : result.winner === 0 ? 'You win' : 'You lose';
    const detail = `${result.score[0]} - ${result.score[1]}${
      result.overtime ? ' (sudden death)' : ''
    }`;
    this.show(title, `${detail} · press R to play again`, 0);
    this.bannerSticky = true;
  }

  /** Clears a sticky banner, for a restart. */
  reset(): void {
    this.bannerSticky = false;
    this.hide();
  }

  private show(title: string, sub: string, seconds: number): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.hidden = false;
    this.bannerTimer = seconds;
  }

  private hide(): void {
    this.banner.hidden = true;
    this.bannerTimer = 0;
  }
}
