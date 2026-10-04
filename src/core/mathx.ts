export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, stiffness: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-stiffness * dt));

export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Scales a vector-like in place. */
export function scale3<T extends { x: number; y: number; z: number }>(v: T, s: number): T {
  v.x *= s;
  v.y *= s;
  v.z *= s;
  return v;
}

export const len3 = (v: { x: number; y: number; z: number }): number =>
  Math.hypot(v.x, v.y, v.z);

export const dot3 = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number => a.x * b.x + a.y * b.y + a.z * b.z;
