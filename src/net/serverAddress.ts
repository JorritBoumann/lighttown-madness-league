/**
 * Where the game server is, if there is one.
 *
 * The game is published as static files, and a static host has no game server
 * behind it. The first build simply assumed one on port 8080 of whatever host
 * served the page -- right on a laptop, and wrong everywhere else, so the live
 * copy offered "Play online" and then failed every time with "Could not
 * connect". Better not to offer what cannot work.
 *
 * In order:
 * - `?server=` on the page URL, which also carries invitations;
 * - `VITE_GAME_SERVER` at build time, for a deployment that has a server;
 * - port 8080 on this machine, but only while developing on this machine.
 */
export function configuredServer(): string | null {
  const fromPage = new URLSearchParams(location.search).get('server');
  if (fromPage) return fromPage;

  const fromBuild = import.meta.env.VITE_GAME_SERVER as string | undefined;
  if (fromBuild) return fromBuild;

  const local = ['localhost', '127.0.0.1', '[::1]', '::1'];
  if (local.includes(location.hostname)) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.hostname}:8080`;
  }
  return null;
}
