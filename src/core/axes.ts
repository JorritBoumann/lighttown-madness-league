import * as THREE from 'three';

/**
 * The car's local axes, in one place.
 *
 * Right-handed, Y up. The nose is +x and the roof is +y, which makes the
 * driver's right `up x forward` = (0, 0, -1) and **not** +z. Anything that
 * re-derives this by hand gets it backwards half the time: a mirrored steering
 * sign turns a bot away from its target, and the same mistake turns a front
 * flip into a back flip. Import these instead.
 */
export const FORWARD = new THREE.Vector3(1, 0, 0);
export const UP = new THREE.Vector3(0, 1, 0);
export const RIGHT = new THREE.Vector3(0, 0, -1);

/** World up, for telling upright from upside down. */
export const WORLD_UP = new THREE.Vector3(0, 1, 0);
