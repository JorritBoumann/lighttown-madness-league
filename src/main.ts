import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const boot = document.getElementById('boot');

try {
  // `?server=ws://host:port` joins a match instead of playing solo. One game
  // either way: the difference is who owns the run, and nothing the player
  // looks at knows which it is.
  const server = new URLSearchParams(location.search).get('server') ?? undefined;
  const game = await Game.create(canvas, ui, server);
  game.start();
  boot?.classList.add('gone');

  // Handy for poking at the simulation from the console while tuning.
  (window as unknown as { game: Game }).game = game;
} catch (error) {
  // A blank page with a console error is the worst way to fail. WebGL or
  // WebAssembly being unavailable is the likely cause, and neither is the
  // player's fault to diagnose.
  const note = boot?.querySelector('.boot-note');
  if (note) {
    note.classList.add('failed');
    note.textContent =
      'This needs WebGL and WebAssembly, and something here is unavailable. Try a different browser.';
  }
  throw error;
}
