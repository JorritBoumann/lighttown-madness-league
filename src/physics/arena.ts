import { RAPIER, type PhysicsWorld, Group, groups } from './world';
import { buildArenaLayout, type ArenaLayout } from '../core/arenaLayout';

export interface Arena {
  layout: ArenaLayout;
  colliders: RAPIER.Collider[];
}

/** Builds the static arena shell: floor, walls, corner ramps, goal boxes. */
export function createArena(phys: PhysicsWorld): Arena {
  const layout = buildArenaLayout();
  const colliders: RAPIER.Collider[] = [];

  for (const panel of layout.panels) {
    const body = phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(panel.pos.x, panel.pos.y, panel.pos.z)
        .setRotation(yawQuat(panel.yaw)),
    );
    const desc = RAPIER.ColliderDesc.cuboid(panel.half.x, panel.half.y, panel.half.z)
      .setFriction(0.5)
      .setRestitution(0.25)
      .setCollisionGroups(groups(Group.ARENA, Group.CAR | Group.BALL | Group.ARENA));
    colliders.push(phys.world.createCollider(desc, body));
  }

  return { layout, colliders };
}

export function yawQuat(yaw: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
