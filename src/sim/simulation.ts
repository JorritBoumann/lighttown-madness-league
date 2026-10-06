import { PhysicsWorld, type RAPIER } from '../physics/world';
import { createArena, destroyArena, type Arena } from '../physics/arena';
import { Ball } from '../physics/ball';
import { Car } from '../physics/car';
import { BoostPads, type BoostPad } from '../physics/boostPads';
import { CarBallInteraction } from '../physics/carBall';
import { Bot, type BotRole } from '../ai/bot';
import { kickoffSpawns, type Spawn } from '../core/arenaLayout';
import { Match, type MatchHandlers } from '../state/match';
import type { MatchRules } from '../state/match';
import type { RoundOpponent } from '../state/round';
import { emptyInput, type CarInput } from '../input/types';
import { cfg } from '../config';

/**
 * The game, with nothing you can see.
 *
 * Everything in here is deterministic given the same inputs: physics, cars,
 * bots, pads and the match rules. Nothing imports a renderer, an audio context
 * or the DOM, so this runs unchanged under Node — which is what makes a
 * server-authoritative multiplayer build possible, and what lets a whole match
 * be played in a test instead of only its pieces.
 *
 * It does not know about meshes, sound, the camera, the HUD, the replay or the
 * run's statistics. Those are consequences of what happened, so `step` reports
 * what happened and the caller decides what to do about it.
 */

/** A car in the simulation, and the bot driving it if it is not a person's. */
export interface SimCar {
  car: Car;
  /** Null for a car driven from outside — the local player, or a network peer. */
  bot: Bot | null;
  spawn: Spawn;
}

export interface BallTouch {
  by: SimCar;
  /** Closing speed at the moment of contact. */
  closing: number;
}

export interface CarHit {
  a: SimCar;
  b: SimCar;
  closing: number;
  at: { x: number; y: number; z: number };
}

/** What happened during one step, for the caller to react to. */
export interface StepEvents {
  ballTouches: BallTouch[];
  carHits: CarHit[];
  padPickups: { car: Car; pad: BoostPad }[];
}

export interface StepOptions {
  /**
   * Whether anyone is driving. False holds every car still: the countdown, the
   * moment after a goal, and any time a menu is up.
   */
  driving: boolean;
  /** Freezes the bodies outright, so nothing drifts while play is held. */
  frozen: boolean;
  /** Whether the match clock advances. Free play runs without one. */
  clock: boolean;
  /**
   * Input for every car with no bot, by index into `cars`.
   *
   * A map rather than a single input because this is the seam a networked
   * build arrives through: today it carries one entry for the local player,
   * and nothing here would change to carry four.
   */
  inputs: ReadonlyMap<number, CarInput>;
}

export class Simulation {
  /**
   * The step both ends run at.
   *
   * On the simulation rather than read from config at each call site, because a
   * client replaying its own inputs has to re-run exactly the steps the server
   * took. Two places reading the same constant is fine until one of them stops.
   */
  readonly stepSeconds = cfg.physics.fixedDt;
  readonly phys: PhysicsWorld;
  readonly ball: Ball;
  readonly pads: BoostPads;
  readonly cars: SimCar[] = [];
  arena: Arena;
  match!: Match;

  private readonly carBall = new CarBallInteraction();
  /** Collider handle to car, for attributing contacts. */
  private readonly byCollider = new Map<number, SimCar>();
  private readonly events: StepEvents = { ballTouches: [], carHits: [], padPickups: [] };

  constructor(private readonly random: () => number = Math.random) {
    this.phys = new PhysicsWorld();
    this.arena = createArena(this.phys);
    this.ball = new Ball(this.phys);
    this.pads = new BoostPads();
  }

  /** Index 0 is the car a person drives. */
  get player(): SimCar {
    return this.cars[0]!;
  }

  /** Adds a car. `botLevel` null leaves it to be driven from outside. */
  addCar(team: 0 | 1, slot: number, botLevel: number | null, role: BotRole = 'balanced'): SimCar {
    const spawn = spawnFor(team, slot);
    const car = new Car(this.phys, spawnPosition(spawn), spawn.yaw, team);
    const entry: SimCar = {
      car,
      bot: botLevel === null ? null : new Bot(car, botLevel, this.random, role),
      spawn,
    };
    this.cars.push(entry);
    this.byCollider.set(car.collider.handle, entry);
    return entry;
  }

  /**
   * Removes the most recently added car.
   *
   * Only ever the last one, which keeps the car list index-aligned with any
   * mirror of it -- a client builds its cars in the server's order, and indices
   * are how snapshots say which car is which.
   */
  removeLastCar(): SimCar | null {
    const entry = this.cars.pop();
    if (!entry) return null;
    this.byCollider.delete(entry.car.collider.handle);
    entry.car.destroy();
    return entry;
  }

  /**
   * Matches the opposition to a round's lineup.
   *
   * Returns the cars that were removed, because the caller is holding meshes
   * and trails that belong to them and has no other way to know they are gone.
   */
  setOpponents(lineup: readonly RoundOpponent[]): { added: SimCar[]; removed: SimCar[] } {
    const existing = this.cars.filter((c) => c.bot !== null).length;
    const added: SimCar[] = [];
    const removed: SimCar[] = [];
    for (let i = existing; i < lineup.length; i++) {
      added.push(this.addCar(1, i, lineup[i]!.tier, lineup[i]!.role));
    }
    for (let i = existing; i > lineup.length; i--) {
      const entry = this.cars.pop();
      if (!entry) break;
      this.byCollider.delete(entry.car.collider.handle);
      entry.car.destroy();
      removed.push(entry);
    }
    // Re-stamp tier and role, since cars are reused across rounds.
    let i = 0;
    for (const entry of this.cars) {
      if (!entry.bot) continue;
      const spot = lineup[i++];
      if (!spot) continue;
      entry.bot.setLevel(spot.tier);
      entry.bot.setRole(spot.role);
    }
    return { added, removed };
  }

  /** Starts a match under these rules. */
  startMatch(rules: MatchRules, handlers: MatchHandlers): Match {
    this.match = new Match(rules, handlers);
    return this.match;
  }

  /** Goal dimensions are baked into colliders, so some modifiers need this. */
  rebuildArena(): void {
    destroyArena(this.phys, this.arena);
    this.arena = createArena(this.phys);
  }

  /** Everyone back on their line, ball on the spot, pads live. */
  resetKickoff(): void {
    for (const entry of this.cars) {
      entry.car.reset(spawnPosition(entry.spawn), entry.spawn.yaw);
      entry.bot?.reset();
    }
    this.ball.reset();
    this.pads.resetAll();
  }

  /**
   * Releases the physics world.
   *
   * Rapier's world lives in WebAssembly memory, which the garbage collector
   * cannot see. A server that drops a finished room without this leaks a whole
   * world per game played, and nothing in JavaScript will ever reclaim it.
   */
  dispose(): void {
    this.phys.free();
  }

  /** Re-reads tuning that a round modifier or an upgrade may have changed. */
  syncConfig(): void {
    this.ball.syncConfig();
    for (const entry of this.cars) entry.car.syncConfig();
    this.carBall.syncConfig();
  }

  /** One fixed step. Returns what happened, for the caller to present. */
  step(dt: number, opts: StepOptions): StepEvents {
    const events = this.events;
    events.ballTouches.length = 0;
    events.carHits.length = 0;
    events.padPickups.length = 0;

    const world = {
      ball: {
        position: this.ball.position,
        velocity: this.ball.velocity,
        radius: cfg.ball.radius,
      },
      pads: this.pads.pads,
    };

    for (let i = 0; i < this.cars.length; i++) {
      const entry = this.cars[i]!;
      if (!opts.driving) {
        entry.car.input = emptyInput();
        continue;
      }
      entry.car.input = entry.bot
        ? entry.bot.think(dt, world)
        : (opts.inputs.get(i) ?? emptyInput());
    }

    if (opts.frozen) {
      for (const entry of this.cars) freeze(entry.car.body);
      freeze(this.ball.body);
    }

    const cars: Car[] = [];
    for (const entry of this.cars) {
      entry.car.update(dt);
      cars.push(entry.car);
    }
    this.ball.update();

    if (opts.driving) {
      this.pads.update(dt, cars);
      for (const picked of this.pads.justPicked) {
        events.padPickups.push({ car: picked.car, pad: picked.pad });
      }
    }

    this.phys.step();
    this.drainContacts(events);

    if (opts.clock) {
      this.match.update(dt, { position: this.ball.position, radius: cfg.ball.radius });
    }
    return events;
  }

  /**
   * Car-on-ball and car-on-car contacts.
   *
   * The ball bounce and the car-on-car shove are applied here because they are
   * physics; the sound, sparks and camera kick that go with them are not, so
   * they are reported instead.
   */
  private drainContacts(events: StepEvents): void {
    const ballHandle = this.ball.collider.handle;
    this.phys.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other = h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;
      if (other === null) {
        const a = this.byCollider.get(h1);
        const b = this.byCollider.get(h2);
        if (a && b && a !== b) this.bump(a, b, events);
        return;
      }
      const entry = this.byCollider.get(other);
      if (!entry) return;

      const cv = entry.car.velocity;
      const bv = this.ball.velocity;
      const closing = Math.hypot(cv.x - bv.x, cv.y - bv.y, cv.z - bv.z);
      this.carBall.apply(entry.car, this.ball);
      // Needed to tell an own goal from a goal.
      this.match?.touch(entry.car.team);
      events.ballTouches.push({ by: entry, closing });
    });
  }

  /**
   * The shove two cars give each other.
   *
   * On top of what the solver does, deliberately: two boxes of equal mass
   * meeting at a shallow angle barely deflect, which reads as scraping past
   * someone rather than hitting them.
   */
  private bump(a: SimCar, b: SimCar, events: StepEvents): void {
    const av = a.car.velocity;
    const bv = b.car.velocity;
    const closing = Math.hypot(av.x - bv.x, av.y - bv.y, av.z - bv.z);
    if (closing < cfg.car.bumpMinSpeed) return;

    const ap = a.car.position;
    const bp = b.car.position;
    const dx = bp.x - ap.x;
    const dy = bp.y - ap.y;
    const dz = bp.z - ap.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const push = Math.min(cfg.car.bumpMaxImpulse, closing * cfg.car.bumpImpulse);
    a.car.body.applyImpulse(
      { x: (-dx / len) * push, y: (-dy / len) * push * 0.3, z: (-dz / len) * push },
      true,
    );
    b.car.body.applyImpulse(
      { x: (dx / len) * push, y: (dy / len) * push * 0.3, z: (dz / len) * push },
      true,
    );
    events.carHits.push({
      a,
      b,
      closing,
      at: { x: (ap.x + bp.x) / 2, y: (ap.y + bp.y) / 2, z: (ap.z + bp.z) / 2 },
    });
  }
}

/**
 * Which kickoff spot each slot takes.
 *
 * Copied exactly from where this used to live. The order is not arbitrary --
 * it decides who starts on the ball and who starts wide -- so inventing a
 * plausible-looking one while moving the code would have quietly changed every
 * kickoff in the game.
 */
const SPAWN_ORDER = [4, 2, 3, 0, 1] as const;

export function spawnFor(team: 0 | 1, slot: number): Spawn {
  const spots = kickoffSpawns(team === 0 ? -1 : 1);
  return spots[SPAWN_ORDER[slot % SPAWN_ORDER.length]!]!;
}

export function spawnPosition(spawn: Spawn): { x: number; y: number; z: number } {
  return { x: spawn.x, z: spawn.z, y: cfg.car.hitbox.height / 2 + cfg.car.rideHeight };
}

/** Holds a body still, for the countdown and after full time. */
function freeze(body: RAPIER.RigidBody): void {
  const zero = { x: 0, y: 0, z: 0 };
  body.setLinvel(zero, false);
  body.setAngvel(zero, false);
}
