import type { Run, RunSummary } from '../state/run';
import type { RoundSpec } from '../state/round';
import type { BestRun } from '../state/persistence';
import { tally, type Upgrade } from '../state/upgrades';

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
  private readonly picker: HTMLElement;
  private readonly pickerOptions: HTMLElement;
  private readonly owned: HTMLElement;

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
      </div>
      <div class="upgrade-picker" data-picker hidden>
        <div class="picker-head">
          <div class="picker-title" data-picker-title>Round cleared</div>
          <div class="picker-sub">Pick one. It lasts the rest of the run.</div>
        </div>
        <div class="picker-options" data-picker-options></div>
      </div>
      <div class="owned-list" data-owned></div>`;
    parent.appendChild(this.root);

    this.roundLabel = this.root.querySelector('[data-round]') as HTMLElement;
    this.roundSub = this.root.querySelector('[data-round-sub]') as HTMLElement;
    this.mods = this.root.querySelector('[data-mods]') as HTMLElement;
    this.bestLine = this.root.querySelector('[data-best]') as HTMLElement;
    this.card = this.root.querySelector('[data-card]') as HTMLElement;
    this.cardTitle = this.root.querySelector('[data-card-title]') as HTMLElement;
    this.cardBody = this.root.querySelector('[data-card-body]') as HTMLElement;
    this.picker = this.root.querySelector('[data-picker]') as HTMLElement;
    this.pickerOptions = this.root.querySelector('[data-picker-options]') as HTMLElement;
    this.owned = this.root.querySelector('[data-owned]') as HTMLElement;
  }

  /** Shows the three upgrades on offer after a cleared round. */
  offerUpgrades(spec: RoundSpec, offer: readonly Upgrade[]): void {
    this.hideCard();
    (this.root.querySelector('[data-picker-title]') as HTMLElement).textContent =
      `Round ${spec.index} cleared`;
    this.pickerOptions.innerHTML = '';
    for (const [i, upgrade] of offer.entries()) {
      const option = document.createElement('div');
      option.className = 'picker-option';
      option.innerHTML = `
        <div class="picker-key">${i + 1}</div>
        <div class="picker-name"></div>
        <div class="picker-desc"></div>`;
      (option.querySelector('.picker-name') as HTMLElement).textContent = upgrade.name;
      (option.querySelector('.picker-desc') as HTMLElement).textContent = upgrade.description;
      this.pickerOptions.appendChild(option);
    }
    this.picker.hidden = false;
  }

  /** The upgrades held so far, stacked counts rolled up. */
  showOwned(owned: readonly Upgrade[]): void {
    this.picker.hidden = true;
    this.owned.innerHTML = '';
    for (const { upgrade, count } of tally(owned)) {
      const chip = document.createElement('i');
      chip.textContent = count > 1 ? `${upgrade.name} x${count}` : upgrade.name;
      chip.title = upgrade.description;
      this.owned.appendChild(chip);
    }
  }

  showBest(best: BestRun | null): void {
    this.bestLine.textContent = best
      ? `Best run: round ${best.reachedRound} · ${best.roundsCleared} cleared`
      : 'Best run: none yet';
  }

  roundStart(spec: RoundSpec): void {
    this.hideCard();
    this.picker.hidden = true;
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



  runOver(summary: RunSummary): void {
    this.picker.hidden = true;
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
