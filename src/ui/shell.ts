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

export type Screen = 'title' | 'online' | 'playing' | 'paused' | 'summary';

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
      title: 'Lighttown Madness League',
      subtitle: 'Clear the rounds back to back. One loss ends the run.',
      bodyHtml: `<dl>${bestRows}${padRow}</dl>`,
      items: [
        { id: 'start', label: 'Start run', hint: 'Round one. Escalates from there.' },
        { id: 'freeplay', label: 'Free play', hint: 'No clock, no opponents. Get a feel for the car.' },
        { id: 'online', label: 'Play online', hint: 'Make a room, or join one with a code.' },
        { id: 'mute', label: muted ? 'Sound: off' : 'Sound: on' },
      ],
      footer: 'Arrows or 1-4 to choose · Enter to select',
    });
  }

  showOnline(): void {
    this.screen = 'online';
    this.menu.show({
      title: 'Play online',
      subtitle: 'A shared run against the bots, with up to two of you in a room.',
      items: [
        { id: 'create', label: 'Make a room', hint: 'You get a code to send to a friend.' },
        { id: 'joinroom', label: 'Join a room', hint: 'Type the code someone sent you.' },
        { id: 'back', label: 'Back' },
      ],
      footer: 'Arrows or 1-3 to choose · Enter to select',
    });
  }

  /**
   * The code box.
   *
   * Enter and Escape are handled by the box itself rather than by the menu: the
   * keyboard deliberately ignores keys aimed at a text field, so the menu never
   * hears them while you are typing. The error goes in the subtitle, which is
   * set as text -- it can echo what was typed, and what was typed is not ours.
   */
  showJoin(onSubmit: (code: string) => void, onCancel: () => void, error?: string): void {
    this.screen = 'online';
    this.menu.show({
      title: 'Join a room',
      subtitle: error ?? 'Four letters and digits.',
      bodyHtml:
        '<input class="room-input" maxlength="6" autocomplete="off" autocapitalize="characters" ' +
        'spellcheck="false" aria-label="Room code" placeholder="ABCD">',
      items: [],
      footer: 'Enter to join · Esc to go back',
    });
    const input = this.menu.body.querySelector('input');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    });
    // After the menu has drawn, or the focus lands on nothing.
    requestAnimationFrame(() => input.focus());
  }

  /** A message with a single way out, for refusals and dropped connections. */
  showMessage(title: string, message: string, action = { id: 'leave', label: 'Back to title' }): void {
    this.screen = 'online';
    this.menu.show({
      title,
      subtitle: message,
      items: [action],
      footer: 'Enter to continue',
    });
  }

  /** While a connection is being made: nothing to choose yet. */
  showConnecting(where: string): void {
    this.screen = 'online';
    this.menu.show({ title: 'Connecting', subtitle: where, items: [] });
  }

  showPause(roundLabel: string, muted: boolean, room: string | null = null): void {
    this.screen = 'paused';
    // Online, the match does not stop because one person opened a menu, and
    // restarting the run is not one person's call -- so neither is offered.
    if (room) {
      this.menu.show({
        title: 'Menu',
        subtitle: `${roundLabel} · room ${room} · the match carries on`,
        items: [
          { id: 'resume', label: 'Back to the match' },
          { id: 'mute', label: muted ? 'Sound: off' : 'Sound: on' },
          { id: 'leave', label: 'Leave room' },
        ],
      });
      return;
    }
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
