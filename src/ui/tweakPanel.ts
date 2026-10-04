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
  'physics.gravity': [-2000, -100, 5],
  'car.brakeAccel': [500, 8000, 25],
  'car.coastDecel': [0, 2000, 5],
  'car.maxDriveSpeed': [400, 2300, 10],
  'car.maxSpeed': [800, 4000, 10],
  'car.supersonicSpeed': [800, 2300, 10],
  'car.steerWheelbase': [30, 200, 1],
  'car.lateralGrip': [0.005, 0.4, 0.0025],
  'car.handbrakeGrip': [0, 0.3, 0.005],
  'car.powerslideSteerGain': [0.2, 2.5, 0.05],
  'car.rideHeight': [2, 60, 0.5],
  'car.suspensionTravel': [5, 90, 1],
  'car.suspensionStiffness': [5, 150, 0.5],
  'car.suspensionDamping': [0.5, 20, 0.1],
  'car.stickForce': [0, 1500, 5],
  'car.surfaceAlignRate': [1, 30, 0.25],
  'car.colliderRadius': [0, 18, 0.5],
  'car.jumpImpulse': [50, 800, 5],
  'car.jumpAccel': [0, 4000, 10],
  'car.jumpHoldTime': [0, 0.6, 0.01],
  'car.jumpGroundLockout': [0, 0.3, 0.005],
  'car.doubleJumpImpulse': [50, 800, 5],
  'car.dodgeImpulse': [100, 1500, 10],
  'car.dodgeTorque': [1, 12, 0.1],
  'car.airPitchAccel': [2, 40, 0.1],
  'car.airYawAccel': [2, 40, 0.1],
  'car.airRollAccel': [2, 80, 0.25],
  'car.airPitchDamping': [0, 10, 0.05],
  'car.airYawDamping': [0, 10, 0.05],
  'car.airRollDamping': [0, 10, 0.05],
  'car.maxAngularSpeed': [1, 12, 0.1],
  'boost.accel': [100, 3000, 10],
  'boost.drainPerSec': [5, 90, 0.5],
  'boost.start': [0, 100, 1],
  'ball.restitution': [0, 1, 0.01],
  'ball.friction': [0, 2, 0.01],
  'ball.drag': [0, 0.3, 0.005],
  'ball.mass': [5, 200, 1],
  'ball.maxSpeed': [1000, 12000, 50],
  'camera.fov': [60, 130, 1],
  'camera.distance': [100, 700, 5],
  'camera.height': [20, 400, 5],
  'camera.angle': [-20, 10, 0.5],
  'camera.lookAhead': [0, 1200, 10],
  'camera.stiffness': [1, 30, 0.25],
  'camera.velocityBias': [0, 1, 0.01],
  'camera.speedDistanceGain': [0, 300, 5],
  'camera.speedFovGain': [0, 30, 0.5],
};

/** Groups shown, in order. Keys not listed here are hidden to keep it readable. */
const SHOWN: [group: string, keys: string[]][] = [
  ['Physics', ['physics.gravity']],
  [
    'Driving',
    [
      'car.maxDriveSpeed',
      'car.maxSpeed',
      'car.supersonicSpeed',
      'car.brakeAccel',
      'car.coastDecel',
      'car.steerWheelbase',
      'car.lateralGrip',
      'car.handbrakeGrip',
      'car.powerslideSteerGain',
    ],
  ],
  [
    'Ground contact',
    [
      'car.rideHeight',
      'car.suspensionStiffness',
      'car.suspensionDamping',
      'car.suspensionTravel',
      'car.stickForce',
      'car.surfaceAlignRate',
      'car.colliderRadius',
    ],
  ],
  [
    'Jumps & dodges',
    [
      'car.jumpImpulse',
      'car.jumpAccel',
      'car.jumpHoldTime',
      'car.jumpGroundLockout',
      'car.doubleJumpImpulse',
      'car.dodgeImpulse',
      'car.dodgeTorque',
    ],
  ],
  [
    'Air control',
    [
      'car.airPitchAccel',
      'car.airYawAccel',
      'car.airRollAccel',
      'car.airPitchDamping',
      'car.airYawDamping',
      'car.airRollDamping',
      'car.maxAngularSpeed',
    ],
  ],
  ['Boost', ['boost.accel', 'boost.drainPerSec', 'boost.start']],
  ['Ball', ['ball.restitution', 'ball.friction', 'ball.drag', 'ball.mass', 'ball.maxSpeed']],
  [
    'Camera',
    [
      'camera.fov',
      'camera.distance',
      'camera.height',
      'camera.angle',
      'camera.lookAhead',
      'camera.stiffness',
      'camera.velocityBias',
      'camera.speedDistanceGain',
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
      <p class="hint">Live. Editing <code>src/config.ts</code> also applies without a reload. The throttle and steering curves are tables &mdash; edit those in the file.</p>
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
