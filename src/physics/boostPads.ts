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

  constructor() {
    this.pads = boostPadLayout().map((p) => ({ x: p.pos.x, z: p.pos.z, big: p.big, cooldown: 0 }));
  }

  update(dt: number, cars: Car[]): void {
    this.justPicked.length = 0;
    const radius = cfg.boost.padRadius;
    for (const pad of this.pads) {
      if (pad.cooldown > 0) {
        pad.cooldown = Math.max(0, pad.cooldown - dt);
        continue;
      }
      for (const car of cars) {
        const p = car.position;
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
