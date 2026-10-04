// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cfg } from '../src/config';
import { PadSource } from '../src/input/gamepad';
import { Controls } from '../src/input/controls';

/**
 * Gamepad mapping, deadzones and edge detection.
 *
 * The browser hands out immutable snapshots, so a fake pad is just an object
 * returned from navigator.getGamepads. That makes the whole mapping testable
 * without a device, which matters because I have no pad to try it with.
 */

interface FakePad {
  index: number;
  connected: boolean;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
}

/** A standard-mapping pad with nothing pressed. */
function makePad(index = 0): FakePad {
  return {
    index,
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 };
const DPAD = { UP: 12, DOWN: 13 };

let pads: (FakePad | null)[] = [];

function press(pad: FakePad, index: number, value = 1): void {
  pad.buttons[index] = { pressed: true, value };
}
function release(pad: FakePad, index: number): void {
  pad.buttons[index] = { pressed: false, value: 0 };
}

beforeEach(() => {
  pads = [];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connection', () => {
  it('reports nothing when no pad is connected', () => {
    const source = new PadSource();
    source.poll();
    expect(source.connected).toBe(false);
    expect(source.read()).toBe(null);
  });

  it('picks up a pad once it appears', () => {
    const source = new PadSource();
    source.poll();
    pads = [makePad()];
    source.poll();
    expect(source.connected).toBe(true);
    expect(source.read()).not.toBe(null);
  });

  it('drops it again on disconnect, without throwing', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    source.poll();
    expect(source.connected).toBe(true);
    pads = [];
    source.poll();
    expect(source.connected).toBe(false);
    expect(source.read()).toBe(null);
  });

  it('ignores a dormant second pad in favour of the one being used', () => {
    const idle = makePad(0);
    const active = makePad(1);
    press(active, BUTTON.RT);
    pads = [idle, active];
    const source = new PadSource();
    source.poll();
    expect(source.read()!.throttle).toBe(1);
  });

  it('does not count as used until something is actually touched', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    source.poll();
    expect(source.used).toBe(false);
    press(pad, BUTTON.A);
    source.poll();
    expect(source.used).toBe(true);
  });
});

describe('driving', () => {
  it('maps the triggers to throttle and reverse', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();

    press(pad, BUTTON.RT);
    source.poll();
    expect(source.read()!.throttle).toBe(1);

    release(pad, BUTTON.RT);
    press(pad, BUTTON.LT);
    source.poll();
    expect(source.read()!.throttle).toBe(-1);
  });

  it('honours analog trigger pressure rather than treating it as on or off', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    pad.buttons[BUTTON.RT] = { pressed: false, value: 0.5 };
    source.poll();
    expect(source.read()!.throttle).toBeCloseTo(0.5, 2);
  });

  it('cancels out when both triggers are held', () => {
    const pad = makePad();
    pads = [pad];
    press(pad, BUTTON.RT);
    press(pad, BUTTON.LT);
    const source = new PadSource();
    source.poll();
    expect(source.read()!.throttle).toBe(0);
  });

  it('maps the left stick to steering', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    pad.axes[0] = 1;
    source.poll();
    expect(source.read()!.steer).toBeCloseTo(1, 2);
    pad.axes[0] = -1;
    source.poll();
    expect(source.read()!.steer).toBeCloseTo(-1, 2);
  });

  it('pitches the nose down when the stick goes forward', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    // Sticks report forward as negative, and positive pitch is nose-down.
    pad.axes[1] = -1;
    source.poll();
    expect(source.read()!.pitch).toBeCloseTo(1, 2);
  });

  it('ignores stick drift inside the deadzone', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    pad.axes[0] = cfg.input.padDeadzone * 0.8;
    source.poll();
    expect(source.read()!.steer).toBe(0);
  });

  it('eases in just past the deadzone rather than jumping to full tilt', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    pad.axes[0] = cfg.input.padDeadzone + 0.02;
    source.poll();
    const steer = source.read()!.steer;
    expect(steer).toBeGreaterThan(0);
    expect(steer).toBeLessThan(0.2);
  });

  it('maps the bumpers to air roll, and the face buttons to boost and slide', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();

    press(pad, BUTTON.RB);
    press(pad, BUTTON.B);
    press(pad, BUTTON.X);
    source.poll();
    const input = source.read()!;
    expect(input.roll).toBe(1);
    expect(input.boost).toBe(true);
    expect(input.drift).toBe(true);

    release(pad, BUTTON.RB);
    press(pad, BUTTON.LB);
    source.poll();
    expect(source.read()!.roll).toBe(-1);
  });
});

describe('jump', () => {
  it('latches a tap so exactly one read sees it', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    press(pad, BUTTON.A);
    source.poll();
    expect(source.read()!.jumpPressed).toBe(true);
    expect(source.read()!.jumpPressed).toBe(false);
  });

  it('reports held for as long as the button is down', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    press(pad, BUTTON.A);
    source.poll();
    source.read();
    expect(source.read()!.jumpHeld).toBe(true);
    release(pad, BUTTON.A);
    source.poll();
    expect(source.read()!.jumpHeld).toBe(false);
  });

  it('needs a release before it latches again', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    press(pad, BUTTON.A);
    source.poll();
    expect(source.read()!.jumpPressed).toBe(true);
    // Still held: no new press.
    source.poll();
    expect(source.read()!.jumpPressed).toBe(false);
    release(pad, BUTTON.A);
    source.poll();
    press(pad, BUTTON.A);
    source.poll();
    expect(source.read()!.jumpPressed).toBe(true);
  });
});

describe('actions', () => {
  it('fires pause, ball cam and mute from their buttons', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    press(pad, BUTTON.START);
    source.poll();
    expect(source.pressed('pause')).toBe(true);

    release(pad, BUTTON.START);
    press(pad, BUTTON.Y);
    source.poll();
    expect(source.pressed('ballCam')).toBe(true);
    expect(source.pressed('pause')).toBe(false);

    release(pad, BUTTON.Y);
    press(pad, BUTTON.BACK);
    source.poll();
    expect(source.pressed('mute')).toBe(true);
  });

  it('navigates menus with the dpad and selects with A', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    press(pad, DPAD.DOWN);
    source.poll();
    expect(source.pressed('menuDown')).toBe(true);

    release(pad, DPAD.DOWN);
    press(pad, DPAD.UP);
    source.poll();
    expect(source.pressed('menuUp')).toBe(true);

    release(pad, DPAD.UP);
    press(pad, BUTTON.A);
    source.poll();
    expect(source.pressed('menuSelect')).toBe(true);
  });

  it('fires an action once per press, not every frame it is held', () => {
    const pad = makePad();
    pads = [pad];
    const source = new PadSource();
    press(pad, BUTTON.START);
    source.poll();
    expect(source.pressed('pause')).toBe(true);
    source.poll();
    expect(source.pressed('pause')).toBe(false);
  });
});

describe('both devices together', () => {
  const key = (type: string, code: string): void => {
    window.dispatchEvent(new KeyboardEvent(type, { code }));
  };

  it('drives from the keyboard when no pad is connected', () => {
    const controls = new Controls(window);
    controls.poll();
    key('keydown', 'KeyW');
    expect(controls.read().throttle).toBe(1);
    controls.destroy();
  });

  it('drives from either device, taking whichever is pushed further', () => {
    const pad = makePad();
    pads = [pad];
    const controls = new Controls(window);

    // Stick half over, no keys: the stick wins by default.
    pad.axes[0] = 0.5;
    controls.poll();
    expect(controls.read().steer).toBeCloseTo(0.42, 1);

    // Key fully over beats a half-pushed stick rather than adding to it.
    key('keydown', 'KeyD');
    controls.poll();
    expect(controls.read().steer).toBe(1);
    key('keyup', 'KeyD');
    controls.destroy();
  });

  it('ors the buttons, so boost from either device boosts', () => {
    const pad = makePad();
    pads = [pad];
    const controls = new Controls(window);
    press(pad, BUTTON.B);
    controls.poll();
    expect(controls.read().boost).toBe(true);
    controls.destroy();
  });

  it('takes a jump from either device exactly once', () => {
    const pad = makePad();
    pads = [pad];
    const controls = new Controls(window);
    press(pad, BUTTON.A);
    controls.poll();
    expect(controls.read().jumpPressed).toBe(true);
    expect(controls.read().jumpPressed).toBe(false);
    controls.destroy();
  });

  it('fires an action from either device', () => {
    const pad = makePad();
    pads = [pad];
    const controls = new Controls(window);

    key('keydown', 'KeyT');
    controls.poll();
    expect(controls.pressed('ballCam')).toBe(true);
    controls.endFrame();
    key('keyup', 'KeyT');

    press(pad, BUTTON.Y);
    controls.poll();
    expect(controls.pressed('ballCam')).toBe(true);
    controls.destroy();
  });

  it('reports which device was used last, for showing the right hints', () => {
    const pad = makePad();
    pads = [pad];
    const controls = new Controls(window);
    controls.poll();
    expect(controls.device).toBe('keyboard');

    press(pad, BUTTON.A);
    controls.poll();
    expect(controls.device).toBe('gamepad');

    release(pad, BUTTON.A);
    key('keydown', 'KeyW');
    controls.poll();
    expect(controls.device).toBe('keyboard');
    key('keyup', 'KeyW');
    controls.destroy();
  });

  it('survives a browser with no gamepad API at all', () => {
    vi.stubGlobal('navigator', {});
    const controls = new Controls(window);
    expect(() => controls.poll()).not.toThrow();
    expect(controls.padConnected).toBe(false);
    expect(() => controls.read()).not.toThrow();
    controls.destroy();
  });
});
