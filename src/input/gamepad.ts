import { cfg } from '../config';
import type { CarInput } from './types';
import { emptyInput } from './types';
import { PAD_BINDINGS, type Action } from './actions';

/**
 * Gamepad source, polled once a frame.
 *
 * The browser hands out immutable snapshots rather than a live object, so there
 * is nothing to subscribe to: every frame reads fresh state and works out the
 * edges itself.
 *
 * Mapping follows Rocket League's own pad defaults, because anyone reaching for
 * a pad for this game already has those in their hands: triggers drive, A
 * jumps, B boosts, X powerslides, the bumpers air roll.
 */

/** Button indices in the W3C standard mapping. */
const BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
} as const;

export class PadSource {
  private readonly input: CarInput = emptyInput();
  /** Buttons that were down last frame, for edge detection. */
  private held = new Set<number>();
  private pressedThisFrame = new Set<number>();
  /** Latched like the keyboard's, so a tap is never missed between steps. */
  private jumpLatched = false;
  private jumpWasDown = false;

  /** Index of the pad being used, or null when none is connected. */
  private index: number | null = null;
  /** Set once a pad has actually been touched, for the "pad in use" hint. */
  used = false;

  get connected(): boolean {
    return this.index !== null;
  }

  /** Poll once per frame, before reading. */
  poll(): void {
    this.pressedThisFrame.clear();
    const pad = this.firstPad();
    if (!pad) {
      this.index = null;
      this.held.clear();
      return;
    }
    this.index = pad.index;

    const down = new Set<number>();
    for (const [i, button] of pad.buttons.entries()) {
      if (isDown(button)) down.add(i);
    }
    for (const i of down) {
      if (!this.held.has(i)) {
        this.pressedThisFrame.add(i);
        this.used = true;
      }
    }
    this.held = down;

    const jumpDown = down.has(BUTTON.A);
    if (jumpDown && !this.jumpWasDown) this.jumpLatched = true;
    this.jumpWasDown = jumpDown;

    // Any real stick movement also counts as the pad being in use.
    if (!this.used && pad.axes.some((a) => Math.abs(a) > 0.5)) this.used = true;
  }

  /** Car controls for this frame, or null when no pad is connected. */
  read(): CarInput | null {
    const pad = this.firstPad();
    if (!pad) return null;
    const i = this.input;
    Object.assign(i, emptyInput());

    const dead = cfg.input.padDeadzone;
    const steer = deadzone(pad.axes[0] ?? 0, dead);
    // Sticks report forward as negative; pitch is positive nose-down, which is
    // what pushing the stick forward should do.
    const pitch = -deadzone(pad.axes[1] ?? 0, dead);

    const forward = analog(pad.buttons[BUTTON.RT]);
    const back = analog(pad.buttons[BUTTON.LT]);

    i.throttle = clamp(forward - back);
    i.steer = steer;
    i.pitch = pitch;
    i.roll =
      (this.held.has(BUTTON.RB) ? 1 : 0) - (this.held.has(BUTTON.LB) ? 1 : 0);
    i.jumpPressed = this.jumpLatched;
    this.jumpLatched = false;
    i.jumpHeld = this.held.has(BUTTON.A);
    i.boost = this.held.has(BUTTON.B);
    i.drift = this.held.has(BUTTON.X);
    return i;
  }

  /** True on the frame an action's button went down. */
  pressed(action: Action): boolean {
    for (const button of PAD_BINDINGS[action]) {
      if (this.pressedThisFrame.has(button)) return true;
    }
    return false;
  }

  /** Any button at all went down this frame. */
  get anyPressed(): boolean {
    return this.pressedThisFrame.size > 0;
  }

  /**
   * The first pad with any button or stick activity, falling back to the first
   * connected one. Picking by activity avoids being hijacked by a dormant
   * second device, which browsers report alongside the one in your hands.
   */
  private firstPad(): globalThis.Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    let fallback: globalThis.Gamepad | null = null;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      fallback ??= pad;
      if (pad.index === this.index) return pad;
      if (pad.buttons.some(isDown) || pad.axes.some((a) => Math.abs(a) > 0.3)) return pad;
    }
    return fallback;
  }
}

function isDown(button: GamepadButton | undefined): boolean {
  if (!button) return false;
  return button.pressed || button.value > cfg.input.padTriggerThreshold;
}

function analog(button: GamepadButton | undefined): number {
  if (!button) return 0;
  // Triggers may be analog or plain buttons depending on the device.
  return button.value > 0 ? button.value : button.pressed ? 1 : 0;
}

function deadzone(value: number, dead: number): number {
  if (Math.abs(value) <= dead) return 0;
  // Rescaled so the travel just past the deadzone is not a jump to full tilt.
  const scaled = (Math.abs(value) - dead) / (1 - dead);
  return Math.sign(value) * Math.min(1, scaled);
}

const clamp = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
