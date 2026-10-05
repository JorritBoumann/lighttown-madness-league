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

  it('gives a panel that starts above the hoardings no solid band at all', () => {
    const lintel = {
      pos: { x: 5160, y: 1343, z: 0 },
      half: { x: 20, y: 701, z: 893 },
      yaw: 0,
      kind: 'wall' as const,
    };
    const bands = splitWallPanel(lintel, solidTop);
    expect(bands.every((b) => b.kind === 'glass')).toBe(true);
    // And it stays where the layout put it, rather than dropping to the floor.
    for (const band of bands) {
      expect(band.centre - band.height / 2).toBeGreaterThanOrEqual(642);
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
          const inMouthHeight = low < goal.height && high > 0;
          const inMouthWidth =
            Math.abs(panel.pos.z) - panel.half.z < goal.width / 2 - 1;
          const atThisGoal = Math.abs(panel.pos.x - goal.x) < cfg.arena.goalDepth * 2;
          expect(inMouthHeight && inMouthWidth && atThisGoal).toBe(false);
        }
      }
    }
  });
});
