import * as THREE from 'three';

/**
 * Smooths a mesh onto a rigid body. Physics runs at a fixed step, the screen
 * does not, so without this everything judders at non-matching refresh rates.
 */
export class TransformInterpolator {
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();

  constructor(private readonly mesh: THREE.Object3D) {}

  /** Call once per fixed step, before the physics step overwrites the state. */
  record(pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.currPos.set(pos.x, pos.y, pos.z);
    this.currRot.set(rot.x, rot.y, rot.z, rot.w);
  }

  apply(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
  }

  snap(pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }): void {
    this.currPos.set(pos.x, pos.y, pos.z);
    this.currRot.set(rot.x, rot.y, rot.z, rot.w);
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.apply(1);
  }
}
