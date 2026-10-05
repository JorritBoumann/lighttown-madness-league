import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cfg } from '../src/config';
import { ChaseCamera } from '../src/render/chaseCamera';

/**
 * The chase camera on walls and the ceiling.
 *
 * The camera used to build its position from a world-horizontal offset and a
 * world-up lift, which is fine on the floor and puts it straight through the
 * wall the moment you drive up one: on the +z wall the car sits at z 4044 and
 * the camera asked for 4450, with the wall at 4096. You ended up watching the
 * game through the outside of the building.
 */

const FLOOR = new THREE.Vector3(0, 1, 0);
const SIDE_WALL = new THREE.Vector3(0, 0, -1); // the +z wall, pointing inward
const CEILING = new THREE.Vector3(0, -1, 0);

function run(opts: {
  car: { x: number; y: number; z: number };
  normal: THREE.Vector3;
  ball?: { x: number; y: number; z: number };
  forward?: THREE.Vector3;
  ballCam?: boolean;
  seconds?: number;
}): { camera: THREE.PerspectiveCamera; chase: ChaseCamera; outside: number } {
  const camera = new THREE.PerspectiveCamera(110, 1.6, 10, 40000);
  const chase = new ChaseCamera(camera);
  if (opts.ballCam === false) chase.toggleBallCam();
  const forward = opts.forward ?? new THREE.Vector3(1, 0, 0);
  const ball = opts.ball ?? { x: 0, y: 95, z: 0 };
  chase.snapTo(opts.car, forward);

  let outside = 0;
  const dt = 1 / 60;
  for (let t = 0; t < (opts.seconds ?? 3); t += dt) {
    chase.update(dt, opts.car, { x: 0, y: 0, z: 0 }, forward, ball, {
      grounded: true,
      normal: opts.normal,
    });
    if (escaped(camera.position)) outside++;
  }
  return { camera, chase, outside };
}

/** Outside the playable box, by any face or through a cut corner. */
function escaped(p: THREE.Vector3): boolean {
  const a = cfg.arena;
  return (
    Math.abs(p.x) > a.halfLength ||
    Math.abs(p.z) > a.halfWidth ||
    p.y < 0 ||
    p.y > a.ceiling ||
    Math.abs(p.x) + Math.abs(p.z) > a.cornerPlane
  );
}

describe('chase camera inside the arena', () => {
  it('stays inside while the car drives a side wall', () => {
    const { outside } = run({ car: { x: 0, y: 600, z: 4040 }, normal: SIDE_WALL });
    expect(outside).toBe(0);
  });

  it('stays inside on the ceiling', () => {
    const { outside } = run({ car: { x: 0, y: cfg.arena.ceiling - 40, z: 0 }, normal: CEILING });
    expect(outside).toBe(0);
  });

  it('stays inside in a cut corner, where a box check would not save it', () => {
    // The diagonals are the one place staying within the x and z limits is
    // not enough: the corner is cut away behind them.
    const { outside } = run({
      car: { x: 4400, y: 300, z: 3400 },
      normal: new THREE.Vector3(-1, 0, -1).normalize(),
      ball: { x: -3000, y: 95, z: -2000 },
    });
    expect(outside).toBe(0);
  });

  it('stands off the wall rather than against it', () => {
    // Being inside is not enough on its own: pressed flat against the glass
    // the view is as useless as being behind it.
    const { camera } = run({ car: { x: 0, y: 600, z: 4040 }, normal: SIDE_WALL });
    expect(cfg.arena.halfWidth - camera.position.z).toBeGreaterThan(80);
  });

  it('keeps the car in shot on a wall', () => {
    const car = { x: 0, y: 600, z: 4040 };
    const { camera } = run({ car, normal: SIDE_WALL, ball: { x: 0, y: 95, z: 200 } });
    camera.updateMatrixWorld(true);
    const p = new THREE.Vector3(car.x, car.y, car.z).project(camera);
    // In front of the camera above all: the first attempt put the car behind
    // it, looking out over the pitch with the car off-screen entirely.
    expect(p.z).toBeLessThan(1);
    expect(Math.abs(p.x)).toBeLessThan(1);
  });

  it('keeps its distance when pinned against the boards', () => {
    // Being inside is not the whole job. Pinned against a wall the camera had
    // nowhere to go and sat 114 units from the car where open play gives 292,
    // which is the "no overview" complaint. Whatever the walls take off the
    // follow distance is given back as height instead.
    const car = { x: 0, y: 40, z: 3950 };
    const { camera } = run({ car, normal: FLOOR, ball: { x: 0, y: 95, z: -1500 } });
    const away = Math.hypot(
      camera.position.x - car.x,
      camera.position.y - car.y,
      camera.position.z - car.z,
    );
    expect(away).toBeGreaterThan(220);
    // And it buys that back by rising, not by pushing through the wall.
    expect(camera.position.y).toBeGreaterThan(200);
  });

  it('looks at the car once the walls have taken the distance', () => {
    // Raised above the car and slightly in front of it, the only view that
    // contains the car is one aimed at the car. A target still part way to the
    // ball points out over the pitch with the car behind the camera.
    const car = { x: 0, y: 40, z: 3950 };
    const { camera } = run({ car, normal: FLOOR, ball: { x: 0, y: 95, z: -1500 } });
    camera.updateMatrixWorld(true);
    const p = new THREE.Vector3(car.x, car.y, car.z).project(camera);
    expect(p.z).toBeLessThan(1);
    expect(Math.abs(p.x)).toBeLessThan(1);
    expect(Math.abs(p.y)).toBeLessThan(1);
  });

  it('leaves the floor exactly as it was', () => {
    // Everything above must cost nothing on the pitch, which is where the
    // camera spends almost all of its time.
    const car = { x: -1000, y: 40, z: 0 };
    const withSurface = run({ car, normal: FLOOR, ball: { x: 1500, y: 95, z: 300 } });
    const camera = new THREE.PerspectiveCamera(110, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const forward = new THREE.Vector3(1, 0, 0);
    chase.snapTo(car, forward);
    for (let t = 0; t < 3; t += 1 / 60) {
      // No surface passed at all: the old call signature.
      chase.update(1 / 60, car, { x: 0, y: 0, z: 0 }, forward, { x: 1500, y: 95, z: 300 });
    }
    expect(camera.position.x).toBeCloseTo(withSurface.camera.position.x, 3);
    expect(camera.position.y).toBeCloseTo(withSurface.camera.position.y, 3);
    expect(camera.position.z).toBeCloseTo(withSurface.camera.position.z, 3);
  });
});

/**
 * Ball cam while steering.
 *
 * Ball cam is locked to the line through the ball, so steering moves nothing
 * and a turn leaves you looking at the side of your own car with no idea where
 * the nose is pointing — measured at 113 degrees off the nose through a steady
 * turn, which is past sideways. It now leans towards the follow camera while
 * the car is actually turning, and lets go again when it straightens.
 */
describe('ball cam while turning', () => {
  /** A car driving a steady circle with the ball parked off to one side. */
  function circle(follow: number, radius = 700): { offNose: number; ballSeen: number } {
    const restore = cfg.camera.ballCamFollow;
    const restoreAway = cfg.camera.ballCamAway;
    cfg.camera.ballCamFollow = follow;
    // The away lean is held off here so this measures the turning lean on its
    // own. A car circling a ball spends part of every lap pointing away from
    // it, so leaving both on would mean neither number says what it claims.
    cfg.camera.ballCamAway = 0;
    const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const ball = { x: -1800, y: 95, z: 1800 };
    const at = (t: number) => {
      const a = t * 1.1;
      return {
        pos: { x: Math.cos(a) * radius, y: 40, z: Math.sin(a) * radius },
        nose: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).normalize(),
        vel: { x: -Math.sin(a) * 1200, y: 0, z: Math.cos(a) * 1200 },
      };
    };
    chase.snapTo(at(0).pos, at(0).nose);

    const angles: number[] = [];
    let seen = 0;
    let total = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      const s = at(t);
      chase.update(1 / 60, s.pos, s.vel, s.nose, ball, {
        grounded: true,
        normal: new THREE.Vector3(0, 1, 0),
      });
      if (t > 3) {
        camera.updateMatrixWorld(true);
        const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        view.y = 0;
        view.normalize();
        angles.push((Math.acos(Math.max(-1, Math.min(1, view.dot(s.nose)))) * 180) / Math.PI);
        const b = new THREE.Vector3(ball.x, ball.y, ball.z).project(camera);
        if (Math.abs(b.x) < 1 && Math.abs(b.y) < 1 && b.z < 1) seen++;
        total++;
      }
    }
    cfg.camera.ballCamFollow = restore;
    cfg.camera.ballCamAway = restoreAway;
    angles.sort((a, b) => a - b);
    return {
      offNose: Math.round(angles[Math.floor(angles.length / 2)]!),
      ballSeen: Math.round((seen / Math.max(1, total)) * 100),
    };
  }

  it('turns the view towards the nose while cornering', () => {
    const locked = circle(0).offNose;
    const leaning = circle(cfg.camera.ballCamFollow).offNose;
    // Locked ball cam measures 113 degrees off the nose here; the lean brings
    // it to about 81. The gap is the whole feature.
    expect(locked).toBeGreaterThan(100);
    expect(leaning).toBeLessThan(locked - 20);
  });

  it('does not give up the ball to do it', () => {
    // The trade is sharp: leaning further aligns the nose quickly but loses
    // the ball — at 0.9 it is gone for a third of a tight corner. The default
    // sits at the point where it is still always in frame.
    expect(circle(cfg.camera.ballCamFollow).ballSeen).toBe(100);
    expect(circle(cfg.camera.ballCamFollow, 2000).ballSeen).toBe(100);
  });

  it('leaves the view alone when driving straight', () => {
    // Driving straight, ball cam framing is the right framing: the lean is
    // gated on the heading actually sweeping, so it reads zero here.
    const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const nose = new THREE.Vector3(1, 0, 0);
    const ball = { x: 3000, y: 95, z: 1200 };
    let x = -2000;
    chase.snapTo({ x, y: 40, z: 0 }, nose);
    for (let t = 0; t < 4; t += 1 / 60) {
      x += 1200 / 60;
      chase.update(1 / 60, { x, y: 40, z: 0 }, { x: 1200, y: 0, z: 0 }, nose, ball, {
        grounded: true,
        normal: new THREE.Vector3(0, 1, 0),
      });
    }
    camera.updateMatrixWorld(true);
    const b = new THREE.Vector3(ball.x, ball.y, ball.z).project(camera);
    expect(Math.abs(b.x)).toBeLessThan(1);
    expect(Math.abs(b.y)).toBeLessThan(1);
  });
});

describe('ball cam when the car drives away from the ball', () => {
  /**
   * Ball cam's worst moment, and the one the camera used to hand you whole:
   * the camera sits on the line from the ball through the car, so a car
   * driving away from the ball is driving straight at the camera. You watch
   * your own bonnet come at you and the steering reads mirrored.
   *
   * Measured as the angle between where the camera looks and where the nose
   * points, flattened. Zero is behind the car; 180 is nose-on.
   */
  function driveAway(awayLean: number, speed = 1200): number {
    const restore = cfg.camera.ballCamAway;
    cfg.camera.ballCamAway = awayLean;
    const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const ball = { x: -2600, y: 95, z: 0 };
    const nose = new THREE.Vector3(1, 0, 0);
    let x = -1200;
    chase.snapTo({ x, y: 40, z: 0 }, nose);

    const angles: number[] = [];
    for (let t = 0; t < 4; t += 1 / 60) {
      x += speed / 60;
      chase.update(1 / 60, { x, y: 40, z: 0 }, { x: speed, y: 0, z: 0 }, nose, ball, {
        grounded: true,
        normal: new THREE.Vector3(0, 1, 0),
      });
      if (t > 2) {
        camera.updateMatrixWorld(true);
        const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        view.y = 0;
        view.normalize();
        angles.push((Math.acos(Math.max(-1, Math.min(1, view.dot(nose)))) * 180) / Math.PI);
      }
    }
    cfg.camera.ballCamAway = restore;
    angles.sort((a, b) => a - b);
    return Math.round(angles[Math.floor(angles.length / 2)]!);
  }

  it('puts the nose back down the screen', () => {
    // Locked ball cam looks straight back along the car: 180 degrees off the
    // nose, which is the mirrored-controls case. The lean brings it to single
    // figures.
    expect(driveAway(0)).toBeGreaterThan(170);
    expect(driveAway(cfg.camera.ballCamAway)).toBeLessThan(20);
  });

  it('leaves a parked car alone', () => {
    // A car sitting still facing away from the ball is not hard to drive, and
    // swinging the view round it would be a worse camera than the one being
    // fixed. The lean is gated on speed as well as heading.
    expect(driveAway(cfg.camera.ballCamAway, 0)).toBeGreaterThan(170);
  });

  it('hands the view back as the car turns towards the ball', () => {
    // Driving at the ball is ball cam's own case and the lean must be gone,
    // or it would have cost the framing it exists to protect.
    const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const ball = { x: 2600, y: 95, z: 0 };
    const nose = new THREE.Vector3(1, 0, 0);
    let x = -1200;
    chase.snapTo({ x, y: 40, z: 0 }, nose);
    // Stopped short of the ball on purpose: drive past it and the car is
    // heading away again, which is the other test.
    for (let t = 0; t < 2.5; t += 1 / 60) {
      x += 1200 / 60;
      chase.update(1 / 60, { x, y: 40, z: 0 }, { x: 1200, y: 0, z: 0 }, nose, ball, {
        grounded: true,
        normal: new THREE.Vector3(0, 1, 0),
      });
    }
    camera.updateMatrixWorld(true);
    const b = new THREE.Vector3(ball.x, ball.y, ball.z).project(camera);
    expect(Math.abs(b.x)).toBeLessThan(1);
    expect(Math.abs(b.y)).toBeLessThan(1);
  });
});

describe('what the away lean costs', () => {
  /**
   * The two leans measured together, which is how they actually run.
   *
   * The other tests hold one or the other at zero to say what each does on
   * its own; this one is here because the away lean buys its worst-case fix
   * with the ball, and that trade should be written down rather than hidden
   * behind an isolated measurement.
   */
  function lap(away: number): { worstOffNose: number; ballSeen: number } {
    const restore = cfg.camera.ballCamAway;
    cfg.camera.ballCamAway = away;
    const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const ball = { x: -1800, y: 95, z: 1800 };
    const at = (t: number) => {
      const a = t * 1.1;
      return {
        pos: { x: Math.cos(a) * 700, y: 40, z: Math.sin(a) * 700 },
        nose: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).normalize(),
        vel: { x: -Math.sin(a) * 1200, y: 0, z: Math.cos(a) * 1200 },
      };
    };
    chase.snapTo(at(0).pos, at(0).nose);
    let worst = 0;
    let seen = 0;
    let total = 0;
    for (let t = 0; t < 10; t += 1 / 60) {
      const s = at(t);
      chase.update(1 / 60, s.pos, s.vel, s.nose, ball, {
        grounded: true,
        normal: new THREE.Vector3(0, 1, 0),
      });
      if (t > 3) {
        camera.updateMatrixWorld(true);
        const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        view.y = 0;
        view.normalize();
        worst = Math.max(
          worst,
          (Math.acos(Math.max(-1, Math.min(1, view.dot(s.nose)))) * 180) / Math.PI,
        );
        const b = new THREE.Vector3(ball.x, ball.y, ball.z).project(camera);
        if (Math.abs(b.x) < 1 && Math.abs(b.y) < 1 && b.z < 1) seen++;
        total++;
      }
    }
    cfg.camera.ballCamAway = restore;
    return { worstOffNose: Math.round(worst), ballSeen: Math.round((seen / total) * 100) };
  }

  it('takes the nose-on moment out of a lap', () => {
    // Without it, a lap round the ball still contains a frame 179 degrees off
    // the nose: the car driving straight at the camera, controls mirrored.
    // That moment is the complaint, and it is gone.
    expect(lap(0).worstOffNose).toBeGreaterThan(170);
    expect(lap(cfg.camera.ballCamAway).worstOffNose).toBeLessThan(90);
  });

  it('pays for it with the ball, and only a full lean is worth paying', () => {
    // The ball is in frame for 59 percent of the lap instead of all of it —
    // the part where the car is driving away from it. That is the intended
    // trade, not a regression: driving away from the ball, where you are
    // going is the thing worth seeing.
    expect(lap(cfg.camera.ballCamAway).ballSeen).toBeGreaterThan(50);
    expect(lap(cfg.camera.ballCamAway).ballSeen).toBeLessThan(100);
    // Half measures buy nothing. At 0.5 the ball is in frame more often but
    // the nose-on moment is still there in full, so the choice is a full lean
    // or none.
    expect(lap(0.5).worstOffNose).toBeGreaterThan(170);
  });
});

describe('low on a wall', () => {
  /**
   * The view while climbing the first few hundred units of a wall.
   *
   * On a wall "behind the car" points down it, so the camera wanted a position
   * below the pitch, got clamped to the floor margin, and ended up standing on
   * the grass pointing almost straight up at a dark wall. The frame went
   * black — which is most of why driving up a wall felt like flying, since
   * there was nothing in shot to say otherwise.
   */
  function onWall(carY: number): {
    standoff: number;
    degreesFromVertical: number;
    carInFrame: boolean;
  } {
    const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1.6, 10, 40000);
    const chase = new ChaseCamera(camera);
    const car = { x: 0, y: carY, z: 4044 };
    // Climbing, so travelling up the wall with the nose up it too.
    const nose = new THREE.Vector3(0, 1, 0);
    chase.snapTo(car, new THREE.Vector3(1, 0, 0));
    for (let t = 0; t < 2; t += 1 / 60) {
      chase.update(1 / 60, car, { x: 0, y: 1200, z: 0 }, nose, { x: 0, y: 95, z: 0 }, {
        grounded: true,
        normal: SIDE_WALL,
      });
    }
    camera.updateMatrixWorld(true);
    const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const b = new THREE.Vector3(car.x, car.y, car.z).project(camera);
    return {
      standoff: Math.round(4096 - camera.position.z),
      degreesFromVertical:
        Math.round((Math.acos(Math.max(-1, Math.min(1, view.dot(FLOOR)))) * 180) / Math.PI),
      carInFrame: Math.abs(b.x) < 1 && Math.abs(b.y) < 1 && b.z < 1,
    };
  }

  it('never drops below the floor margin', () => {
    // The camera asks for a position below the pitch here, because on a wall
    // "behind the car" points down it. It trades what the floor takes for
    // standoff from the wall rather than being clamped flat onto the grass.
    for (const y of [120, 200, 345]) {
      expect(onWall(y).standoff).toBeGreaterThan(110);
    }
  });

  it('looks up the wall, not at the sky', () => {
    // Looking up the wall is correct — that is where the car is going. What was
    // wrong was what it found there: the +z wall and the whole ceiling measured
    // zero direct light, so a surface the car can drive on rendered black.
    // That is fixed in the lighting, not here; this only pins the framing.
    const low = onWall(345);
    expect(low.degreesFromVertical).toBeGreaterThan(5);
    expect(low.carInFrame).toBe(true);
  });

  it('keeps the car in shot all the way up', () => {
    for (const y of [200, 345, 700, 1200, 1800]) {
      expect(onWall(y).carInFrame).toBe(true);
    }
  });
});
