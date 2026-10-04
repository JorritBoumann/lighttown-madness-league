import * as THREE from 'three';
import { RAPIER, type PhysicsWorld, Group, groups } from './world';
import { cfg } from '../config';
import { clamp, sign } from '../core/mathx';
import { Curve } from '../core/curve';
import type { CarInput } from '../input/types';
import { emptyInput } from '../input/types';

/**
 * Arcade car, modelled on Rocket League's handling.
 *
 * Deliberately not a simulation: no tyre model, no engine curve, no differential.
 * What it does have is the handful of things that actually produce the feel:
 *
 *  - throttle acceleration that falls off with speed, rather than a flat force
 *    against a hard speed clamp (the clamp is what made the old version feel
 *    like it hit a wall at top speed)
 *  - steering as a front-wheel angle through a bicycle model, so turn radius
 *    widens with speed instead of the car pivoting on the spot
 *  - four suspension rays at the real wheel positions, so the chassis pitches
 *    and rolls onto surfaces
 *  - boost as pure acceleration along the nose, capped only by the global max
 *  - per-axis air control with its own damping, roll far stronger than pitch
 *    and yaw, which is what makes air roll the backbone of air play
 *
 * Local axes: +x is forward (nose), +y is up (roof), +z is right.
 * Units are Unreal Units throughout: see src/config.ts.
 */

const FWD = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(0, 0, 1);

export interface CarModifiers {
  /** Multipliers applied on top of config, for upgrades and round modifiers. */
  accel: number;
  maxSpeed: number;
  boostAccel: number;
  boostDrain: number;
  turnRate: number;
  jump: number;
  boostMax: number;
}

export function defaultModifiers(): CarModifiers {
  return { accel: 1, maxSpeed: 1, boostAccel: 1, boostDrain: 1, turnRate: 1, jump: 1, boostMax: 1 };
}

/** One suspension ray. */
interface Wheel {
  /** Position in car-local space. */
  local: THREE.Vector3;
  radius: number;
  /** Whether this wheel found ground on the last step. */
  contact: boolean;
}

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mods: CarModifiers = defaultModifiers();

  /** Inputs for the current step; replaced wholesale each frame. */
  input: CarInput = emptyInput();

  boost = cfg.boost.start;

  // Contact and jump state.
  grounded = false;
  /** Landed on a side or the roof, with no wheels to drive on. */
  beached = false;
  /** Distance from the nearest wheel to the surface. Handy while tuning. */
  groundDistance = Infinity;

  private readonly wheels: Wheel[];
  private groundNormal = new THREE.Vector3(0, 1, 0);
  private beachNormal = new THREE.Vector3(0, 1, 0);
  private airTime = 0;
  private jumpsUsed = 0;
  private jumpHoldRemaining = 0;
  /** Suppresses ground detection just after a jump, so the car leaves cleanly. */
  private groundLockout = 0;
  private dodgeLock = 0;
  private wasJumpHeld = false;
  /**
   * Set when a press has been acted on, cleared when jump is released. Rocket
   * League needs a release between the first and second jump, and without this
   * a press that stays true for more than one step fires twice over.
   */
  private jumpConsumed = false;

  // Curves, rebuilt when the config changes.
  private throttleCurve: Curve;
  private steerCurve: Curve;
  private powerslideCurve: Curve;

  // Scratch objects, reused every step so the hot loop does not allocate.
  private readonly q = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly angvel = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly cornerVel = new THREE.Vector3();
  private readonly alignQ = new THREE.Quaternion();

  /**
   * Which side this car plays for. Team 0 defends the -x end. Kept as a plain
   * number so the physics layer does not need to know about match state.
   */
  readonly team: 0 | 1;

  constructor(
    private readonly phys: PhysicsWorld,
    spawn: { x: number; y: number; z: number },
    spawnYaw = 0,
    team: 0 | 1 = 0,
  ) {
    this.team = team;
    const h = cfg.car.hitbox;
    const hx = h.length / 2;
    const hy = h.height / 2;
    const hz = h.width / 2;

    this.body = phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation({ x: 0, y: Math.sin(spawnYaw / 2), z: 0, w: Math.cos(spawnYaw / 2) })
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCcdEnabled(true),
    );

    const br = Math.min(cfg.car.colliderRadius, hy * 0.9);
    this.collider = phys.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(hx - br, hy - br, hz - br, br)
        .setFriction(0.106)
        .setRestitution(0)
        .setMass(cfg.car.mass)
        .setCollisionGroups(groups(Group.CAR, Group.ARENA | Group.BALL))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    const f = cfg.car.frontWheel;
    const r = cfg.car.rearWheel;
    this.wheels = [
      { local: new THREE.Vector3(f.x, -hy, f.z), radius: f.radius, contact: false },
      { local: new THREE.Vector3(f.x, -hy, -f.z), radius: f.radius, contact: false },
      { local: new THREE.Vector3(r.x, -hy, r.z), radius: r.radius, contact: false },
      { local: new THREE.Vector3(r.x, -hy, -r.z), radius: r.radius, contact: false },
    ];

    this.throttleCurve = new Curve(cfg.car.throttleCurve);
    this.steerCurve = new Curve(cfg.car.steerCurve);
    this.powerslideCurve = new Curve(cfg.car.powerslideSteerCurve);
  }

  /** Re-reads the tuning curves. Called when the config changes. */
  syncConfig(): void {
    this.throttleCurve = new Curve(cfg.car.throttleCurve);
    this.steerCurve = new Curve(cfg.car.steerCurve);
    this.powerslideCurve = new Curve(cfg.car.powerslideSteerCurve);
  }

  get position(): RAPIER.Vector {
    return this.body.translation();
  }

  get velocity(): RAPIER.Vector {
    return this.body.linvel();
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Forward unit vector in world space. Copy it if you need to keep it. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.body.rotation();
    return out.copy(FWD).applyQuaternion(this.q.set(r.x, r.y, r.z, r.w));
  }

  get boostFraction(): number {
    return this.boost / (cfg.boost.max * this.mods.boostMax);
  }

  get isSupersonic(): boolean {
    return this.speed >= cfg.car.supersonicSpeed;
  }

  /** True while a second jump or dodge is still available. */
  get canDoubleJump(): boolean {
    return this.jumpsUsed === 1 && this.airTime < cfg.car.doubleJumpWindow && this.dodgeLock <= 0;
  }

  /** How many wheels are touching. Drives the HUD and the AI's decisions. */
  get wheelsOnGround(): number {
    let n = 0;
    for (const w of this.wheels) if (w.contact) n++;
    return n;
  }

  addBoost(amount: number): void {
    this.boost = clamp(this.boost + amount, 0, cfg.boost.max * this.mods.boostMax);
  }

  reset(pos: { x: number; y: number; z: number }, yaw = 0): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.jumpsUsed = 0;
    this.airTime = 0;
    this.dodgeLock = 0;
    this.groundLockout = 0;
    this.jumpHoldRemaining = 0;
    this.jumpConsumed = false;
    this.boost = cfg.boost.start;
    for (const w of this.wheels) w.contact = false;
  }

  /** One fixed physics step of car logic. Call before world.step(). */
  update(dt: number): void {
    const inp = this.input;

    // Rapier keeps forces added with addForce until they are reset, so clear
    // them every step and drive the car with per-step impulses instead.
    this.body.resetForces(false);
    this.body.resetTorques(false);

    const r = this.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.fwd.copy(FWD).applyQuaternion(this.q);
    this.up.copy(UP).applyQuaternion(this.q);
    this.right.copy(RIGHT).applyQuaternion(this.q);

    const lv = this.body.linvel();
    this.vel.set(lv.x, lv.y, lv.z);
    const av = this.body.angvel();
    this.angvel.set(av.x, av.y, av.z);

    this.dodgeLock = Math.max(0, this.dodgeLock - dt);
    this.groundLockout = Math.max(0, this.groundLockout - dt);

    this.probeGround(dt);

    if (this.grounded) {
      this.airTime = 0;
      this.jumpsUsed = 0;
      this.driveOnGround(dt);
    } else if (this.beached) {
      // Sitting on a side or the roof: roll back onto the wheels, and give the
      // jump back so the player can always get out of it.
      this.rightSelf(dt);
      this.jumpsUsed = 0;
      this.airTime = 0;
    } else {
      this.airTime += dt;
      // Leaving the ground without jumping still consumes the first jump, so you
      // cannot drive off a ramp and get two jumps for free.
      if (this.jumpsUsed === 0 && this.airTime > 0.08) this.jumpsUsed = 1;
      this.controlInAir(dt);
    }

    this.handleJump(dt);
    this.applyBoost(dt);
    this.clampSpeed();

    this.wasJumpHeld = inp.jumpHeld;
  }

  // --- internals ----------------------------------------------------------

  /**
   * Four suspension rays at the real wheel positions, cast along the car's own
   * -up axis so wall and ceiling driving work the same way. Per-wheel springs
   * are what let the car pitch and roll onto a slope instead of butting into it.
   */
  private probeGround(dt: number): void {
    const c = cfg.car;
    const p = this.body.translation();
    const dir = this.tmp.copy(this.up).negate();

    let contacts = 0;
    let nearest = Infinity;
    this.groundNormal.set(0, 0, 0);

    // Just after a jump the wheels are still within suspension range. Pushing
    // against that would add height the jump figures do not account for.
    if (this.groundLockout > 0) {
      for (const wheel of this.wheels) wheel.contact = false;
      this.grounded = false;
      this.beached = false;
      this.groundDistance = Infinity;
      return;
    }

    for (const wheel of this.wheels) {
      // Ray starts at the wheel's mounting point and reaches past the tyre.
      const rest = c.rideHeight + wheel.radius;
      const reach = rest + c.suspensionTravel;
      const origin = this.tmp2
        .set(p.x, p.y, p.z)
        .addScaledVector(this.fwd, wheel.local.x)
        .addScaledVector(this.up, wheel.local.y)
        .addScaledVector(this.right, wheel.local.z);

      const hit = this.phys.ray(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
        reach,
        this.body,
      );
      wheel.contact = !!hit && hit.distance <= rest + c.suspensionTravel * 0.5;
      if (!hit) continue;

      if (wheel.contact) {
        contacts++;
        nearest = Math.min(nearest, hit.distance);
        this.groundNormal.x += hit.normal.x;
        this.groundNormal.y += hit.normal.y;
        this.groundNormal.z += hit.normal.z;
      }

      // Spring and damper for this wheel, applied at the wheel so it produces
      // the pitch and roll the chassis should have.
      const compression = rest - hit.distance;
      if (compression <= 0) continue;
      const wheelVel = this.pointVelocity(origin, p);
      const normalVel = wheelVel.dot(this.up);
      const accel = compression * c.suspensionStiffness - normalVel * c.suspensionDamping;
      if (accel <= 0) continue;
      const j = accel * c.mass * dt;
      this.body.applyImpulseAtPoint(
        { x: this.up.x * j, y: this.up.y * j, z: this.up.z * j },
        { x: origin.x, y: origin.y, z: origin.z },
        true,
      );
    }

    if (contacts > 0) {
      this.groundNormal.normalize();
      if (this.groundNormal.lengthSq() < 1e-6) this.groundNormal.copy(this.up);
      this.groundDistance = nearest;
      // Two wheels down is enough to drive; one is a scrape, not traction.
      this.grounded = contacts >= 2;
    } else {
      this.grounded = false;
      this.groundDistance = Infinity;
    }

    // Land on a side or the roof and the car's own down-rays miss the floor
    // entirely, so it would never recover. Catch that with a world-space ray.
    this.beached = false;
    if (!this.grounded) {
      const h = c.hitbox;
      const diag = Math.hypot(h.length, h.height, h.width) / 2;
      const rest = this.phys.ray(
        { x: p.x, y: p.y, z: p.z },
        { x: 0, y: -1, z: 0 },
        diag + 20,
        this.body,
      );
      if (rest && this.vel.lengthSq() < c.rightingSpeedLimit ** 2) {
        this.beachNormal.set(rest.normal.x, rest.normal.y, rest.normal.z);
        if (this.beachNormal.lengthSq() < 1e-6) this.beachNormal.set(0, 1, 0);
        // Only beached if the roof is actually pointing away from the surface.
        // A car flying low and slow over the floor is not stuck, it is flying.
        this.beached = this.up.dot(this.beachNormal) < c.rightingUprightLimit;
      }
    }
  }

  /** Velocity of a world-space point on the chassis, including spin. */
  private pointVelocity(point: THREE.Vector3, centre: RAPIER.Vector): THREE.Vector3 {
    const r = this.tmp3.set(point.x - centre.x, point.y - centre.y, point.z - centre.z);
    return this.cornerVel.copy(this.angvel).cross(r).add(this.vel);
  }

  private driveOnGround(dt: number): void {
    const c = cfg.car;
    const m = this.mods;
    const inp = this.input;
    const n = this.groundNormal;

    // The wheel impulses have already changed the velocity this step.
    const lv = this.body.linvel();
    this.vel.set(lv.x, lv.y, lv.z);

    // Work in the surface plane, so this all holds on walls and the ceiling.
    const planeFwd = this.tmp.copy(this.fwd).addScaledVector(n, -this.fwd.dot(n)).normalize();
    const planeRight = this.tmp2.copy(this.right).addScaledVector(n, -this.right.dot(n)).normalize();
    const alongSpeed = this.vel.dot(planeFwd);
    const absAlong = Math.abs(alongSpeed);

    // --- Throttle, brake, coast ---
    if (inp.throttle !== 0) {
      const opposing = sign(inp.throttle) !== sign(alongSpeed) && absAlong > 10;
      if (opposing) {
        // Braking: a flat, strong deceleration, and it never pushes you past a stop.
        const drop = Math.min(absAlong, c.brakeAccel * dt);
        this.vel.addScaledVector(planeFwd, -sign(alongSpeed) * drop);
      } else if (inp.throttle > 0) {
        // Acceleration tapers to nothing at maxDriveSpeed. No hard clamp, which
        // is what keeps the top end from feeling like hitting a wall.
        const accel = this.throttleCurve.at(absAlong) * m.accel;
        this.vel.addScaledVector(planeFwd, accel * dt);
      } else {
        // Reverse tops out well below forwards.
        if (absAlong < c.maxDriveSpeed * 0.4) {
          this.vel.addScaledVector(planeFwd, -c.brakeAccel * dt);
        }
      }
    } else if (absAlong > 1) {
      const drop = Math.min(absAlong, c.coastDecel * dt);
      this.vel.addScaledVector(planeFwd, -sign(alongSpeed) * drop);
    }

    // --- Lateral grip ---
    // A fraction of sideways speed shed per step. Powerslide cuts it right down,
    // which is the whole trick: the car keeps its heading while it slides.
    const lateral = this.vel.dot(planeRight);
    const grip = inp.drift ? c.handbrakeGrip : c.lateralGrip;
    this.vel.addScaledVector(planeRight, -lateral * Math.min(1, grip * 120 * dt));

    // Press into the surface so the car holds walls and the seam ramps.
    this.vel.addScaledVector(n, -c.stickForce * dt);

    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);

    // --- Steering ---
    // Front wheel angle from the curve, then a bicycle model for yaw rate:
    // omega = v * tan(delta) / wheelbase. Turn radius therefore widens with
    // speed on its own, instead of needing a fudge factor.
    const steerAngle =
      (inp.drift ? this.powerslideCurve.at(absAlong) : this.steerCurve.at(absAlong)) *
      (inp.drift ? c.powerslideSteerGain : 1);
    let yawRate = (absAlong * Math.tan(steerAngle * inp.steer)) / c.steerWheelbase;
    yawRate *= m.turnRate;
    if (alongSpeed < 0) yawRate = -yawRate;
    // Standing still with no throttle should not let the car pivot on the spot.
    if (absAlong < 20 && inp.throttle === 0) yawRate *= 0.1;

    // Alignment: rotate the roof toward the surface normal.
    this.alignQ.setFromUnitVectors(this.up, n);
    const alignAngle = 2 * Math.acos(clamp(Math.abs(this.alignQ.w), -1, 1));
    const axisLen = Math.hypot(this.alignQ.x, this.alignQ.y, this.alignQ.z);
    const target = this.tmp.set(0, 0, 0).addScaledVector(n, yawRate);
    if (axisLen > 1e-5 && alignAngle > 1e-4) {
      const k = (alignAngle * c.surfaceAlignRate) / axisLen;
      target.x += this.alignQ.x * k;
      target.y += this.alignQ.y * k;
      target.z += this.alignQ.z * k;
    }
    this.body.setAngvel({ x: target.x, y: target.y, z: target.z }, true);
  }

  private controlInAir(dt: number): void {
    const c = cfg.car;
    const inp = this.input;

    if (this.dodgeLock <= 0) {
      // Config values are angular accelerations in rad/s^2: direct, predictable,
      // and independent of the inertia tensor.
      this.angvel.addScaledVector(this.right, -inp.pitch * c.airPitchAccel * dt);
      this.angvel.addScaledVector(this.up, inp.steer * c.airYawAccel * dt);
      this.angvel.addScaledVector(this.fwd, inp.roll * c.airRollAccel * dt);

      // Per-axis damping, applied only where there is no input. Holding an axis
      // stays crisp; releasing it settles.
      this.dampAxis(this.right, inp.pitch, c.airPitchDamping, dt);
      this.dampAxis(this.up, inp.steer, c.airYawDamping, dt);
      this.dampAxis(this.fwd, inp.roll, c.airRollDamping, dt);
    }

    if (this.angvel.length() > c.maxAngularSpeed) this.angvel.setLength(c.maxAngularSpeed);
    this.body.setAngvel({ x: this.angvel.x, y: this.angvel.y, z: this.angvel.z }, true);
  }

  /** Bleeds spin off one body axis, unless that axis is being driven. */
  private dampAxis(axis: THREE.Vector3, input: number, rate: number, dt: number): void {
    if (input !== 0) return;
    const component = this.angvel.dot(axis);
    this.angvel.addScaledVector(axis, -component * Math.min(1, rate * dt));
  }

  /** Rolls a beached car back onto its wheels, and lifts it clear as it goes. */
  private rightSelf(dt: number): void {
    const c = cfg.car;
    this.alignQ.setFromUnitVectors(this.up, this.beachNormal);
    const angle = 2 * Math.acos(clamp(Math.abs(this.alignQ.w), -1, 1));
    const axisLen = Math.hypot(this.alignQ.x, this.alignQ.y, this.alignQ.z);
    if (axisLen > 1e-5 && angle > 1e-3) {
      const k = (angle * c.rightingRate) / axisLen;
      this.body.setAngvel(
        { x: this.alignQ.x * k, y: this.alignQ.y * k, z: this.alignQ.z * k },
        true,
      );
    }
    // A nudge away from the surface, so a roof landing does not grind in place.
    this.impulseAlong(this.beachNormal, c.rightingLift * dt);
  }

  private handleJump(dt: number): void {
    const c = cfg.car;
    const inp = this.input;
    const jumpScale = this.mods.jump;

    // Sustained first jump: holding jump keeps accelerating for a short window.
    if (this.jumpHoldRemaining > 0) {
      if (inp.jumpHeld) {
        this.jumpHoldRemaining -= dt;
        this.impulseAlong(this.up, c.jumpAccel * jumpScale * dt);
      } else {
        this.jumpHoldRemaining = 0;
      }
    }

    if (!inp.jumpHeld && !inp.jumpPressed) this.jumpConsumed = false;

    const pressed =
      !this.jumpConsumed && (inp.jumpPressed || (inp.jumpHeld && !this.wasJumpHeld));
    if (!pressed) return;
    this.jumpConsumed = true;

    if (this.grounded || this.jumpsUsed === 0) {
      this.impulseAlong(this.up, c.jumpImpulse * jumpScale);
      this.jumpsUsed = 1;
      this.jumpHoldRemaining = c.jumpHoldTime;
      this.grounded = false;
      this.groundLockout = c.jumpGroundLockout;
      this.airTime = 0.0001;
      return;
    }

    if (this.canDoubleJump) {
      const dirX = inp.throttle || inp.pitch;
      const dirZ = inp.steer;
      if (Math.abs(dirX) > c.dodgeDeadzone || Math.abs(dirZ) > c.dodgeDeadzone) {
        this.dodge(dirX, dirZ);
      } else {
        this.impulseAlong(this.up, c.doubleJumpImpulse * jumpScale);
      }
      this.jumpsUsed = 2;
    }
  }

  /** Directional dodge: a committed kick plus the spin that reads as the move. */
  private dodge(dirX: number, dirZ: number): void {
    const c = cfg.car;
    const mag = Math.hypot(dirX, dirZ);
    const fx = dirX / mag;
    const fz = dirZ / mag;

    // Kick in the car's own horizontal plane.
    const kick = this.tmp
      .set(0, 0, 0)
      .addScaledVector(this.fwd, fx)
      .addScaledVector(this.right, fz);
    kick.addScaledVector(this.up, -this.up.dot(kick)).normalize();

    const lv = this.body.linvel();
    this.vel.set(lv.x, lv.y, lv.z);

    // Flatten vertical velocity so a front dodge actually goes forward. That
    // conversion, plus the flat kick, is what makes flipping a way to travel.
    this.vel.addScaledVector(this.up, -this.vel.dot(this.up) * 0.45);
    this.vel.addScaledVector(kick, c.dodgeImpulse);
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);

    // Spin about the axis perpendicular to the kick: pitch for forward and back,
    // roll for sideways.
    const axis = this.tmp2
      .set(0, 0, 0)
      .addScaledVector(this.right, fx)
      .addScaledVector(this.fwd, -fz)
      .normalize();
    this.body.setAngvel(
      { x: axis.x * c.dodgeTorque, y: axis.y * c.dodgeTorque, z: axis.z * c.dodgeTorque },
      true,
    );
    this.dodgeLock = c.dodgeLockTime;
  }

  private applyBoost(dt: number): void {
    const inp = this.input;
    if (!inp.boost || this.boost <= 0) return;
    this.boost = Math.max(0, this.boost - cfg.boost.drainPerSec * this.mods.boostDrain * dt);
    this.impulseAlong(this.fwd, cfg.boost.accel * this.mods.boostAccel * dt);
  }

  /** The one hard speed limit. Throttle tapers off on its own well below it. */
  private clampSpeed(): void {
    const cap = cfg.car.maxSpeed * this.mods.maxSpeed;
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    if (speed > cap) {
      const k = cap / speed;
      this.body.setLinvel({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);
    }
  }

  /** `magnitude` is a change in velocity (uu/s), not a force. */
  private impulseAlong(dir: THREE.Vector3, magnitude: number): void {
    const j = magnitude * cfg.car.mass;
    this.body.applyImpulse({ x: dir.x * j, y: dir.y * j, z: dir.z * j }, true);
  }

  destroy(): void {
    this.phys.world.removeRigidBody(this.body);
  }
}
