import type { CarInput } from './types';
import { emptyInput } from './types';
import { Keyboard } from './keyboard';
import { PadSource } from './gamepad';
import { KEY_BINDINGS, type Action } from './actions';

/**
 * The player's controls: keyboard and gamepad behind one interface.
 *
 * Both are live at once and merged rather than one being "selected". Switching
 * device should be a matter of picking the other one up, not of finding a
 * setting, and someone steering with a stick while boosting with Shift is doing
 * nothing wrong.
 */
export type Device = 'keyboard' | 'gamepad';

export class Controls {
  readonly keyboard: Keyboard;
  readonly pad = new PadSource();

  private readonly merged: CarInput = emptyInput();
  /** Whichever was used most recently, for showing the right hints. */
  private lastUsed: Device = 'keyboard';

  constructor(target: Window = window) {
    this.keyboard = new Keyboard(target);
  }

  get device(): Device {
    return this.lastUsed;
  }

  get padConnected(): boolean {
    return this.pad.connected;
  }

  /** Poll devices. Call once at the top of a frame. */
  poll(): void {
    this.pad.poll();
    if (this.pad.anyPressed) this.lastUsed = 'gamepad';
    else if (this.keyboard.anyPressed) this.lastUsed = 'keyboard';
  }

  /**
   * Car controls for this step, keyboard and pad combined.
   *
   * Analog axes take whichever input is pushed further rather than being added,
   * so holding a key while a stick is half over does not overshoot. Buttons are
   * an or, and the jump latch is consumed from both so a tap on either is acted
   * on exactly once.
   */
  read(): CarInput {
    const keys = this.keyboard.read();
    const pad = this.pad.read();
    const out = this.merged;
    if (!pad) {
      Object.assign(out, keys);
      return out;
    }
    out.throttle = larger(keys.throttle, pad.throttle);
    out.steer = larger(keys.steer, pad.steer);
    out.pitch = larger(keys.pitch, pad.pitch);
    out.roll = larger(keys.roll, pad.roll);
    out.jumpPressed = keys.jumpPressed || pad.jumpPressed;
    out.jumpHeld = keys.jumpHeld || pad.jumpHeld;
    out.boost = keys.boost || pad.boost;
    out.drift = keys.drift || pad.drift;
    return out;
  }

  /** True on the frame an action was triggered by either device. */
  pressed(action: Action): boolean {
    for (const code of KEY_BINDINGS[action]) {
      if (this.keyboard.wasPressed(code)) return true;
    }
    return this.pad.pressed(action);
  }

  /** Any input at all this frame, which is the gesture audio needs. */
  get anyPressed(): boolean {
    return this.keyboard.anyPressed || this.pad.anyPressed;
  }

  /** Call once per rendered frame, after reading. */
  endFrame(): void {
    this.keyboard.endFrame();
  }

  destroy(): void {
    this.keyboard.destroy();
  }
}

/** Whichever is pushed further from centre, keeping its sign. */
function larger(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}
