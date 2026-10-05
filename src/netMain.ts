import { NetGame } from './net/netGame';

/**
 * Entry point for the networked client.
 *
 * Separate from the single-player one on purpose: that game owns a run,
 * upgrades and round modifiers, all of which the server would have to own
 * instead. This is the smallest thing that proves the protocol end to end.
 */
const canvas = document.getElementById('game') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLElement;

const url = new URLSearchParams(location.search).get('server') ?? 'ws://localhost:8080';

try {
  status.textContent = `connecting to ${url}`;
  const game = await NetGame.create(canvas, status, url);
  game.start();
  (window as unknown as { net: NetGame }).net = game;
} catch (error) {
  status.textContent = `could not start: ${String(error)}`;
  throw error;
}
