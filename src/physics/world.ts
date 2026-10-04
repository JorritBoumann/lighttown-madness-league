import * as RAPIER from '@dimforge/rapier3d-compat';
import { cfg } from '../config';

let initialized = false;

export async function initPhysics(): Promise<void> {
  if (initialized) return;
  await RAPIER.init();
  initialized = true;
}

/** Collision group bits, so rays and queries can filter by what they hit. */
export const Group = {
  ARENA: 0x0001,
  CAR: 0x0002,
  BALL: 0x0004,
  GOAL_SENSOR: 0x0008,
} as const;

/** Packs rapier interaction groups: high 16 bits = membership, low 16 = filter. */
export function groups(member: number, collidesWith: number): number {
  return (member << 16) | collidesWith;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: cfg.physics.gravity, z: 0 });
    this.world.timestep = cfg.physics.fixedDt;
    this.events = new RAPIER.EventQueue(true);
  }

  step(): void {
    // Picked up live so gravity modifiers and tuning apply without a reload.
    this.world.timestep = cfg.physics.fixedDt;
    this.world.gravity = { x: 0, y: cfg.physics.gravity, z: 0 };
    this.world.step(this.events);
  }

  /** Nearest hit along a ray, excluding one body (usually the caster). */
  ray(
    origin: RAPIER.Vector,
    dir: RAPIER.Vector,
    maxToi: number,
    exclude?: RAPIER.RigidBody,
    filter = Group.ARENA,
  ): { distance: number; normal: RAPIER.Vector } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      groups(0xffff, filter),
      undefined,
      exclude,
    );
    if (!hit) return null;
    return { distance: hit.timeOfImpact, normal: hit.normal };
  }

  free(): void {
    this.world.free();
  }
}

export { RAPIER };
