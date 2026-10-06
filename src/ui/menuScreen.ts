/**
 * Keyboard-driven menu overlay.
 *
 * Generic so the title screen, the pause menu and the summary can all be the
 * same thing with different items, rather than three hand-built overlays that
 * drift apart.
 */

export interface MenuItem {
  id: string;
  label: string;
  /** Optional second line under the label. */
  hint?: string;
}

export class MenuScreen {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly footerEl: HTMLElement;

  private items: MenuItem[] = [];
  private index = 0;

  constructor(parent: HTMLElement, className = '') {
    this.root = document.createElement('div');
    this.root.className = `menu-screen ${className}`.trim();
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="menu-panel">
        <div class="menu-title" data-title></div>
        <div class="menu-subtitle" data-subtitle></div>
        <div class="menu-body" data-body></div>
        <ul class="menu-list" data-list></ul>
        <div class="menu-footer" data-footer></div>
      </div>`;
    parent.appendChild(this.root);

    this.titleEl = this.root.querySelector('[data-title]') as HTMLElement;
    this.subtitleEl = this.root.querySelector('[data-subtitle]') as HTMLElement;
    this.bodyEl = this.root.querySelector('[data-body]') as HTMLElement;
    this.listEl = this.root.querySelector('[data-list]') as HTMLElement;
    this.footerEl = this.root.querySelector('[data-footer]') as HTMLElement;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** The detail block, for screens that put a control in it. */
  get body(): HTMLElement {
    return this.bodyEl;
  }

  /** Currently highlighted item, or null if there are none. */
  get selected(): MenuItem | null {
    return this.items[this.index] ?? null;
  }

  show(opts: {
    title: string;
    subtitle?: string;
    /** Trusted markup for the detail block; built by us, never from input. */
    bodyHtml?: string;
    items: MenuItem[];
    footer?: string;
  }): void {
    this.titleEl.textContent = opts.title;
    this.subtitleEl.textContent = opts.subtitle ?? '';
    this.subtitleEl.hidden = !opts.subtitle;
    this.bodyEl.innerHTML = opts.bodyHtml ?? '';
    this.bodyEl.hidden = !opts.bodyHtml;
    this.footerEl.textContent = opts.footer ?? '';
    this.footerEl.hidden = !opts.footer;

    this.items = opts.items;
    this.index = 0;
    this.renderList();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Moves the highlight, wrapping around. */
  move(delta: number): void {
    if (this.items.length === 0) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.renderList();
  }

  /** Jumps straight to an item by its one-based position, for number keys. */
  pick(position: number): MenuItem | null {
    const item = this.items[position - 1];
    if (!item) return null;
    this.index = position - 1;
    this.renderList();
    return item;
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    for (const [i, item] of this.items.entries()) {
      const li = document.createElement('li');
      li.className = i === this.index ? 'on' : '';
      const key = document.createElement('span');
      key.className = 'menu-key';
      key.textContent = String(i + 1);
      const label = document.createElement('span');
      label.className = 'menu-label';
      label.textContent = item.label;
      li.append(key, label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-hint';
        hint.textContent = item.hint;
        li.appendChild(hint);
      }
      this.listEl.appendChild(li);
    }
  }
}
