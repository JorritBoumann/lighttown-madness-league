import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Ribbon } from '../src/render/ribbon';

/**
 * The trail behind the ball and behind a supersonic car.
 *
 * Tested on frame-rate independence above all, because the first version was
 * not: it sampled on distance travelled, so a ball at full speed moving 21
 * units a frame never cleared a 26 unit threshold and the trail never appeared
 * at all. Where a distance threshold does work it makes the tail longer on a
 * slow machine than a fast one, which is the same bug wearing a disguise.
 */

const camera = new THREE.PerspectiveCamera(70, 1.6, 10, 40000);
camera.position.set(0, 500, 2000);
camera.updateMatrixWorld(true);

function make(): Ribbon {
  return new Ribbon({
    segments: 20,
    width: 60,
    colour: new THREE.Color(0x9fd8ff),
    sampleInterval: 0.02,
    teleport: 900,
  });
}

/** Flies a ribbon in a straight line and reports the drawn index count. */
function fly(ribbon: Ribbon, fps: number, seconds: number, speed = 2000): number {
  const dt = 1 / fps;
  let x = 0;
  for (let t = 0; t < seconds; t += dt) {
    x += speed * dt;
    ribbon.update(dt, { x, y: 100, z: 0 }, camera, 1);
  }
  return ribbon.mesh.geometry.drawRange.count;
}

describe('ribbon trail', () => {
  it('draws nothing until it has somewhere to draw from', () => {
    const r = make();
    r.update(1 / 60, { x: 0, y: 100, z: 0 }, camera, 1);
    expect(r.mesh.visible).toBe(false);
  });

  it('appears once the thing has moved', () => {
    const r = make();
    expect(fly(r, 60, 0.3)).toBeGreaterThan(0);
    expect(r.mesh.visible).toBe(true);
  });

  it('is the same length at 60 and at 144 frames a second', () => {
    // The whole point of sampling on time. These must match exactly: the tail
    // is a number of samples at a fixed interval, whatever the frame rate.
    const slow = fly(make(), 60, 1);
    const fast = fly(make(), 144, 1);
    expect(fast).toBe(slow);
  });

  it('still works at a frame rate faster than the sample interval', () => {
    // The case that broke: 120fps with a distance threshold drew nothing.
    expect(fly(make(), 120, 0.5)).toBeGreaterThan(0);
  });

  it('caps the tail at the segment count', () => {
    const r = make();
    const long = fly(r, 60, 5);
    // 20 segments is 19 quads is 114 indices, however long it flies.
    expect(long).toBe(19 * 6);
  });

  it('breaks rather than streaking across the pitch on a teleport', () => {
    const r = make();
    fly(r, 60, 1);
    expect(r.mesh.geometry.drawRange.count).toBeGreaterThan(0);
    // A kickoff puts the ball back on the spot from wherever it was.
    r.update(1 / 60, { x: -5000, y: 100, z: 0 }, camera, 1);
    expect(r.mesh.geometry.drawRange.count).toBe(0);
  });

  it('retires the tail when the thing slows down instead of vanishing', () => {
    const r = make();
    fly(r, 60, 1);
    const full = r.mesh.geometry.drawRange.count;
    // One frame at zero strength should shorten it, not clear it outright.
    r.update(1 / 60, { x: 0, y: 100, z: 0 }, camera, 0);
    const after = r.mesh.geometry.drawRange.count;
    expect(after).toBeLessThan(full);
    expect(after).toBeGreaterThan(0);
  });

  it('clears on demand', () => {
    const r = make();
    fly(r, 60, 1);
    r.clear();
    expect(r.mesh.visible).toBe(false);
    expect(r.mesh.geometry.drawRange.count).toBe(0);
  });
});
