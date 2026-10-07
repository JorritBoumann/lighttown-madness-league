import { cfg } from '../config';
import { boostPadLayout } from '../core/arenaLayout';
import type { Car } from './car';

export interface BoostPad {
  x: number;
  z: number;
  big: boolean;
  /** Seconds until this pad is live again; 0 means available. */
  cooldown: number;
}

/**
 * Pads are proximity checks rather than colliders: cheap, and it keeps pickup
 * generous enough to feel good at speed.
 */
export class BoostPads {
  readonly pads: BoostPad[];
  /** Pads picked up since the last drain, for the renderer and sound. */
  readonly justPicked: { pad: BoostPad; car: Car }[] = [];
  /** Each car's position, read once per update; see update(). */
  private readonly where: { x: number; y: number; z: number }[] = [];

  constructor() {
    this.pads = boostPadLayout().map((p) => ({ x: p.pos.x, z: p.pos.z, big: p.big, cooldown: 0 }));
  }

  update(dt: number, cars: Car[]): void {
    this.justPicked.length = 0;
    const radius = cfg.boost.padRadius;
    // Read once per step, not once per pad. A car's position comes out of the
    // physics engine's WebAssembly as a new object on every read, and asking
    // for it inside this loop did that for every pad and every car -- 136
    // times a step for a full pitch, a tenth of the server's step time spent
    // finding out that nobody was near a pad.
    const where = this.where;
    where.length = cars.length;
    for (let i = 0; i < cars.length; i++) where[i] = cars[i]!.position;
    for (const pad of this.pads) {
      if (pad.cooldown > 0) {
        pad.cooldown = Math.max(0, pad.cooldown - dt);
        continue;
      }
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        const p = where[i]!;
        // Only count pickups near the floor, so flying overhead does not collect.
        if (p.y > cfg.boost.padHeight) continue;
        const dx = p.x - pad.x;
        const dz = p.z - pad.z;
        if (dx * dx + dz * dz > radius * radius) continue;
        const full = cfg.boost.max * car.mods.boostMax;
        if (car.boost >= full - 0.001) continue;
        const amount = pad.big ? cfg.boost.bigPadAmount : cfg.boost.smallPadAmount;
        car.addBoost(amount * car.mods.padYield);
        pad.cooldown = pad.big ? cfg.boost.bigPadRespawn : cfg.boost.smallPadRespawn;
        this.justPicked.push({ pad, car });
        break;
      }
    }
  }

  resetAll(): void {
    for (const pad of this.pads) pad.cooldown = 0;
  }
}
