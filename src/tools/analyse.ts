import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { constants, gunzipSync } from 'node:zlib';
import {
  analyseRecording,
  learningCurve,
  parseLines,
  type RunResult,
  type Tally,
} from '../research/blindSideAnalysis';
import { describeSide } from '../state/blindSide';

/**
 * `npm run analyse -- <files or folders>`: the blind-side experiment's
 * results from a set of recordings. `--json` prints the numbers instead.
 */

function files(paths: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (statSync(path).isDirectory()) {
      out.push(...files(readdirSync(path).map((name) => join(path, name))));
    } else if (/\.ndjson(\.gz)?$/.test(path)) {
      out.push(path);
    }
  }
  return out.sort();
}

function read(path: string): string {
  const raw = readFileSync(path);
  if (!path.endsWith('.gz')) return raw.toString();
  // Sync flush rather than finish, so a file whose writer was killed before
  // closing it still yields everything that reached the disk.
  return gunzipSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }).toString();
}

const pct = (n: number | null): string => (n === null ? '   -' : `${Math.round(n * 100)}%`.padStart(4));
const conv = (scored: Tally, entries: Tally, k: keyof Tally): string =>
  entries[k] > 0 ? `${scored[k]}/${entries[k]}` : '-';

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const paths = args.filter((a) => a !== '--json');
  if (paths.length === 0) {
    process.stderr.write('usage: npm run analyse -- <recordings folder or files> [--json]\n');
    process.exit(1);
  }

  const runs: RunResult[] = [];
  for (const path of files(paths)) runs.push(...analyseRecording(parseLines(read(path)), path));
  const curve = learningCurve(runs);

  if (json) {
    process.stdout.write(JSON.stringify({ runs, curve }, null, 2) + '\n');
    return;
  }

  const out: string[] = [];
  out.push(`${runs.length} run(s) with a blind side, from ${files(paths).length} recording(s)\n`);
  for (const run of runs) {
    const side = run.blindSide ? describeSide(run.blindSide.side) : '-';
    out.push(`${run.source}: blind side on the attacker's ${side}`);
    for (const r of run.rounds) {
      const t = r.touches;
      out.push(
        `  round ${String(r.index).padStart(2)}  ${r.goalsFor}-${r.goalsAgainst}  ` +
          `touches blind ${t.blind} strong ${t.strong} middle ${t.middle}  ` +
          `attacks scored: blind ${conv(r.scored, r.entries, 'blind')}, strong ${conv(r.scored, r.entries, 'strong')}`,
      );
    }
  }
  out.push('\nBy round, all runs together. Share = blind / (blind + strong); 50% is no preference.');
  out.push('round  runs  touch share  attack share  attacks scored (blind | strong)');
  for (const p of curve) {
    out.push(
      `${String(p.round).padStart(5)}  ${String(p.runs).padStart(4)}  ${pct(p.touchShare).padStart(11)}  ` +
        `${pct(p.entryShare).padStart(12)}  ${conv(p.scored, p.entries, 'blind').padStart(8)} | ${conv(p.scored, p.entries, 'strong')}`,
    );
  }
  process.stdout.write(out.join('\n') + '\n');
}

main();
