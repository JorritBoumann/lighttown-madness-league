import { cfg } from '../config';

/**
 * Holds the frame rate by trading render resolution for it.
 *
 * The alternative is picking a fixed resolution, which means picking a machine:
 * at device pixel ratio 2 this scene draws nearly four million pixels a frame
 * through a bloom chain, which a desktop GPU shrugs at and a laptop on battery
 * does not. Rather than guess, or leave the player a settings menu to guess
 * with, the renderer measures its own frame time and moves the resolution.
 *
 * Deliberately a pure object with no renderer in it: the policy is the part
 * that is easy to get subtly wrong — oscillating between two resolutions once
 * a second is far more annoying than a slightly soft image — so it is the part
 * worth testing on its own.
 */
export class ResolutionScaler {
  /** Current pixel ratio. */
  private current: number;
  private readonly ceiling: number;
  /** Frame times in the window, in milliseconds. */
  private readonly window: number[] = [];
  /** Seconds left before another change is allowed. */
  private cooldown = 0;

  constructor(ceiling: number) {
    this.ceiling = Math.max(cfg.render.scaleFloor, ceiling);
    this.current = this.ceiling;
  }

  get scale(): number {
    return this.current;
  }

  /**
   * Feeds in a frame time. Returns the new pixel ratio when it changes, and
   * null when it does not — so the caller only resizes when something moved.
   */
  sample(frameMs: number): number | null {
    const r = cfg.render;

    // Ignore obvious outliers. A tab coming back from the background, a
    // garbage collection or a round rebuild produces a frame of hundreds of
    // milliseconds, and reacting to one of those drops the resolution for
    // something that will never happen again.
    if (frameMs > r.scaleOutlierMs || frameMs <= 0) return null;

    this.window.push(frameMs);
    if (this.window.length > r.scaleWindow) this.window.shift();

    if (this.cooldown > 0) {
      this.cooldown -= frameMs / 1000;
      return null;
    }
    if (this.window.length < r.scaleWindow) return null;

    // Median, not mean: one stutter in the window should not move anything.
    const sorted = [...this.window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    let next = this.current;
    if (median > r.scaleDownMs) {
      next = Math.max(r.scaleFloor, this.current - r.scaleStep);
    } else if (median < r.scaleUpMs) {
      next = Math.min(this.ceiling, this.current + r.scaleStep);
    }

    if (next === this.current) return null;

    this.current = next;
    // Clear the window: the next few frames are measuring a different
    // resolution, and judging the new one on the old one's samples is what
    // makes this sort of thing oscillate.
    this.window.length = 0;
    this.cooldown = r.scaleCooldown;
    return next;
  }
}
