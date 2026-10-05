import * as THREE from 'three';

/**
 * The car's local axes, in one place.
 *
 * Right-handed, Y up. The nose is +x and the roof is +y, so the driver's right
 * is `forward x up` = (1,0,0) x (0,1,0) = **(0, 0, 1)**.
 *
 * This file used to say `up x forward` and define RIGHT as (0, 0, -1), which is
 * the driver's *left*. It is the same mistake the paragraph warned about, and
 * it cost a playable game: pressing right steered left. The reason it survived
 * is that it was wrong in pairs — the bot measured its target against a
 * mirrored right and fed the result to a mirrored steering sign, so the bots
 * drove correctly and only a human could feel it.
 *
 * The check, if this is ever in doubt again, is a projection rather than a
 * cross product: put a camera behind a car facing +x and project a point at
 * +z. It lands on the right of the screen.
 */
export const FORWARD = new THREE.Vector3(1, 0, 0);
export const UP = new THREE.Vector3(0, 1, 0);
export const RIGHT = new THREE.Vector3(0, 0, 1);

/** World up, for telling upright from upside down. */
export const WORLD_UP = new THREE.Vector3(0, 1, 0);
