import * as THREE from 'three';

/**
 * A tapering streak that follows something moving fast.
 *
 * Used for the ball's trail and for a supersonic car. Built as a camera-facing
 * ribbon from a ring buffer of recent positions rather than a line, because a
 * line has no width to taper and reads as a wire; the taper from full width at
 * the head to nothing at the tail is most of what makes it look like motion
 * rather than a rope being dragged.
 *
 * Geometry is allocated once and rewritten in place. A trail that rebuilds its
 * buffers every frame is a lot of garbage for something on screen constantly.
 */
export interface RibbonOptions {
  /** How many samples the tail remembers. */
  segments: number;
  /** Half-width at the head, in world units. */
  width: number;
  colour: THREE.Color;
  /**
   * Seconds between samples.
   *
   * Time, not distance. Sampling on distance ties the trail to the frame rate
   * twice over: a threshold large enough to avoid degenerate segments stops a
   * fast object recording anything at all on a high refresh rate — at 120fps a
   * ball at full speed moves 21 units a frame, which never cleared a 26 unit
   * step, so the trail simply never appeared — and where it does work the
   * trail ends up longer on a slow machine than a fast one. On a fixed
   * interval the tail is the same length in seconds everywhere.
   */
  sampleInterval: number;
  /** A jump further than this is a teleport, not motion: the trail breaks
   *  rather than drawing a streak across the pitch. */
  teleport: number;
}

export class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  /** Recent head positions, newest last. */
  private readonly history: THREE.Vector3[] = [];
  private readonly opts: RibbonOptions;
  /** Time since the last sample was committed. */
  private sinceSample = 0;

  private readonly head = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor(opts: RibbonOptions) {
    this.opts = opts;
    const verts = opts.segments * 2;
    this.positions = new Float32Array(verts * 3);
    this.colours = new Float32Array(verts * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));

    // Two triangles per pair of samples, wound once up front.
    const indices: number[] = [];
    for (let i = 0; i < opts.segments - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    // The head moves every frame and the geometry is in world space, so there
    // is no meaningful bounding volume to cull against.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Drops the tail. Call on a reset, or the trail stretches across the pitch. */
  clear(): void {
    this.history.length = 0;
    this.sinceSample = 0;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /**
   * `strength` from 0 to 1 scales width and brightness: it is how the trail
   * fades in with speed instead of snapping on at a threshold.
   */
  update(
    dt: number,
    at: { x: number; y: number; z: number },
    camera: THREE.Camera,
    strength: number,
  ): void {
    const o = this.opts;
    this.sinceSample += dt;
    if (strength <= 0.001) {
      // Let the tail run out rather than vanishing mid-air.
      if (this.history.length > 0) this.history.shift();
      if (this.history.length < 2) {
        this.clear();
        return;
      }
    } else {
      this.head.set(at.x, at.y, at.z);
      const last = this.history[this.history.length - 1];
      if (!last) {
        this.history.push(this.head.clone());
        this.sinceSample = 0;
      } else if (last.distanceTo(this.head) > o.teleport) {
        // A jump this big is a kickoff, not a shot.
        this.clear();
        this.history.push(this.head.clone());
      } else if (this.sinceSample >= o.sampleInterval) {
        this.history.push(this.head.clone());
        this.sinceSample = 0;
      } else {
        // Between samples the newest point stays glued to the object, so the
        // head of the trail never lags behind what it is following.
        last.copy(this.head);
      }
      while (this.history.length > o.segments) this.history.shift();
    }

    const count = this.history.length;
    if (count < 2) {
      this.mesh.visible = false;
      return;
    }

    camera.getWorldPosition(this.toCamera);
    for (let i = 0; i < count; i++) {
      const point = this.history[i]!;
      const prev = this.history[Math.max(0, i - 1)]!;
      const next = this.history[Math.min(count - 1, i + 1)]!;
      this.dir.subVectors(next, prev);
      if (this.dir.lengthSq() < 1e-8) this.dir.set(1, 0, 0);
      this.dir.normalize();

      // Face the camera: the ribbon's width is across the view, not across
      // some fixed axis, so it never turns edge-on and disappears.
      this.side.subVectors(this.toCamera, point).normalize().cross(this.dir).normalize();

      // Newest sample is full width, oldest is a point.
      const t = i / (count - 1);
      const half = o.width * t * strength;
      const i6 = i * 6;
      this.positions[i6] = point.x + this.side.x * half;
      this.positions[i6 + 1] = point.y + this.side.y * half;
      this.positions[i6 + 2] = point.z + this.side.z * half;
      this.positions[i6 + 3] = point.x - this.side.x * half;
      this.positions[i6 + 4] = point.y - this.side.y * half;
      this.positions[i6 + 5] = point.z - this.side.z * half;

      // Brightness fades towards the tail on a curve, which keeps the head
      // hot rather than making the whole streak uniformly dim.
      const fade = t * t * strength;
      for (const v of [0, 3]) {
        this.colours[i6 + v] = o.colour.r * fade;
        this.colours[i6 + v + 1] = o.colour.g * fade;
        this.colours[i6 + v + 2] = o.colour.b * fade;
      }
    }

    const geometry = this.mesh.geometry;
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
    geometry.setDrawRange(0, Math.max(0, (count - 1) * 6));
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
