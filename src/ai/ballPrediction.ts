import { cfg } from '../config';

/**
 * Cheap ball predictor.
 *
 * Steps the ball forward with gravity, drag and bounces off the floor, walls and
 * ceiling. It ignores the corner panels and anything the cars do, so it drifts
 * after a bounce or two, but it only has to be right for the second or so a bot
 * needs to pick an interception. Running the real physics world forward would be
 * far more accurate and far too expensive to do per bot per step.
 */

export interface BallSnapshot {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface PredictedSample extends BallSnapshot {
  /** Seconds from now. */
  time: number;
}

/**
 * Samples the ball's future at `step` intervals out to `horizon`.
 * Reuses its output array between calls, so copy anything you keep.
 */
export class BallPredictor {
  private readonly samples: PredictedSample[] = [];

  predict(ball: BallSnapshot, horizon: number, step = 1 / 20): PredictedSample[] {
    const radius = cfg.ball.radius;
    const gravity = cfg.physics.gravity;
    const drag = cfg.ball.drag;
    const restitution = cfg.ball.restitution;
    const hl = cfg.arena.halfLength;
    const hw = cfg.arena.halfWidth;
    const ceiling = cfg.arena.ceiling;

    let px = ball.position.x;
    let py = ball.position.y;
    let pz = ball.position.z;
    let vx = ball.velocity.x;
    let vy = ball.velocity.y;
    let vz = ball.velocity.z;

    const count = Math.max(1, Math.ceil(horizon / step));
    this.samples.length = 0;

    for (let i = 0; i < count; i++) {
      // Integrate one interval. Coarse, but the error that matters is the
      // bounces, not the step size.
      vy += gravity * step;
      const keep = Math.max(0, 1 - drag * step);
      vx *= keep;
      vy *= keep;
      vz *= keep;
      px += vx * step;
      py += vy * step;
      pz += vz * step;

      if (py < radius) {
        py = radius;
        if (vy < 0) vy = -vy * restitution;
      } else if (py > ceiling - radius) {
        py = ceiling - radius;
        if (vy > 0) vy = -vy * restitution;
      }

      // Side walls. The goal mouths are left open, so a shot on target keeps
      // going rather than bouncing back out of the net.
      if (pz > hw - radius) {
        pz = hw - radius;
        if (vz > 0) vz = -vz * restitution;
      } else if (pz < -(hw - radius)) {
        pz = -(hw - radius);
        if (vz < 0) vz = -vz * restitution;
      }
      const inMouth =
        Math.abs(pz) < cfg.arena.goalWidth / 2 - radius && py < cfg.arena.goalHeight - radius;
      if (!inMouth) {
        if (px > hl - radius) {
          px = hl - radius;
          if (vx > 0) vx = -vx * restitution;
        } else if (px < -(hl - radius)) {
          px = -(hl - radius);
          if (vx < 0) vx = -vx * restitution;
        }
      }

      this.samples.push({
        time: (i + 1) * step,
        position: { x: px, y: py, z: pz },
        velocity: { x: vx, y: vy, z: vz },
      });
    }

    return this.samples;
  }
}

/** Where the ball will be after `seconds`, as a one-off. */
export function predictAt(ball: BallSnapshot, seconds: number): PredictedSample {
  const samples = new BallPredictor().predict(ball, seconds, Math.min(1 / 30, seconds));
  return samples[samples.length - 1]!;
}

/** A ball on its way into a net. */
export interface GoalThreat {
  /** Seconds until it reaches the goal plane. */
  time: number;
  /** How high it crosses, so a defender knows whether driving can reach it. */
  height: number;
  /** Where across the mouth it crosses. */
  z: number;
}

/**
 * Whether a predicted path ends up in a particular net, and when.
 *
 * Used to decide that a ball is worth leaving the ground for in defence: a
 * clearance is only worth the boost and the exposure if the ball is actually
 * going in. The mouth is grown by the ball's radius, since a ball whose centre
 * passes just outside the post still crosses the line.
 *
 * The walk stops at the first sample past the plane rather than looking for the
 * nearest approach, because the prediction ignores the goal frame: a path that
 * carries on through the back of the net is the same threat as one that stops
 * there, and anything after the crossing never happens.
 */
export function threatensGoal(opts: {
  samples: readonly PredictedSample[];
  /** The defended goal line, signed: the ball crosses it going further out. */
  goalX: number;
  /** Half the mouth plus the ball's radius. */
  halfWidth: number;
  /** The crossbar plus the ball's radius. */
  maxHeight: number;
}): GoalThreat | null {
  const { samples, goalX, halfWidth, maxHeight } = opts;
  const side = Math.sign(goalX) || 1;
  const line = Math.abs(goalX);

  for (const sample of samples) {
    if (sample.position.x * side < line) continue;
    // Past the plane. Whether it is a goal is decided here and nowhere later.
    if (Math.abs(sample.position.z) > halfWidth) return null;
    if (sample.position.y > maxHeight) return null;
    return { time: sample.time, height: sample.position.y, z: sample.position.z };
  }
  return null;
}
