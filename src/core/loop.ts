/**
 * Fixed-step loop. Physics advances in constant slices so the feel does not
 * change with frame rate; rendering gets the leftover fraction to interpolate.
 */
export interface LoopHandlers {
  fixed(dt: number): void;
  render(dt: number, alpha: number): void;
}

export class Loop {
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private running = false;

  constructor(
    private readonly handlers: LoopHandlers,
    private readonly stepSize: () => number,
    private readonly maxSteps: () => number,
    /**
     * How fast the simulation runs against real time. 1 is normal.
     *
     * Applied to the frame delta rather than to the step size, so slow motion
     * feeds the physics fewer steps per second instead of changing what a step
     * means. Scaling the step would change how the car handles, which is the
     * one thing slow motion must not touch.
     */
    private readonly timeScale: () => number = () => 1,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    // Clamp the frame delta so a backgrounded tab does not teleport everything.
    const frameDt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.accumulator += frameDt * this.timeScale();

    const dt = this.stepSize();
    let steps = 0;
    const max = this.maxSteps();
    while (this.accumulator >= dt && steps < max) {
      this.handlers.fixed(dt);
      this.accumulator -= dt;
      steps++;
    }
    if (steps === max) this.accumulator = 0;

    this.handlers.render(frameDt, this.accumulator / dt);
  };
}
