import { RAPIER, type PhysicsWorld, Group, groups } from './world';
import { cfg } from '../config';
import { len3, scale3 } from '../core/mathx';

/**
 * The ball. Rocket League's is heavy for its size (30 against the car's 180),
 * bounces at 0.6, and sheds a steady 3% of its speed per second to drag rather
 * than using a damping curve.
 */
export class Ball {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  constructor(private readonly phys: PhysicsWorld) {
    this.body = phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, cfg.ball.radius + 300, 0)
        .setLinearDamping(cfg.ball.drag)
        .setAngularDamping(cfg.ball.angularDamping)
        .setCcdEnabled(true),
    );
    this.collider = phys.world.createCollider(
      RAPIER.ColliderDesc.ball(cfg.ball.radius)
        .setRestitution(cfg.ball.restitution)
        .setFriction(cfg.ball.friction)
        .setMass(cfg.ball.mass)
        .setCollisionGroups(groups(Group.BALL, Group.ARENA | Group.CAR))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
  }

  /** Re-reads tunables that live on the body rather than being applied per step. */
  syncConfig(): void {
    this.collider.setRestitution(cfg.ball.restitution);
    this.collider.setFriction(cfg.ball.friction);
    this.body.setLinearDamping(cfg.ball.drag);
    this.body.setAngularDamping(cfg.ball.angularDamping);
    if (Math.abs(this.collider.radius() - cfg.ball.radius) > 1e-4) {
      this.collider.setRadius(cfg.ball.radius);
    }
  }

  update(): void {
    const v = this.body.linvel();
    const speed = len3(v);
    if (speed > cfg.ball.maxSpeed) {
      this.body.setLinvel(scale3({ x: v.x, y: v.y, z: v.z }, cfg.ball.maxSpeed / speed), true);
    }
    const a = this.body.angvel();
    const spin = len3(a);
    if (spin > cfg.ball.maxAngularSpeed) {
      this.body.setAngvel(scale3({ x: a.x, y: a.y, z: a.z }, cfg.ball.maxAngularSpeed / spin), true);
    }
  }

  /** Kickoff position: dead centre, on the ground. */
  reset(pos = { x: 0, y: cfg.ball.radius, z: 0 }): void {
    this.body.setTranslation(pos, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
  }

  get position(): RAPIER.Vector {
    return this.body.translation();
  }

  get velocity(): RAPIER.Vector {
    return this.body.linvel();
  }

  destroy(): void {
    this.phys.world.removeRigidBody(this.body);
  }
}
