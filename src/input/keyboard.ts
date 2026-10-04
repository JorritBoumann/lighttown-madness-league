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

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const code = e.code;
    this.down.add(code);
    this.pressedThisFrame.add(code);
    // Stop the page scrolling out from under the game.
    if (SWALLOW.has(code)) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
  };

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once, on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Call once per rendered frame, after reading. */
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
    i.jumpPressed = this.wasPressed('Space');
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

const SWALLOW = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyQ',
  'KeyE',
]);
