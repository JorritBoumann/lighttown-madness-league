import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AccessGate, safeNext } from '../src/server/access';

/**
 * The team access code: the site and the rooms open to the code and only to
 * it, invitations survive the form, and guessing is slowed.
 */

const CODE = 'blue-kite-42';
let server: Server;
let port: number;
let gate: AccessGate;

interface Reply {
  status: number;
  headers: IncomingMessage['headers'];
  body: string;
}

function send(path: string, opts: { method?: string; body?: string; cookie?: string; ip?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        port,
        path,
        method: opts.method ?? 'GET',
        headers: {
          ...(opts.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...(opts.ip ? { 'fly-client-ip': opts.ip } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

const login = (code: string, next = '/', ip = '10.0.0.1'): Promise<Reply> =>
  send('/access', { method: 'POST', body: new URLSearchParams({ code, next }).toString(), ip });

const cookieOf = (reply: Reply): string => String(reply.headers['set-cookie']?.[0] ?? '').split(';')[0]!;

beforeEach(async () => {
  gate = new AccessGate(CODE);
  // The same order as the real server: health, then the gate, then the site.
  server = createServer((req, res) => {
    if (req.url === '/health') return void res.writeHead(200).end('ok');
    if (!gate.allows(req)) return gate.handle(req, res);
    res.writeHead(200).end('the game');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  server.close();
});

describe('without the code', () => {
  it('asks for it instead of serving the game', async () => {
    const r = await send('/');
    expect(r.status).toBe(401);
    expect(r.body).toContain('Access code');
    expect(r.body).not.toContain('the game');
  });

  it('still answers the host’s health check', async () => {
    expect((await send('/health')).status).toBe(200);
  });

  it('turns away a wrong code', async () => {
    const r = await login('nope');
    expect(r.status).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.body).toContain('not the code');
  });

  it('slows guessing from one address, and only that one', async () => {
    for (let i = 0; i < 6; i++) await login(`guess-${i}`, '/', '10.0.0.9');
    const blocked = await login(CODE, '/', '10.0.0.9');
    expect(blocked.status).toBe(429);
    expect((await login(CODE, '/', '10.0.0.10')).status).toBe(303);
  });
});

describe('with the code', () => {
  it('sets a cookie that opens the site, and does not contain the code', async () => {
    const r = await login(CODE);
    expect(r.status).toBe(303);
    const cookie = cookieOf(r);
    expect(cookie).toMatch(/^ltml_access=/);
    expect(cookie).not.toContain(CODE);
    expect(String(r.headers['set-cookie'])).toContain('HttpOnly');
    expect((await send('/', { cookie })).body).toBe('the game');
  });

  it('goes back to the room the invitation named', async () => {
    const page = await send('/?room=ABCD');
    expect(page.body).toContain('value="/?room=ABCD"');
    const r = await login(CODE, '/?room=ABCD');
    expect(r.headers.location).toBe('/?room=ABCD');
  });

  it('accepts the code with stray spaces around it', async () => {
    expect((await login(`  ${CODE} `)).status).toBe(303);
  });

  it('stops working when the code changes', async () => {
    const cookie = cookieOf(await login(CODE));
    gate = new AccessGate('a-new-code');
    expect((await send('/', { cookie })).status).toBe(401);
  });

  it('opens the rooms too: the socket upgrade carries the same cookie', async () => {
    const cookie = cookieOf(await login(CODE));
    const withCookie = { headers: { cookie } } as unknown as IncomingMessage;
    const without = { headers: {} } as unknown as IncomingMessage;
    expect(gate.allows(withCookie)).toBe(true);
    expect(gate.allows(without)).toBe(false);
  });
});

describe('where the form sends you', () => {
  it.each([
    ['/?room=ABCD', '/?room=ABCD'],
    ['/', '/'],
    ['//evil.example/', '/'],
    ['https://evil.example/x', '/'],
    ['/access', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s goes to %s', (raw, want) => {
    expect(safeNext(raw)).toBe(want);
  });
});
