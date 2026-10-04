/**
 * Single tuning surface for the whole game.
 *
 * Everything in here is live-editable: save this file and Vite hot-replaces the
 * values in place without reloading the page (see the `import.meta.hot` block at
 * the bottom). The debug panel (press `P`) writes into the same object, so panel
 * edits and file edits are interchangeable.
 */

export const config: Config = {
  physics: {
    /** World gravity. Much heavier than real gravity so the car drops fast and
     *  aerials stay short and punchy. */
    gravity: -38,
    /** Physics runs on a fixed step; the renderer interpolates between steps. */
    fixedDt: 1 / 120,
    /** Max physics steps per frame, so a stalled tab can't spiral. */
    maxStepsPerFrame: 8,
  },

  car: {
    /** Box half-extents: x = half length (nose to tail), y = half height, z = half width. */
    halfExtents: { x: 1.25, y: 0.38, z: 0.62 },
    mass: 180,

    // --- Driving ---
    /** Forward acceleration force per unit mass while throttling on the ground. */
    accel: 62,
    /** Speed cap without boost. */
    maxSpeed: 36,
    /** Speed cap while boosting. */
    boostMaxSpeed: 52,
    reverseAccel: 40,
    /** Applied when throttle opposes current direction. */
    brakeAccel: 85,
    /** Slows the car when there is no throttle input. */
    coastDrag: 14,

    // --- Steering ---
    /** Peak yaw rate (rad/s) on the ground. */
    turnRate: 3.1,
    /** How much the turn rate shrinks at top speed. 0 = no falloff, 1 = can't turn flat out. */
    turnSpeedFalloff: 0.45,
    /** How hard sideways velocity is scrubbed off. Higher = more grip, less drift. */
    lateralGrip: 18,
    /** Grip multiplier while powerslide (handbrake) is held. */
    driftGripMultiplier: 0.18,
    /** Extra yaw authority while drifting. */
    driftTurnMultiplier: 1.45,

    // --- Ground contact ---
    /** Rounds the chassis collider's edges so it slides onto ramps and grazes
     *  walls instead of catching on a corner. Subtracted from the half-extents,
     *  so the overall size is unchanged. */
    colliderRadius: 0.22,
    /** How far each corner ray looks past ride height before giving up. */
    groundRayLength: 0.95,
    /** Suspension spring per corner, holding that corner at ride height. Four
     *  rays rather than one means the car pitches and rolls onto slopes. */
    /** Set so the chassis settles with its wheels on the floor and the body
     *  clear of it: four corners each push with `compression * stiffness`, so
     *  resting compression is (gravity + stickForce) / (4 * stiffness). */
    rideHeight: 0.82,
    suspensionStiffness: 95,
    suspensionDamping: 9,
    /** Where the corner rays sit, as a fraction of the chassis half-extents. */
    suspensionSpreadX: 0.85,
    suspensionSpreadZ: 0.95,
    /** Pushes the car into whatever surface it is on, so it can drive up walls. */
    stickForce: 26,
    /** How fast the chassis rotates to match the surface normal. */
    surfaceAlignRate: 9,

    // --- Jumps and flips ---
    jumpImpulse: 10.5,
    /** Upward acceleration (m/s^2) while jump is held, for a taller hop. */
    jumpHoldForce: 24,
    jumpHoldTime: 0.18,
    /** Second jump stays available for this long after leaving the ground. */
    doubleJumpWindow: 1.3,
    /** Flat second jump (no directional input). */
    doubleJumpImpulse: 9.0,
    /** Directional flip: linear kick plus the spin that sells it. */
    flipImpulse: 11.5,
    flipTorque: 22,
    /** Flips lock rotation control briefly so they read as a committed move. */
    flipLockTime: 0.22,

    // --- Air control ---
    airPitchTorque: 13,
    airYawTorque: 10,
    airRollTorque: 17,
    /** Angular velocity bleed-off in the air. 1 = no damping. */
    airAngularDamping: 0.965,
    maxAngularSpeed: 6.0,

    // --- Self-righting ---
    /** Below this speed, a car resting on its side or roof rolls itself back
     *  upright instead of being stuck there. */
    rightingSpeedLimit: 9,
    rightingRate: 7,
    /** Upward acceleration while righting, to lift clear of the surface. */
    rightingLift: 26,
  },

  boost: {
    max: 100,
    /** Boost the car starts a match with. */
    start: 34,
    drainPerSec: 34,
    /** Thrust as an acceleration (m/s^2). Works in the air and on the ground. */
    force: 95,
    smallPadAmount: 12,
    bigPadAmount: 100,
    smallPadRespawn: 4,
    bigPadRespawn: 10,
    padPickupRadius: 1.9,
  },

  ball: {
    radius: 1.35,
    mass: 32,
    /** Bounciness. 0 = dead, 1 = no energy lost. */
    restitution: 0.64,
    friction: 0.35,
    linearDamping: 0.26,
    angularDamping: 0.32,
    maxSpeed: 62,
    /** Extra pop added on car contact so hits feel decisive. */
    hitBoost: 1.12,
  },

  arena: {
    /** Playing surface length along x (goal to goal) and width along z. */
    length: 86,
    width: 60,
    wallHeight: 22,
    /** 45-degree corner panels, measured along each axis. */
    cornerCut: 13,
    /** Height of the 45-degree ramp where the floor meets each wall. Lets a fast
     *  car transition onto the wall instead of hitting a right angle. */
    wallChamfer: 3.5,
    ceiling: true,
    goalWidth: 15,
    goalHeight: 6,
    goalDepth: 4.5,
  },

  camera: {
    fov: 92,
    /** Chase distance behind the car. */
    distance: 11.5,
    height: 4.0,
    /** Look target is pushed this far ahead of the car. */
    lookAhead: 7,
    lookHeight: 1.2,
    /** How fast the camera catches up. Higher = tighter, more twitchy. */
    stiffness: 11,
    /** Camera yaw follows travel direction rather than car yaw by this much. */
    velocityBias: 0.55,
    /** Ball cam (toggle with T). */
    ballCamStiffness: 7,
    ballCamDistance: 12.5,
    ballCamHeight: 4.5,
    /** FOV stretch at top speed, for the sense of speed. */
    speedFovGain: 14,
  },
};

// --- Types + HMR plumbing -------------------------------------------------

export interface Config {
  physics: { gravity: number; fixedDt: number; maxStepsPerFrame: number };
  car: {
    halfExtents: { x: number; y: number; z: number };
    mass: number;
    accel: number;
    maxSpeed: number;
    boostMaxSpeed: number;
    reverseAccel: number;
    brakeAccel: number;
    coastDrag: number;
    turnRate: number;
    turnSpeedFalloff: number;
    lateralGrip: number;
    driftGripMultiplier: number;
    driftTurnMultiplier: number;
    colliderRadius: number;
    groundRayLength: number;
    rideHeight: number;
    suspensionStiffness: number;
    suspensionDamping: number;
    suspensionSpreadX: number;
    suspensionSpreadZ: number;
    stickForce: number;
    surfaceAlignRate: number;
    jumpImpulse: number;
    jumpHoldForce: number;
    jumpHoldTime: number;
    doubleJumpWindow: number;
    doubleJumpImpulse: number;
    flipImpulse: number;
    flipTorque: number;
    flipLockTime: number;
    airPitchTorque: number;
    airYawTorque: number;
    airRollTorque: number;
    airAngularDamping: number;
    maxAngularSpeed: number;
    rightingSpeedLimit: number;
    rightingRate: number;
    rightingLift: number;
  };
  boost: {
    max: number;
    start: number;
    drainPerSec: number;
    force: number;
    smallPadAmount: number;
    bigPadAmount: number;
    smallPadRespawn: number;
    bigPadRespawn: number;
    padPickupRadius: number;
  };
  ball: {
    radius: number;
    mass: number;
    restitution: number;
    friction: number;
    linearDamping: number;
    angularDamping: number;
    maxSpeed: number;
    hitBoost: number;
  };
  arena: {
    length: number;
    width: number;
    wallHeight: number;
    cornerCut: number;
    wallChamfer: number;
    ceiling: boolean;
    goalWidth: number;
    goalHeight: number;
    goalDepth: number;
  };
  camera: {
    fov: number;
    distance: number;
    height: number;
    lookAhead: number;
    lookHeight: number;
    stiffness: number;
    velocityBias: number;
    ballCamStiffness: number;
    ballCamDistance: number;
    ballCamHeight: number;
    speedFovGain: number;
  };
}

/** Alias kept short because nearly every module reads from it. */
export const cfg = config;

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (!mod) return;
    // Patch values into the existing object so every module keeps its reference.
    const next = (mod as unknown as { config: Record<string, Record<string, unknown>> }).config;
    const live = cfg as unknown as Record<string, Record<string, unknown>>;
    for (const group of Object.keys(next)) {
      if (!live[group]) continue;
      Object.assign(live[group], next[group]);
    }
    window.dispatchEvent(new CustomEvent('config:hot'));
  });
}
