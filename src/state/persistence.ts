/**
 * Best-run persistence.
 *
 * localStorage throws outright in some contexts (private windows, site data
 * blocked, a thumbnail renderer), and it can come back empty or holding
 * something another version wrote. Every read is guarded and validated, and a
 * bad record is treated as no record rather than crashing the menu.
 */

const KEY = 'rocket-gauntlet:best-run:v1';

export interface BestRun {
  /** Highest round number cleared. */
  roundsCleared: number;
  /** Round the run died on. */
  reachedRound: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Seconds of play. */
  duration: number;
  /** When it was set, ISO date. */
  setAt: string;
}

function isBestRun(value: unknown): value is BestRun {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.roundsCleared === 'number' &&
    Number.isFinite(v.roundsCleared) &&
    typeof v.reachedRound === 'number' &&
    typeof v.goalsFor === 'number' &&
    typeof v.goalsAgainst === 'number' &&
    typeof v.duration === 'number' &&
    typeof v.setAt === 'string'
  );
}

export function loadBestRun(): BestRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isBestRun(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Saves only if it beats what is there. Returns true if it was a new best. */
export function saveBestRun(run: BestRun): boolean {
  const current = loadBestRun();
  if (current && !beats(run, current)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
    return true;
  } catch {
    // Nothing to be done about a storage failure, and it is not worth losing
    // the run summary over.
    return false;
  }
}

/** Further is better; goal difference breaks a tie. */
export function beats(a: BestRun, b: BestRun): boolean {
  if (a.roundsCleared !== b.roundsCleared) return a.roundsCleared > b.roundsCleared;
  return a.goalsFor - a.goalsAgainst > b.goalsFor - b.goalsAgainst;
}

export function clearBestRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore: nothing depends on the clear succeeding.
  }
}
