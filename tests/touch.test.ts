// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TouchSource } from '../src/input/touch';

/**
 * The phone controls, driven the way fingers drive them: several pointers at
 * once, each pressing and lifting on its own.
 *
 * jsdom has no PointerEvent, so these are mouse events carrying the two
 * fields the controls read.
 */

let parent: HTMLElement;
let touch: TouchSource;

function pointer(
  target: EventTarget,
  type: string,
  id: number,
  x = 0,
  y = 0,
): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  target.dispatchEvent(e);
}

const el = (selector: string): HTMLElement => parent.querySelector(selector) as HTMLElement;

beforeEach(() => {
  parent = document.createElement('div');
  document.body.appendChild(parent);
  touch = new TouchSource(parent);
});
afterEach(() => {
  touch.destroy();
  parent.remove();
});

describe('activation', () => {
  it('stays out of the way until a finger touches the screen', () => {
    expect(touch.read()).toBeNull();
    expect(document.body.classList.contains('touch')).toBe(false);
    pointer(el('[data-btn="boost"]'), 'pointerdown', 1);
    expect(touch.active).toBe(true);
    expect(document.body.classList.contains('touch')).toBe(true);
    expect(touch.read()).not.toBeNull();
  });
});

describe('stick', () => {
  it('pushed up and right is throttle and right steer, as W and D', () => {
    pointer(el('[data-zone]'), 'pointerdown', 1, 100, 200);
    pointer(window, 'pointermove', 1, 130, 150);
    const i = touch.read()!;
    expect(i.throttle).toBeGreaterThan(0.5);
    expect(i.steer).toBeGreaterThan(0.2);
    // The same movement turns the car in the air.
    expect(i.pitch).toBe(i.throttle);
  });

  it('is capped at full deflection however far the thumb travels', () => {
    pointer(el('[data-zone]'), 'pointerdown', 1, 100, 200);
    pointer(window, 'pointermove', 1, 100, -400);
    expect(touch.read()!.throttle).toBe(1);
  });

  it('ignores a small wobble around the centre', () => {
    pointer(el('[data-zone]'), 'pointerdown', 1, 100, 200);
    pointer(window, 'pointermove', 1, 104, 197);
    const i = touch.read()!;
    expect(i.throttle).toBe(0);
    expect(i.steer).toBe(0);
  });

  it('centres when the thumb lifts', () => {
    pointer(el('[data-zone]'), 'pointerdown', 1, 100, 200);
    pointer(window, 'pointermove', 1, 100, 100);
    pointer(window, 'pointerup', 1, 100, 100);
    expect(touch.read()!.throttle).toBe(0);
  });
});

describe('buttons', () => {
  it('jump is latched, so a tap between steps still jumps once', () => {
    const jump = el('[data-btn="jump"]');
    pointer(jump, 'pointerdown', 2);
    pointer(jump, 'pointerup', 2);
    expect(touch.read()!.jumpPressed).toBe(true);
    expect(touch.read()!.jumpPressed).toBe(false);
  });

  it('a second finger does not disturb the first', () => {
    pointer(el('[data-zone]'), 'pointerdown', 1, 100, 200);
    pointer(window, 'pointermove', 1, 100, 100);
    pointer(el('[data-btn="boost"]'), 'pointerdown', 2);
    pointer(el('[data-btn="jump"]'), 'pointerdown', 3);
    pointer(window, 'pointerup', 3);
    const i = touch.read()!;
    expect(i.throttle).toBe(1);
    expect(i.boost).toBe(true);
    expect(i.jumpPressed).toBe(true);
    expect(i.jumpHeld).toBe(false);
  });

  it('lets go when the finger lifts somewhere other than the button', () => {
    pointer(el('[data-btn="boost"]'), 'pointerdown', 2);
    expect(touch.read()!.boost).toBe(true);
    // Slid off and lifted over the pitch: the button never hears it.
    pointer(window, 'pointerup', 2);
    expect(touch.read()!.boost).toBe(false);
    expect(el('[data-btn="boost"]').classList.contains('down')).toBe(false);
  });

  it('stays held while either of two fingers is on it', () => {
    const drift = el('[data-btn="drift"]');
    pointer(drift, 'pointerdown', 2);
    pointer(drift, 'pointerdown', 3);
    pointer(window, 'pointerup', 2);
    expect(touch.read()!.drift).toBe(true);
    pointer(window, 'pointerup', 3);
    expect(touch.read()!.drift).toBe(false);
  });

  it('pause is reported once per press', () => {
    pointer(el('[data-pause]'), 'pointerdown', 4);
    expect(touch.takePause()).toBe(true);
    expect(touch.takePause()).toBe(false);
  });
});
