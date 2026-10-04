import * as THREE from 'three';
import { RAPIER, type PhysicsWorld, Group, groups } from './world';
import { cfg } from '../config';
import { clamp, sign } from '../core/mathx';
import type { CarInput } from '../input/types';
import { emptyInput } from '../input/types';

/**
 * Arcade car. Deliberately not a simulation: there are no wheels, no tyre model
 * and no engine curve. One box, a ground ray for contact, and direct control of
 * velocity and angular velocity. That is what makes it feel snappy.
 *
 * Local axes: +x is forward (nose), +y is up (roof), +z is right.
 */

const FWD = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(0, 0, 1);

export interface CarModifiers {
  /** Multipliers applied on top of config, for upgrades and round modifiers. */
  accel: number;
  maxSpeed: number
  boostForce: number;
  boostDrain: number;
  turnRate: number;
  jump: number;
  boostMax: number;
}

export function defaultModifiers(): CarModifiers {
  return { accel: 1, maxSpeed: 1, boostForce: 1, boostDrain: 1, turnRate: 1, jump: 1, boostMax: 1 };
}

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mods: CarModifiers = defaultModifiers();

  /** Inputs for the current step; replaced wholesale each frame. */
  input: CarInput = emptyInput();

  boost = cfg.boost.start;

  // Contact + jump state.
  grounded = false;
  /** Landed on a side or the roof, with no wheels to drive on. */
  beached = false;
  private groundNormal = new THREE.Vector3(0, 1, 0);
  private beachNormal = new THREE.Vector3(0, 1, 0);
  private airTime = 0;
  private jumpsUsed = 0;
  private jumpHoldRemaining = 0;
  private flipLock = 0;
  private wasJumpHeld = false;

  // Scratch objects, reused every step so the hot loop does not allocate.
  private readonly q = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly cornerVel = new THREE.Vector3();
  private readonly angvel = new THREE.Vector3();
  private readonly alignQ = new THREE.Quaternion();

  constructor(
    private readonly phys: PhysicsWorld,
    spawn: { x: number; y: number; z: number },
    spawnYaw = 0,
  ) {
    const he = cfg.car.halfExtents;
    this.body = phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation({ x: 0, y: Math.sin(spawnYaw / 2), z: 0, w: Math.cos(spawnYaw / 2) })
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCcdEnabled(true),
    );
    const br = Math.min(cfg.car.colliderRadius, he.y * 0.9);
    this.collider = phys.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(he.x - br, he.y - br, he.z - br, br)
        .setFriction(0.2)
        .setRestitution(0.1)
        .setMass(cfg.car.mass)
        .setCollisionGroups(groups(Group.CAR, Group.ARENA | Group.BALL))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
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
    return this.speed > cfg.car.maxSpeed * this.mods.maxSpeed * 0.95;
  }

  /** True while a second jump or flip is still available. */
  get canDoubleJump(): boolean {
    return this.jumpsUsed === 1 && this.airTime < cfg.car.doubleJumpWindow && this.flipLock <= 0;
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
    this.flipLock = 0;
    this.jumpHoldRemaining = 0;
    this.boost = cfg.boost.start;
  }

  /** One fixed physics step of car logic. Call before world.step(). */
  update(dt: number): void {
    const inp = this.input;

    // Rapier keeps forces added with addForce until they are reset, so clear them
    // every step and drive the car with per-step impulses instead.
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

    this.flipLock = Math.max(0, this.flipLock - dt);

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
   * Four suspension rays, one per corner, cast along the car's own -up axis so
   * wall and ceiling driving work the same way. Per-corner springs are what let
   * the car pitch and roll onto a slope instead of butting into it.
   */
  private probeGround(dt: number): void {
    const c = cfg.car;
    const he = c.halfExtents;
    const p = this.body.translation();
    const dir = this.tmp.copy(this.up).negate();
    const reach = c.rideHeight + c.groundRayLength;

    let contacts = 0;
    let nearest = Infinity;
    this.groundNormal.set(0, 0, 0);

    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? 1 : -1;
      const sz = i % 2 === 0 ? 1 : -1;
      // Corner position in world space.
      const corner = this.tmp2
        .set(p.x, p.y, p.z)
        .addScaledVector(this.fwd, sx * he.x * c.suspensionSpreadX)
        .addScaledVector(this.right, sz * he.z * c.suspensionSpreadZ);

      const hit = this.phys.ray(
        { x: corner.x, y: corner.y, z: corner.z },
        { x: dir.x, y: dir.y, z: dir.z },
        reach,
        this.body,
      );
      if (!hit) continue;

      contacts++;
      nearest = Math.min(nearest, hit.distance);
      this.groundNormal.x += hit.normal.x;
      this.groundNormal.y += hit.normal.y;
      this.groundNormal.z += hit.normal.z;

      // Spring and damper for this corner, applied at the corner so it produces
      // the pitch and roll the chassis should have.
      const compression = c.rideHeight - hit.distance;
      if (compression <= 0) continue;
      const cornerVel = this.cornerVelocity(corner, p);
      const normalVel = cornerVel.dot(this.up);
      const accel = compression * c.suspensionStiffness - normalVel * c.suspensionDamping;
      if (accel <= 0) continue;
      const j = accel * cfg.car.mass * dt;
      this.body.applyImpulseAtPoint(
        { x: this.up.x * j, y: this.up.y * j, z: this.up.z * j },
        { x: corner.x, y: corner.y, z: corner.z },
        true,
      );
    }

    if (contacts > 0) {
      this.groundNormal.normalize();
      if (this.groundNormal.lengthSq() < 1e-6) this.groundNormal.copy(this.up);
      this.groundDistance = nearest;
      // Two wheels down is enough to drive; one is a scrape, not traction.
      this.grounded = contacts >= 2 && nearest <= c.rideHeight + 0.4;
    } else {
      this.grounded = false;
      this.groundDistance = Infinity;
    }

    // Land on a side or the roof and the car's own down-rays miss the floor
    // entirely, so it would never recover. Catch that with a world-space ray.
    this.beached = false;
    if (!this.grounded) {
      const diag = Math.hypot(he.x, he.y, he.z);
      const rest = this.phys.ray(
        { x: p.x, y: p.y, z: p.z },
        { x: 0, y: -1, z: 0 },
        diag + 0.25,
        this.body,
      );
      if (rest && this.vel.lengthSq() < c.rightingSpeedLimit ** 2) {
        this.beached = true;
        this.beachNormal.set(rest.normal.x, rest.normal.y, rest.normal.z);
        if (this.beachNormal.lengthSq() < 1e-6) this.beachNormal.set(0, 1, 0);
      }
    }
  }

  /** Velocity of a world-space point on the chassis, including spin. */
  private cornerVelocity(corner: THREE.Vector3, centre: RAPIER.Vector): THREE.Vector3 {
    const r = this.tmp3.set(corner.x - centre.x, corner.y - centre.y, corner.z - centre.z);
    return this.cornerVel.copy(this.angvel).cross(r).add(this.vel);
  }

  /** Distance from the nearest corner to the surface. Handy while tuning. */
  groundDistance = Infinity;

  private driveOnGround(dt: number): void {
    const c = cfg.car;
    const m = this.mods;
    const inp = this.input;
    const n = this.groundNormal;

    // The corner impulses have already changed the velocity this step.
    const lv0 = this.body.linvel();
    this.vel.set(lv0.x, lv0.y, lv0.z);

    // The per-corner springs in probeGround() already hold the ride height.
    // Press into the surface so the car can carry speed up walls and round the
    // seam ramps without floating off.
    this.vel.addScaledVector(n, -c.stickForce * dt);

    // Forward direction projected onto the surface plane.
    const planeFwd = this.tmp.copy(this.fwd).addScaledVector(n, -this.fwd.dot(n)).normalize();
    const planeRight = this.tmp2.copy(this.right).addScaledVector(n, -this.right.dot(n)).normalize();

    const alongSpeed = this.vel.dot(planeFwd);
    const maxSpeed = (inp.boost && this.boost > 0 ? c.boostMaxSpeed : c.maxSpeed) * m.maxSpeed;

    // Throttle, brake and coast drag.
    if (inp.throttle !== 0) {
      const opposing = sign(inp.throttle) !== sign(alongSpeed) && Math.abs(alongSpeed) > 0.6;
      let accel: number;
      if (opposing) accel = c.brakeAccel;
      else if (inp.throttle > 0) accel = c.accel * m.accel;
      else accel = c.reverseAccel;
      const headroom = inp.throttle > 0 ? maxSpeed : c.maxSpeed * 0.45;
      if (Math.abs(alongSpeed) < headroom || opposing) {
        this.vel.addScaledVector(planeFwd, inp.throttle * accel * dt);
      }
    } else if (Math.abs(alongSpeed) > 0.05) {
      const drop = Math.min(Math.abs(alongSpeed), c.coastDrag * dt);
      this.vel.addScaledVector(planeFwd, -sign(alongSpeed) * drop);
    }

    // Lateral grip: scrub off sideways velocity.
    const lateral = this.vel.dot(planeRight);
    const grip = c.lateralGrip * (inp.drift ? c.driftGripMultiplier : 1);
    const scrub = Math.min(Math.abs(lateral), grip * dt * Math.max(1, Math.abs(lateral)));
    this.vel.addScaledVector(planeRight, -sign(lateral) * scrub);

    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);

    // Steering: directly drive yaw rate about the surface normal. Turn authority
    // tapers off with speed so flat out is committed rather than twitchy.
    const speedFrac = clamp(Math.abs(alongSpeed) / Math.max(1, c.maxSpeed), 0, 1);
    const turnScale = 1 - c.turnSpeedFalloff * speedFrac;
    const reversing = alongSpeed < -0.5;
    let yawRate =
      inp.steer *
      c.turnRate *
      m.turnRate *
      turnScale *
      (inp.drift ? c.driftTurnMultiplier : 1) *
      (reversing ? -1 : 1);
    // Standing still with no throttle should not let the car spin on the spot.
    if (Math.abs(alongSpeed) < 0.8 && inp.throttle === 0) yawRate *= 0.15;

    // Alignment: rotate the roof toward the surface normal.
    this.alignQ.setFromUnitVectors(this.up, n);
    const alignAngle = 2 * Math.acos(clamp(Math.abs(this.alignQ.w), -1, 1));
    const axisLen = Math.hypot(this.alignQ.x, this.alignQ.y, this.alignQ.z);
    const target = this.tmp.set(0, 0, 0).addScaledVector(n, yawRate);
    if (axisLen > 1e-5 && alignAngle > 1e-4) {
      target.x += (this.alignQ.x / axisLen) * alignAngle * c.surfaceAlignRate;
      target.y += (this.alignQ.y / axisLen) * alignAngle * c.surfaceAlignRate;
      target.z += (this.alignQ.z / axisLen) * alignAngle * c.surfaceAlignRate;
    }
    this.body.setAngvel({ x: target.x, y: target.y, z: target.z }, true);
  }

  private controlInAir(dt: number): void {
    const c = cfg.car;
    const inp = this.input;

    if (this.flipLock <= 0) {
      // Config torques are read as angular accelerations: direct, predictable,
      // and independent of the inertia tensor.
      this.angvel.addScaledVector(this.right, -inp.pitch * c.airPitchTorque * dt);
      this.angvel.addScaledVector(this.up, inp.steer * c.airYawTorque * dt);
      this.angvel.addScaledVector(this.fwd, inp.roll * c.airRollTorque * dt);

      // Bleed off rotation only on axes with no input, so held input stays crisp.
      const bleed = Math.pow(c.airAngularDamping, dt * 60);
      if (inp.pitch === 0 && inp.steer === 0 && inp.roll === 0) {
        this.angvel.multiplyScalar(bleed);
      }
    }

    const maxAng = c.maxAngularSpeed;
    if (this.angvel.length() > maxAng) this.angvel.setLength(maxAng);
    this.body.setAngvel({ x: this.angvel.x, y: this.angvel.y, z: this.angvel.z }, true);
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

    // Sustained first jump.
    if (this.jumpHoldRemaining > 0) {
      if (inp.jumpHeld) {
        this.jumpHoldRemaining -= dt;
        this.impulseAlong(this.up, c.jumpHoldForce * jumpScale * dt);
      } else {
        this.jumpHoldRemaining = 0;
      }
    }

    const pressed = inp.jumpPressed || (inp.jumpHeld && !this.wasJumpHeld);
    if (!pressed) return;

    if (this.grounded || this.jumpsUsed === 0) {
      this.impulseAlong(this.up, c.jumpImpulse * jumpScale);
      this.jumpsUsed = 1;
      this.jumpHoldRemaining = c.jumpHoldTime;
      this.grounded = false;
      this.airTime = 0.0001;
      return;
    }

    if (this.canDoubleJump) {
      const dirX = inp.throttle;
      const dirZ = inp.steer;
      if (Math.abs(dirX) > 0.25 || Math.abs(dirZ) > 0.25) {
        this.flip(dirX, dirZ);
      } else {
        this.impulseAlong(this.up, c.doubleJumpImpulse * jumpScale);
      }
      this.jumpsUsed = 2;
    }
  }

  /** Directional flip: a committed kick plus the spin that reads as the move. */
  private flip(dirX: number, dirZ: number): void {
    const c = cfg.car;
    const mag = Math.hypot(dirX, dirZ);
    const fx = dirX / mag;
    const fz = dirZ / mag;

    // Kick along the car's own horizontal plane.
    const kick = this.tmp.set(0, 0, 0).addScaledVector(this.fwd, fx).addScaledVector(this.right, fz);
    kick.addScaledVector(this.up, -this.up.dot(kick)).normalize();

    // Flatten vertical velocity so a front flip actually goes forward.
    const lv = this.body.linvel();
    this.vel.set(lv.x, lv.y, lv.z);
    this.vel.addScaledVector(this.up, -this.vel.dot(this.up) * 0.45);
    this.vel.addScaledVector(kick, c.flipImpulse);
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, true);

    // Spin about the axis perpendicular to the kick: pitch for forward/back,
    // roll for sideways.
    const axis = this.tmp2
      .set(0, 0, 0)
      .addScaledVector(this.right, fx)
      .addScaledVector(this.fwd, -fz)
      .normalize();
    this.body.setAngvel(
      {
        x: axis.x * c.flipTorque,
        y: axis.y * c.flipTorque,
        z: axis.z * c.flipTorque,
      },
      true,
    );
    this.flipLock = c.flipLockTime;
  }

  private applyBoost(dt: number): void {
    const inp = this.input;
    if (!inp.boost || this.boost <= 0) return;
    this.boost = Math.max(0, this.boost - cfg.boost.drainPerSec * this.mods.boostDrain * dt);
    this.impulseAlong(this.fwd, cfg.boost.force * this.mods.boostForce * dt);
  }

  /** Boosting raises the cap; otherwise hold the no-boost ceiling. */
  private clampSpeed(): void {
    const cap =
      (this.input.boost && this.boost > 0 ? cfg.car.boostMaxSpeed : cfg.car.maxSpeed) *
      this.mods.maxSpeed;
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    if (speed > cap) {
      const k = cap / speed;
      this.body.setLinvel({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);
    }
  }

  /** `magnitude` is a change in velocity (m/s), not a force. */
  private impulseAlong(dir: THREE.Vector3, magnitude: number): void {
    const j = magnitude * cfg.car.mass;
    this.body.applyImpulse({ x: dir.x * j, y: dir.y * j, z: dir.z * j }, true);
  }

  destroy(): void {
    this.phys.world.removeRigidBody(this.body);
  }
}
