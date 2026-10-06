import type { CarInput } from './types';
import { emptyInput } from './types';
import { Keyboard } from './keyboard';
import { PadSource } from './gamepad';
import { KEY_BINDINGS, type Action } from './actions';
import type { TouchSource } from './touch';

/**
 * The player's controls: keyboard and gamepad behind one interface.
 *
 * Both are live at once and merged rather than one being "selected". Switching
 * device should be a matter of picking the other one up, not of finding a
 * setting, and someone steering with a stick while boosting with Shift is doing
 * nothing wrong.
 */
export type Device = 'keyboard' | 'gamepad' | 'touch';

export class Controls {
  readonly keyboard: Keyboard;
  readonly pad = new PadSource();

  private readonly merged: CarInput = emptyInput();
  /** On-screen controls, when the page has been given a place to draw them. */
  private touch: TouchSource | null = null;
  /** The on-screen pause, held for the whole frame it was pressed in. */
  private touchPause = false;
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

  /** Adds on-screen controls as a third source. */
  attachTouch(touch: TouchSource): void {
    this.touch = touch;
  }

  /** Poll devices. Call once at the top of a frame. */
  poll(): void {
    this.pad.poll();
    // Taken once and held for the frame, because several places ask whether
    // pause was pressed and a latch read by the first would be gone by the
    // second.
    this.touchPause = this.touch?.takePause() ?? false;
    if (this.pad.anyPressed) this.lastUsed = 'gamepad';
    else if (this.touch?.anyPressed) this.lastUsed = 'touch';
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
    const out = this.merged;
    Object.assign(out, this.keyboard.read());
    for (const other of [this.pad.read(), this.touch?.read() ?? null]) {
      if (!other) continue;
      out.throttle = larger(out.throttle, other.throttle);
      out.steer = larger(out.steer, other.steer);
      out.pitch = larger(out.pitch, other.pitch);
      out.roll = larger(out.roll, other.roll);
      out.jumpPressed = out.jumpPressed || other.jumpPressed;
      out.jumpHeld = out.jumpHeld || other.jumpHeld;
      out.boost = out.boost || other.boost;
      out.drift = out.drift || other.drift;
    }
    return out;
  }

  /** True on the frame an action was triggered by either device. */
  pressed(action: Action): boolean {
    if (action === 'pause' && this.touchPause) return true;
    for (const code of KEY_BINDINGS[action]) {
      if (this.keyboard.wasPressed(code)) return true;
    }
    return this.pad.pressed(action);
  }

  /** Any input at all this frame, which is the gesture audio needs. */
  get anyPressed(): boolean {
    return this.keyboard.anyPressed || this.pad.anyPressed || (this.touch?.anyPressed ?? false);
  }

  /** Call once per rendered frame, after reading. */
  endFrame(): void {
    this.keyboard.endFrame();
    this.touch?.endFrame();
    this.touchPause = false;
  }

  destroy(): void {
    this.keyboard.destroy();
  }
}

/** Whichever is pushed further from centre, keeping its sign. */
function larger(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}
