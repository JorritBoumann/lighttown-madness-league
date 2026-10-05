import { describe, it, expect } from 'vitest';
import { cfg } from '../src/config';
import { ResolutionScaler } from '../src/render/resolutionScaler';

/**
 * Adaptive resolution. The point of testing the policy rather than the picture
 * is that the failure everyone actually hits is hunting: a scaler that drops a
 * step, measures the faster frames, climbs back, measures the slower ones, and
 * does it for ever is far worse than one that settles slightly too soft.
 */

/** Feeds n frames of the same length and returns every change it asked for. */
function feed(scaler: ResolutionScaler, frameMs: number, frames: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < frames; i++) {
    const next = scaler.sample(frameMs);
    if (next !== null) changes.push(next);
  }
  return changes;
}

describe('resolution scaler', () => {
  it('starts at the display ratio and leaves a fast machine alone', () => {
    const s = new ResolutionScaler(2);
    expect(s.scale).toBe(2);
    // Already at the ceiling and comfortably fast: nothing to do.
    expect(feed(s, 8, 400)).toEqual([]);
    expect(s.scale).toBe(2);
  });

  it('drops the resolution on a machine that cannot hold the frame rate', () => {
    const s = new ResolutionScaler(2);
    feed(s, 30, 600);
    expect(s.scale).toBeLessThan(2);
  });

  it('never drops below the floor, however slow', () => {
    const s = new ResolutionScaler(2);
    feed(s, 400 - 1, 4000); // every frame terrible but inside the outlier bound
    expect(s.scale).toBeGreaterThanOrEqual(cfg.render.scaleFloor);
  });

  it('climbs back when the load lets up', () => {
    const s = new ResolutionScaler(2);
    feed(s, 30, 600);
    const dropped = s.scale;
    expect(dropped).toBeLessThan(2);
    feed(s, 7, 900);
    expect(s.scale).toBeGreaterThan(dropped);
  });

  it('does not climb past the display ratio', () => {
    const s = new ResolutionScaler(1.25);
    expect(s.scale).toBe(1.25);
    feed(s, 4, 900);
    expect(s.scale).toBe(1.25);
  });

  it('settles instead of hunting between two resolutions', () => {
    // The frame time a scaler like this actually sees: one that rises as the
    // resolution does. Modelled as proportional to pixel count, which is what
    // makes hunting possible at all — drop a step and it looks fast again.
    const s = new ResolutionScaler(2);
    const changes: number[] = [];
    for (let i = 0; i < 4000; i++) {
      // 2.0 -> ~20ms, so it must come down; at 1.55 it lands near 12ms.
      const frameMs = 5 + 3.75 * s.scale * s.scale;
      const next = s.sample(frameMs);
      if (next !== null) changes.push(next);
    }
    // It should make a handful of moves and then stop, not keep changing.
    const late = changes.slice(-10);
    const settled = new Set(late);
    expect(changes.length).toBeLessThan(30);
    expect(settled.size).toBeLessThanOrEqual(2);
  });

  it('ignores a single stutter', () => {
    const s = new ResolutionScaler(2);
    // A long frame from a tab waking up or a round rebuilding is not the frame
    // rate, and reacting to one drops the resolution for a one-off.
    for (let i = 0; i < 300; i++) {
      s.sample(i % 60 === 0 ? 900 : 8);
    }
    expect(s.scale).toBe(2);
  });

  it('is not fooled by one slow frame in an otherwise fast window', () => {
    const s = new ResolutionScaler(2);
    for (let i = 0; i < 600; i++) s.sample(i % 40 === 0 ? 40 : 7);
    // The median is what decides, so a fortieth of the frames being slow
    // should not move it.
    expect(s.scale).toBe(2);
  });
});
