/**
 * The only thing that drives a car. The keyboard, a gamepad and the AI all
 * produce this, so nothing downstream knows or cares which one is in charge.
 */
export interface CarInput {
  /** -1 (reverse/brake) .. 1 (throttle). */
  throttle: number;
  /** -1 (left) .. 1 (right). Steers on the ground, yaws in the air. */
  steer: number;
  /** -1 (nose down) .. 1 (nose up). Air only. */
  pitch: number;
  /** -1 (roll left) .. 1 (roll right). Air only. */
  roll: number;
  /** True on the frame the jump was pressed. */
  jumpPressed: boolean;
  /** True while jump is held, for the taller hop. */
  jumpHeld: boolean;
  boost: boolean;
  /** Powerslide. */
  drift: boolean;
}

export function emptyInput(): CarInput {
  return {
    throttle: 0,
    steer: 0,
    pitch: 0,
    roll: 0,
    jumpPressed: false,
    jumpHeld: false,
    boost: false,
    drift: false,
  };
}
