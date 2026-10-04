import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const game = await Game.create(canvas, ui);
game.start();

// Handy for poking at the simulation from the console while tuning.
(window as unknown as { game: Game }).game = game;
