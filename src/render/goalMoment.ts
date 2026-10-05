import * as THREE from 'three';
import { cfg } from '../config';
import type { Particles } from './particles';
import type { Stadium } from './stadium';

/**
 * The goal celebration.
 *
 * Scoring was a number changing: a camera kick, one burst of particles, and a
 * two and a half second wait for the next kickoff. The scoreline is the whole
 * point of the game, and it was the least dramatic thing in it.
 *
 * Everything here is choreography over the pause the match already takes, and
 * it is all driven off one clock so the pieces cannot drift out of step. The
 * ordering matters more than any single effect: the hit lands, time stops dead
 * for a beat, then releases — a flash and a bang with no pause in front of it
 * reads as a glitch rather than an impact.
 */

export interface GoalMomentTargets {
  scene: THREE.Scene;
  particles: Particles;
  stadium: Stadium;
}

interface Flare {
  material: THREE.MeshStandardMaterial;
  base: number;
}

export class GoalMoment {
  /** Seconds since the goal; null when nothing is happening. */
  private clock: number | null = null;
  private arena: THREE.Group | null = null;

  /** The expanding ring, parked out of sight until it is needed. */
  private readonly shockwave: THREE.Mesh;
  private readonly shockMaterial: THREE.MeshBasicMaterial;

  /** The net being bulged, and its geometry at rest. */
  private net: THREE.Mesh | null = null;
  private netRest: Float32Array | null = null;
  private readonly hit = new THREE.Vector3();

  private flares: Flare[] = [];
  private mouths: { material: THREE.MeshBasicMaterial; base: number }[] = [];

  constructor(private readonly targets: GoalMomentTargets) {
    this.shockMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    // A flat annulus, scaled rather than rebuilt: a ring whose geometry is
    // regenerated every frame is a lot of churn for an effect that lasts half
    // a second.
    this.shockwave = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), this.shockMaterial);
    this.shockwave.visible = false;
    targets.scene.add(this.shockwave);
  }

  /**
   * Points the celebration at a freshly built arena.
   *
   * The arena is rebuilt whenever a round changes the goals, which throws away
   * the nets and materials this holds. Without this the first goal after a
   * modifier round would animate a disposed net.
   */
  setArena(arena: THREE.Group): void {
    this.arena = arena;
    this.net = null;
    this.netRest = null;
    this.flares = [];
    this.mouths = [];

    arena.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material;
      if (material?.name?.startsWith('goal-surround')) {
        const standard = material as THREE.MeshStandardMaterial;
        const base = (standard.userData.baseEmissive as number) ?? standard.emissiveIntensity;
        if (!this.flares.some((f) => f.material === standard)) {
          this.flares.push({ material: standard, base });
        }
      }
      if (mesh.name.startsWith('goal-mouth')) {
        const basic = mesh.material as THREE.MeshBasicMaterial;
        this.mouths.push({ material: basic, base: (basic.userData.baseOpacity as number) ?? 0.16 });
      }
    });
  }

  /**
   * How fast the world should run. 1 is normal.
   *
   * A dead stop on contact, then a ramp back up. The stop is what sells the
   * hit; the ramp is what stops the return to normal speed feeling like a
   * dropped frame.
   */
  get timeScale(): number {
    const g = cfg.goal;
    if (this.clock === null) return 1;
    if (this.clock < g.hitstop) return g.hitstopScale;
    const t = (this.clock - g.hitstop) / g.slowMotion;
    if (t >= 1) return 1;
    return g.hitstopScale + (1 - g.hitstopScale) * t * t;
  }

  trigger(at: { x: number; y: number; z: number }, sign: 1 | -1, colour: THREE.Color): void {
    const g = cfg.goal;
    this.clock = 0;
    this.hit.set(at.x, at.y, at.z);

    // The net to bulge, and its shape at rest so it can be put back.
    const net = this.arena?.getObjectByName(`net-back-${sign}`) as THREE.Mesh | undefined;
    if (net) {
      this.net = net;
      const position = net.geometry.getAttribute('position');
      if (!this.netRest || this.netRest.length !== position.array.length) {
        this.netRest = Float32Array.from(position.array as Float32Array);
      }
    }

    // The ring sits in the plane of the goal mouth, facing down the pitch.
    this.shockwave.position.set(cfg.arena.goalLine * sign, Math.max(120, at.y), 0);
    this.shockwave.rotation.set(0, sign > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    this.shockwave.visible = true;
    this.shockMaterial.color.copy(colour).lerp(new THREE.Color(0xffffff), 0.45);

    // Two waves rather than one. A single burst of one colour reads as a puff;
    // a fast white wave with the team colour following behind it reads as an
    // impact that threw something.
    this.targets.particles.burst(at, g.sparkCount, {
      colour: new THREE.Color(0xffffff),
      speed: 2600,
      size: 26,
      life: 0.45,
      gravity: -200,
    });
    this.targets.particles.burst(at, g.emberCount, {
      colour,
      speed: 1500,
      size: 46,
      life: 1.5,
      gravity: -620,
    });

    this.targets.stadium.celebrate(g.crowdSeconds);
  }

  update(dt: number): void {
    if (this.clock === null) return;
    const g = cfg.goal;
    this.clock += dt;

    const ringT = Math.min(1, this.clock / g.ringSeconds);
    if (ringT < 1) {
      const radius = g.ringRadius * ringT;
      this.shockwave.scale.setScalar(Math.max(1, radius));
      // Fades as it grows, so it reads as energy spreading out rather than a
      // hoop being pushed down the pitch.
      this.shockMaterial.opacity = (1 - ringT) ** 2 * g.ringOpacity;
    } else {
      this.shockwave.visible = false;
      this.shockMaterial.opacity = 0;
    }

    // The net takes the ball, snaps back, and rings a couple of times.
    if (this.net && this.netRest) {
      const netT = this.clock / g.netSeconds;
      const position = this.net.geometry.getAttribute('position');
      const array = position.array as Float32Array;
      if (netT >= 1) {
        array.set(this.netRest);
        position.needsUpdate = true;
        this.net.geometry.computeVertexNormals();
        this.net = null;
      } else {
        // A decaying ring rather than a single push: a net that bulges and
        // stops looks like a sheet of rubber.
        const amplitude =
          g.netBulge * Math.exp(-netT * g.netDamping) * Math.cos(netT * g.netRinging);
        // The net plane is built in its own local x/y, so the bulge is applied
        // along local z and falls off from the point the ball went through.
        const local = this.net.worldToLocal(this.hit.clone());
        for (let i = 0; i < array.length; i += 3) {
          const dx = this.netRest[i]! - local.x;
          const dy = this.netRest[i + 1]! - local.y;
          const falloff = Math.exp(-(dx * dx + dy * dy) / (2 * g.netSpread * g.netSpread));
          array[i + 2] = this.netRest[i + 2]! + amplitude * falloff;
        }
        position.needsUpdate = true;
        this.net.geometry.computeVertexNormals();
      }
    }

    // The frame flares; the mouth glow steps aside.
    const flareT = Math.min(1, this.clock / g.flareSeconds);
    const flare = (1 - flareT) ** 2;
    for (const f of this.flares) {
      f.material.emissiveIntensity = f.base + flare * g.flareStrength;
    }
    for (const m of this.mouths) {
      // Towards clear at the peak, back to normal as the flare decays.
      m.material.opacity = m.base * (1 - flare * (1 - g.mouthClear));
    }

    if (this.clock > g.totalSeconds) {
      this.clock = null;
      for (const f of this.flares) f.material.emissiveIntensity = f.base;
      for (const m of this.mouths) m.material.opacity = m.base;
      this.shockwave.visible = false;
    }
  }
}
