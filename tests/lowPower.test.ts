import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { thinInstances } from '../src/render/stadium';

/** The thinned crowd: the right share, spread evenly, nobody duplicated. */

function crowd(n: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    // Seat i sits at x = i, so a seat's number can be read back off it.
    mesh.setMatrixAt(i, m.makeTranslation(i, 0, 0));
    mesh.setColorAt(i, new THREE.Color(i / n, 0, 0));
  }
  return mesh;
}

const seatAt = (mesh: THREE.InstancedMesh, i: number): number => mesh.instanceMatrix.array[i * 16 + 12]!;

describe('thinInstances', () => {
  it('keeps about the share asked for', () => {
    const mesh = crowd(10000);
    thinInstances(mesh, 0.35);
    expect(mesh.count / 10000).toBeCloseTo(0.35, 2);
  });

  it('keeps every stretch of seats about equally full', () => {
    const mesh = crowd(10000);
    thinInstances(mesh, 0.35);
    const perBlock = new Array(10).fill(0);
    for (let i = 0; i < mesh.count; i++) perBlock[Math.floor(seatAt(mesh, i) / 1000)]++;
    for (const n of perBlock) expect(n).toBeGreaterThan(330);
  });

  it('keeps each seat’s colour with it, and draws nobody twice', () => {
    const mesh = crowd(500);
    thinInstances(mesh, 0.5);
    const seen = new Set<number>();
    for (let i = 0; i < mesh.count; i++) {
      const seat = seatAt(mesh, i);
      expect(seen.has(seat)).toBe(false);
      seen.add(seat);
      expect(mesh.instanceColor!.array[i * 3]!).toBeCloseTo(seat / 500, 5);
    }
  });
});
