import type { CarInput } from './types';
import { emptyInput } from './types';

/**
 * Keyboard source. Tracks raw key state and folds it into a CarInput each frame,
 * so a held key keeps reading as held and a tap is never missed between frames.
 */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly input: CarInput = emptyInput();
  /**
   * Jump is latched rather than read per frame. A render frame can run zero
   * physics steps, and without the latch the tap in that frame would be cleared
   * before any step saw it, silently eating the jump.
   */
  private jumpLatched = false;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // Someone typing into a field is not driving. Without this the room-code
    // box could not take a 2, a 3, a Q or an E -- all valid code characters --
    // because those keys are swallowed below, and every letter typed would also
    // fire as a hotkey: M mutes, T toggles ball cam, a digit picks a menu item.
    if (isTyping(e.target)) return;
    const code = e.code;
    this.down.add(code);
    this.pressedThisFrame.add(code);
    if (code === 'Space') this.jumpLatched = true;
    // Stop the page scrolling out from under the game.
    if (SWALLOW.has(code)) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
    this.jumpLatched = false;
  };

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once, on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Any key at all went down this frame. Used to unlock audio. */
  get anyPressed(): boolean {
    return this.pressedThisFrame.size > 0;
  }

  /** Call once per rendered frame, after reading the one-shot hotkeys. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  read(): CarInput {
    const i = this.input;
    const fwd = this.isDown('KeyW') || this.isDown('ArrowUp');
    const back = this.isDown('KeyS') || this.isDown('ArrowDown');
    const left = this.isDown('KeyA') || this.isDown('ArrowLeft');
    const right = this.isDown('KeyD') || this.isDown('ArrowRight');

    i.throttle = (fwd ? 1 : 0) - (back ? 1 : 0);
    i.steer = (right ? 1 : 0) - (left ? 1 : 0);
    // In the air W/S pitch and A/D yaw, using the same keys.
    i.pitch = i.throttle;
    i.roll = (this.isDown('KeyE') ? 1 : 0) - (this.isDown('KeyQ') ? 1 : 0);
    // Consumed here, so exactly one physics step acts on each tap.
    i.jumpPressed = this.jumpLatched;
    this.jumpLatched = false;
    i.jumpHeld = this.isDown('Space');
    i.boost = this.isDown('ShiftLeft') || this.isDown('ShiftRight');
    i.drift = this.isDown('AltLeft') || this.isDown('AltRight') || this.isDown('KeyC');
    return i;
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

/** True when a key is going into a text field rather than to the game. */
function isTyping(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

const SWALLOW = new Set([
  'Space',
  'Enter',
  'Digit1',
  'Digit2',
  'Digit3',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyQ',
  'KeyE',
]);
