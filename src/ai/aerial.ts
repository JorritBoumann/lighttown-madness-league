import * as THREE from 'three';
import { WORLD_UP } from '../core/axes';

/**
 * Air orientation: given a direction to point the nose, produce pitch, yaw and
 * roll inputs that get it there and stop.
 *
 * A proportional term alone oscillates — the car swings past the target,
 * corrects, swings past the other way — so each axis also damps against its own
 * rotation rate. That is the difference between a bot that looks like it is
 * flying and one that looks like it is falling over.
 *
 * Signs follow the car's input conventions (see core/axes.ts): positive pitch
 * is nose down, positive yaw is nose right, positive roll is roll right. Note
 * that none of those is a rotation about the matching body axis in the positive
 * direction — about the car's right the nose goes up, and about its roof the
 * nose goes left — so the projections below are negated. Each axis is
 * driven in those same units, so a term is `Kp * error - Kd * rate` throughout
 * rather than a different sign per axis.
 */

export interface AerialInputs {
  pitch: number;
  steer: number;
  roll: number;
  /** How far off the nose is from the target, radians. */
  error: number;
}

export interface AerialGains {
  /** How hard a rate error is corrected. */
  p: number;
  /** Unused by the rate profile; kept so callers need not change. */
  d: number;
  /** Roll is levelling rather than aiming, so it gets its own pair. */
  rollP: number;
  rollD: number;
  /** Angular acceleration available on each axis, radians/s^2. */
  pitchAccel: number;
  yawAccel: number;
  rollAccel: number;
  /** Hard cap on spin, radians/s. */
  maxRate: number;
}

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Scratch for the turn axis; this runs once per bot per frame. */
const AXIS = new THREE.Vector3();

/**
 * One axis, as a rate profile rather than a proportional push.
 *
 * The naive version commands a turn proportional to the error and damps
 * against the current rate. It cannot work here: the car builds four or five
 * radians a second covering ninety degrees and then needs a third of a second
 * to stop, by which time it has sailed tens of degrees past. Damping harder
 * only makes it sluggish everywhere else.
 *
 * Instead, never ask for more rate than can be arrested in the error
 * remaining: `sqrt(2 * accel * error)` is exactly the speed from which a
 * constant deceleration stops in that distance. The command is then the
 * difference between that rate and the current one, which decelerates into the
 * target and holds it.
 */
function axis(error: number, rate: number, accel: number, gains: AerialGains): number {
  const magnitude = Math.abs(error);
  // The fastest rate that can still be stopped by the time the error is gone,
  // shaded slightly so a late arrival does not become an overshoot.
  const stoppable = Math.sqrt(2 * accel * magnitude) * 0.9;
  const wanted = Math.sign(error) * Math.min(magnitude * gains.p, stoppable, gains.maxRate);
  return clamp1((wanted - rate) * gains.p);
}

/**
 * `direction` is where the nose should point, in world space; it need not be
 * normalised. The basis vectors and angular velocity are the car's current
 * state.
 */
export function pointNoseAt(
  direction: THREE.Vector3,
  fwd: THREE.Vector3,
  up: THREE.Vector3,
  right: THREE.Vector3,
  angvel: THREE.Vector3,
  gains: AerialGains,
  out: AerialInputs = { pitch: 0, steer: 0, roll: 0, error: 0 },
): AerialInputs {
  const len = direction.length();
  if (len < 1e-6) {
    out.pitch = 0;
    out.steer = 0;
    out.roll = 0;
    out.error = 0;
    return out;
  }

  // The attitude error as one rotation: the shortest turn that puts the nose on
  // the target, expressed as an axis and an angle.
  //
  // Decomposing the target with atan2 per axis seems simpler and is wrong past
  // ninety degrees: the pitch error of a target directly overhead keeps growing
  // as the nose passes vertical rather than reversing, so the car rotates
  // straight through and ends up inverted. An axis-angle error is correct at
  // every attitude.
  const ahead = direction.dot(fwd) / len;
  const turnAxis = AXIS.copy(fwd).cross(direction).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, ahead)));

  // Exactly ahead or exactly behind leaves no defined turn axis: ahead needs no
  // turn at all, behind is pushed into pitching up rather than left to stall.
  if (!Number.isFinite(turnAxis.x) || turnAxis.lengthSq() < 0.5) {
    if (ahead > 0) turnAxis.set(0, 0, 0);
    else turnAxis.copy(right);
  }

  // Projected onto the car's own axes, and negated.
  //
  // A rotation about the car's right is nose-*up* and about its roof is
  // nose-*left*, whereas positive pitch means nose down and positive yaw means
  // nose right. The two negations are what put the errors in the same units as
  // the commands; they match the ones in `controlInAir`.
  const pitchError = -turnAxis.dot(right) * angle;
  const yawError = -turnAxis.dot(up) * angle;

  // Levelling: the roof should be up. Which way the car is banked is exactly
  // how far its right side has risen or fallen against world up.
  //
  // Weighted by how far the nose is from vertical, because near-vertical the
  // whole idea stops meaning anything: rolling and yawing become the same
  // motion, and a levelling term that keeps insisting fights the pitch instead.
  // Left unweighted, a car asked to point straight up spends more than a
  // second thrashing and loses all the height its jump bought it.
  const verticality = Math.abs(fwd.dot(WORLD_UP));
  const rollWeight = 1 - verticality * verticality;
  const rollError = right.dot(WORLD_UP) * rollWeight;

  // The measured rates are negated wherever the command is: `axis` subtracts
  // the rate from the rate it wants, so the two have to be in the same units.
  out.pitch = axis(pitchError, -angvel.dot(right), gains.pitchAccel, gains);
  out.steer = axis(yawError, -angvel.dot(up), gains.yawAccel, gains);
  // Positive roll input produces positive spin about the nose, so this one
  // needs no sign change.
  out.roll = axis(rollError, angvel.dot(fwd), gains.rollAccel, gains);
  out.error = Math.acos(Math.max(-1, Math.min(1, ahead)));
  return out;
}

/**
 * Whether an aerial is worth starting.
 *
 * The honest version of this question is "can I get there before the ball has
 * gone", and the thing that decides it is vertical: horizontal travel is cheap
 * with boost, but climbing is paid for out of the tank. Returns the boost
 * needed as a fraction of a full one, or null when it cannot be done.
 */
export function aerialCost(opts: {
  /** Horizontal distance to the interception. */
  distance: number;
  /** How high above the car the interception is. */
  climb: number;
  /** Seconds until the ball is there. */
  time: number;
  /** The car's current speed. */
  speed: number;
  /** Gravity, as a positive number. */
  gravity: number;
  /** Boost acceleration. */
  boostAccel: number;
  /** Upward speed a jump and a double jump are worth. */
  jumpSpeed: number;
}): number | null {
  const { distance, climb, time, speed, gravity, boostAccel, jumpSpeed } = opts;
  if (time <= 0.15) return null;

  // Vertical: the jump covers some of it, boost has to find the rest, and
  // gravity is working the whole way.
  const neededVertical = (climb - jumpSpeed * time + 0.5 * gravity * time * time) / (0.5 * time * time);
  const verticalAccel = Math.max(0, neededVertical);

  // Horizontal: whatever is left over after holding altitude.
  const neededHorizontal = Math.max(0, (2 * (distance - speed * time)) / (time * time));

  const total = Math.hypot(verticalAccel, neededHorizontal);
  if (total > boostAccel) return null;

  // Boost burns at a fixed rate while held, so the cost is how long it is held.
  const fraction = total / boostAccel;
  return fraction * time;
}

/**
 * How long a climb of `height` takes, starting with the upward speed a jump
 * gives and thrusting the rest of the way.
 *
 * Returns null when the climb is beyond what the boost can do at all: with
 * thrust below gravity the car never gets there however long it is given.
 */
export function climbTime(opts: {
  height: number;
  launchSpeed: number;
  boostAccel: number;
  gravity: number;
  /** Overhead for rotating to point upward before the thrust is useful. */
  turnTime: number;
}): number | null {
  const { height, launchSpeed, boostAccel, gravity, turnTime } = opts;
  if (height <= 0) return turnTime;
  const net = boostAccel - gravity;
  if (net <= 0) {
    // Ballistic only: reachable if the jump alone carries it that high.
    const apex = (launchSpeed * launchSpeed) / (2 * gravity);
    if (apex < height) return null;
    return (launchSpeed - Math.sqrt(Math.max(0, launchSpeed * launchSpeed - 2 * gravity * height))) / gravity;
  }
  // height = v*t + 0.5*net*t^2, solved for t.
  const t = (-launchSpeed + Math.sqrt(launchSpeed * launchSpeed + 2 * net * height)) / net;
  return t + turnTime;
}

/**
 * Whether to leave the ground now.
 *
 * This is the piece that was missing, and the reason the first version sailed
 * past every ball it went for. Jumping when *close* to the spot under the ball
 * is wrong: a car launches with whatever ground speed it had and keeps it, so
 * it carries on travelling horizontally for the whole climb. The launch has to
 * happen at the distance that drift will cover — far short of the ball, not
 * next to it — and the right distance is simply speed times climb time.
 *
 * Expressed as a condition rather than a planned moment so it re-checks every
 * frame, which keeps it right whether the car arrives early or late.
 */
export function shouldLaunch(opts: {
  /** Horizontal distance to the interception. */
  distance: number;
  /** The car's current speed. */
  speed: number;
  /** Seconds of climbing needed, from climbTime. */
  climbSeconds: number;
  /** Slack, as a fraction of the drift distance. */
  tolerance: number;
}): boolean {
  const drift = opts.speed * opts.climbSeconds;
  return opts.distance <= drift * (1 + opts.tolerance);
}

/** Where to meet the ball, and the direction the touch should send it. */
export interface AerialContact {
  /** Unit vector along which the ball should leave. */
  shot: THREE.Vector3;
  /** The point to fly at: back from the ball along the shot line. */
  point: THREE.Vector3;
}

export function aerialContact(opts: {
  /** Where the ball will be at the intercept. */
  ballAt: THREE.Vector3;
  /** How fast it is travelling there, which the touch has to cancel. */
  ballVelocity: THREE.Vector3;
  /** The spot in the net being aimed at. */
  goal: THREE.Vector3;
  /** How hard the car can send the ball. */
  shotSpeed: number;
  /** How far back from the ball's centre to meet it, in world units. */
  offset: number;
  /** Written in place; nothing is allocated. */
  out: AerialContact;
}): AerialContact {
  const { ballAt, ballVelocity, goal, shotSpeed, offset, out } = opts;
  const shot = out.shot;

  shot.set(goal.x - ballAt.x, goal.y - ballAt.y, goal.z - ballAt.z);
  const len = shot.length() || 1;
  shot.divideScalar(len).multiplyScalar(shotSpeed);

  // The impulse that would leave the ball travelling that way, not the
  // direction of the goal: a touch changes the ball's velocity rather than
  // simply pushing it, and in the air the ball is usually moving fast.
  shot.sub(ballVelocity);
  if (shot.lengthSq() < 1e-6) shot.set(goal.x - ballAt.x, 0, goal.z - ballAt.z);
  shot.normalize();

  out.point.set(
    ballAt.x - shot.x * offset,
    ballAt.y - shot.y * offset,
    ballAt.z - shot.z * offset,
  );
  return out;
}
