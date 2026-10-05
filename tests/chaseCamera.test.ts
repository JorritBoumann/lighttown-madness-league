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
