import { cfg } from '../config';

/**
 * Temporary config overrides, for round modifiers.
 *
 * Modifiers have to change things the whole game already reads from `cfg`:
 * gravity, ball mass, goal width, boost capacity. Rather than thread an
 * overrides object through every module, this writes into `cfg` and keeps a
 * baseline so it can be put back exactly.
 *
 * The baseline is captured per key on first write, so applying, changing and
 * reverting always returns to the values the file shipped with rather than to
 * whatever the previous round left behind.
 */

export type Patch = Record<string, number>;

/** `group.key` paths into the config, e.g. `ball.mass`. */
type Bag = Record<string, Record<string, number>>;

function read(path: string): number {
  const [group, key] = path.split('.') as [string, string];
  const bag = cfg as unknown as Bag;
  const g = bag[group];
  if (!g || !(key in g)) throw new Error(`No such config path: ${path}`);
  return g[key]!;
}

function write(path: string, value: number): void {
  const [group, key] = path.split('.') as [string, string];
  (cfg as unknown as Bag)[group]![key] = value;
}

export class ConfigOverrides {
  private readonly baseline = new Map<string, number>();

  /** Multiplies the current baseline value. */
  scale(path: string, factor: number): void {
    this.remember(path);
    write(path, this.baseline.get(path)! * factor);
  }

  /** Sets an absolute value. */
  set(path: string, value: number): void {
    this.remember(path);
    write(path, value);
  }

  /** Applies a patch of absolute values. */
  apply(patch: Patch): void {
    for (const [path, value] of Object.entries(patch)) this.set(path, value);
  }

  /** What a path was before anything was overridden. */
  baseValue(path: string): number {
    return this.baseline.has(path) ? this.baseline.get(path)! : read(path);
  }

  get active(): boolean {
    return this.baseline.size > 0;
  }

  /** Paths currently overridden, for display and tests. */
  get paths(): string[] {
    return [...this.baseline.keys()];
  }

  /** Puts everything back as it was. */
  revert(): void {
    for (const [path, value] of this.baseline) write(path, value);
    this.baseline.clear();
  }

  private remember(path: string): void {
    if (!this.baseline.has(path)) this.baseline.set(path, read(path));
  }
}
