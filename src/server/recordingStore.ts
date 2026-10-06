import { createWriteStream, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip, type Gzip } from 'node:zlib';
import { Recorder } from './recorder';

/**
 * Where recordings go: one gzipped file per room, under a folder per day.
 *
 * Kept apart from the recorder so the recorder stays a thing that turns a
 * match into lines, testable with an array, and this stays the one place that
 * knows about disks.
 */
export class RecordingStore {
  private readonly open = new Map<Gzip, Promise<void>>();

  constructor(
    private readonly dir: string,
    /** Stop starting new recordings once the folder holds this many bytes. */
    private readonly maxBytes: number,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** A recorder for a new room, or null when the folder is full. */
  recorderFor(code: string): Recorder | null {
    const used = folderBytes(this.dir);
    if (used >= this.maxBytes) return null;

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const folder = join(this.dir, day);
    mkdirSync(folder, { recursive: true });
    const stamp = now.toISOString().slice(11, 19).replace(/:/g, '');
    const path = join(folder, `${day}-${stamp}-${code}.ndjson.gz`);

    const gzip = createGzip();
    const file = createWriteStream(path);
    gzip.pipe(file);
    const done = new Promise<void>((resolve) => {
      file.on('finish', resolve);
      file.on('error', resolve);
    });
    this.open.set(gzip, done);

    return new Recorder(
      (line) => {
        gzip.write(line + '\n');
      },
      4,
      () => {
        gzip.end();
        void done.then(() => this.open.delete(gzip));
      },
    );
  }

  /**
   * Pushes what is buffered out to the files.
   *
   * Gzip holds data back to compress it better, and a process that is killed
   * rather than stopped -- out of memory, or the host pulling the machine --
   * loses whatever was held. Flushed every few seconds, a crash costs seconds
   * of a recording rather than all of it.
   */
  flush(): void {
    for (const gzip of this.open.keys()) gzip.flush();
  }

  /** Resolves once every file that was closed has reached the disk. */
  async settled(): Promise<void> {
    await Promise.all(this.open.values());
  }

  get openCount(): number {
    return this.open.size;
  }
}

function folderBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    total += stat.isDirectory() ? folderBytes(path) : stat.size;
  }
  return total;
}
