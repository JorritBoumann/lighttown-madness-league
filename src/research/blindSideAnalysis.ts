import { cfg } from '../config';
import { sideOf, type BlindSide } from '../state/blindSide';

/**
 * Reads recordings for the blind-side experiment: do players find the side
 * the opposition is weak on, and play there more as a run goes on?
 *
 * Two measures, both from the players' side of the ball:
 *
 * - where they touch it in the half they attack: blind side, strong side or
 *   the middle. A player who has noticed should be found more on the blind
 *   side in later rounds than in early ones.
 * - attacks: each time the ball gets into the final third, which side it came
 *   in on, and whether a goal followed before it was cleared. This is the
 *   weakness itself, seen from the player's end -- if it does not show here,
 *   there was nothing to learn.
 *
 * Pure: lines in, numbers out. Reading files is the command's business.
 */

export type Where = 'blind' | 'strong' | 'middle';

export interface Tally {
  blind: number;
  strong: number;
  middle: number;
}

export interface RoundResult {
  /** One-based round of the run. */
  index: number;
  label: string;
  blindSide: BlindSide | null;
  /** Players' touches in the half they attack, by side. */
  touches: Tally;
  /** Times the ball reached the final third, by the side it came in on. */
  entries: Tally;
  /** Of those, the ones that ended in a goal for the players. */
  scored: Tally;
  goalsFor: number;
  goalsAgainst: number;
}

export interface RunResult {
  /** Which recording, and which run within it. */
  source: string;
  blindSide: BlindSide | null;
  rounds: RoundResult[];
}

interface Line {
  t: string;
  k: number;
  [key: string]: unknown;
}

const tally = (): Tally => ({ blind: 0, strong: 0, middle: 0 });

function where(z: number, blind: BlindSide | null): Where | null {
  if (!blind) return null;
  const s = sideOf(z);
  if (s === 0) return 'middle';
  return s === blind.side ? 'blind' : 'strong';
}

/** Splits one recording into runs and rounds and measures each. */
export function analyseRecording(lines: readonly Line[], source: string): RunResult[] {
  const runs: RunResult[] = [];
  let run: RunResult | null = null;
  let round: RoundResult | null = null;
  /** Cars driven by people, by index. */
  const people = new Set<number>();
  let entry: Where | null = null;
  const third = cfg.arena.halfLength / 3;
  // How far back out the ball must come before a new entry counts, so a ball
  // bobbling on the line is one attack, not ten.
  const hysteresis = 400;

  for (const line of lines) {
    switch (line.t) {
      case 'round': {
        const index = line.index as number;
        const blindSide = (line.blindSide as BlindSide | null) ?? null;
        // Round one again means the run before it ended and a new one began.
        if (!run || index === 1 || index <= (round?.index ?? 0)) {
          run = { source: `${source}#${runs.length + 1}`, blindSide, rounds: [] };
          runs.push(run);
        }
        round = {
          index,
          label: String(line.label ?? ''),
          blindSide,
          touches: tally(),
          entries: tally(),
          scored: tally(),
          goalsFor: 0,
          goalsAgainst: 0,
        };
        run.rounds.push(round);
        entry = null;
        // Which cars people drive comes from the round's car list, so a file
        // that starts mid-way still knows.
        const cars = line.cars as { team: number; bot: number | null }[] | undefined;
        if (cars) {
          people.clear();
          cars.forEach((c, i) => {
            if (c.bot === null) people.add(i);
          });
        }
        break;
      }
      case 'touch': {
        if (!round || !people.has(line.car as number)) break;
        const p = line.p as number[];
        if (p[0]! <= 0) break;
        const w = where(p[2]!, round.blindSide);
        if (w) round.touches[w]++;
        break;
      }
      case 'state': {
        if (!round) break;
        const b = line.b as number[];
        const x = b[0]!;
        const z = b[2]!;
        if (entry === null && x > third) {
          entry = where(z, round.blindSide);
          if (entry) round.entries[entry]++;
        } else if (entry !== null && x < third - hysteresis) {
          entry = null;
        }
        break;
      }
      case 'goal': {
        if (!round) break;
        if (line.team === 0) {
          round.goalsFor++;
          if (entry) round.scored[entry]++;
        } else {
          round.goalsAgainst++;
        }
        entry = null;
        break;
      }
      case 'kickoff':
        entry = null;
        break;
    }
  }
  // Rounds that never got going -- nobody touched the ball -- are noise.
  for (const r of runs) {
    r.rounds = r.rounds.filter(
      (x) => x.touches.blind + x.touches.strong + x.touches.middle + x.goalsFor + x.goalsAgainst > 0,
    );
  }
  return runs.filter((r) => r.rounds.length > 0 && r.blindSide !== null);
}

export interface CurvePoint {
  round: number;
  runs: number;
  touches: Tally;
  entries: Tally;
  scored: Tally;
  /** Blind share of the players' side touches: blind / (blind + strong). */
  touchShare: number | null;
  /** The same for attacks into the final third. */
  entryShare: number | null;
}

/** The learning curve: every run's rounds summed by round number. */
export function learningCurve(runs: readonly RunResult[]): CurvePoint[] {
  const byRound = new Map<number, CurvePoint>();
  for (const run of runs) {
    for (const r of run.rounds) {
      let p = byRound.get(r.index);
      if (!p) {
        p = { round: r.index, runs: 0, touches: tally(), entries: tally(), scored: tally(), touchShare: null, entryShare: null };
        byRound.set(r.index, p);
      }
      p.runs++;
      for (const k of ['blind', 'strong', 'middle'] as const) {
        p.touches[k] += r.touches[k];
        p.entries[k] += r.entries[k];
        p.scored[k] += r.scored[k];
      }
    }
  }
  const share = (t: Tally): number | null => (t.blind + t.strong > 0 ? t.blind / (t.blind + t.strong) : null);
  return [...byRound.values()]
    .sort((a, b) => a.round - b.round)
    .map((p) => ({ ...p, touchShare: share(p.touches), entryShare: share(p.entries) }));
}

/** Parses NDJSON, skipping a torn last line from a recording cut off mid-write. */
export function parseLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      out.push(JSON.parse(raw) as Line);
    } catch {
      // Only ever the last line, of a file whose writer was killed.
    }
  }
  return out;
}
