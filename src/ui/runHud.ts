import type { Run, RunSummary } from '../state/run';
import type { RoundSpec } from '../state/round';
import type { BestRun } from '../state/persistence';

/**
 * Run furniture: which round you are on and what is odd about it, the cleared
 * banner, and the summary when the run dies.
 *
 * The match HUD owns the scoreboard and clock; this sits alongside it.
 */
export class RunHud {
  private readonly root: HTMLElement;
  private readonly roundLabel: HTMLElement;
  private readonly roundSub: HTMLElement;
  private readonly mods: HTMLElement;
  private readonly bestLine: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardBody: HTMLElement;

  /** Seconds the round-intro strip stays expanded. */
  private introTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.innerHTML = `
      <div class="round-strip">
        <div class="round-no" data-round>Round 1</div>
        <div class="round-sub" data-round-sub></div>
        <div class="round-mods" data-mods></div>
      </div>
      <div class="best-line" data-best></div>
      <div class="run-card" data-card hidden>
        <div class="run-card-title" data-card-title></div>
        <div class="run-card-body" data-card-body></div>
      </div>`;
    parent.appendChild(this.root);

    this.roundLabel = this.root.querySelector('[data-round]') as HTMLElement;
    this.roundSub = this.root.querySelector('[data-round-sub]') as HTMLElement;
    this.mods = this.root.querySelector('[data-mods]') as HTMLElement;
    this.bestLine = this.root.querySelector('[data-best]') as HTMLElement;
    this.card = this.root.querySelector('[data-card]') as HTMLElement;
    this.cardTitle = this.root.querySelector('[data-card-title]') as HTMLElement;
    this.cardBody = this.root.querySelector('[data-card-body]') as HTMLElement;
  }

  showBest(best: BestRun | null): void {
    this.bestLine.textContent = best
      ? `Best run: round ${best.reachedRound} · ${best.roundsCleared} cleared`
      : 'Best run: none yet';
  }

  roundStart(spec: RoundSpec): void {
    this.hideCard();
    this.roundLabel.textContent = `Round ${spec.index}`;
    this.roundLabel.classList.toggle('boss', spec.isBoss);
    this.roundSub.textContent = `${spec.label} · first to ${spec.rules.goalTarget} · ${Math.round(
      spec.rules.durationSeconds,
    )}s`;

    this.mods.innerHTML = '';
    for (const mod of spec.modifiers) {
      const chip = document.createElement('i');
      chip.textContent = mod.name;
      chip.title = mod.description;
      this.mods.appendChild(chip);
    }
    this.introTimer = 4;
    this.root.querySelector('.round-strip')!.classList.add('intro');
  }

  roundCleared(spec: RoundSpec): void {
    this.showCard('Round cleared', `Round ${spec.index} down. Next one starting.`);
  }

  runOver(summary: RunSummary): void {
    const title = summary.lost ? 'Run over' : 'Run abandoned';
    const lines = [
      `Reached round ${summary.reachedRound}`,
      `${summary.roundsCleared} round${summary.roundsCleared === 1 ? '' : 's'} cleared`,
      `Goals ${summary.goalsFor} for, ${summary.goalsAgainst} against`,
      `${Math.round(summary.duration)}s played`,
      summary.newBest ? 'New best run' : '',
      'Press R to start a new run',
    ].filter(Boolean);
    this.showCard(title, lines.join('<br>'), summary.newBest);
  }

  update(run: Run, dt: number): void {
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.root.querySelector('.round-strip')!.classList.remove('intro');
      }
    }
    // The cleared card is dismissed by the next round starting, so nothing to
    // time out here; only the summary is sticky, and R clears that.
    void run;
  }

  private showCard(title: string, bodyHtml: string, highlight = false): void {
    this.cardTitle.textContent = title;
    this.cardBody.innerHTML = bodyHtml;
    this.card.classList.toggle('best', highlight);
    this.card.hidden = false;
  }

  private hideCard(): void {
    this.card.hidden = true;
  }
}
