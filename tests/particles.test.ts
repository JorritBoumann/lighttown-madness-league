// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Particles } from '../src/render/particles';

/**
 * The particle pool. Worth testing because the failure mode is silent: a pool
 * that never frees anything simply stops showing new effects, which looks like
 * the effect was never written.
 */

const WHITE = new THREE.Color(0xffffff);

const sizesOf = (p: Particles): Float32Array =>
  (p.points.geometry.getAttribute('aSize') as THREE.BufferAttribute).array as Float32Array;

const alive = (p: Particles): number => sizesOf(p).reduce((n, s) => n + (s > 0 ? 1 : 0), 0);

function emitOne(p: Particles, life = 1): void {
  p.emit({
    position: { x: 0, y: 100, z: 0 },
    velocity: { x: 100, y: 0, z: 0 },
    colour: WHITE,
    size: 40,
    life,
  });
}

describe('pooling', () => {
  it('shows a particle once emitted', () => {
    const p = new Particles();
    expect(alive(p)).toBe(0);
    emitOne(p);
    p.update(0.016);
    expect(alive(p)).toBe(1);
  });

  it('frees a particle when its life runs out', () => {
    const p = new Particles();
    emitOne(p, 0.1);
    p.update(0.05);
    expect(alive(p)).toBe(1);
    p.update(0.2);
    expect(alive(p)).toBe(0);
  });

  it('keeps going past the pool size rather than growing or failing', () => {
    const p = new Particles();
    const capacity = sizesOf(p).length;
    for (let i = 0; i < capacity * 3; i++) emitOne(p);
    p.update(0.016);
    // Every slot is in use and nothing has been allocated beyond the pool.
    expect(alive(p)).toBe(capacity);
    expect(sizesOf(p).length).toBe(capacity);
  });

  it('moves a particle along its velocity', () => {
    const p = new Particles();
    emitOne(p);
    p.update(0.1);
    const pos = (p.points.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    expect(pos[0]).toBeGreaterThan(0);
  });

  it('shrinks a particle as it ages, so it fades out', () => {
    const p = new Particles();
    emitOne(p, 1);
    p.update(0.1);
    const early = sizesOf(p)[0]!;
    p.update(0.6);
    expect(sizesOf(p)[0]!).toBeLessThan(early);
  });

  it('clears everything at once', () => {
    const p = new Particles();
    for (let i = 0; i < 50; i++) emitOne(p);
    p.update(0.016);
    expect(alive(p)).toBeGreaterThan(0);
    p.clear();
    expect(alive(p)).toBe(0);
  });
});

describe('bursts', () => {
  it('emits the number asked for', () => {
    const p = new Particles();
    p.burst({ x: 0, y: 100, z: 0 }, 24, {
      colour: WHITE,
      speed: 500,
      size: 30,
      life: 1,
    });
    p.update(0.016);
    expect(alive(p)).toBe(24);
  });

  it('throws them in different directions', () => {
    const p = new Particles();
    p.burst({ x: 0, y: 100, z: 0 }, 40, { colour: WHITE, speed: 500, size: 30, life: 1 });
    p.update(0.1);
    const pos = (p.points.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    const xs = new Set<number>();
    for (let i = 0; i < 40; i++) xs.add(Math.round(pos[i * 3]! * 10));
    // Not all on top of each other.
    expect(xs.size).toBeGreaterThan(5);
  });
});

describe('projection', () => {
  it('scales world sizes to the viewport and field of view', () => {
    const p = new Particles();
    const uniform = () =>
      (p.points.material as THREE.ShaderMaterial).uniforms.uScale!.value as number;
    p.setProjection(1080, 110);
    const wide = uniform();
    p.setProjection(1080, 60);
    // A narrower field of view magnifies, so the scale goes up.
    expect(uniform()).toBeGreaterThan(wide);
  });
});
