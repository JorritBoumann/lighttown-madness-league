import { describe, it, expect } from 'vitest';
import { cfg } from '../src/config';
import { buildArenaLayout } from '../src/core/arenaLayout';
import { splitWallPanel } from '../src/render/scene';

/**
 * How a wall panel divides into hoardings and glass.
 *
 * This had a bug you could see from the halfway line: the split was measured
 * from the floor rather than from the panel, so the lintel over each goal
 * mouth — which starts at the top of the goal — was given a band of hoardings
 * at y 0 to 620 and hung it across the mouth. The goal looked like a recess
 * with a sponsor board in it, and the netting behind was invisible.
 */
describe('splitting a wall into hoardings and glass', () => {
  const solidTop = cfg.arena.hoardingHeight;
  const layout = buildArenaLayout();

  it('puts hoardings at the bottom of a floor-to-ceiling wall', () => {
    const wall = {
      pos: { x: 0, y: cfg.arena.ceiling / 2, z: 4096 },
      half: { x: 5120, y: cfg.arena.ceiling / 2, z: 20 },
      yaw: 0,
      kind: 'wall' as const,
    };
    const bands = splitWallPanel(wall, solidTop);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ kind: 'solid', height: solidTop, centre: solidTop / 2 });
    expect(bands[1]!.kind).toBe('glass');
    expect(bands[1]!.centre - bands[1]!.height / 2).toBeCloseTo(solidTop);
  });

  it('gives the lintel over a goal a solid header on the crossbar', () => {
    const lintel = {
      pos: { x: 5160, y: 1343, z: 0 },
      half: { x: 20, y: 701, z: 893 },
      yaw: 0,
      kind: 'wall' as const,
    };
    const bands = splitWallPanel(lintel, solidTop);
    // Solid for its own first `solidTop` units, then glass — the same rule as
    // any wall, applied from the panel's base rather than from the pitch.
    //
    // All-glass was wrong for a different reason than all-solid: you looked
    // straight through it at the stands sitting just above the goal's roof, and
    // a row of spectators appeared to be standing inside the net.
    expect(bands[0]).toMatchObject({ kind: 'solid' });
    expect(bands[0]!.centre - bands[0]!.height / 2).toBeCloseTo(642, 0);
    expect(bands[0]!.height).toBeCloseTo(solidTop, 0);
    expect(bands[1]!.kind).toBe('glass');
    // Nothing drops to the floor.
    for (const band of bands) {
      expect(band.centre - band.height / 2).toBeGreaterThan(600);
    }
  });

  it('leaves nothing opaque across either goal mouth', () => {
    // The real check, against the real layout: no solid band may overlap the
    // volume a ball has to pass through to score.
    for (const goal of layout.goals) {
      for (const panel of layout.panels) {
        for (const band of splitWallPanel(panel, solidTop)) {
          if (band.kind !== 'solid') continue;
          const low = band.centre - band.height / 2;
          const high = band.centre + band.height / 2;
          // A band resting exactly on the crossbar is not inside the mouth;
          // the tolerance is there because that boundary lands on 642.775 and
          // the arithmetic puts it a tenth of a picometre below.
          const inMouthHeight = low < goal.height - 1 && high > 0;
          const inMouthWidth =
            Math.abs(panel.pos.z) - panel.half.z < goal.width / 2 - 1;
          const atThisGoal = Math.abs(panel.pos.x - goal.x) < cfg.arena.goalDepth * 2;
          expect(inMouthHeight && inMouthWidth && atThisGoal).toBe(false);
        }
      }
    }
  });
});
