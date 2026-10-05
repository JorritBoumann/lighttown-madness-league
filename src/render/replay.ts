import * as THREE from 'three';
import { cfg } from '../config';

/**
 * Goal replays.
 *
 * Records the last few seconds of everything that moves, and plays it back
 * from a camera that orbits the goal. It is a recording of transforms, not a
 * re-simulation: replaying by running the physics again would need the whole
 * world rewound exactly, and a single floating-point difference turns a goal
 * into a miss. Transforms always show what actually happened.
 *
 * Samples are taken on a fixed interval and played back by interpolating
 * between them, so the replay runs at the same speed and length however fast
 * the machine recorded it.
 */

export interface ReplayActor {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

/** One moment: every car, then the ball, packed flat. */
type Frame = Float32Array;

export class Replay {
  /** Ring buffer of frames, oldest first once it wraps. */
  private readonly frames: Frame[] = [];
  private readonly capacity: number;
  private write = 0;
  private filled = 0;
  private sinceSample = 0;

  /** Null when not playing; otherwise seconds into the replay. */
  private clock: number | null = null;
  /** Where the camera looks: where the ball ended up. */
  private readonly focus = new THREE.Vector3();
  private readonly fromQ = new THREE.Quaternion();
  private readonly toQ = new THREE.Quaternion();

  private actorCount = 0;

  constructor() {
    this.capacity = Math.max(2, Math.round(cfg.replay.seconds / cfg.replay.interval));
  }

  get playing(): boolean {
    return this.clock !== null;
  }

  /** Seconds of footage held, which is how long a replay will run. */
  get available(): number {
    return (this.filled - 1) * cfg.replay.interval;
  }

  /** Throws the recording away. Called at kickoff, so a replay never spans one. */
  reset(): void {
    this.filled = 0;
    this.write = 0;
    this.sinceSample = 0;
    this.clock = null;
  }

  /**
   * Records a moment, at most once per interval.
   *
   * Takes the live bodies rather than the interpolated meshes: the meshes lag
   * by design, and a replay should show where things were, not where they were
   * being drawn.
   */
  record(dt: number, actors: readonly ReplayActor[], ball: ReplayActor): void {
    if (this.clock !== null) return;

    // The lineup check comes before the interval gate, not after it. Rounds
    // have different numbers of opponents, and footage of four cars cannot be
    // played back against two — but below the gate this ran on only one call
    // in four, so a change could sit undetected for a sample interval.
    const count = actors.length + 1;
    if (count !== this.actorCount) {
      this.actorCount = count;
      this.filled = 0;
      this.write = 0;
      this.frames.length = 0;
      this.sinceSample = cfg.replay.interval;
    }

    this.sinceSample += dt;
    if (this.filled > 0 && this.sinceSample < cfg.replay.interval) return;
    this.sinceSample = 0;

    let frame = this.frames[this.write];
    if (!frame || frame.length !== count * 7) {
      frame = new Float32Array(count * 7);
      this.frames[this.write] = frame;
    }
    let i = 0;
    for (const actor of [...actors, ball]) {
      frame[i++] = actor.position.x;
      frame[i++] = actor.position.y;
      frame[i++] = actor.position.z;
      frame[i++] = actor.rotation.x;
      frame[i++] = actor.rotation.y;
      frame[i++] = actor.rotation.z;
      frame[i++] = actor.rotation.w;
    }

    this.write = (this.write + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
  }

  /** Starts playback. Returns false when there is not enough footage. */
  start(focus: { x: number; y: number; z: number }): boolean {
    if (this.filled < cfg.replay.minimumFrames) return false;
    this.clock = 0;
    this.focus.set(focus.x, focus.y, focus.z);
    return true;
  }

  stop(): void {
    this.clock = null;
  }

  /** Advances playback. Returns false once it has finished. */
  update(dt: number): boolean {
    if (this.clock === null) return false;
    this.clock += dt * cfg.replay.speed;
    if (this.clock >= this.available) {
      this.clock = null;
      return false;
    }
    return true;
  }

  /**
   * Writes the current moment into the given meshes.
   *
   * Interpolated between samples, or the replay plays back at the sample rate
   * and judders however smoothly it is being drawn.
   */
  apply(meshes: readonly THREE.Object3D[], ballMesh: THREE.Object3D): void {
    if (this.clock === null) return;
    const exact = this.clock / cfg.replay.interval;
    const index = Math.min(this.filled - 2, Math.max(0, Math.floor(exact)));
    const blend = Math.min(1, Math.max(0, exact - index));

    const a = this.frameAt(index);
    const b = this.frameAt(index + 1);
    if (!a || !b) return;

    const targets = [...meshes, ballMesh];
    for (let n = 0; n < targets.length && n < this.actorCount; n++) {
      const o = n * 7;
      const target = targets[n]!;
      target.position.set(
        a[o]! + (b[o]! - a[o]!) * blend,
        a[o + 1]! + (b[o + 1]! - a[o + 1]!) * blend,
        a[o + 2]! + (b[o + 2]! - a[o + 2]!) * blend,
      );
      this.fromQ.set(a[o + 3]!, a[o + 4]!, a[o + 5]!, a[o + 6]!);
      this.toQ.set(b[o + 3]!, b[o + 4]!, b[o + 5]!, b[o + 6]!);
      target.quaternion.copy(this.fromQ).slerp(this.toQ, blend);
    }
  }

  /**
   * Puts the camera on a slow arc around where the ball finished.
   *
   * Deliberately not the chase camera: a replay from the same angle as the
   * play is just the play again. Swinging round the goal is what makes it read
   * as a different look at the same thing.
   */
  frameCamera(camera: THREE.PerspectiveCamera, subject: THREE.Object3D): void {
    if (this.clock === null) return;
    const r = cfg.replay;
    const t = this.clock / Math.max(0.001, this.available);
    const angle = r.orbitFrom + (r.orbitTo - r.orbitFrom) * t;
    // Sweeps from the attacking side towards the goal's own side.
    const side = Math.sign(this.focus.x) || 1;
    camera.position.set(
      this.focus.x - side * Math.cos(angle) * r.orbitRadius,
      r.orbitHeight,
      this.focus.z + Math.sin(angle) * r.orbitRadius,
    );
    // Orbits the goal but looks at the ball where it is *now*, not where it
    // ended up. Pointing at the final position means the subject is off-screen
    // for most of the replay — the ball spends those seconds arriving.
    camera.lookAt(subject.position.x, subject.position.y + 60, subject.position.z);
    camera.updateProjectionMatrix();
  }

  private frameAt(index: number): Frame | undefined {
    if (index < 0 || index >= this.filled) return undefined;
    // Oldest sample first: the write head is the oldest slot once it wraps.
    const start = this.filled === this.capacity ? this.write : 0;
    return this.frames[(start + index) % this.capacity];
  }
}
