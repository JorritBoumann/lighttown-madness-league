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

  ai: {
    /** How hard the bot turns toward its target. Higher is twitchier. */
    steerGain: 2.6,
    /** Beyond this angle off target the bot powerslides through the turn. */
    powerslideAngle: 1.15,
    /** Beyond this angle it backs off the throttle rather than driving wide. */
    easeOffAngle: 1.9,
    /** Badly misaligned and faster than this, the bot brakes instead of easing
     *  off: scrubbing speed tightens the turn far more than coasting does,
     *  because steering authority climbs as speed falls. */
    brakeToTurnSpeed: 600,
    /** Within this angle, and far enough out, it will boost. */
    boostAngle: 0.3,
    /**
     * Boost is held off until the target is this far away.
     *
     * Kept small on purpose. At 900 the bot stopped boosting for the whole
     * final approach and coasted into the ball, so its shots arrived with about
     * half the pace they could have and stopped short of the net.
     */
    boostMinDistance: 250,

    /** Ball this high and close gets a jump instead of a drive-through. */
    jumpBallHeight: 260,
    jumpRange: 420,

    // --- Aerials ---
    /** Ball has to be at least this high to be worth leaving the ground for. */
    aerialMinHeight: 420,
    /** And the interception has to be at least this far ahead. Climbing a
     *  thousand units under boost takes well over a second, so anything
     *  sooner is an aerial the car cannot physically finish. */
    aerialMinTime: 1.1,
    /** Boost needed in the tank before committing. An aerial that runs dry
     *  halfway up is worse than never starting. */
    aerialMinBoost: 28,
    /**
     * If the ball will be down at driving height within this long, and the car
     * can be there, drive instead.
     *
     * Being *able* to fly is not a reason to. With no check like this a bot
     * goes up for nearly every loose ball, and the chances it gives up on the
     * ground cost more than the ones it converts in the air.
     */
    aerialGroundedWindow: 1.6,
    /** Seconds of a run-up allowed before giving up on the attempt. */
    aerialMaxSetup: 2.2,
    /**
     * Slack on top of the drift distance when judging whether an interception
     * is within reach.
     *
     * The reach of an aerial is mostly the drift: whatever ground speed the car
     * launches with, it keeps for the whole climb. This is the margin on top,
     * for what the boost can add sideways and for the run-up still to come.
     */
    aerialMaxReach: 900,
    /** Orientation gains: proportional and damping, aiming and levelling. */
    aerialP: 2.6,
    aerialD: 0.45,
    aerialRollP: 2.2,
    aerialRollD: 0.38,
    /** Nose within this many radians of the target before boosting, so it does
     *  not thrust itself off course while still turning. */
    aerialBoostAngle: 0.5,
    /** Jump is released for this long between the first and second jump. A car
     *  needs it let go of before the second registers. */
    aerialJumpGap: 0.06,
    /**
     * How far above the target to aim while still climbing to it.
     *
     * Pointing straight at a ball that is high and ahead splits the thrust
     * between going up and going along, and the car arrives under the ball
     * having run out of air. Aiming high first and levelling off later is what
     * players do, and it is the difference between reaching 200 units and
     * reaching a thousand.
     */
    aerialClimbBias: 0.9,
    /** Below this much remaining climb it stops biasing and aims true. */
    aerialClimbUntil: 260,
    /**
     * Where to meet the ball in an aerial, as a multiple of its radius back
     * along the shot line.
     *
     * The same point the ground game learned the hard way: flying at the ball's
     * centre sends it wherever the approach happened to be pointing, which is
     * why aerial touches were going 43 degrees off the goal against 12 on the
     * ground. Meeting it on the far side from the goal is what makes the touch
     * a shot rather than a collision.
     */
    aerialContactRadii: 1.2,
    /**
     * How high in the goal an aerial aims, as a fraction of the mouth.
     *
     * Not the floor: a ball struck downward from height needs somewhere to go,
     * and the bottom of the net asks the touch to be perfect.
     */
    aerialGoalHeight: 0.45,
    /**
     * How long before contact a bot stops climbing and starts aiming the shot.
     *
     * Where an aerial touch sends the ball is decided by the car's *velocity*
     * at contact, not by where its nose points, and during a climb that
     * velocity is mostly straight up. Pointing the nose along the shot line for
     * the last stretch is what swings the velocity onto it, and is the
     * difference between meeting the ball and shooting.
     */
    aerialStrikeTime: 0.45,

    /**
     * How far ahead a defender looks for a shot heading into its own net.
     *
     * Longer than the attacking horizon: the whole value of a defensive aerial
     * is seeing the shot early enough to climb into its path, and a ball
     * crossing the line in a second is already past saving.
     */
    aerialSaveHorizon: 3.2,
    /**
     * How much of the boost in the tank a save may spend, against the strict
     * budget an attacking aerial gets.
     *
     * An attacking aerial that fails costs a chance; a save that is not
     * attempted costs the run. Worth emptying the tank for.
     */
    aerialSaveBudget: 1.5,
    /**
     * Lowest ball a defender will leave the ground for, as a fraction of the
     * attacking threshold.
     *
     * Lower, because the question is not "is this high" but "can I get to it
     * any other way": a shot at 300 units that the car cannot drive into in
     * time still has to be met in the air.
     */
    aerialSaveHeight: 0.6,
    /** Latest a save can be started and still get in the way. */
    aerialSaveMinTime: 0.75,
    /**
     * How far in front of the crossing a save aims to make contact.
     *
     * Interceptions are taken as late as possible, so this is the only thing
     * keeping the touch from happening on the goal line itself, where a miss
     * by a hair is a goal and a touch that is slightly late carries the ball
     * over with it.
     */
    aerialSaveMargin: 0.25,
    /**
     * Where a clearance is aimed, across the pitch and up.
     *
     * Not at the opposing net: a weak clear up the middle sits the ball back in
     * front of the net it just left. Aimed up-field, high, and toward the wall
     * the ball is already nearest, so the touch does not have to reverse its
     * sideways motion as well as its approach.
     */
    aerialClearWide: 0.55,
    aerialClearHeight: 0.38,
    /** Upward speed a full jump sequence is worth, for planning the launch. */
    aerialLaunchSpeed: 600,
    /** Overhead for rotating nose-up before the thrust starts paying. */
    aerialTurnTime: 0.28,
    /** Slack on the launch distance, as a fraction. */
    aerialLaunchTolerance: 0.18,
    /** Close enough and square enough to flip into the ball for power. */
    dodgeRange: 420,
    dodgeAngle: 0.45,
    dodgeMinSpeed: 900,
    /** How far in front of its own goal a defending bot sits. */
    defendStandoff: 1100,
    /** A keeper sits much closer to its line than an ordinary defender. */
    keeperStandoff: 450,
    /** A keeper leaves its net to clear only once the ball is this far into its
     *  own half, as a fraction of the half length. */
    keeperClearDepth: 0.35,
    /** Ball past this far into its own half makes a defender turn back. */
    defendTrigger: 0.25,
    /** Bots re-pick a boost pad no more often than this, to stop dithering. */
    padRepickInterval: 0.8,
    /** A bot asking for throttle but going slower than this is stuck on
     *  something: a wall, a corner, or the inside of a goal. */
    stuckSpeed: 120,
    /** How long it has to be stuck before it gives up and backs out. */
    stuckTime: 0.5,
    /** How long it reverses for once it decides it is stuck. */
    unstickTime: 0.8,
    /** After reversing out, it heads for open space for this long before going
     *  back to the ball. Reversing alone just lets it drive forward on the same
     *  heading and wedge on the same wall again, which is a loop it never
     *  leaves: a car at a standstill cannot steer, because yaw rate scales with
     *  speed. */
    clearOutTime: 1.3,
    /** Ball within this range outranks any boost detour. */
    collectBallGuard: 1800,
    /** How near the ball a bot has to be for its attack to count as live and
     *  so block a boost detour. Being nominally behind a ball on the far side
     *  of the pitch is not a play, it is a jog, and boost is worth more. */
    attackLiveRange: 3000,
    /** Extra boost needed to *stop* collecting, so the decision does not flap
     *  on and off as the meter crosses the threshold. */
    collectHysteresis: 25,
    /** How far behind the ball a bot lines up before committing to a shot. */
    approachStandoff: 700,
    /**
     * Where a committed bot aims, as a multiple of the ball's radius, measured
     * back along the shot line from the ball's centre: the contact point on the
     * near side.
     *
     * Aiming *past* the ball is the intuitive choice and it is wrong. The car
     * cuts the corner toward a point beyond the ball and clips its edge, and an
     * off-centre strike amplifies whatever approach error there was rather than
     * absorbing it. Measured over sixty chances, aiming past the ball put the
     * strike 106uu off the shot line against a radius of 91 and turned a 24
     * degree approach error into 41 degrees on the ball; aiming at the contact
     * point halved both and nearly doubled conversion.
     */
    contactOffsetRadii: 1.5,
    /**
     * How fast a bot means to hit the ball, used to work out which way to
     * strike it.
     *
     * Aiming straight at the goal ignores the ball's own motion, and a ball
     * drifting across at a few hundred uu/s carries the shot wide however
     * cleanly it is struck. Treating the touch as a change in the ball's
     * velocity rather than as a push in the goal's direction is what lets a bot
     * cancel that drift.
     */
    shotSpeed: 1400,
    /** Sideways offset on the approach, so a bot that has overrun loops *round*
     *  the ball to get behind it. Aiming straight at the point behind the ball
     *  means driving through the ball again, knocking it the wrong way, which
     *  turns into shepherding it sideways down the pitch for ever. */
    approachSwing: 750,
    /** How well lined up it has to be to commit: 1 is dead behind the ball,
     *  0 is square on to it. Lower means it shoots from worse angles. */
    commitAlignment: 0.6,
    /** It also has to be this much further from the target goal than the ball
     *  is. Direction alone is not enough: a bot level with the ball can point
     *  roughly goalward, tap the ball sideways, and then shepherd it along the
     *  pitch for ever without once getting behind it. */
    commitBehindMargin: 150,
    /** And its nose has to be pointing this close to the shot line, as a dot
     *  product. Where the ball goes is decided by which way the car is
     *  travelling at contact, so a car that is behind the ball but crossing it
     *  will strike it sideways however well placed it is. 0 disables the gate. */
    commitHeading: 0.6,
  },

  match: {
    /** Match length in seconds. Gauntlet rounds sit in the 60-90 band. */
    durationSeconds: 90,
    /** Reaching this many goals wins there and then. 0 means time only. */
    goalTarget: 3,
    /** Countdown before kickoff. */
    countdown: 3,
    /** How long the goal celebration holds before the next kickoff. */
    goalPause: 2.5,
    /** A draw at full time goes to sudden death: next goal wins. */
    suddenDeath: true,
  },

  input: {
    /** Stick movement below this is ignored, then the rest is rescaled. */
    padDeadzone: 0.14,
    /** Analog trigger pull that counts as a button press. */
    padTriggerThreshold: 0.3,
  },

  audio: {
    /** Overall volume. */
    master: 0.5,
    /** Boost thrust loop, relative to master. */
    boost: 0.18,
  },

  render: {
    /** Tone-mapping exposure. Higher is brighter before the filmic rolloff. */
    exposure: 1.02,
    /** How much the sky gradient lights the scene through reflections. */
    environmentIntensity: 0.22,
    /** Bloom: threshold is the brightness a pixel needs before it blooms. */
    bloomStrength: 0.62,
    bloomRadius: 0.62,
    bloomThreshold: 0.72,
  },

  camera: {
    /** The slow orbit behind the title and summary screens. */
    menuOrbitSpeed: 0.055,
    /** Inside the bowl, not outside it: the walls are solid, so a camera
     *  further out than the pitch just looks at the back of a hoarding. */
    menuOrbitRadius: 3500,
    menuOrbitHeight: 1700,
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
    /** How hard the camera shakes on a goal or a heavy touch. */
    shake: 1,
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
