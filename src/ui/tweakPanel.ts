import { cfg } from '../config';

/**
 * Live tuning panel (press P). Writes straight into the same `cfg` object the
 * simulation reads, so every change takes effect on the next physics step.
 * `Copy values` puts the current numbers on the clipboard in config.ts shape,
 * for when a tuning session produces something worth keeping.
 */

type Range = [min: number, max: number, step: number];

/** Explicit ranges for the constants worth sweeping; others get a sane default. */
const RANGES: Record<string, Range> = {
  'physics.gravity': [-90, -5, 0.5],
  'car.accel': [10, 160, 1],
  'car.maxSpeed': [10, 70, 0.5],
  'car.boostMaxSpeed': [20, 90, 0.5],
  'car.brakeAccel': [10, 200, 1],
  'car.coastDrag': [0, 60, 0.5],
  'car.turnRate': [0.5, 7, 0.05],
  'car.turnSpeedFalloff': [0, 1, 0.01],
  'car.lateralGrip': [1, 60, 0.5],
  'car.driftGripMultiplier': [0, 1, 0.01],
  'car.driftTurnMultiplier': [0.5, 3, 0.05],
  'car.rideHeight': [0.2, 1.5, 0.01],
  'car.colliderRadius': [0, 0.35, 0.01],
  'car.suspensionStiffness': [10, 400, 1],
  'car.suspensionDamping': [0.5, 40, 0.25],
  'car.stickForce': [0, 90, 0.5],
  'car.surfaceAlignRate': [1, 30, 0.25],
  'car.jumpImpulse': [2, 30, 0.1],
  'car.jumpHoldForce': [0, 80, 0.5],
  'car.jumpHoldTime': [0, 0.6, 0.01],
  'car.doubleJumpImpulse': [2, 25, 0.1],
  'car.flipImpulse': [2, 30, 0.1],
  'car.flipTorque': [4, 50, 0.5],
  'car.airPitchTorque': [2, 40, 0.25],
  'car.airYawTorque': [2, 40, 0.25],
  'car.airRollTorque': [2, 50, 0.25],
  'car.maxAngularSpeed': [1, 15, 0.1],
  'boost.force': [10, 300, 1],
  'boost.drainPerSec': [5, 90, 0.5],
  'boost.start': [0, 100, 1],
  'ball.restitution': [0, 1, 0.01],
  'ball.friction': [0, 2, 0.01],
  'ball.linearDamping': [0, 2, 0.01],
  'ball.mass': [5, 200, 1],
  'ball.maxSpeed': [20, 120, 1],
  'ball.hitBoost': [1, 2, 0.01],
  'camera.fov': [50, 130, 1],
  'camera.distance': [4, 30, 0.25],
  'camera.height': [0.5, 15, 0.1],
  'camera.lookAhead': [0, 25, 0.25],
  'camera.stiffness': [1, 30, 0.25],
  'camera.velocityBias': [0, 1, 0.01],
  'camera.speedFovGain': [0, 40, 0.5],
};

/** Groups shown, in order. Keys not listed here are hidden to keep it readable. */
const SHOWN: [group: string, keys: string[]][] = [
  ['Physics', ['physics.gravity']],
  [
    'Driving',
    [
      'car.accel',
      'car.maxSpeed',
      'car.boostMaxSpeed',
      'car.brakeAccel',
      'car.coastDrag',
      'car.turnRate',
      'car.turnSpeedFalloff',
      'car.lateralGrip',
      'car.driftGripMultiplier',
      'car.driftTurnMultiplier',
    ],
  ],
  [
    'Ground contact',
    [
      'car.rideHeight',
      'car.suspensionStiffness',
      'car.suspensionDamping',
      'car.colliderRadius',
      'car.stickForce',
      'car.surfaceAlignRate',
    ],
  ],
  [
    'Jumps & flips',
    [
      'car.jumpImpulse',
      'car.jumpHoldForce',
      'car.jumpHoldTime',
      'car.doubleJumpImpulse',
      'car.flipImpulse',
      'car.flipTorque',
    ],
  ],
  [
    'Air control',
    ['car.airPitchTorque', 'car.airYawTorque', 'car.airRollTorque', 'car.maxAngularSpeed'],
  ],
  ['Boost', ['boost.force', 'boost.drainPerSec', 'boost.start']],
  [
    'Ball',
    [
      'ball.restitution',
      'ball.friction',
      'ball.linearDamping',
      'ball.mass',
      'ball.maxSpeed',
      'ball.hitBoost',
    ],
  ],
  [
    'Camera',
    [
      'camera.fov',
      'camera.distance',
      'camera.height',
      'camera.lookAhead',
      'camera.stiffness',
      'camera.velocityBias',
      'camera.speedFovGain',
    ],
  ],
];

type Bag = Record<string, Record<string, number>>;

function read(path: string): number {
  const [g, k] = path.split('.') as [string, string];
  return (cfg as unknown as Bag)[g]![k]!;
}

function write(path: string, v: number): void {
  const [g, k] = path.split('.') as [string, string];
  (cfg as unknown as Bag)[g]![k] = v;
}

export class TweakPanel {
  private readonly el: HTMLElement;
  private readonly bindings: { path: string; slider: HTMLInputElement; num: HTMLInputElement }[] = [];
  /** Snapshot taken at startup, so Reset always returns to the file's values. */
  private readonly baseline = new Map<string, number>();
  private onChangeCb: (() => void) | undefined;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'panel';
    this.el.hidden = true;
    this.el.innerHTML = `
      <h2>Tuning</h2>
      <p class="hint">Live. Editing <code>src/config.ts</code> also applies without a reload.</p>
      <div class="row">
        <button data-act="copy">Copy values</button>
        <button data-act="reset">Reset</button>
      </div>`;

    for (const [title, paths] of SHOWN) {
      const section = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = title;
      section.appendChild(h);
      for (const path of paths) {
        section.appendChild(this.makeRow(path));
        this.baseline.set(path, read(path));
      }
      this.el.appendChild(section);
    }

    this.el.querySelector('[data-act="copy"]')!.addEventListener('click', () => this.copy());
    this.el.querySelector('[data-act="reset"]')!.addEventListener('click', () => this.reset());

    parent.appendChild(this.el);
    window.addEventListener('config:hot', () => this.syncFromConfig());
  }

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  private makeRow(path: string): HTMLElement {
    const value = read(path);
    const [min, max, step] = RANGES[path] ?? defaultRange(value);

    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = path.split('.')[1]!;
    name.title = path;

    const num = document.createElement('input');
    num.type = 'number';
    num.step = String(step);
    num.value = String(value);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const apply = (v: number, from: 'slider' | 'num'): void => {
      if (!Number.isFinite(v)) return;
      write(path, v);
      if (from === 'slider') num.value = String(v);
      else slider.value = String(v);
      this.onChangeCb?.();
    };
    slider.addEventListener('input', () => apply(Number(slider.value), 'slider'));
    num.addEventListener('change', () => apply(Number(num.value), 'num'));

    label.append(name, num, slider);
    this.bindings.push({ path, slider, num });
    return label;
  }

  private syncFromConfig(): void {
    for (const b of this.bindings) {
      const v = read(b.path);
      b.slider.value = String(v);
      b.num.value = String(v);
    }
    this.onChangeCb?.();
  }

  private reset(): void {
    for (const [path, v] of this.baseline) write(path, v);
    this.syncFromConfig();
  }

  private async copy(): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const b of this.bindings) {
      const [g, k] = b.path.split('.') as [string, string];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(`    ${k}: ${round(read(b.path))},`);
    }
    const text = [...groups]
      .map(([g, lines]) => `  ${g}: {\n${lines.join('\n')}\n  },`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.flash('Copied');
    } catch {
      // Clipboard needs a secure context; the console is a fine fallback.
      console.log(text);
      this.flash('Logged to console');
    }
  }

  private flash(msg: string): void {
    const btn = this.el.querySelector('[data-act="copy"]') as HTMLButtonElement;
    const prev = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => (btn.textContent = prev), 1200);
  }
}

function defaultRange(value: number): Range {
  const mag = Math.abs(value) || 1;
  return [value < 0 ? -mag * 3 : 0, mag * 3, mag / 100];
}

const round = (v: number): number => Math.round(v * 1e4) / 1e4;
