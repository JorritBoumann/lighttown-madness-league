import { GameServer, type ServerOptions } from './gameServer';
import { generateCode, normaliseCode } from './roomCode';

export { generateCode, normaliseCode, CODE_LENGTH } from './roomCode';

/**
 * Rooms: several matches on one server, each found by a short code.
 *
 * Each room is a whole `GameServer` — its own simulation, its own run — so two
 * rooms share nothing but the process. Isolation is the property worth having:
 * a bug that wedges one match cannot reach into another, and a room can be
 * thrown away whole when the last person leaves.
 */

export interface Room {
  code: string;
  game: GameServer;
  /** Seconds since the last person left; 0 while anyone is connected. */
  emptyFor: number;
}

export interface RegistryOptions {
  /** Per-room settings, passed to every GameServer this creates. */
  room?: ServerOptions;
  /**
   * Most rooms at once.
   *
   * Every room is a physics world stepping at 120Hz whether anyone is watching
   * or not, so the cap is what keeps one curious person refreshing a create
   * link from taking the whole server down.
   */
  maxRooms?: number;
  /** Seconds an empty room survives before it is thrown away. */
  idleTimeout?: number;
  random?: () => number;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly options: RegistryOptions = {}) {}

  get size(): number {
    return this.rooms.size;
  }

  /** A new room, or null when the server is at capacity. */
  create(): Room | null {
    if (this.rooms.size >= (this.options.maxRooms ?? 32)) return null;
    const random = this.options.random ?? Math.random;
    // A clash is a one-in-nearly-a-million event per existing room, so a
    // handful of tries is plenty; the bound is there so it cannot spin.
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateCode(random);
      if (this.rooms.has(code)) continue;
      const room: Room = {
        code,
        game: new GameServer({ ...this.options.room, code }),
        emptyFor: 0,
      };
      this.rooms.set(code, room);
      return room;
    }
    return null;
  }

  get(raw: string): Room | null {
    const code = normaliseCode(raw);
    return code ? (this.rooms.get(code) ?? null) : null;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /**
   * Ages empty rooms and throws away the ones nobody has come back to.
   *
   * Kept for a while rather than closed the instant they empty, because a
   * dropped connection is far more often someone reconnecting than someone
   * leaving, and they should come back to the match they were in.
   */
  sweep(dt: number): string[] {
    const removed: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.game.clientCount > 0) {
        room.emptyFor = 0;
        continue;
      }
      room.emptyFor += dt;
      if (room.emptyFor >= (this.options.idleTimeout ?? 60)) {
        room.game.dispose();
        this.rooms.delete(room.code);
        removed.push(room.code);
      }
    }
    return removed;
  }
}
