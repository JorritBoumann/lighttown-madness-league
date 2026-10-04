/**
 * Named actions, so nothing above the input layer knows about key codes or
 * button numbers.
 *
 * Without this, adding a gamepad means every hotkey and every menu key in the
 * game grows a second branch. With it, a new device is a new source that
 * produces the same actions.
 */
export type Action =
  | 'pause'
  | 'ballCam'
  | 'mute'
  | 'tuning'
  | 'resetBall'
  | 'menuUp'
  | 'menuDown'
  | 'menuSelect'
  | 'pick1'
  | 'pick2'
  | 'pick3'
  | 'pick4';

/** Which keys fire which action. Several keys may share one. */
export const KEY_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  pause: ['Escape'],
  ballCam: ['KeyT'],
  mute: ['KeyM'],
  tuning: ['KeyP'],
  resetBall: ['KeyB'],
  menuUp: ['ArrowUp', 'KeyW'],
  menuDown: ['ArrowDown', 'KeyS'],
  menuSelect: ['Enter', 'Space'],
  pick1: ['Digit1'],
  pick2: ['Digit2'],
  pick3: ['Digit3'],
  pick4: ['Digit4'],
};

/**
 * Which gamepad buttons fire which action, by index in the W3C standard
 * mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start,
 * 12-15 dpad up/down/left/right.
 */
export const PAD_BINDINGS: Readonly<Record<Action, readonly number[]>> = {
  pause: [9],
  ballCam: [3],
  mute: [8],
  tuning: [],
  resetBall: [],
  menuUp: [12],
  menuDown: [13],
  menuSelect: [0],
  // Menu items are chosen with the stick and A on a pad; the numbered
  // shortcuts stay keyboard-only rather than being mapped to arbitrary buttons.
  pick1: [],
  pick2: [],
  pick3: [],
  pick4: [],
};

export const ALL_ACTIONS = Object.keys(KEY_BINDINGS) as Action[];
