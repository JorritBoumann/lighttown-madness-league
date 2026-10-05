import { MenuScreen } from './menuScreen';
import type { RunSummary } from '../state/run';
import type { BestRun } from '../state/persistence';
import { tally, type Upgrade } from '../state/upgrades';

/**
 * The screens around the game: title, pause and run summary.
 *
 * All three are the same menu overlay with different contents, and the shell
 * only reports which item was chosen — it starts nothing and stops nothing
 * itself, so the game keeps a single place where screens change.
 */

export type Screen = 'title' | 'playing' | 'paused' | 'summary';

export class Shell {
  private readonly menu: MenuScreen;
  screen: Screen = 'title';

  constructor(parent: HTMLElement) {
    this.menu = new MenuScreen(parent);
  }

  get visible(): boolean {
    return this.menu.visible;
  }

  showTitle(best: BestRun | null, muted: boolean, padConnected = false): void {
    this.screen = 'title';
    const bestRows = best
      ? `<dt>Best run</dt><dd>round ${best.reachedRound}, ${best.roundsCleared} cleared</dd>
         <dt>Goals</dt><dd>${best.goalsFor} for, ${best.goalsAgainst} against</dd>`
      : '<dt>Best run</dt><dd>none yet</dd>';
    // Pads are invisible to the page until one is touched, so say which it is
    // rather than leaving someone holding a pad to wonder.
    const padRow = `<dt>Controller</dt><dd>${
      padConnected ? 'connected' : 'press any button to connect'
    }</dd>`;
    this.menu.show({
      title: 'Rocket Gauntlet',
      subtitle: 'Clear the rounds back to back. One loss ends the run.',
      bodyHtml: `<dl>${bestRows}${padRow}</dl>`,
      items: [
        { id: 'start', label: 'Start run', hint: 'Round one. Escalates from there.' },
        { id: 'freeplay', label: 'Free play', hint: 'No clock, no opponents. Get a feel for the car.' },
        { id: 'mute', label: muted ? 'Sound: off' : 'Sound: on' },
      ],
      footer: 'Arrows or 1-3 to choose · Enter to select',
    });
  }

  showPause(roundLabel: string, muted: boolean): void {
    this.screen = 'paused';
    this.menu.show({
      title: 'Paused',
      subtitle: roundLabel,
      items: [
        { id: 'resume', label: 'Resume' },
        { id: 'restart', label: 'Restart run', hint: 'Back to round one.' },
        { id: 'mute', label: muted ? 'Sound: off' : 'Sound: on' },
        { id: 'quit', label: 'Quit to title' },
      ],
      footer: 'Esc to resume',
    });
  }

  showSummary(summary: RunSummary, upgrades: readonly Upgrade[], best: BestRun | null): void {
    this.screen = 'summary';

    const chips = tally(upgrades)
      .map((e) => `<i>${escapeHtml(e.count > 1 ? `${e.upgrade.name} x${e.count}` : e.upgrade.name)}</i>`)
      .join('');

    // Round by round, because a gauntlet run is a story and the scoreline of
    // the round that ended it is the part anyone wants to see.
    const rounds = summary.rounds
      .map((r) => {
        const result = r.cleared ? 'cleared' : 'lost';
        return `<li class="${result}${r.boss ? ' boss' : ''}">
          <span class="n">${r.index}</span>
          <span class="what">${escapeHtml(r.label)}</span>
          <span class="score">${r.score[0]}&ndash;${r.score[1]}</span>
        </li>`;
      })
      .join('');

    const d = summary.driving;
    const played = Math.max(1, summary.duration);
    // Distance in kilometres: a run covers tens of thousands of Unreal Units,
    // and "412,000 uu" means nothing to anybody. 1 uu is 1cm.
    const km = (d.distance / 100000).toFixed(2);
    const stat = (label: string, value: string): string =>
      `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

    const statsHtml = [
      stat('Goals', `${summary.goalsFor}`),
      stat('Conceded', `${summary.goalsAgainst}`),
      stat('Ball touches', `${d.touches}`),
      stat('Hardest touch', `${Math.round(d.hardestTouch)}`),
      stat('Top speed', `${Math.round(d.topSpeed)}`),
      stat('Distance', `${km}km`),
      stat('Supersonic', formatDuration(d.supersonicSeconds)),
      stat('Airborne', `${Math.round((d.airborneSeconds / played) * 100)}%`),
      stat('Boost pads', `${d.pads}`),
      stat('Boost used', `${Math.round(d.boostSpent)}`),
    ].join('');

    const bestLine = summary.newBest
      ? '<p class="best-line">A new best run.</p>'
      : best
        ? `<p class="best-line muted">Best: round ${best.reachedRound}, ${best.roundsCleared} cleared.</p>`
        : '';

    this.menu.show({
      title: summary.lost ? 'Run over' : 'Run abandoned',
      subtitle: `Reached round ${summary.reachedRound} · ${summary.roundsCleared} cleared · ${formatDuration(summary.duration)} played`,
      bodyHtml: `
        ${bestLine}
        <div class="summary-stats">${statsHtml}</div>
        ${rounds ? `<ol class="summary-rounds">${rounds}</ol>` : ''}
        ${chips ? `<div class="chips">${chips}</div>` : ''}`,
      items: [
        { id: 'again', label: 'Run it again' },
        { id: 'quit', label: 'Back to title' },
      ],
      footer: 'Enter to select',
    });
  }

  hide(): void {
    this.menu.hide();
  }

  /** Moves the highlight. */
  move(delta: number): void {
    this.menu.move(delta);
  }

  /** The highlighted item's id. */
  get selectedId(): string | null {
    return this.menu.selected?.id ?? null;
  }

  /** Highlights the nth item and returns its id, for number keys. */
  pick(position: number): string | null {
    return this.menu.pick(position)?.id ?? null;
  }
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Upgrade names are ours, but this is markup, so do not take chances. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
