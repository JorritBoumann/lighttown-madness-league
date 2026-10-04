// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Keyboard } from '../src/input/keyboard';

/**
 * The keyboard is the contract between the player and the car, so the mapping
 * and the jump latch are worth pinning down.
 */

let kb: Keyboard;

const press = (code: string): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code }));
};
const release = (code: string): void => {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
};

beforeEach(() => {
  kb = new Keyboard(window);
});
afterEach(() => {
  kb.destroy();
});

describe('mapping', () => {
  it('maps WASD to throttle and steer', () => {
    press('KeyW');
    press('KeyD');
    const i = kb.read();
    expect(i.throttle).toBe(1);
    expect(i.steer).toBe(1);
    release('KeyW');
    press('KeyS');
    expect(kb.read().throttle).toBe(-1);
  });

  it('cancels opposing keys rather than picking one', () => {
    press('KeyA');
    press('KeyD');
    expect(kb.read().steer).toBe(0);
  });

  it('maps Q and E to air roll', () => {
    press('KeyQ');
    expect(kb.read().roll).toBe(-1);
    release('KeyQ');
    press('KeyE');
    expect(kb.read().roll).toBe(1);
  });

  it('maps shift to boost and C to powerslide', () => {
    press('ShiftLeft');
    press('KeyC');
    const i = kb.read();
    expect(i.boost).toBe(true);
    expect(i.drift).toBe(true);
  });

  it('reuses throttle for pitch, so the air controls need no extra keys', () => {
    press('KeyS');
    const i = kb.read();
    expect(i.pitch).toBe(i.throttle);
  });
});

describe('jump latch', () => {
  it('delivers a tap exactly once, however many times it is read', () => {
    press('Space');
    expect(kb.read().jumpPressed).toBe(true);
    expect(kb.read().jumpPressed).toBe(false);
  });

  it('survives render frames that run no physics steps', () => {
    press('Space');
    kb.endFrame(); // a frame went by with no fixed step
    kb.endFrame();
    expect(kb.read().jumpPressed).toBe(true);
  });

  it('reports jump as held for as long as the key is down', () => {
    press('Space');
    kb.read();
    expect(kb.read().jumpHeld).toBe(true);
    release('Space');
    expect(kb.read().jumpHeld).toBe(false);
  });

  it('drops held keys when the window loses focus', () => {
    press('KeyW');
    press('Space');
    window.dispatchEvent(new Event('blur'));
    const i = kb.read();
    expect(i.throttle).toBe(0);
    expect(i.jumpPressed).toBe(false);
    expect(i.jumpHeld).toBe(false);
  });
});
