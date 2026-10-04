/**
 * Piecewise-linear lookup table.
 *
 * Rocket League's handling is defined by curves rather than single constants:
 * throttle acceleration falls off with speed, and so does steering authority.
 * A table is both closer to the real thing and easier to tune by eye than any
 * formula fitted to it.
 */
export class Curve {
  private readonly xs: number[];
  private readonly ys: number[];

  /** Points must be sorted by x ascending. */
  constructor(points: readonly (readonly [number, number])[]) {
    if (points.length === 0) throw new Error('Curve needs at least one point');
    this.xs = points.map((p) => p[0]);
    this.ys = points.map((p) => p[1]);
  }

  /** Value at `x`, clamped to the end points outside the table's range. */
  at(x: number): number {
    const { xs, ys } = this;
    const n = xs.length;
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    // Linear scan: these tables are half a dozen points long.
    for (let i = 1; i < n; i++) {
      if (x > xs[i]!) continue;
      const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t;
    }
    return ys[n - 1]!;
  }
}

export type CurvePoints = readonly (readonly [number, number])[];
