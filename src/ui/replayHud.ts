/**
 * The replay badge.
 *
 * Small and in the corner, with the usual recording dot. Its real job is
 * telling you that what you are watching already happened — without it a
 * replay is indistinguishable from the game having rewound itself, and the
 * second thing it does is say the replay can be skipped, because by round
 * twenty nobody wants to watch another one.
 */
export class ReplayHud {
  private readonly root: HTMLElement;
  private elapsed = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'replay-badge';
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="replay-dot"></span>
      <b>Replay</b>
      <span class="replay-skip">Space to skip</span>
    `;
    parent.appendChild(this.root);
  }

  show(): void {
    this.elapsed = 0;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  update(dt: number): void {
    this.elapsed += dt;
    // The dot blinks, which is what makes it read as a recording light rather
    // than a full stop.
    this.root.classList.toggle('on', this.elapsed % 1 < 0.5);
  }
}
