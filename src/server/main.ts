import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { initPhysics } from '../physics/world';
import { SNAPSHOT_HZ } from './gameServer';
import { RoomRegistry, type Room } from './rooms';
import { CLOSE, decodeClient, encode, type ServerMessage } from './protocol';
import { cfg } from '../config';

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
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 32);
/** Seconds an empty room is kept, so a dropped connection can come back to it. */
const IDLE_SECONDS = Number(process.env.IDLE_SECONDS ?? 60);
/**
 * The most simulated time made up in one wake-up, in seconds.
 *
 * In time rather than steps, and a quarter of a second rather than a tenth. A
 * step costs about a tenth of a millisecond per room, so catching up thirty of
 * them is three milliseconds of work: cheap, and far better than the
 * alternative, which is the match quietly running slower than real time and
 * every client correcting for it. The cap still exists for what it was for --
 * a stall long enough that catching up would itself stall -- it was just set
 * as if steps were expensive.
 */
const MAX_CATCHUP_SECONDS = 0.25;
/**
 * Pages allowed to connect, comma-separated; unset allows any.
 *
 * A browser always sends the page's origin on a WebSocket upgrade, so this is
 * what stops someone else's page from opening rooms on this server. It is not
 * authentication -- anything that is not a browser can send any origin it
 * likes -- which is fine, because there is nothing here to protect but
 * capacity, and the room cap already bounds that.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

async function main(): Promise<void> {
  await initPhysics();

  const registry = new RoomRegistry({
    room: { botOpponents: BOTS, maxClients: SEATS },
    maxRooms: MAX_ROOMS,
    idleTimeout: IDLE_SECONDS,
  });
  // Client ids are only unique within a room, so sockets are filed per room.
  const sockets = new Map<string, Map<number, WebSocket>>();
  /**
   * Plain HTTP alongside the sockets, for whatever hosts this.
   *
   * Every host checks that a process is alive by requesting a page from it,
   * and a bare WebSocket server answers that with 426 Upgrade Required -- which
   * reads as down, so the host restarts it, for ever. `/health` answers 200
   * with the room count, which is also the quickest way to see whether anyone
   * is playing.
   */
  const http = createServer((request, response) => {
    if (request.url === '/health' || request.url === '/') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: registry.size, max: MAX_ROOMS }));
      return;
    }
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server: http,
    verifyClient: ({ origin }: { origin: string }) =>
      ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin),
  });
  // Listening on every interface: inside a container, localhost is the
  // container itself, and nothing outside it could connect.
  // Said once the port is actually held, not before: "listening" followed by
  // a crash, when the port was taken, is a log that lies for one line.
  // On the socket server, which re-emits the HTTP server's errors as its own
  // and would otherwise throw them before any handler here ran.
  wss.once('error', (error: NodeJS.ErrnoException) => {
    process.stderr.write(
      `[server] cannot listen on port ${PORT}: ${error.code === 'EADDRINUSE' ? 'already in use' : error.message}\n`,
    );
    process.exit(1);
  });
  http.listen(PORT, '0.0.0.0', () => {
    log(
      `listening on port ${PORT} — rooms of ${SEATS} seats, ${BOTS} bot(s), at most ${MAX_ROOMS}` +
        (ALLOWED_ORIGINS.length > 0 ? `, pages from ${ALLOWED_ORIGINS.join(' ')}` : ', pages from anywhere'),
    );
  });

  wss.on('connection', (socket, request) => {
    // The room comes in on the URL: `?room=ABCD` to join, `?room=new` or
    // nothing to start one. On the URL rather than in a first message, so a
    // refusal happens before anything is set up for a connection that is not
    // going to stay.
    const asked = new URL(request.url ?? '/', 'http://server').searchParams.get('room');
    let room: Room | null;
    if (!asked || asked.toLowerCase() === 'new') {
      room = registry.create();
      if (!room) {
        socket.close(CLOSE.SERVER_FULL, 'server full');
        return;
      }
      // With the page it came from: which origins actually connect is what
      // ALLOWED_ORIGINS has to be set from, and a page embedded in a
      // sandboxed frame says "null" rather than its address.
      log(`room ${room.code} opened from ${request.headers.origin ?? 'no origin'} (${registry.size} live)`);
    } else {
      room = registry.get(asked);
      if (!room) {
        socket.close(CLOSE.NO_SUCH_ROOM, 'no such room');
        return;
      }
    }

    const game = room.game;
    const joined = game.join();
    if (!joined) {
      socket.close(CLOSE.ROOM_FULL, 'room full');
      return;
    }
    const code = room.code;
    const { handle, welcome } = joined;
    let roomSockets = sockets.get(code);
    if (!roomSockets) {
      roomSockets = new Map();
      sockets.set(code, roomSockets);
    }
    roomSockets.set(handle.id, socket);
    socket.send(encode(welcome));
    // A client joining mid-run needs the round it is joining, not the next one.
    const round = game.currentRound();
    if (round) socket.send(encode(round));
    socket.send(encode(game.runState()));
    log(`room ${code}: client ${handle.id} joined as car ${handle.carIndex} (${game.clientCount}/${SEATS})`);

    socket.on('message', (data) => {
      const message = decodeClient(String(data));
      if (!message) return;
      if (message.type === 'input') game.onInput(handle.id, message.seq, message.input);
      else game.choose(handle.id, message.index);
    });

    const drop = (): void => {
      if (!roomSockets.delete(handle.id)) return;
      game.leave(handle.id);
      log(`room ${code}: client ${handle.id} left (${game.clientCount}/${SEATS})`);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  const stepSeconds = cfg.physics.fixedDt;
  const step = stepSeconds * 1000;
  const snapshotEvery = 1000 / SNAPSHOT_HZ;
  let last = performance.now();
  let accumulator = 0;
  let sinceSnapshot = 0;
  const health = { window: 0, drops: 0, droppedMs: 0, worstGap: 0 };

  /** Sends to everyone in one room. */
  const broadcast = (code: string, messages: (ServerMessage | null)[]): void => {
    const roomSockets = sockets.get(code);
    if (!roomSockets) return;
    for (const socket of roomSockets.values()) {
      if (socket.readyState !== socket.OPEN) continue;
      for (const message of messages) if (message) socket.send(encode(message));
    }
  };

  const tick = (): void => {
    const now = performance.now();
    const elapsed = now - last;
    accumulator += elapsed;
    sinceSnapshot += elapsed;
    last = now;

    const rooms = registry.all();
    health.worstGap = Math.max(health.worstGap, elapsed);
    const maxSteps = Math.ceil((MAX_CATCHUP_SECONDS * 1000) / step);
    let steps = 0;
    while (accumulator >= step && steps < maxSteps) {
      for (const room of rooms) room.game.step();
      accumulator -= step;
      steps++;
    }
    if (steps === maxSteps && accumulator >= step) {
      // Behind by more than is worth making up. Drop the debt rather than
      // carrying it, or every later wake-up pays for one bad one -- but count
      // it, because every millisecond dropped is a millisecond the match ran
      // slow, and that is worth knowing about rather than guessing at.
      health.droppedMs += accumulator;
      health.drops++;
      accumulator = 0;
    }

    // One line every ten seconds, and only when something went wrong. A line
    // per event told you it happened but not how badly, and it happened often
    // enough to bury everything else in the log.
    health.window += elapsed;
    if (health.window >= 10_000) {
      if (health.drops > 0) {
        log(
          `fell behind ${health.drops}x in 10s: dropped ${health.droppedMs.toFixed(0)}ms of ` +
            `simulation, worst gap between wake-ups ${health.worstGap.toFixed(0)}ms ` +
            `(${registry.size} room${registry.size === 1 ? '' : 's'})`,
        );
      }
      health.window = 0;
      health.drops = 0;
      health.droppedMs = 0;
      health.worstGap = 0;
    }

    for (const room of rooms) {
      // Goal and kickoff before round and run, because that is the order they
      // happen in: a goal is celebrated, then everyone is reset, then the round
      // and the run reflect it. Out of order, a client would clear its trails
      // for the kickoff and then start a celebration on top of it.
      const game = room.game;
      broadcast(room.code, [
        game.takeGoalMessage(),
        game.takeKickoffMessage(),
        game.takeRoundMessage(),
        game.takeRunMessage(),
      ]);
    }

    if (sinceSnapshot >= snapshotEvery) {
      // Subtracted rather than zeroed, so the send rate does not drift slower
      // than it should every time a wake-up lands late.
      sinceSnapshot %= snapshotEvery;
      for (const room of rooms) {
        const roomSockets = sockets.get(room.code);
        if (!roomSockets) continue;
        for (const [id, socket] of roomSockets) {
          if (socket.readyState !== socket.OPEN) continue;
          socket.send(encode(room.game.snapshotFor(id)));
        }
      }
    }

    for (const code of registry.sweep(elapsed / 1000)) {
      sockets.delete(code);
      log(`room ${code} closed after ${IDLE_SECONDS}s empty (${registry.size} live)`);
    }
  };

  const timer = setInterval(tick, step);
  const shutdown = (): void => {
    clearInterval(timer);
    // Told, rather than cut off: a client sees a clean close and says the
    // match ended, instead of waiting out a timeout on a socket that is gone.
    for (const client of wss.clients) client.close(1001, 'server stopping');
    wss.close();
    http.close();
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
