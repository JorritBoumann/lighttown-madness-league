import { describe, it, expect } from 'vitest';
import { buildArenaLayout, boostPadLayout } from '../src/core/arenaLayout';
import { cfg } from '../src/config';

describe('arena layout', () => {
  it('matches Rocket League’s pitch dimensions', () => {
    const l = buildArenaLayout();
    expect(l.halfLength * 2).toBe(10240);
    expect(l.halfWidth * 2).toBe(8192);
    expect(l.ceiling).toBe(2044);
  });

  it('keeps every panel out of the playing area', () => {
    const l = buildArenaLayout();
    for (const [i, p] of l.panels.entries()) {
      if (p.kind === 'floor' || p.kind === 'ceiling') continue;
      const insideX = Math.abs(p.pos.x) + p.half.x < l.halfLength - 100;
      const insideZ = Math.abs(p.pos.z) + p.half.z < l.halfWidth - 100;
      expect(
        insideX && insideZ,
        `panel ${i} (${p.kind}) at ${p.pos.x},${p.pos.y},${p.pos.z} is inside the pitch`,
      ).toBe(false);
    }
  });

  it('cuts the corners on the |x| + |z| plane, as the real arena does', () => {
    const l = buildArenaLayout();
    // Corner cut of 1152 along each axis is what the 420 chamfer works out to.
    expect(Math.round(l.cornerCut)).toBe(1152);
  });
});

describe('boost pads', () => {
  it('lays out 34 pads, six of them full boost', () => {
    const pads = boostPadLayout();
    expect(pads).toHaveLength(34);
    expect(pads.filter((p) => p.big)).toHaveLength(6);
  });

  it('keeps every pad on the pitch', () => {
    for (const pad of boostPadLayout()) {
      expect(Math.abs(pad.pos.x)).toBeLessThan(cfg.arena.halfLength);
      expect(Math.abs(pad.pos.z)).toBeLessThan(cfg.arena.halfWidth);
    }
  });

  it('is symmetric end to end', () => {
    const pads = boostPadLayout();
    for (const pad of pads) {
      const mirror = pads.find(
        (p) => Math.abs(p.pos.x + pad.pos.x) < 4 && Math.abs(p.pos.z + pad.pos.z) < 4,
      );
      expect(mirror, `no mirror for pad at ${pad.pos.x},${pad.pos.z}`).toBeTruthy();
      expect(mirror!.big).toBe(pad.big);
    }
  });
});
