import { describe, it, expect } from 'vitest';
import { buildArenaLayout } from '../src/core/arenaLayout';
import { cfg } from '../src/config';

describe('arena layout', () => {
  it('keeps every panel out of the playing area near the centre', () => {
    const layout = buildArenaLayout();
    // Nothing solid should sit within this radius of the kickoff spot, other
    // than the floor.
    for (const [i, p] of layout.panels.entries()) {
      if (i === 0) continue; // floor
      const insideX = Math.abs(p.pos.x) + p.half.x < cfg.arena.length / 2 - 2;
      const insideZ = Math.abs(p.pos.z) + p.half.z < cfg.arena.width / 2 - 2;
      const lowEnough = p.pos.y - p.half.y < cfg.arena.wallHeight;
      expect(
        insideX && insideZ && lowEnough,
        `panel ${i} at ${p.pos.x},${p.pos.y},${p.pos.z} half ${p.half.x},${p.half.y},${p.half.z} is inside the pitch`,
      ).toBe(false);
    }
  });
});
