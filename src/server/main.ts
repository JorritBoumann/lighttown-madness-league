import { WebSocketServer, type WebSocket } from 'ws';
import { initPhysics } from '../physics/world';
import { GameServer, SNAPSHOT_HZ } from './gameServer';
import { decodeClient, encode } from './protocol';

/**
 * The server.
 *
 * Runs the same simulation the browser does, at the same fixed step, and is the
 * only thing allowed to decide where anything is. Clients send input and are
 * told the result; they never send a position, so they cannot assert one.
 *
 * The loop is a catch-up accumulator rather than a timer per step, for the same
 * reason the client's is: `setInterval` drifts and coalesces under load, and a
 * physics step that silently runs at the wrong rate is the hardest kind of bug
 * to see. Stepping to a wall clock keeps the simulation honest when the process
 * is briefly starved, and the cap stops a long stall turning into a spiral the
 * server never climbs out of.
 */

const PORT = Number(process.env.PORT ?? 8080);
const BOTS = Number(process.env.BOTS ?? 1);
const SEATS = Number(process.env.SEATS ?? 2);
/** Never try to make up more than this in one wake-up. */
const MAX_CATCHUP_STEPS = 12;

async function main(): Promise<void> {
  await initPhysics();

  const game = new GameServer({ botOpponents: BOTS, maxClients: SEATS });
  const sockets = new Map<number, WebSocket>();
  const wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (socket) => {
    const joined = game.join();
    if (!joined) {
      socket.close(1013, 'server full');
      return;
    }
    const { handle, welcome } = joined;
    sockets.set(handle.id, socket);
    socket.send(encode(welcome));
    // A client joining mid-run needs the round it is joining, not the next one.
    const round = game.currentRound();
    if (round) socket.send(encode(round));
    socket.send(encode(game.runState()));
    log(`client ${handle.id} joined as car ${handle.carIndex} (${game.clientCount}/${SEATS})`);

    socket.on('message', (data) => {
      const message = decodeClient(String(data));
      if (!message) return;
      if (message.type === 'input') game.onInput(handle.id, message.seq, message.input);
      else game.choose(handle.id, message.index);
    });

    const drop = (): void => {
      if (!sockets.delete(handle.id)) return;
      game.leave(handle.id);
      log(`client ${handle.id} left (${game.clientCount}/${SEATS})`);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  const step = game.stepSeconds * 1000;
  const snapshotEvery = 1000 / SNAPSHOT_HZ;
  let last = performance.now();
  let accumulator = 0;
  let sinceSnapshot = 0;

  const tick = (): void => {
    const now = performance.now();
    const elapsed = now - last;
    accumulator += elapsed;
    sinceSnapshot += elapsed;
    last = now;

    let steps = 0;
    while (accumulator >= step && steps < MAX_CATCHUP_STEPS) {
      game.step();
      accumulator -= step;
      steps++;
    }
    if (steps === MAX_CATCHUP_STEPS) {
      // Behind by more than we will ever make up. Drop the debt rather than
      // carrying it, or every later frame pays for one bad one.
      accumulator = 0;
      log('fell behind; dropped the backlog');
    }

    // Round and run changes go out the moment they happen rather than waiting
    // for the snapshot tick: a round change rebuilds the client's arena, and
    // doing that a frame late means a frame simulated against the wrong one.
    const roundChange = game.takeRoundMessage();
    const runChange = game.takeRunMessage();
    if (roundChange || runChange) {
      for (const id of game.clientIds()) {
        const socket = sockets.get(id);
        if (!socket || socket.readyState !== socket.OPEN) continue;
        if (roundChange) socket.send(encode(roundChange));
        if (runChange) socket.send(encode(runChange));
      }
    }

    if (sinceSnapshot >= snapshotEvery) {
      // Subtracted rather than zeroed, so the send rate does not drift slower
      // than it should every time a wake-up lands late.
      sinceSnapshot %= snapshotEvery;
      for (const id of game.clientIds()) {
        const socket = sockets.get(id);
        if (!socket || socket.readyState !== socket.OPEN) continue;
        socket.send(encode(game.snapshotFor(id)));
      }
    }
  };

  const timer = setInterval(tick, step);
  log(`listening on ws://localhost:${PORT} — ${SEATS} seats, ${BOTS} bot(s)`);

  const shutdown = (): void => {
    clearInterval(timer);
    wss.close();
    log('stopped');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function log(message: string): void {
  process.stdout.write(`[server] ${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[server] failed to start: ${String(error)}\n`);
  process.exit(1);
});
