import { cfg } from '../config';

/**
 * Arena geometry derived from config, in one place so the colliders and the
 * meshes can never disagree about where a wall is.
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
}

export interface ArenaLayout {
  halfLength: number;
  halfWidth: number;
  wallHeight: number;
  cornerCut: number;
  /** Floor, walls, corner panels, ceiling: everything solid. */
  panels: Panel[];
  /** Goal mouth centres, +x and -x ends. */
  goals: { sign: 1 | -1; x: number; width: number; height: number; depth: number }[];
}

const THICK = 1.0;

export function buildArenaLayout(): ArenaLayout {
  const a = cfg.arena;
  const hl = a.length / 2;
  const hw = a.width / 2;
  const h = a.wallHeight;
  const cut = a.cornerCut;
  const gw = a.goalWidth;
  const gh = a.goalHeight;
  const gd = a.goalDepth;

  const panels: Panel[] = [];

  // Floor.
  panels.push({ pos: { x: 0, y: -THICK, z: 0 }, half: { x: hl + gd, y: THICK, z: hw }, yaw: 0 });

  // Side walls, shortened to leave room for the corner panels.
  for (const s of [1, -1]) {
    panels.push({
      pos: { x: 0, y: h / 2, z: s * (hw + THICK) },
      half: { x: hl, y: h / 2, z: THICK },
      yaw: 0,
    });
    // Corner panels at 45 degrees, one per corner on this side.
    for (const e of [1, -1]) {
      const span = Math.SQRT2 * cut * 0.5;
      panels.push({
        pos: { x: e * (hl - cut / 2), y: h / 2, z: s * (hw - cut / 2) },
        half: { x: span, y: h / 2, z: THICK },
        yaw: (-e * s * Math.PI) / 4,
      });
    }
  }

  // Back walls: three pieces per end, leaving the goal mouth open.
  for (const e of [1, -1]) {
    const x = e * (hl + THICK);
    const sideW = (a.width - gw) / 2;
    for (const s of [1, -1]) {
      panels.push({
        pos: { x, y: h / 2, z: s * (gw / 2 + sideW / 2) },
        half: { x: THICK, y: h / 2, z: sideW / 2 },
        yaw: 0,
      });
    }
    // Lintel above the goal mouth.
    panels.push({
      pos: { x, y: gh + (h - gh) / 2, z: 0 },
      half: { x: THICK, y: (h - gh) / 2, z: gw / 2 },
      yaw: 0,
    });
    // Goal box: back, roof and two sides, so shots stay in the net.
    panels.push({
      pos: { x: e * (hl + gd + THICK), y: gh / 2, z: 0 },
      half: { x: THICK, y: gh / 2, z: gw / 2 + THICK },
      yaw: 0,
    });
    panels.push({
      pos: { x: e * (hl + gd / 2), y: gh + THICK, z: 0 },
      half: { x: gd / 2, y: THICK, z: gw / 2 + THICK },
      yaw: 0,
    });
    for (const s of [1, -1]) {
      panels.push({
        pos: { x: e * (hl + gd / 2), y: gh / 2, z: s * (gw / 2 + THICK) },
        half: { x: gd / 2, y: gh / 2, z: THICK },
        yaw: 0,
      });
    }
  }

  // Chamfer along the floor-to-wall seam: a 45-degree ramp so a fast car can
  // transition onto the wall instead of slapping into a right angle.
  //
  // Each ramp is a thin slab tilted 45 degrees. The slab's centre has to sit
  // half a thickness *below* the ramp surface, or its leading edge stands proud
  // of the floor as a lip the car cannot climb.
  const ch = a.wallChamfer;
  if (ch > 0) {
    const half = (Math.SQRT2 * ch) / 2; // half-length of the sloped face
    const mid = ch / 2;
    const k = Math.SQRT1_2 * THICK; // thickness offset along each normal axis

    // Side walls, at z = +/- hw. Ramp normal points up and in toward the pitch.
    for (const s of [1, -1]) {
      panels.push({
        pos: { x: 0, y: mid - k, z: s * (hw - mid) + s * k },
        half: { x: hl, y: THICK, z: half },
        yaw: 0,
        pitch: (-s * Math.PI) / 4,
        axis: 'x',
      });
    }

    // Back walls, at x = +/- hl, in two pieces each so the goal mouth stays clear.
    for (const e of [1, -1]) {
      const sideW = (a.width - gw) / 2;
      for (const s of [1, -1]) {
        panels.push({
          pos: { x: e * (hl - mid) + e * k, y: mid - k, z: s * (gw / 2 + sideW / 2) },
          half: { x: half, y: THICK, z: sideW / 2 },
          yaw: 0,
          pitch: (e * Math.PI) / 4,
          axis: 'z',
        });
      }
    }
  }

  if (a.ceiling) {
    panels.push({ pos: { x: 0, y: h + THICK, z: 0 }, half: { x: hl, y: THICK, z: hw }, yaw: 0 });
  }

  return {
    halfLength: hl,
    halfWidth: hw,
    wallHeight: h,
    cornerCut: cut,
    panels,
    goals: [
      { sign: 1, x: hl, width: gw, height: gh, depth: gd },
      { sign: -1, x: -hl, width: gw, height: gh, depth: gd },
    ],
  };
}

/** Boost pad positions: four big corners plus a scatter of small pads. */
export function boostPadLayout(): { pos: { x: number; z: number }; big: boolean }[] {
  const hl = cfg.arena.length / 2;
  const hw = cfg.arena.width / 2;
  const pads: { pos: { x: number; z: number }; big: boolean }[] = [];

  for (const ex of [1, -1]) {
    for (const ez of [1, -1]) {
      pads.push({ pos: { x: ex * (hl - 6), z: ez * (hw - 5) }, big: true });
    }
  }

  const smalls: [number, number][] = [
    [0, 0],
    [0, hw * 0.62],
    [0, -hw * 0.62],
    [hl * 0.42, 0],
    [-hl * 0.42, 0],
    [hl * 0.42, hw * 0.55],
    [hl * 0.42, -hw * 0.55],
    [-hl * 0.42, hw * 0.55],
    [-hl * 0.42, -hw * 0.55],
    [hl * 0.76, hw * 0.3],
    [hl * 0.76, -hw * 0.3],
    [-hl * 0.76, hw * 0.3],
    [-hl * 0.76, -hw * 0.3],
  ];
  for (const [x, z] of smalls) pads.push({ pos: { x, z }, big: false });

  return pads;
}
