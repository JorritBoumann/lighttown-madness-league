import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { Site } from '../src/server/site';

/**
 * The game as the server hands it out: the right bytes, the right types, and
 * nothing outside the built site, however the path is spelled.
 */

let root: string;
let server: Server;
let port: number;

const PAGE = '<!doctype html><title>Lighttown</title>' + 'x'.repeat(2000);
const SCRIPT = 'console.log("game");'.repeat(200);

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function get(path: string, opts: { encoding?: string; method?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        port,
        path,
        method: opts.method ?? 'GET',
        headers: opts.encoding ? { 'accept-encoding': opts.encoding } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'site-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), PAGE);
  writeFileSync(join(dist, 'assets', 'index-AbCd1234.js'), SCRIPT);
  writeFileSync(join(dist, 'assets', 'rapier_bg-Zx9_Yw8v.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  // Beside the site, where a path with ".." in it would reach.
  writeFileSync(join(root, 'secret.txt'), 'not for you');

  const site = new Site(dist);
  server = createServer((req, res) => {
    if (!site.serve(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('serving the game', () => {
  it('answers the root with the page, checked fresh every load', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.body.toString()).toBe(PAGE);
  });

  it('lets a browser keep hashed files for good', async () => {
    const r = await get('/assets/index-AbCd1234.js');
    expect(r.headers['content-type']).toContain('text/javascript');
    expect(r.headers['cache-control']).toContain('immutable');
  });

  it('labels WebAssembly so it compiles while downloading', async () => {
    const r = await get('/assets/rapier_bg-Zx9_Yw8v.wasm');
    expect(r.headers['content-type']).toBe('application/wasm');
  });

  it('sends brotli when asked, then gzip, then the file as it is', async () => {
    const br = await get('/assets/index-AbCd1234.js', { encoding: 'gzip, deflate, br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.body.length).toBeLessThan(SCRIPT.length / 4);
    expect(brotliDecompressSync(br.body).toString()).toBe(SCRIPT);

    const gz = await get('/assets/index-AbCd1234.js', { encoding: 'gzip' });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.body).toString()).toBe(SCRIPT);

    const plain = await get('/assets/index-AbCd1234.js');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe(SCRIPT);
  });

  it('answers HEAD with the headers and no body', async () => {
    const r = await get('/', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(Number(r.headers['content-length'])).toBe(PAGE.length);
    expect(r.body.length).toBe(0);
  });
});

describe('nothing else', () => {
  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/secret.txt',
    '/nope.js',
    '/%E0%A4%A',
  ])('%s is not served', async (path) => {
    const r = await get(path);
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain('not for you');
  });

  it('does not answer anything but GET and HEAD', async () => {
    expect((await get('/', { method: 'POST' })).status).toBe(404);
  });

  it('refuses to start without a built game', () => {
    const empty = mkdtempSync(join(tmpdir(), 'site-empty-'));
    expect(() => new Site(empty)).toThrow(/index\.html/);
    rmSync(empty, { recursive: true, force: true });
  });
});
