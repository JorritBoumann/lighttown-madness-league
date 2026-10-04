import type { CurvePoints } from './core/curve';

/**
 * Single tuning surface for the whole game.
 *
 * UNITS: Unreal Units, as Rocket League itself uses. 1 uu = 1 cm, so the pitch
 * is 10240 x 8192 uu and the ball is 91.25 uu across the radius. Every number
 * below is in uu, uu/s or uu/s^2 unless it says otherwise. Working at this scale
 * means the published Rocket League handling figures drop straight in, which is
 * the whole reason the car feels like a car rather than a shopping trolley.
 *
 * Everything here is live-editable: save this file and Vite hot-replaces the
 * values in place without reloading. The debug panel (press `P`) writes into the
 * same object, so panel edits and file edits are interchangeable.
 */

export const config = {
  physics: {
    /** Rocket League's gravity. Much weaker than Earth's 981, which is what
     *  gives the game its floaty, committed-aerial feel. */
    gravity: -650,
    fixedDt: 1 / 120,
    maxStepsPerFrame: 8,
    /** Units per metre, for the physics engine's internal tolerances. */
    lengthUnit: 100,
  },

  car: {
    /** Octane hitbox: length (nose to tail), height, width. */
    hitbox: { length: 120.507, height: 38.6591, width: 86.6994 },
    mass: 180,
    /** Rounds the chassis collider so it slides along walls and up ramps
     *  instead of catching on a corner. */
    colliderRadius: 8,

    // --- Driving ---
    /** Throttle acceleration against forward speed. Falls to nothing at 1410,
     *  which is why you need boost to go faster than that. */
    throttleCurve: [
      [0, 1600],
      [1400, 160],
      [1410, 0],
    ] as CurvePoints,
    /** Braking, and the same figure drives reverse. */
    brakeAccel: 3500,
    /** Deceleration when you let go of the throttle entirely. */
    coastDecel: 525,
    /** Fastest the throttle alone will take you. */
    maxDriveSpeed: 1410,
    /** Hard ceiling on car speed, boost included. */
    maxSpeed: 2300,
    /** Above this you are supersonic. */
    supersonicSpeed: 2200,

    // --- Steering ---
    /** Front wheel angle (radians) against forward speed. Combined with the
     *  wheelbase below this reproduces Rocket League's turn radius at speed:
     *  wide and committed when fast, tight when slow. */
    steerCurve: [
      [0, 0.53356],
      [500, 0.3193],
      [1000, 0.18203],
      [1500, 0.1057],
      [1750, 0.08507],
      [3000, 0.03454],
    ] as CurvePoints,
    /** Effective wheelbase for the steering model. Yaw rate = speed * tan(angle) / wheelbase. */
    steerWheelbase: 77.3,
    /** Front wheel angle while powersliding. */
    powerslideSteerCurve: [
      [0, 0.39235],
      [2500, 0.1261],
    ] as CurvePoints,
    /** Fraction of sideways velocity scrubbed off per step's worth of grip.
     *  This is the knob for how much the car slides. */
    lateralGrip: 0.0875,
    /** Lateral grip while the handbrake is down. Well below the gripping figure,
     *  so the car actually slides and keeps its heading through the turn. */
    handbrakeGrip: 0.02,
    /** Yaw you keep while powersliding, as a multiplier. */
    powerslideSteerGain: 1.0,

    // --- Ground contact ---
    /** Wheel positions in car-local space: x forward, z sideways. */
    frontWheel: { x: 51.25, z: 25.9, radius: 12.5 },
    rearWheel: { x: -33.75, z: 29.5, radius: 15 },
    /** How far the hitbox floats above the surface at rest. */
    rideHeight: 17,
    /** How much further a wheel ray looks before it counts as off the ground. */
    suspensionTravel: 30,
    suspensionStiffness: 36,
    suspensionDamping: 4.5,
    /** Presses the car into whatever surface it is on, so it holds walls. */
    stickForce: 325,
    surfaceAlignRate: 9,

    // --- Jumps, flips and dodges ---
    /** Instant kick on pressing jump. */
    jumpImpulse: 291.667,
    /** Held-jump acceleration, for the 0.2s after the press. */
    jumpAccel: 1458.333,
    jumpHoldTime: 0.2,
    /** Ground detection is suppressed for this long after a jump. Without it the
     *  wheels stay in suspension range for several steps, which both inflates
     *  the jump and keeps resetting the jump count. */
    jumpGroundLockout: 0.09,
    /** Second jump stays available for this long after leaving the ground. */
    doubleJumpWindow: 1.25,
    doubleJumpImpulse: 291.667,
    /** Directional dodge: the kick, plus the spin that sells it. */
    dodgeImpulse: 500,
    dodgeTorque: 5.5,
    /** How long a dodge locks out air control. */
    dodgeLockTime: 0.2,
    /** Deadzone before a second jump counts as a directional dodge. */
    dodgeDeadzone: 0.25,

    // --- Air control ---
    /** Angular accelerations, radians/s^2. Roll is far stronger than the other
     *  two, which is why air roll is the backbone of air control. */
    airPitchAccel: 12.46,
    airYawAccel: 9.11,
    airRollAccel: 38.34,
    /** Per-axis bleed-off, applied only on axes with no input. */
    airPitchDamping: 2.798,
    airYawDamping: 0.346,
    airRollDamping: 4.47,
    maxAngularSpeed: 5.5,

    // --- Self-righting ---
    /** Below this speed, a car resting on its side or roof rolls itself back
     *  upright instead of being stuck there. */
    rightingSpeedLimit: 200,
    /** How far from upright counts as beached: the roof has to be pointing well
     *  away from the surface, or a car flying low over the floor qualifies. */
    rightingUprightLimit: 0.65,
    rightingRate: 7,
    rightingLift: 400,
  },

  boost: {
    max: 100,
    /** Boost you start a match with. */
    start: 33.3,
    /** Boost units burned per second. */
    drainPerSec: 33.3,
    /** Thrust acceleration while boosting. */
    accel: 991.667,
    smallPadAmount: 12,
    bigPadAmount: 100,
    smallPadRespawn: 4,
    bigPadRespawn: 10,
    /** Pickup cylinder around a pad. */
    padRadius: 165,
    padHeight: 165,
  },

  ball: {
    radius: 91.25,
    mass: 30,
    /** Bounciness against the arena. */
    restitution: 0.6,
    friction: 0.35,
    /** Air drag, as a fraction of velocity shed per second. */
    drag: 0.03,
    angularDamping: 0.0,
    maxSpeed: 6000,
    maxAngularSpeed: 6,
    /** Car-on-ball restitution against closing speed: softer at pace, so a fast
     *  touch drives through the ball rather than pinging off it. */
    carRestitutionCurve: [
      [0, 0.65],
      [500, 0.65],
      [2300, 0.55],
      [4600, 0.3],
    ] as CurvePoints,
  },

  arena: {
    /** Half-extents of the playing surface. Full pitch is 10240 x 8192. */
    halfLength: 5120,
    halfWidth: 4096,
    ceiling: 2044,
    /** The four corners are cut by the plane |x| + |z| = this, exactly as the
     *  real arena is. Takes 1152 off each axis, so the corners read as long
     *  diagonal walls rather than small bevels. */
    cornerPlane: 8064,
    /** Radius of the curved transition from floor to wall, approximated with a
     *  45-degree ramp. */
    wallChamfer: 256,
    goalWidth: 1786,
    goalHeight: 642.775,
    goalDepth: 880,
    /** How far past the goal line the ball's centre must go to count. */
    goalLine: 5124.25,
    hasCeiling: true,
  },

  camera: {
    /** Rocket League's own camera defaults. */
    fov: 110,
    distance: 270,
    height: 110,
    /** Downward tilt in degrees. */
    angle: -4,
    stiffness: 9,
    /** How much camera yaw follows travel direction rather than car heading. */
    velocityBias: 0.55,
    lookAhead: 300,
    ballCamStiffness: 7,
    /** Extra distance pulled back at top speed, for a sense of pace. */
    speedDistanceGain: 60,
    speedFovGain: 8,
  },
};

export type Config = typeof config;

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
