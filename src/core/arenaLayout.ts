import { cfg } from '../config';

/**
 * Arena geometry derived from config, in one place so the colliders and the
 * meshes can never disagree about where a wall is.
 *
 * Rocket League's pitch is 10240 long by 8192 wide by 2044 tall, with the four
 * corners cut by the plane |x| + |z| = 8064. That cut takes 1152 off each axis,
 * which is why the corners read as long diagonal walls rather than small bevels.
 */

export interface Panel {
  /** Centre of the panel. */
  pos: { x: number; y: number; z: number };
  /** Half-extents before rotation. */
  half: { x: number; y: number; z: number };
  /** Rotation about the Y axis, radians. */
  yaw: number;
  /** Optional tilt, for the ramps along the floor-to-wall seam. */
  pitch?: number;
  /** Which axis `pitch` turns about. */
  axis?: 'x' | 'z';
  /** Tags the floor and ceiling so the renderer can style them differently. */
  kind?: 'floor' | 'ceiling' | 'wall' | 'ramp' | 'goal';
}

export interface Goal {
  /** Which end: +1 is the far end along +x. */
  sign: 1 | -1;
  /** x of the goal mouth. */
  x: number;
  width: number;
  height: number;
  depth: number;
}

export interface ArenaLayout {
  halfLength: number;
  halfWidth: number;
  ceiling: number;
  /** Where the corner diagonal meets each wall. */
  cornerCut: number;
  panels: Panel[];
  goals: Goal[];
}

/** Wall thickness. Only matters for the collider boxes. */
const THICK = 40;

export function buildArenaLayout(): ArenaLayout {
  const a = cfg.arena;
  const hl = a.halfLength;
  const hw = a.halfWidth;
  const ceil = a.ceiling;
  const gw = a.goalWidth;
  const gh = a.goalHeight;
  const gd = a.goalDepth;

  // The corner plane |x| + |z| = cornerPlane cuts this much off each axis.
  const wallEndX = a.cornerPlane - hw; // side walls stop here
  const wallEndZ = a.cornerPlane - hl; // back walls stop here
  const cutX = hl - wallEndX;

  const panels: Panel[] = [];

  // Floor, wide enough to cover the goal mouths too.
  panels.push({
    pos: { x: 0, y: -THICK, z: 0 },
    half: { x: hl + gd, y: THICK, z: hw },
    yaw: 0,
    kind: 'floor',
  });

  // Side walls, stopping where the corner diagonals start.
  for (const s of [1, -1]) {
    panels.push({
      pos: { x: 0, y: ceil / 2, z: s * (hw + THICK) },
      half: { x: wallEndX, y: ceil / 2, z: THICK },
      yaw: 0,
      kind: 'wall',
    });
  }

  // Corner diagonals, from (wallEndX, hw) to (hl, wallEndZ).
  for (const ex of [1, -1]) {
    for (const ez of [1, -1]) {
      const x0 = ex * wallEndX;
      const z0 = ez * hw;
      const x1 = ex * hl;
      const z1 = ez * wallEndZ;
      const span = Math.hypot(x1 - x0, z1 - z0) / 2;
      panels.push({
        pos: { x: (x0 + x1) / 2, y: ceil / 2, z: (z0 + z1) / 2 },
        half: { x: span, y: ceil / 2, z: THICK },
        // The diagonal runs at 45 degrees; the sign flips with the quadrant.
        yaw: ex * ez * (Math.PI / 4),
        kind: 'wall',
      });
    }
  }

  // Back walls: a piece either side of the goal mouth, plus the lintel over it.
  for (const e of [1, -1]) {
    const x = e * (hl + THICK);
    const sideW = (wallEndZ - gw / 2) / 2;
    for (const s of [1, -1]) {
      panels.push({
        pos: { x, y: ceil / 2, z: s * (gw / 2 + sideW) },
        half: { x: THICK, y: ceil / 2, z: sideW },
        yaw: 0,
        kind: 'wall',
      });
    }
    panels.push({
      pos: { x, y: gh + (ceil - gh) / 2, z: 0 },
      half: { x: THICK, y: (ceil - gh) / 2, z: gw / 2 },
      yaw: 0,
      kind: 'wall',
    });

    // Goal box: back, roof and two sides, so shots stay in the net.
    panels.push({
      pos: { x: e * (hl + gd + THICK), y: gh / 2, z: 0 },
      half: { x: THICK, y: gh / 2, z: gw / 2 + THICK },
      yaw: 0,
      kind: 'goal',
    });
    panels.push({
      pos: { x: e * (hl + gd / 2), y: gh + THICK, z: 0 },
      half: { x: gd / 2, y: THICK, z: gw / 2 + THICK },
      yaw: 0,
      kind: 'goal',
    });
    for (const s of [1, -1]) {
      panels.push({
        pos: { x: e * (hl + gd / 2), y: gh / 2, z: s * (gw / 2 + THICK) },
        half: { x: gd / 2, y: gh / 2, z: THICK },
        yaw: 0,
        kind: 'goal',
      });
    }
  }

  // Ramps along the floor-to-wall seam. Rocket League curves this transition;
  // a 45-degree ramp is the cheap approximation that still lets a fast car
  // carry speed onto the wall instead of slapping into a right angle.
  //
  // The slab's centre sits half a thickness *below* the ramp surface, or its
  // leading edge stands proud of the floor as a lip the car cannot climb.
  const ch = a.wallChamfer;
  if (ch > 0) {
    const span = (Math.SQRT2 * ch) / 2;
    const mid = ch / 2;
    const k = Math.SQRT1_2 * THICK;

    for (const s of [1, -1]) {
      panels.push({
        pos: { x: 0, y: mid - k, z: s * (hw - mid) + s * k },
        half: { x: wallEndX, y: THICK, z: span },
        yaw: 0,
        pitch: (-s * Math.PI) / 4,
        axis: 'x',
        kind: 'ramp',
      });
    }
    for (const e of [1, -1]) {
      const sideW = (wallEndZ - gw / 2) / 2;
      for (const s of [1, -1]) {
        panels.push({
          pos: {
            x: e * (hl - mid) + e * k,
            y: mid - k,
            z: s * (gw / 2 + sideW),
          },
          half: { x: span, y: THICK, z: sideW },
          yaw: 0,
          pitch: (e * Math.PI) / 4,
          axis: 'z',
          kind: 'ramp',
        });
      }
    }
  }

  if (a.hasCeiling) {
    panels.push({
      pos: { x: 0, y: ceil + THICK, z: 0 },
      half: { x: hl, y: THICK, z: hw },
      yaw: 0,
      kind: 'ceiling',
    });
  }

  return {
    halfLength: hl,
    halfWidth: hw,
    ceiling: ceil,
    cornerCut: cutX,
    panels,
    goals: [
      { sign: 1, x: hl, width: gw, height: gh, depth: gd },
      { sign: -1, x: -hl, width: gw, height: gh, depth: gd },
    ],
  };
}

/**
 * Rocket League's boost pad layout: 34 pads, six of them full-boost.
 *
 * Given in the game's own coordinates, where the first number runs across the
 * pitch and the second runs goal to goal, then mapped to ours (x goal to goal,
 * z across).
 */
const PADS: readonly (readonly [across: number, along: number, big: 0 | 1])[] = [
  [0, -4240, 0],
  [-1792, -4184, 0],
  [1792, -4184, 0],
  [-3072, -4096, 1],
  [3072, -4096, 1],
  [-940, -3308, 0],
  [940, -3308, 0],
  [0, -2816, 0],
  [-3584, -2484, 0],
  [3584, -2484, 0],
  [-1788, -2300, 0],
  [1788, -2300, 0],
  [-2048, -1036, 0],
  [0, -1024, 0],
  [2048, -1036, 0],
  [-3584, 0, 1],
  [-1024, 0, 0],
  [1024, 0, 0],
  [3584, 0, 1],
  [-2048, 1036, 0],
  [0, 1024, 0],
  [2048, 1036, 0],
  [-1788, 2300, 0],
  [1788, 2300, 0],
  [-3584, 2484, 0],
  [3584, 2484, 0],
  [0, 2816, 0],
  [-940, 3310, 0],
  [940, 3308, 0],
  [-3072, 4096, 1],
  [3072, 4096, 1],
  [-1792, 4184, 0],
  [1792, 4184, 0],
  [0, 4240, 0],
];

export function boostPadLayout(): { pos: { x: number; z: number }; big: boolean }[] {
  return PADS.map(([across, along, big]) => ({
    pos: { x: along, z: across },
    big: big === 1,
  }));
}

/**
 * Rocket League's five kickoff positions for the -x end, nearest the middle
 * first. Mirror along x for the other team.
 */
const KICKOFFS: readonly (readonly [across: number, along: number, rlYaw: number])[] = [
  [-256, -3840, Math.PI * 0.5],
  [256, -3840, Math.PI * 0.5],
  [-2048, -2560, Math.PI * 0.25],
  [2048, -2560, Math.PI * 0.75],
  [0, -4608, Math.PI * 0.5],
];

export interface Spawn {
  x: number;
  z: number;
  yaw: number;
}

/** Kickoff spots for one end. `sign` is which end, as with goals. */
export function kickoffSpawns(sign: 1 | -1): Spawn[] {
  // The table is written for the -x end, so the +x end is the mirror of it.
  const mirror = sign === 1 ? -1 : 1;
  return KICKOFFS.map(([across, along, rlYaw]) => ({
    x: along * mirror,
    z: across * mirror,
    // Our yaw turns about +Y from +x; the game's turns from its own across axis.
    yaw: rlYaw - Math.PI / 2 + (sign === 1 ? Math.PI : 0),
  }));
}
