import * as THREE from 'three';

/**
 * One pooled point-sprite system for every effect: boost trails, impact bursts,
 * goal explosions, pad pickups.
 *
 * A fixed pool written into a single BufferGeometry, so the whole thing is one
 * draw call however much is going on, and emitting never allocates. Dead
 * particles are parked outside the view by setting their size to zero rather
 * than being removed, which keeps the buffers contiguous.
 */

const MAX = 1400;

interface Particle {
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  gravity: number;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly sizes: Float32Array;
  private readonly velocities: Float32Array;
  private readonly pool: Particle[] = [];
  private next = 0;

  private readonly geometry: THREE.BufferGeometry;

  constructor() {
    this.positions = new Float32Array(MAX * 3);
    this.colours = new Float32Array(MAX * 3);
    this.sizes = new Float32Array(MAX);
    this.velocities = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      this.pool.push({ life: 0, maxLife: 1, size: 0, drag: 0, gravity: 0 });
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    // Own shader rather than patching PointsMaterial: per-particle size needs a
    // vertex attribute, and reaching into three's shader to add one is both
    // opaque and liable to break when the built-in shader changes.
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: softDot() },
        /** viewportHeight / (2 * tan(fov/2)), so a size is in world units. */
        uScale: { value: 300 },
      },
      vertexShader: `
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColour;
        void main() {
          vColour = color;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          // Proper perspective falloff: a particle of a given world size keeps
          // that size on screen as the camera moves, which a hand-picked
          // constant does not.
          gl_PointSize = aSize * (uScale / max(1.0, -view.z));
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColour;
        void main() {
          vec4 dot = texture2D(uMap, gl_PointCoord);
          if (dot.a < 0.01) discard;
          gl_FragColor = vec4(vColour, dot.a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.material = material;
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /**
   * Emits one particle. `spread` scatters the velocity, `size` is in world
   * units. Oldest particles are overwritten once the pool is full, which for
   * effects reads as the trail simply being shorter under load.
   */
  emit(opts: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    colour: THREE.Color;
    size: number;
    life: number;
    spread?: number;
    drag?: number;
    gravity?: number;
  }): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;

    const spread = opts.spread ?? 0;
    const p = this.pool[i]!;
    p.life = opts.life;
    p.maxLife = opts.life;
    p.size = opts.size;
    p.drag = opts.drag ?? 1.2;
    p.gravity = opts.gravity ?? 0;

    const i3 = i * 3;
    this.positions[i3] = opts.position.x;
    this.positions[i3 + 1] = opts.position.y;
    this.positions[i3 + 2] = opts.position.z;
    this.velocities[i3] = opts.velocity.x + (Math.random() * 2 - 1) * spread;
    this.velocities[i3 + 1] = opts.velocity.y + (Math.random() * 2 - 1) * spread;
    this.velocities[i3 + 2] = opts.velocity.z + (Math.random() * 2 - 1) * spread;
    this.colours[i3] = opts.colour.r;
    this.colours[i3 + 1] = opts.colour.g;
    this.colours[i3 + 2] = opts.colour.b;
    this.sizes[i] = opts.size;
  }

  /** A burst of `count` particles from a point. */
  burst(
    position: { x: number; y: number; z: number },
    count: number,
    opts: { colour: THREE.Color; speed: number; size: number; life: number; gravity?: number },
  ): void {
    for (let i = 0; i < count; i++) {
      // Even-ish directions on a sphere.
      const theta = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - z * z);
      const speed = opts.speed * (0.4 + Math.random() * 0.6);
      this.emit({
        position,
        velocity: {
          x: Math.cos(theta) * r * speed,
          y: Math.abs(z) * speed * 0.8,
          z: Math.sin(theta) * r * speed,
        },
        colour: opts.colour,
        size: opts.size * (0.6 + Math.random() * 0.8),
        life: opts.life * (0.7 + Math.random() * 0.6),
        drag: 1.6,
        gravity: opts.gravity ?? -400,
      });
    }
  }

  update(dt: number): void {
    const pos = this.positions;
    const vel = this.velocities;
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i]!;
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.sizes[i] = 0;
        continue;
      }
      const i3 = i * 3;
      vel[i3 + 1]! += p.gravity * dt;
      const keep = Math.max(0, 1 - p.drag * dt);
      vel[i3]! *= keep;
      vel[i3 + 1] = vel[i3 + 1]! * keep;
      vel[i3 + 2] = vel[i3 + 2]! * keep;
      pos[i3] = pos[i3]! + vel[i3]! * dt;
      pos[i3 + 1] = pos[i3 + 1]! + vel[i3 + 1]! * dt;
      pos[i3 + 2] = pos[i3 + 2]! + vel[i3 + 2]! * dt;
      // Fade out by shrinking, which additive blending reads as dimming too.
      this.sizes[i] = p.size * (p.life / p.maxLife);
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.color!.needsUpdate = true;
    this.geometry.attributes.aSize!.needsUpdate = true;
  }

  /**
   * Keeps world sizes honest as the viewport and field of view change.
   * Called whenever either does.
   */
  setProjection(viewportHeight: number, fovDegrees: number): void {
    const halfFov = (fovDegrees * Math.PI) / 360;
    this.material.uniforms.uScale!.value = viewportHeight / (2 * Math.tan(halfFov));
  }

  /** Kills everything, for a kickoff or a restart. */
  clear(): void {
    for (const p of this.pool) p.life = 0;
    this.sizes.fill(0);
    this.geometry.attributes.aSize!.needsUpdate = true;
  }
}

/** A soft round dot, drawn once into a canvas rather than loaded as an asset. */
function softDot(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // A 2D context is not guaranteed: some environments have no canvas backend at
  // all. A flat dot is worse looking and still works, which beats throwing.
  if (!ctx) return flatDot();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Fallback for when there is no 2D canvas to draw into. */
function flatDot(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}
