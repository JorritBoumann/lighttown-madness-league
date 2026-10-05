import * as THREE from 'three';
import { cfg } from '../config';
import { damp } from '../core/mathx';

/**
 * Chase camera, on Rocket League's own defaults: 110 degrees of field of view,
 * 270 behind, 110 up, tilted 4 degrees down.
 *
 * Yaw follows a blend of where the car points and where it is actually
 * travelling, which keeps the view stable through slides without feeling
 * detached. Ball cam swings round to frame car and ball together.
 */
export class ChaseCamera {
  ballCam = true;

  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(1, 0, 0);
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private fov = cfg.camera.fov;
  /** Decaying shake amplitude, in world units. */
  private shake = 0;
  /**
   * Which way is "up" for the camera, eased towards the surface the car is on.
   *
   * On the floor this is world up and nothing below behaves differently. On a
   * wall it leans out into the pitch, which is the whole fix: the camera used
   * to build its position from a world-horizontal offset and a world-up lift,
   * so driving up the +z wall put it at z 4450 with the wall at 4096 — behind
   * the wall, looking through it.
   *
   * Eased rather than snapped, because the normal changes in one step at a
   * seam and a camera that teleports round the car at that moment is worse
   * than the problem being fixed.
   */
  /**
   * How much follow distance the walls took last frame, 0 to 1.
   *
   * Read one frame late on purpose: the clamp happens after the look target is
   * chosen, and threading it the other way would mean clamping twice. The
   * camera damps over several frames anyway, so a frame's lag is invisible.
   */
  private cornered = 0;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly surfaceUp = new THREE.Vector3(0, 1, 0);
  private readonly flat = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly followPos = new THREE.Vector3();
  private readonly followLook = new THREE.Vector3();
  /** Last frame's flattened heading, for measuring how hard the car is turning. */
  private readonly lastHeading = new THREE.Vector3(1, 0, 0);
  /** Eased 0-to-1 measure of how hard the car is turning. */
  private turning = 0;
  /** Eased 0-to-1 measure of how far the car is driving away from the ball. */
  private driftingAway = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  toggleBallCam(): void {
    this.ballCam = !this.ballCam;
  }

  update(
    dt: number,
    carPos: { x: number; y: number; z: number },
    carVel: { x: number; y: number; z: number },
    carForward: THREE.Vector3,
    ballPos: { x: number; y: number; z: number },
    surface?: { grounded: boolean; normal: THREE.Vector3 },
  ): void {
    const c = cfg.camera;
    const speed = Math.hypot(carVel.x, carVel.y, carVel.z);
    const speedFrac = Math.min(1, speed / cfg.car.maxSpeed);
    const distance = c.distance + speedFrac * c.speedDistanceGain;

    // Lean the camera's up towards the surface under the car, and let it fall
    // back to world up in the air. Only part of the way: fully on the wall's
    // normal the horizon rolls ninety degrees and the arena stops being
    // readable, and the point is to see where you are going, not to be upside
    // down accurately.
    // Two different things, and conflating them was the bug. `up` is where the
    // camera stands off the surface, and it has to follow the surface *fully*:
    // part way there, a car on a vertical wall still gets most of its lift
    // from world up, which slides the camera along the wall instead of off it
    // and leaves it clamped against the glass looking the wrong way. The roll
    // of the horizon is a separate, partial blend below — that one wants to
    // stay nearer upright or the arena stops being readable.
    this.surfaceUp.set(0, 1, 0);
    if (surface?.grounded && surface.normal.lengthSq() > 0.1) {
      this.surfaceUp.copy(surface.normal).normalize();
    }
    this.up.lerp(this.surfaceUp, Math.min(1, c.surfaceEase * dt)).normalize();

    // How hard the car is turning, from how fast its heading is sweeping.
    //
    // Taken from the heading rather than the steering input because the camera
    // is not given the input, and because what matters is the car actually
    // changing direction — a wheel turned against a slide is not a turn.
    const nose = this.flatten(carForward);
    if (dt > 0) {
      const swept = Math.acos(Math.max(-1, Math.min(1, nose.dot(this.lastHeading)))) / dt;
      const want = Math.min(1, swept / c.turnReference);
      // Eases up quickly and falls away slowly, so the view does not snap back
      // the instant the wheel straightens mid-corner.
      const rate = want > this.turning ? c.turnAttack : c.turnRelease;
      this.turning += (want - this.turning) * Math.min(1, rate * dt);
    }
    this.lastHeading.copy(nose);

    // How far the car is driving away from the ball.
    //
    // Ball cam puts the camera on the line from the ball through the car, so
    // a car heading away from the ball is heading straight at the camera: you
    // see your own bonnet coming at you and steering reads mirrored. This is
    // the measure that lets the framing give way before that happens.
    //
    // Gated on speed as well as heading. A car sitting still facing the wrong
    // way is not hard to drive, and swinging the view round it would be a
    // worse camera than the one being fixed.
    this.tmp.set(ballPos.x - carPos.x, ballPos.y - carPos.y, ballPos.z - carPos.z);
    this.tmp.addScaledVector(this.up, -this.tmp.dot(this.up));
    let away = 0;
    if (this.tmp.lengthSq() > 1e-4) {
      const facing = nose.dot(this.tmp.normalize());
      const t = c.ballCamAwayThreshold;
      away =
        Math.min(1, Math.max(0, (-facing - t) / Math.max(1e-3, 1 - t))) *
        Math.min(1, speed / c.ballCamAwaySpeed);
    }
    if (dt > 0) {
      const rate = away > this.driftingAway ? c.turnAttack : c.turnRelease;
      this.driftingAway += (away - this.driftingAway) * Math.min(1, rate * dt);
    }

    // How far the surface has tilted away from the floor: 0 driving the pitch,
    // 1 on a wall or the ceiling. Ball cam has to give way as this rises.
    const wallness = Math.min(1, Math.max(0, 1 - this.up.y));

    if (this.ballCam) {
      // Ball cam sits on the line from the ball through the car, so the car is
      // always between the camera and the ball. On a wall that line runs into
      // the wall — there is no room behind the car — so as the surface tilts,
      // the framing gives way to the follow camera's: behind the car along
      // the way it is pointing, in the plane of the wall. On the floor this is
      // exactly the old behaviour.
      this.dir.set(carPos.x - ballPos.x, carPos.y - ballPos.y, carPos.z - ballPos.z);
      this.dir.addScaledVector(this.up, -this.dir.dot(this.up));
      if (this.dir.lengthSq() < 1e-4) this.dir.copy(this.flatten(carForward));
      this.dir.normalize();
      if (wallness > 0.01) {
        this.tmp.copy(this.flatten(carForward)).negate();
        this.dir.lerp(this.tmp, wallness).normalize();
      }

      this.desired
        .set(carPos.x, carPos.y, carPos.z)
        .addScaledVector(this.dir, distance)
        .addScaledVector(this.up, c.height);

      // How much the walls refuse. Measured on the position the camera *wants*
      // rather than on the one it ends up with: the lift below gives the
      // distance back, so measuring afterwards reports almost no cornering and
      // the look target never commits to the car — a feedback loop that hides
      // exactly what it is meant to detect.
      this.probe.copy(this.desired);
      this.pushInside(this.probe);
      this.cornered = Math.min(
        1,
        this.probe.distanceTo(this.desired) / Math.max(1, distance * c.corneredFull),
      );

      const k = c.ballCamStiffness;
      this.pos.set(
        damp(this.pos.x, this.desired.x, k, dt),
        damp(this.pos.y, Math.max(this.desired.y, 40), k, dt),
        damp(this.pos.z, this.desired.z, k, dt),
      );
      // Where to look. On the floor, a point most of the way to the ball. On a
      // wall that target sits out over the pitch, and aiming at it swings the
      // view off the wall until the car is behind the camera — so it gives way
      // to the follow camera's target, just ahead of the car along the wall.
      // The ball becomes context rather than the subject.
      // Pulled towards the car both on a wall and when cornered. Lifting the
      // camera to recover the distance the walls stole, without re-aiming,
      // just drops the car out of the bottom of the frame — which is what the
      // first attempt at this did.
      // How far towards the ball to look. It gives way to the same three
      // things the framing does: a wall, being cornered, and driving away.
      //
      // That last one is not optional. The lean below is a lerp between two
      // points, and the ball-biased point is three quarters of the way to a
      // ball that may be four thousand units behind the car — so an
      // eighty-five percent lean towards a target three hundred units ahead
      // still ends up looking backwards. Driving away from the ball, the ball
      // stops being the subject; it is the wall case again.
      const bias =
        c.ballBias *
        (1 - wallness) *
        (1 - this.cornered * c.corneredBiasDrop) *
        (1 - this.driftingAway * c.ballCamAway);
      this.tmp2.set(
        carPos.x + (ballPos.x - carPos.x) * bias,
        carPos.y + (ballPos.y - carPos.y) * bias,
        carPos.z + (ballPos.z - carPos.z) * bias,
      );
      if (wallness > 0.01) {
        // Ahead of the car in the plane of the wall, and lifted off it, which
        // is what puts the car in the lower middle of the frame rather than
        // behind the camera.
        this.tmp
          .set(carPos.x, carPos.y, carPos.z)
          .addScaledVector(this.dir, -c.lookAhead)
          .addScaledVector(this.up, c.wallLookLift);
        this.tmp2.lerp(this.tmp, wallness);
      }
      // Lean the whole framing towards the follow camera.
      //
      // Ball cam is locked to the line through the ball, so steering moves
      // nothing and you end up looking at the side of your own car with no
      // idea where the nose points — measured at 110 degrees off the nose
      // through a steady turn. Leaning helps only if the *look target* comes
      // with it: moving the camera behind the car while it still stares at the
      // ball makes the angle worse, not better, which is what a first attempt
      // at this did.
      // Only while actually turning. Held at a fixed lean the camera trades
      // away the ball for a heading you did not ask about; driving straight,
      // ball cam framing is the right framing and this is zero.
      // Whichever asks for more: a hard turn, or driving away from the ball.
      // They are the same fix — put the nose back down the screen — so taking
      // the larger rather than adding them keeps a turn made while already
      // driving away from overshooting into a full follow cam and back.
      const follow = Math.max(
        c.ballCamFollow * this.turning,
        c.ballCamAway * this.driftingAway,
      );
      if (follow > 0.001) {
        const heading = this.flatten(carForward);
        this.followPos
          .set(carPos.x, carPos.y, carPos.z)
          .addScaledVector(heading, -distance)
          .addScaledVector(this.up, c.height);
        const drop = Math.tan((-c.angle * Math.PI) / 180) * (distance + c.lookAhead);
        this.followLook
          .set(carPos.x, carPos.y, carPos.z)
          .addScaledVector(this.up, -drop)
          .addScaledVector(heading, c.lookAhead);
        this.desired.lerp(this.followPos, follow);
        this.tmp2.lerp(this.followLook, follow);
        // The position was damped above against the unblended target, so it is
        // re-damped here against the blended one. Both halves of the framing
        // have to move together or the camera looks somewhere its position
        // does not justify.
        this.pos.set(
          damp(this.pos.x, this.desired.x, k, dt),
          damp(this.pos.y, Math.max(this.desired.y, 40), k, dt),
          damp(this.pos.z, this.desired.z, k, dt),
        );
      }


      this.look.set(
        damp(this.look.x, this.tmp2.x, k, dt),
        damp(this.look.y, this.tmp2.y, k, dt),
        damp(this.look.z, this.tmp2.z, k, dt),
      );
    } else {
      // Blend car heading with travel direction.
      const heading = this.dir.copy(carForward);
      heading.addScaledVector(this.up, -heading.dot(this.up));
      if (heading.lengthSq() < 1e-6) heading.set(1, 0, 0);
      heading.normalize();
      const travel = this.tmp.set(carVel.x, carVel.y, carVel.z);
      travel.addScaledVector(this.up, -travel.dot(this.up));
      if (travel.lengthSq() > 10000) {
        travel.normalize();
        // Reversing should not whip the camera round to the front.
        if (travel.dot(heading) > 0) heading.lerp(travel, c.velocityBias).normalize();
      }

      this.desired
        .set(carPos.x, carPos.y, carPos.z)
        .addScaledVector(heading, -distance)
        .addScaledVector(this.up, c.height);

      const k = c.stiffness;
      this.pos.set(
        damp(this.pos.x, this.desired.x, k, dt),
        damp(this.pos.y, Math.max(this.desired.y, 40), k, dt),
        damp(this.pos.z, this.desired.z, k, dt),
      );

      // Look ahead of the car, and apply the downward tilt by dropping the
      // target rather than rotating the camera.
      const drop = Math.tan((-c.angle * Math.PI) / 180) * (distance + c.lookAhead);
      const target = this.tmp
        .set(carPos.x, carPos.y, carPos.z)
        .addScaledVector(this.up, -drop)
        .addScaledVector(heading, c.lookAhead);
      this.look.set(
        damp(this.look.x, target.x, k, dt),
        damp(this.look.y, target.y, k, dt),
        damp(this.look.z, target.z, k, dt),
      );
    }

    this.keepInside(this.pos, carPos, distance);
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      // Applied to the camera rather than the stored position, so the shake
      // decays on its own instead of fighting the follow.
      this.camera.position.x += (Math.random() * 2 - 1) * this.shake;
      this.camera.position.y += (Math.random() * 2 - 1) * this.shake;
      this.camera.position.z += (Math.random() * 2 - 1) * this.shake;
      this.shake = Math.max(0, this.shake - this.shake * 6 * dt - 2 * dt);
    }
    // The horizon rolls only part of the way onto the surface. Fully rolled,
    // driving the wall turns the world ninety degrees and nothing is readable.
    this.camera.up.set(0, 1, 0).lerp(this.up, c.surfaceRoll).normalize();
    this.camera.lookAt(this.look);

    // Nudge field of view with speed, for a sense of acceleration.
    const targetFov = c.fov + speedFrac * c.speedFovGain;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** A direction flattened against the camera's current up. */
  private flatten(v: THREE.Vector3): THREE.Vector3 {
    this.flat.copy(v).addScaledVector(this.up, -v.dot(this.up));
    if (this.flat.lengthSq() < 1e-6) this.flat.set(1, 0, 0);
    return this.flat.normalize();
  }

  /**
   * Keeps the camera inside the arena.
   *
   * The backstop behind the surface-relative framing above. Easing the up
   * vector means the camera is briefly still working off the old surface
   * during a transition, and a seam or a corner can still push it through a
   * wall for a frame or two — which is exactly long enough to see the outside
   * of the building. The corner cut is included, or the camera slips out
   * through the diagonals, which are the one place a round offset does not
   * protect.
   */
  private keepInside(
    pos: THREE.Vector3,
    carPos: { x: number; y: number; z: number },
    wanted: number,
  ): void {
    const c = cfg.camera;
    // Kept inside the building.
    //
    // Letting it sit outside instead was tried and is worse: the seating bowl
    // starts 130 units beyond the boards, so a camera with enough room to keep
    // its follow distance is inside the stands, looking at the back of a
    // concrete tier.
    this.pushInside(pos);

    // Trade the stolen distance for height.
    //
    // Keeping the camera inside the building is not enough on its own: pinned
    // against a wall it ends up on top of the car — measured at 114 units away
    // where open play gives 292 — and you lose any sense of where you are.
    // Whatever the walls take off the follow distance is added as lift
    // instead, so being cornered raises the view rather than shrinking it.
    const shortfall =
      wanted - Math.hypot(pos.x - carPos.x, pos.y - carPos.y, pos.z - carPos.z);
    if (shortfall > 1) {
      pos.addScaledVector(this.up, shortfall * c.cornerLift);
      this.pushInside(pos);
    }
  }

  /** Pushes a point back inside the playable box, cut corners included. */
  private pushInside(pos: THREE.Vector3): void {
    const a = cfg.arena;
    const c = cfg.camera;
    const m = c.wallMargin;
    pos.x = Math.min(a.halfLength - m, Math.max(-a.halfLength + m, pos.x));
    pos.z = Math.min(a.halfWidth - m, Math.max(-a.halfWidth + m, pos.z));
    pos.y = Math.min(a.ceiling - m, Math.max(c.floorMargin, pos.y));

    const corner = a.cornerPlane - m * 1.4;
    const reach = Math.abs(pos.x) + Math.abs(pos.z);
    if (reach > corner) {
      const scale = corner / reach;
      pos.x *= scale;
      pos.z *= scale;
    }
  }

  /** Kicks the camera. `strength` is in world units before the config scale. */
  kick(strength: number): void {
    this.shake = Math.min(90, this.shake + strength * cfg.camera.shake);
  }

  snapTo(carPos: { x: number; y: number; z: number }, forward: THREE.Vector3): void {
    this.pos
      .set(carPos.x, carPos.y + cfg.camera.height, carPos.z)
      .addScaledVector(this.tmp.set(forward.x, 0, forward.z).normalize(), -cfg.camera.distance);
    this.look.set(carPos.x, carPos.y, carPos.z);
    this.shake = 0;
  }
}
