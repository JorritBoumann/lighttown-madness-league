import * as THREE from 'three';
import { cfg } from '../config';
import { clamp } from '../core/mathx';
import type { CarInput } from '../input/types';
import { emptyInput } from '../input/types';
import type { Car } from '../physics/car';
import type { BoostPad } from '../physics/boostPads';
import { FORWARD, UP, RIGHT, WORLD_UP } from '../core/axes';
import { BallPredictor, type BallSnapshot, type PredictedSample } from './ballPrediction';
import { tier, type BotTier } from './tiers';
import { pointNoseAt, aerialCost, climbTime, shouldLaunch, type AerialInputs } from './aerial';

/**
 * Opponent bot.
 *
 * Produces a CarInput, exactly like the keyboard does, so nothing downstream
 * knows or cares that a car is driven by this rather than a player.
 *
 * The shape of it: pick a thing to go to (an interception, a defensive post, a
 * boost pad), then run one steering controller that drives there. Keeping the
 * "what" and the "how" apart is what stops the behaviour from turning into a
 * pile of special cases.
 */

export type BotMode = 'attack' | 'defend' | 'collect' | 'recover' | 'unstick' | 'aerial';

/**
 * What a bot is for. Tiers say how good it is; the role says what job it does,
 * which is how a boss round gets a keeper rather than just a better attacker.
 */
export type BotRole =
  /** Attacks and falls back as its tier allows. The ordinary opponent. */
  | 'balanced'
  /** Holds its own net and clears. Never goes hunting. */
  | 'keeper'
  /** Always forward, never defends, whatever its tier would do. */
  | 'attacker';

export interface BotWorld {
  ball: BallSnapshot & { radius: number };
  pads: readonly BoostPad[];
}

/** Ball states kept for the reaction delay. */
interface Memory {
  time: number;
  snapshot: BallSnapshot;
}

export class Bot {
  tier: BotTier;
  mode: BotMode = 'attack';

  private readonly input: CarInput = emptyInput();
  private readonly predictor = new BallPredictor();
  private readonly memory: Memory[] = [];
  private clock = 0;

  /** Current aim scatter, re-rolled on an interval. */
  private aimOffset = 0;
  private aimRolledAt = -Infinity;

  /** How long it has been asking to move without moving. */
  private stuckFor = 0;
  /** Time left reversing to get out of whatever it was stuck on. */
  private unstickFor = 0;
  /** Time left heading for open space after reversing out. */
  private clearOutFor = 0;

  /**
   * The aerial being attempted, if any.
   *
   * Held across frames rather than re-decided each step: an aerial is a
   * commitment, and a bot that re-evaluates it every frame abandons it the
   * moment the prediction wobbles and ends up jumping on the spot instead.
   */
  private aerial: {
    /** Where to meet the ball, refreshed from the intercept time each frame. */
    target: THREE.Vector3;
    /**
     * Seconds until the interception, counted down.
     *
     * The commitment is to a *moment*, not to a point and not to a fresh search
     * every frame. Re-searching picks a near, low sample one frame and a far,
     * high one the next, and the plan built on top of it — when to launch, how
     * long the climb is — changes with it, so nothing is ever carried out.
     */
    timeToIntercept: number;
    /** Seconds spent on the attempt so far. */
    elapsed: number;
    /** Whether the first jump has been used. */
    jumped: boolean;
    /** Whether the second jump has been used. */
    doubleJumped: boolean;
    /** How long the first jump has been held, for the taller hop. */
    heldFor: number;
    /** Frames spent with jump released, so the second one can register. */
    releasedFor: number;
  } | null = null;
  private readonly aim: AerialInputs = { pitch: 0, steer: 0, roll: 0, error: 0 };

  /** The pad being collected, held for a moment to stop dithering. */
  private targetPad: BoostPad | null = null;
  private padPickedAt = -Infinity;

  /** Scratch. */
  private readonly target = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  /** The car's spin, read once a frame for the aerial controller. */
  private readonly angvel = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  role: BotRole;

  constructor(
    readonly car: Car,
    level: number,
    /** Deterministic for tests; defaults to Math.random. */
    private readonly random: () => number = Math.random,
    role: BotRole = 'balanced',
  ) {
    this.tier = tier(level);
    this.role = role;
  }

  setLevel(level: number): void {
    this.tier = tier(level);
  }

  setRole(role: BotRole): void {
    this.role = role;
  }

  private mods(): { jump: number; boostAccel: number } {
    return this.car.mods;
  }

  /** Which end this bot defends. */
  private get ownGoalX(): number {
    return this.car.team === 0 ? -cfg.arena.halfLength : cfg.arena.halfLength;
  }

  private get targetGoalX(): number {
    return -this.ownGoalX;
  }

  /** Decides what to do and returns the input for this step. */
  think(dt: number, world: BotWorld): CarInput {
    this.clock += dt;
    this.remember(world.ball);

    const ball = this.recallBall();
    const basis = this.readBasis();

    // Upside down: do nothing and let the car right itself, since driving or
    // boosting from there only makes it worse.
    //
    // This must not fire during an aerial. Pointing the nose up tilts the roof
    // away from world up by exactly the same angle, so a 60 degree climb looks
    // identical to falling over, and the guard used to abandon every aerial at
    // the moment it started working.
    if (!this.aerial && basis.upness < 0.5 && !this.car.grounded) {
      this.mode = 'recover';
      return this.idle();
    }
    if (this.aerial && basis.upness < -0.4 && !this.car.grounded) {
      // Genuinely inverted mid-aerial: give it up rather than thrusting
      // downwards.
      this.aerial = null;
      this.mode = 'recover';
      return this.idle();
    }

    this.clearOutFor = Math.max(0, this.clearOutFor - dt);

    // Just backed out of something: head for open space before going back to
    // the ball, or it drives straight into the same wall again.
    if (this.clearOutFor > 0 && this.unstickFor <= 0) {
      this.mode = 'unstick';
      this.aimAtOpenSpace();
      this.clampToPitch();
      return this.driveToTarget(dt, ball);
    }

    // An aerial in progress outranks everything except righting itself.
    if (this.aerial) {
      this.aerial.elapsed += dt;
      if (this.aerialStillOn(ball)) {
        this.mode = 'aerial';
        return this.flyAerial(dt, ball);
      }
      this.aerial = null;
    }

    this.mode = this.chooseMode(ball, world);
    if (this.mode === 'attack' && this.tier.usesAerials && this.car.grounded) {
      const started = this.considerAerial(ball);
      if (started) {
        this.mode = 'aerial';
        return this.flyAerial(dt, ball);
      }
    }

    switch (this.mode) {
      case 'collect':
        this.aimAtPad(world);
        break;
      case 'defend':
        this.aimAtDefensivePost(ball);
        break;
      default:
        this.aimAtBall(ball);
        break;
    }

    this.clampToPitch();
    return this.driveToTarget(dt, ball);
  }

  // --- perception ---------------------------------------------------------

  private remember(ball: BallSnapshot & { radius: number }): void {
    this.memory.push({
      time: this.clock,
      snapshot: {
        position: { ...ball.position },
        velocity: { ...ball.velocity },
      },
    });
    // Keep a little more than the delay needs.
    const cutoff = this.clock - (this.tier.reactionDelay + 0.1);
    while (this.memory.length > 1 && this.memory[0]!.time < cutoff) this.memory.shift();
  }

  /** The ball as the bot currently believes it to be: a little out of date. */
  private recallBall(): BallSnapshot {
    const wanted = this.clock - this.tier.reactionDelay;
    // The buffer is short, so a scan is cheaper than anything clever.
    for (let i = this.memory.length - 1; i >= 0; i--) {
      if (this.memory[i]!.time <= wanted) return this.memory[i]!.snapshot;
    }
    return this.memory[0]!.snapshot;
  }

  private readBasis(): { upness: number } {
    const r = this.car.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.fwd.copy(FORWARD).applyQuaternion(this.q);
    this.right.copy(RIGHT).applyQuaternion(this.q);
    this.up.copy(UP).applyQuaternion(this.q);
    const a = this.car.body.angvel();
    this.angvel.set(a.x, a.y, a.z);
    return { upness: this.up.dot(WORLD_UP) };
  }

  // --- deciding ----------------------------------------------------------

  private chooseMode(ball: BallSnapshot, world: BotWorld): BotMode {
    const t = this.tier;

    // A keeper holds its net. It only leaves to clear a ball that has come
    // close enough to be dangerous, which is what makes it read as a keeper
    // rather than as an opponent that happens to be standing in the way.
    if (this.role === 'keeper') {
      const side = Math.sign(this.ownGoalX);
      const ballDepth = ball.position.x * side;
      const clearRange = cfg.arena.halfLength * cfg.ai.keeperClearDepth;
      return ballDepth > clearRange ? 'attack' : 'defend';
    }

    if (t.defends && this.role !== 'attacker') {
      // Ball well into our own half and heading our way: get back.
      const side = Math.sign(this.ownGoalX);
      const depth = (ball.position.x / cfg.arena.halfLength) * side;
      const closing = ball.velocity.x * side > 0;
      const behindBall = (this.car.position.x - ball.position.x) * side < 0;
      if (depth > cfg.ai.defendTrigger && closing && behindBall) return 'defend';
    }

    if (t.managesBoost) {
      const p = this.car.position;
      const toBall = Math.hypot(ball.position.x - p.x, ball.position.z - p.z);

      // An attack already developing outranks needing boost. Without this the
      // bot boosts, drops under its low mark, abandons the attack for a pad,
      // tops up, boosts again and repeats: it spends the match pad-hunting and
      // barely plays. Being behind the ball is the cheap test for "this is my
      // play", and it is the same test the shot itself uses.
      const botToGoal = Math.hypot(this.targetGoalX - p.x, p.z);
      const ballToGoal = Math.hypot(this.targetGoalX - ball.position.x, ball.position.z);
      const attackLive = botToGoal > ballToGoal && toBall < cfg.ai.attackLiveRange;

      // Needing boost never outranks a ball that is right there, either.
      if (!attackLive && toBall > cfg.ai.collectBallGuard) {
        // Hysteresis: it takes more boost to stop collecting than to start, or
        // the decision flaps on and off as the meter crosses the threshold and
        // the bot drives back and forth between a pad and the ball.
        const threshold =
          this.mode === 'collect' ? t.boostLowMark + cfg.ai.collectHysteresis : t.boostLowMark;
        if (this.car.boost < threshold) {
          const pad = this.pickPad(world, ball);
          if (pad) {
            this.targetPad = pad;
            return 'collect';
          }
        }
      }
    }

    this.targetPad = null;
    return 'attack';
  }

  /**
   * A pad worth the detour: live, roughly on the way to the ball, and not
   * miles off. Re-picked on an interval so the bot does not flip between two
   * pads and drive between them.
   */
  private pickPad(world: BotWorld, ball: BallSnapshot): BoostPad | null {
    if (
      this.targetPad &&
      this.targetPad.cooldown <= 0 &&
      this.clock - this.padPickedAt < cfg.ai.padRepickInterval
    ) {
      return this.targetPad;
    }

    const p = this.car.position;
    let best: BoostPad | null = null;
    let bestCost = Infinity;
    for (const pad of world.pads) {
      if (pad.cooldown > 0) continue;
      const toPad = Math.hypot(pad.x - p.x, pad.z - p.z);
      const padToBall = Math.hypot(ball.position.x - pad.x, ball.position.z - pad.z);
      // Prefer pads that are close and do not send us away from the ball. Big
      // pads are worth a longer trip.
      const cost = toPad + padToBall * 0.6 - (pad.big ? 1800 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = pad;
      }
    }
    if (best) this.padPickedAt = this.clock;
    return best;
  }

  // --- choosing a target -------------------------------------------------

  private aimAtBall(ball: BallSnapshot): void {
    const t = this.tier;
    const a = cfg.ai;
    const hit = this.interceptPoint(ball);
    const p = this.car.position;

    // Where in the goal to put it: the middle, always.
    //
    // Aiming nearer the close post from out wide looks right — it is a much
    // shorter shot — and measures worse, 36 conversions against 46. Distance is
    // not what beats these shots; every ball that reaches the back wall goes
    // in. What beats them is the ball never getting there, and the middle has
    // the most mouth behind it when the touch is imperfect.
    const aimZ = 0;
    const goalDx = this.targetGoalX - hit.position.x;
    const goalDz = aimZ - hit.position.z;
    const goalLen = Math.hypot(goalDx, goalDz) || 1;
    const ux = goalDx / goalLen;
    const uz = goalDz / goalLen;

    // Which way to strike it. A touch changes the ball's velocity rather than
    // simply pushing it goalward, so the direction that actually sends it at the
    // net is the one that cancels whatever sideways drift it already has.
    const needX = ux * a.shotSpeed - hit.velocity.x;
    const needZ = uz * a.shotSpeed - hit.velocity.z;
    const needLen = Math.hypot(needX, needZ) || 1;
    const gx = needX / needLen;
    const gz = needZ / needLen;

    // How well placed we already are: 1 means sitting directly behind the ball
    // with the goal beyond it, 0 means square on to the line of the shot.
    const toHitX = hit.position.x - p.x;
    const toHitZ = hit.position.z - p.z;
    const toHitLen = Math.hypot(toHitX, toHitZ) || 1;
    const alignment = (toHitX / toHitLen) * gx + (toHitZ / toHitLen) * gz;

    // Being further from the goal than the ball is what makes driving forward
    // push it goalward rather than across.
    const botToGoal = Math.hypot(this.targetGoalX - p.x, aimZ - p.z);
    const ballToGoal = Math.hypot(this.targetGoalX - hit.position.x, aimZ - hit.position.z);
    const behindBall = botToGoal > ballToGoal + a.commitBehindMargin;

    // Which way the car is pointing matters as much as where it is standing:
    // the ball leaves along the car's direction of travel, so a well-placed car
    // that is crossing the shot line will still hit the ball sideways.
    const headingDot = this.fwd.x * gx + this.fwd.z * gz;

    this.reasoning.alignment = alignment;
    this.reasoning.behindBall = behindBall;
    this.reasoning.headingDot = headingDot;
    this.reasoning.committed =
      alignment > a.commitAlignment && behindBall && headingDot > a.commitHeading;

    if (this.reasoning.committed) {
      // Lined up: aim at the contact point on the near side of the ball, so the
      // car's path runs through the ball's centre along the shot line. Aiming
      // past the ball instead lets it cut the corner and clip the edge.
      const contact = cfg.ball.radius * a.contactOffsetRadii;
      this.target.set(
        hit.position.x - gx * contact,
        hit.position.y,
        hit.position.z - gz * contact,
      );
    } else {
      // Not lined up: loop round to the far side of the ball from the goal.
      // The waypoint is swung out to whichever side the car is already on, so
      // the path curves around the ball instead of straight back through it.
      const perpX = -gz;
      const perpZ = gx;
      const sideways = (p.x - hit.position.x) * perpX + (p.z - hit.position.z) * perpZ;
      const side = sideways >= 0 ? 1 : -1;
      this.target.set(
        hit.position.x - gx * a.approachStandoff + perpX * side * a.approachSwing,
        hit.position.y,
        hit.position.z - gz * a.approachStandoff + perpZ * side * a.approachSwing,
      );
    }

    // Scatter the aim sideways, re-rolled on an interval so it reads as a
    // player hitting the ball off-centre rather than as jitter.
    if (t.aimError > 0) {
      if (this.clock - this.aimRolledAt > t.aimErrorInterval) {
        this.aimOffset = (this.random() * 2 - 1) * t.aimError;
        this.aimRolledAt = this.clock;
      }
      const dx = this.target.x - p.x;
      const dz = this.target.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      // Perpendicular to the approach, so the error moves the strike across the
      // ball rather than short or long of it.
      this.target.x += (-dz / len) * this.aimOffset;
      this.target.z += (dx / len) * this.aimOffset;
    }
  }

  /**
   * Earliest point on the ball's path the car could plausibly get to.
   * Walks the prediction and takes the first sample it can reach in time.
   */
  private interceptPoint(ball: BallSnapshot): BallSnapshot {
    const horizon = this.tier.predictionHorizon;
    if (horizon <= 0) return ball;

    const samples = this.predictor.predict(ball, horizon);
    const p = this.car.position;
    const speed = Math.max(this.car.speed, 500);

    for (const sample of samples) {
      const distance = Math.hypot(sample.position.x - p.x, sample.position.z - p.z);
      // Rough: current speed plus some of the acceleration still available.
      const reachable = speed * sample.time + 0.5 * 900 * sample.time * sample.time;
      if (reachable >= distance) return sample;
    }
    // Nothing on the path is reachable in time. Chase where the ball is now:
    // falling back to the furthest future sample sends the bot sprinting at a
    // spot it has already been shown it cannot make, which is how a bot ends up
    // running away from the play.
    return ball;
  }

  /**
   * A point well away from the walls, to drive to after getting unwedged.
   * Pulls toward the middle of the pitch, which is always open.
   */
  private aimAtOpenSpace(): void {
    const p = this.car.position;
    const inset = 0.45;
    this.target.set(p.x * inset, 0, p.z * inset);
  }

  /** Keeps a waypoint on the pitch, so the bot never aims into a wall. */
  private clampToPitch(): void {
    const margin = cfg.car.hitbox.length;
    const hl = cfg.arena.halfLength - margin;
    const hw = cfg.arena.halfWidth - margin;
    this.target.x = clamp(this.target.x, -hl, hl);
    this.target.z = clamp(this.target.z, -hw, hw);
  }

  /** Sits between the ball and its own net. */
  private aimAtDefensivePost(ball: BallSnapshot): void {
    const goalX = this.ownGoalX;
    const dx = ball.position.x - goalX;
    const dz = ball.position.z - 0;
    const len = Math.hypot(dx, dz) || 1;
    // A keeper hugs the line; everyone else pushes further up.
    const reach = this.role === 'keeper' ? cfg.ai.keeperStandoff : cfg.ai.defendStandoff;
    const standoff = Math.min(reach, len * 0.6);
    this.target.set(goalX + (dx / len) * standoff, 0, (dz / len) * standoff);
  }

  private aimAtPad(world: BotWorld): void {
    const pad = this.targetPad;
    if (!pad) {
      this.target.set(0, 0, 0);
      return;
    }
    void world;
    this.target.set(pad.x, 0, pad.z);
  }

  // --- driving -----------------------------------------------------------

  /** One steering controller, whatever the target is. */
  private driveToTarget(dt: number, ball: BallSnapshot): CarInput {
    const a = cfg.ai;
    const t = this.tier;
    const i = this.input;
    Object.assign(i, emptyInput());

    const p = this.car.position;
    this.toTarget.set(this.target.x - p.x, 0, this.target.z - p.z);
    const distance = this.toTarget.length();

    // Angle to the target in the car's own frame.
    const forwardDot = this.toTarget.dot(this.fwd);
    const rightDot = this.toTarget.dot(this.right);
    const angle = Math.atan2(rightDot, forwardDot);
    const absAngle = Math.abs(angle);
    this.reasoning.targetAngle = angle;
    this.reasoning.distance = distance;

    i.steer = clamp(angle * a.steerGain, -1, 1);

    // Already reversing out of something.
    this.reasoning.unsticking = this.unstickFor > 0;
    if (this.unstickFor > 0) {
      this.unstickFor -= dt;
      i.throttle = -1;
      // Reversing flips the car's yaw response, so holding the same steer backs
      // it out while swinging the nose round toward the target.
      i.drift = false;
      i.boost = false;
      return i;
    }

    // Throttle: full ahead unless the target is well off to the side, in which
    // case easing off tightens the turn instead of driving a wide arc.
    if (absAngle > Math.PI - 0.5 && distance < 700) {
      // Target is behind and close: reverse out rather than loop round.
      i.throttle = -1;
      i.steer = -i.steer;
    } else if (absAngle > a.easeOffAngle) {
      // Braking rather than coasting: steering authority climbs sharply as
      // speed falls, so scrubbing speed turns the car round far faster than
      // arcing round at pace, which is an endless circle.
      i.throttle = this.car.speed > a.brakeToTurnSpeed ? -1 : 0.6 * t.throttleCap;
    } else {
      i.throttle = t.throttleCap;
    }

    if (t.usesPowerslide && absAngle > a.powerslideAngle && this.car.speed > 700) {
      i.drift = true;
    }

    // Boosted right up to the ball, deliberately.
    //
    // Capping the arrival speed to avoid overshooting was the obvious idea and
    // measured badly: it cost tier three a third of its goals, 12.5 a match
    // down to 7.6, for about half a goal gained at tier four. Fast strikes are
    // the accurate ones anyway — off-centre by 17uu at 1600uu/s against 57 at
    // 800 — because a car at speed travels in a straight line and has no time
    // to wander off it.
    if (
      t.usesBoost &&
      this.car.boost > t.boostReserve &&
      absAngle < a.boostAngle &&
      distance > a.boostMinDistance &&
      this.car.grounded
    ) {
      i.boost = true;
    }

    if (t.usesDodges && this.mode === 'attack') {
      this.maybeAerialOrDodge(i, ball, distance, absAngle);
    }

    // Wedged against something: a wall, a corner, or the inside of a goal.
    // Only counted when it is actually *asking* to go forward and not going:
    // braking to turn, and the moment after striking the ball, are both slow on
    // purpose and are not stuck. Without this a bot that drives into the net
    // steers into the back of it for the rest of the match and the round can
    // never finish.
    if (i.throttle > 0 && this.car.speed < a.stuckSpeed) {
      this.stuckFor += dt;
      if (this.stuckFor > a.stuckTime) {
        this.stuckFor = 0;
        this.unstickFor = a.unstickTime;
        this.clearOutFor = a.unstickTime + a.clearOutTime;
      }
    } else {
      this.stuckFor = 0;
    }

    return i;
  }

  // --- aerials ------------------------------------------------------------

  /**
   * Looks for a ball worth leaving the ground for, and commits if there is one.
   *
   * Deliberately strict: an aerial that fails leaves the bot airborne, out of
   * boost and facing the wrong way, which costs far more than the chance was
   * worth. It has to be high enough to need an aerial at all, far enough ahead
   * to climb to, and affordable out of the tank.
   */
  private considerAerial(ball: BallSnapshot): boolean {
    const a = cfg.ai;
    if (this.car.boost < a.aerialMinBoost) return false;

    const samples = this.predictor.predict(ball, Math.max(2.2, this.tier.predictionHorizon));

    // Driving beats flying whenever driving is on. If the ball is going to be
    // at a height the car can reach from the floor, soon enough to get there,
    // take that instead.
    if (this.groundedChanceSoon(samples)) return false;

    const p = this.car.position;
    const gravity = -cfg.physics.gravity;
    // What a jump and a double jump are worth, as one upward push.
    const jumpSpeed = (cfg.car.jumpImpulse + cfg.car.doubleJumpImpulse) * this.mods().jump;
    const boostAccel = cfg.boost.accel * this.mods().boostAccel;

    for (const sample of samples) {
      if (sample.time < a.aerialMinTime) continue;
      if (sample.position.y < a.aerialMinHeight) continue;

      const distance = Math.hypot(sample.position.x - p.x, sample.position.z - p.z);
      const climb = sample.position.y - p.y;

      // How long the climb takes, and therefore how far the car will drift
      // across while doing it. That drift *is* the lateral reach of an aerial:
      // a fixed radius around the ball is not a criterion, it is a guess, and
      // the one here previously was tight enough to make a correct launch
      // impossible.
      const climbSeconds = climbTime({
        height: climb,
        launchSpeed: jumpSpeed,
        boostAccel,
        gravity,
        turnTime: a.aerialTurnTime,
      });
      if (climbSeconds === null) continue;
      // There has to be time to climb before the ball arrives.
      if (sample.time < climbSeconds) continue;

      // And the car has to be able to get to the launch point in the time left
      // over, at a speed that then carries it across.
      const launchSpeedNow = Math.max(this.car.speed, cfg.car.maxDriveSpeed * 0.5);
      const drift = launchSpeedNow * climbSeconds;
      const toLaunch = distance - drift;
      const timeToLaunch = sample.time - climbSeconds;
      if (toLaunch > launchSpeedNow * timeToLaunch + a.aerialMaxReach) continue;
      if (distance > a.aerialMaxReach + drift) continue;

      const cost = aerialCost({
        distance,
        climb,
        time: sample.time,
        speed: this.car.speed,
        gravity,
        boostAccel,
        jumpSpeed,
      });
      if (cost === null) continue;
      // Pay for it out of what is actually in the tank.
      if (cost * cfg.boost.drainPerSec > this.car.boost) continue;

      this.aerial = {
        target: new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z),
        timeToIntercept: sample.time,
        elapsed: 0,
        jumped: false,
        doubleJumped: false,
        heldFor: 0,
        releasedFor: 0,
      };
      return true;
    }
    return false;
  }

  /** Whether the ball will be drivable, and reachable, before long. */
  private groundedChanceSoon(samples: readonly PredictedSample[]): boolean {
    const a = cfg.ai;
    const p = this.car.position;
    const speed = Math.max(this.car.speed, cfg.car.maxDriveSpeed * 0.5);
    for (const sample of samples) {
      if (sample.time > a.aerialGroundedWindow) return false;
      if (sample.position.y > a.aerialMinHeight) continue;
      const distance = Math.hypot(sample.position.x - p.x, sample.position.z - p.z);
      if (distance <= speed * sample.time) return true;
    }
    return false;
  }

  /**
   * Refreshes the aerial target from the committed intercept time.
   *
   * The prediction improves as the moment approaches, so the point moves a
   * little; the time it is pinned to does not. That is what keeps the launch
   * distance and the climb estimate talking about the same thing.
   */
  private updateAerialTarget(dt: number, ball: BallSnapshot): void {
    const attempt = this.aerial;
    if (!attempt) return;
    attempt.timeToIntercept -= dt;
    if (attempt.timeToIntercept <= 0) return;

    const step = Math.min(1 / 30, attempt.timeToIntercept);
    const samples = this.predictor.predict(ball, attempt.timeToIntercept, step);
    const at = samples[samples.length - 1];
    if (at) attempt.target.set(at.position.x, at.position.y, at.position.z);
  }

  /** Orientation gains, including what the car can actually do in the air. */
  private aerialGains() {
    const a = cfg.ai;
    const air = this.car.mods.airControl;
    return {
      p: a.aerialP,
      d: a.aerialD,
      rollP: a.aerialRollP,
      rollD: a.aerialRollD,
      pitchAccel: cfg.car.airPitchAccel * air,
      yawAccel: cfg.car.airYawAccel * air,
      rollAccel: cfg.car.airRollAccel * air,
      maxRate: cfg.car.maxAngularSpeed,
    };
  }

  /** Whether the attempt is still worth continuing. */
  private aerialStillOn(ball: BallSnapshot): boolean {
    const a = cfg.ai;
    const attempt = this.aerial;
    if (!attempt) return false;
    // Out of time, out of boost, or back on the floor with the ball long gone.
    if (attempt.elapsed > a.aerialMaxSetup + 2) return false;
    if (attempt.jumped && this.car.grounded && attempt.elapsed > 0.4) return false;
    if (!attempt.jumped && attempt.elapsed > a.aerialMaxSetup) return false;
    // The moment it was aiming for has passed.
    if (attempt.timeToIntercept <= -0.3) return false;
    // Ball has come back down to where driving would do.
    if (ball.position.y < a.aerialMinHeight * 0.5 && !attempt.jumped) return false;
    return true;
  }

  /**
   * Runs an aerial: drive under the target, jump, then point the nose at it and
   * boost. Steering in the air is the orientation controller's job; this
   * decides when to jump and when to thrust.
   */
  private flyAerial(dt: number, ball: BallSnapshot): CarInput {
    const a = cfg.ai;
    const attempt = this.aerial!;
    const i = this.input;
    Object.assign(i, emptyInput());

    // Re-aim every frame. Flying at the point the ball occupied when the
    // attempt started means flying at where it is not: by the time the car is
    // airborne the ball has moved hundreds of units, and the nose never lines
    // up, so it never boosts and never arrives.
    this.updateAerialTarget(dt, ball);

    const p = this.car.position;
    const toTarget = this.tmp.set(
      attempt.target.x - p.x,
      attempt.target.y - p.y,
      attempt.target.z - p.z,
    );

    if (this.car.grounded && !attempt.jumped) {
      // Still on the floor: drive at the spot under the target, and launch at
      // the distance the climb will drift across rather than when close to it.
      const flat = Math.hypot(toTarget.x, toTarget.z);
      this.target.set(attempt.target.x, 0, attempt.target.z);
      this.clampToPitch();
      const drive = this.driveToTarget(dt, ball);

      const climb = climbTime({
        height: toTarget.y,
        launchSpeed: a.aerialLaunchSpeed * this.mods().jump,
        boostAccel: cfg.boost.accel * this.mods().boostAccel,
        gravity: -cfg.physics.gravity,
        turnTime: a.aerialTurnTime,
      });
      if (
        climb !== null &&
        shouldLaunch({
          distance: flat,
          speed: this.car.speed,
          climbSeconds: climb,
          tolerance: a.aerialLaunchTolerance,
        })
      ) {
        drive.jumpPressed = true;
        drive.jumpHeld = true;
        attempt.jumped = true;
      }
      return drive;
    }

    let doubleJumpingNow = false;

    // Airborne jump sequence: hold the first jump for its full window, release,
    // then press again for the second.
    //
    // The release is not optional. A car needs jump let go of before the second
    // one registers, which is the real game's rule, so holding it down for
    // height blocks the double jump entirely: the bot climbs on one jump and
    // never understands why it cannot reach anything.
    if (attempt.jumped && !attempt.doubleJumped) {
      if (attempt.heldFor < cfg.car.jumpHoldTime) {
        attempt.heldFor += dt;
        i.jumpHeld = true;
      } else if (attempt.releasedFor < a.aerialJumpGap) {
        attempt.releasedFor += dt;
        // Jump deliberately not held: this is the gap.
      } else {
        i.jumpPressed = true;
        i.jumpHeld = true;
        attempt.doubleJumped = true;
        doubleJumpingNow = true;
      }
    }

    // While still well below the target, aim above it: thrust spent climbing is
    // worth more than thrust spent closing the horizontal gap, which the car
    // can do on the way down.
    const climb = toTarget.y;
    if (climb > a.aerialClimbUntil) {
      const bias = Math.min(1, climb / 900) * a.aerialClimbBias;
      toTarget.y += Math.hypot(toTarget.x, toTarget.z) * bias;
    }

    pointNoseAt(
      toTarget,
      this.fwd,
      this.up,
      this.right,
      this.angvel,
      this.aerialGains(),
      this.aim,
    );
    if (doubleJumpingNow) {
      // The second jump has to be pressed with the stick centred.
      //
      // A directional second jump is a dodge, not a jump: the car snaps into a
      // flip and locks out air control. Holding a nose-up command through that
      // frame turns the climb into a front flip, which is exactly nose-down,
      // and the aerial is over before it began.
      i.pitch = 0;
      i.steer = 0;
      i.roll = 0;
    } else {
      i.pitch = this.aim.pitch;
      i.steer = this.aim.steer;
      i.roll = this.aim.roll;
    }

    // Thrust once roughly pointed at the aim direction. While climbing, any
    // thrust with an upward component is worth having even off-aim: height is
    // the scarce thing, and waiting for a tidy line wastes the airtime.
    const climbing = climb > a.aerialClimbUntil;
    const window = climbing ? a.aerialBoostAngle * 2.2 : a.aerialBoostAngle;
    const noseUp = this.fwd.y > 0.15;
    i.boost = this.car.boost > 0 && (this.aim.error < window || (climbing && noseUp));
    return i;
  }

  /** Jump at a high ball, or flip into a close one for extra power. */
  private maybeAerialOrDodge(
    i: CarInput,
    ball: BallSnapshot,
    distance: number,
    absAngle: number,
  ): void {
    const a = cfg.ai;
    if (!this.car.grounded) return;

    const ballHigh = ball.position.y > a.jumpBallHeight;
    if (ballHigh && distance < a.jumpRange && absAngle < a.dodgeAngle) {
      i.jumpPressed = true;
      i.jumpHeld = true;
      return;
    }

    if (
      !ballHigh &&
      distance < a.dodgeRange &&
      absAngle < a.dodgeAngle &&
      this.car.speed > a.dodgeMinSpeed
    ) {
      // A flip into the ball hits harder than rolling into it.
      i.jumpPressed = true;
      i.jumpHeld = true;
      i.throttle = 1;
    }
  }

  private idle(): CarInput {
    Object.assign(this.input, emptyInput());
    return this.input;
  }

  /** Where the bot is currently heading, for debugging. */
  get aimTarget(): THREE.Vector3 {
    return this.target;
  }

  /** Why it chose that target. Written every step; for tuning and tests. */
  readonly reasoning = {
    alignment: 0,
    behindBall: false,
    committed: false,
    /** Angle to the current target in the car's own frame, radians. */
    targetAngle: 0,
    distance: 0,
    /** How well the nose lines up with the shot, as a dot product. */
    headingDot: 0,
    /** Reversing out of something it got wedged on. */
    unsticking: false,
  };

  /** Wipes the reaction buffer and intentions, for a kickoff. */
  reset(): void {
    this.memory.length = 0;
    this.clock = 0;
    this.targetPad = null;
    this.padPickedAt = -Infinity;
    this.aimRolledAt = -Infinity;
    this.aimOffset = 0;
    this.stuckFor = 0;
    this.unstickFor = 0;
    this.clearOutFor = 0;
    this.aerial = null;
    this.mode = this.role === 'keeper' ? 'defend' : 'attack';
  }
}
