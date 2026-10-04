import { RAPIER, type PhysicsWorld, Group, groups } from './world';
import { buildArenaLayout, type ArenaLayout, type Panel } from '../core/arenaLayout';

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
        .setRotation(panelQuat(panel)),
    );
    const desc = RAPIER.ColliderDesc.cuboid(panel.half.x, panel.half.y, panel.half.z)
      .setFriction(0.5)
      .setRestitution(0.25)
      .setCollisionGroups(groups(Group.ARENA, Group.CAR | Group.BALL | Group.ARENA));
    colliders.push(phys.world.createCollider(desc, body));
  }

  return { layout, colliders };
}

/** Panel orientation: a yaw, or a tilt about x or z for the seam ramps. */
export function panelQuat(panel: Panel): RAPIER.Rotation {
  if (panel.pitch) {
    const h = panel.pitch / 2;
    return panel.axis === 'z'
      ? { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }
      : { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) };
  }
  return { x: 0, y: Math.sin(panel.yaw / 2), z: 0, w: Math.cos(panel.yaw / 2) };
}
