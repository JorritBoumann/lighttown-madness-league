import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * A team access code in front of the game and its rooms.
 *
 * The game is for the team, not the public, and its link is easy to forward.
 * One shared code, asked for once: the right code sets a cookie, the cookie
 * opens the site and the rooms, and changing the code shuts out every browser
 * that had the old one.
 *
 * The cookie holds a keyed hash, not the code, so a cookie copied out of a
 * browser does not reveal it. Wrong guesses are slowed per address, so the
 * code cannot be found by trying them all.
 */

const COOKIE = 'ltml_access';
const COOKIE_DAYS = 180;
/** Wrong guesses allowed per address before it has to wait. */
const GUESSES = 6;
const GUESS_WINDOW_MS = 10 * 60 * 1000;

export class AccessGate {
  private readonly token: Buffer;
  private readonly misses = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly code: string,
    private readonly now: () => number = Date.now,
  ) {
    this.token = Buffer.from(createHmac('sha256', code).update('lighttown-access-v1').digest('hex'));
  }

  /** Whether this request carries the team's cookie. */
  allows(request: IncomingMessage): boolean {
    const value = readCookie(request.headers.cookie, COOKIE);
    if (!value) return false;
    const given = Buffer.from(value);
    return given.length === this.token.length && timingSafeEqual(given, this.token);
  }

  /**
   * Answers a request that does not have the cookie: the code form, or the
   * form's submission. Always responds.
   */
  handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.method === 'POST' && pathOf(request.url) === '/access') {
      void this.submit(request, response);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(401).end();
      return;
    }
    page(response, 401, safeNext(request.url ?? '/'), null);
  }

  private async submit(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(request, 2048));
    const next = safeNext(form.get('next') ?? '/');
    const who = clientAddress(request);

    const miss = this.misses.get(who);
    if (miss && this.now() - miss.since > GUESS_WINDOW_MS) this.misses.delete(who);
    const current = this.misses.get(who);
    if (current && current.count >= GUESSES) {
      page(response, 429, next, 'Too many wrong codes. Try again in ten minutes.');
      return;
    }

    const given = Buffer.from(form.get('code')?.trim() ?? '');
    const want = Buffer.from(this.code);
    const right = given.length === want.length && timingSafeEqual(given, want);
    if (!right) {
      this.misses.set(who, { count: (current?.count ?? 0) + 1, since: current?.since ?? this.now() });
      page(response, 401, next, 'That is not the code.');
      return;
    }

    this.misses.delete(who);
    // Secure only over HTTPS, which on Fly arrives as plain HTTP from its proxy
    // with the original scheme in a header. Locally there is no HTTPS, and a
    // Secure cookie would simply never be sent back.
    const https = request.headers['x-forwarded-proto'] === 'https';
    response.writeHead(303, {
      location: next,
      'set-cookie':
        `${COOKIE}=${this.token.toString()}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; ` +
        `HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`,
      'cache-control': 'no-store',
    });
    response.end();
  }
}

function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://site').pathname;
  } catch {
    return '/';
  }
}

/**
 * Where to go after the code, kept on this site.
 *
 * It is what makes an invitation survive the form -- `/?room=ABCD` comes back
 * to the room -- and it has to stay a path on this site, or the form becomes a
 * way to send people anywhere with this site's name on the link.
 */
export function safeNext(raw: string): string {
  try {
    const url = new URL(raw, 'http://site');
    if (url.origin !== 'http://site') return '/';
    if (url.pathname === '/access') return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** The visitor's address: Fly's header when behind its proxy, else the socket. */
function clientAddress(request: IncomingMessage): string {
  const fly = request.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly) return fly;
  return request.socket.remoteAddress ?? 'unknown';
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) {
        body = '';
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', () => resolve(''));
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(response: ServerResponse, status: number, next: string, error: string | null): void {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Lighttown Madness League</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e6edf7;
    background: radial-gradient(ellipse at top, #1b2a4a, #070a12 70%);
  }
  form {
    width: min(380px, 100%); padding: 28px 28px 24px; border-radius: 12px;
    background: rgba(10, 14, 24, 0.95); border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
  }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.01em; }
  p { margin: 0 0 18px; opacity: 0.65; font-size: 13px; }
  label { display: block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; margin-bottom: 6px; }
  input[type=password] {
    width: 100%; padding: 11px 12px; font: inherit; color: inherit; border-radius: 6px;
    background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18);
  }
  input[type=password]:focus { outline: 2px solid rgba(79, 195, 247, 0.7); outline-offset: 1px; }
  button {
    margin-top: 14px; width: 100%; padding: 11px; font: inherit; font-weight: 650; cursor: pointer;
    color: #04121c; background: #4fc3f7; border: 0; border-radius: 6px;
  }
  .error { margin: 10px 0 0; color: #ff9a9a; opacity: 1; }
</style>
</head>
<body>
<form method="post" action="/access">
  <h1>Lighttown Madness League</h1>
  <p>For the team. Enter the access code to play.</p>
  <label for="code">Access code</label>
  <input id="code" name="code" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Play</button>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
</form>
</body>
</html>`;
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  response.end(html);
}
