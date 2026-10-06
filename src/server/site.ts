import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The built game, served from the same process as the rooms.
 *
 * So one address is the whole thing: open it and you have the game, and the
 * game's "Play online" talks back to where it came from. It exists to give a
 * link that can be sent to someone, which a copy on a laptop cannot be.
 *
 * Everything is read and compressed once, at start-up. The site is a handful
 * of files and a few megabytes, and Rapier's WebAssembly alone is three of
 * them -- a third of that compressed -- so compressing per request would spend
 * the CPU the simulation needs on work that never changes. It also makes the
 * question of which paths can be served a lookup in a map of files that were
 * found at start-up: nothing a request says can name a file outside it.
 */

interface SiteFile {
  type: string;
  /** Hashed by the build, so a browser may keep it for good. */
  immutable: boolean;
  raw: Buffer;
  gzip: Buffer;
  br: Buffer;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  // Must be exactly this for the browser to compile while downloading;
  // anything else falls back to buffering all three megabytes first.
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** Already compressed; squeezing them again only costs time. */
const PRECOMPRESSED = new Set(['.png', '.jpg', '.webp']);

export class Site {
  private readonly files = new Map<string, SiteFile>();

  constructor(dir: string) {
    for (const path of walk(dir)) {
      const ext = extname(path).toLowerCase();
      const raw = readFileSync(path);
      const squeeze = !PRECOMPRESSED.has(ext);
      const url = '/' + relative(dir, path).split(sep).join('/');
      this.files.set(url, {
        type: TYPES[ext] ?? 'application/octet-stream',
        // Vite names what it emits into assets/ by content hash.
        immutable: url.startsWith('/assets/') && /-[\w-]{8}\.\w+$/.test(url),
        raw,
        gzip: squeeze ? gzipSync(raw, { level: 9 }) : raw,
        // Quality 9, not the maximum 11: measured on this site, 11 is 1.08MB
        // in ten seconds of CPU and 9 is 1.24MB in a quarter of one. The
        // machine stops when idle and does this on every start, so the first
        // visitor after a quiet spell would wait out the difference.
        br: squeeze
          ? brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 9 } })
          : raw,
      });
    }
    if (!this.files.has('/index.html')) {
      throw new Error(`no index.html in ${dir}; build the game first`);
    }
  }

  get size(): number {
    return this.files.size;
  }

  /** Bytes sent for the whole site, raw and as a browser would get it. */
  get weight(): { raw: number; br: number } {
    let raw = 0;
    let br = 0;
    for (const file of this.files.values()) {
      raw += file.raw.length;
      br += file.br.length;
    }
    return { raw, br };
  }

  /** Answers the request if it names a file of the site. False if not. */
  serve(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname);
    } catch {
      return false;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = this.files.get(path);
    if (!file) return false;

    const accepts = String(request.headers['accept-encoding'] ?? '');
    const [body, encoding] = /\bbr\b/.test(accepts)
      ? [file.br, 'br']
      : /\bgzip\b/.test(accepts)
        ? [file.gzip, 'gzip']
        : [file.raw, null];
    const compressed = encoding !== null && body !== file.raw;

    response.writeHead(200, {
      'content-type': file.type,
      'content-length': body.length,
      // The page itself is checked every time, so a deploy reaches everyone on
      // their next load; what it points at is hashed and never changes.
      'cache-control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      vary: 'accept-encoding',
      ...(compressed ? { 'content-encoding': encoding } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return true;
  }
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
