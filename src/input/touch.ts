import type { CarInput } from './types';
import { emptyInput } from './types';

/**
 * On-screen controls for touchscreens.
 *
 * A third source beside the keyboard and the pad, producing the same CarInput,
 * so nothing downstream knows a phone is involved. Before this, a touchscreen
 * could get through every menu and then could not drive at all.
 *
 * The stick floats: it appears wherever a thumb lands on the left half and
 * measures from there, rather than living in a fixed circle a thumb has to
 * find without looking. It maps exactly as W/A/S/D do -- up is throttle, side
 * to side steers, and in the air the same movement pitches and yaws -- so the
 * car handles the same however it is being driven.
 *
 * Every control tracks its own pointer by id. Steering with one thumb while
 * holding boost and tapping jump with the other is the normal way to play, and
 * a control that listened to "the touch" rather than its touch would let go
 * when an unrelated finger lifted.
 */

/** How far, in CSS pixels, the stick has to travel for full lock. */
const STICK_RADIUS = 56;
/** Below this fraction of full travel, the stick reads as centred. */
const DEAD_ZONE = 0.14;

export class TouchSource {
  /** True once a touchscreen has been used, or the device says it is one. */
  active = false;

  private readonly root: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly input: CarInput = emptyInput();

  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  /** Pointers holding each button down. A Set, because two fingers can. */
  private readonly held = { jump: new Set<number>(), boost: new Set<number>(), drift: new Set<number>() };
  /** Latched like the keyboard's, so a tap between steps is never missed. */
  private jumpLatched = false;
  private pauseLatched = false;
  private touchedThisFrame = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    // Inside the HUD layer, so it disappears with the HUD whenever a menu is
    // up and the menu's own buttons are what a finger should be pressing.
    this.root.className = 'hud-layer touch-layer';
    this.root.innerHTML = `
      <div class="touch-stick-zone" data-zone></div>
      <div class="touch-stick" data-base hidden><div class="touch-knob" data-knob></div></div>
      <button type="button" class="touch-btn touch-jump" data-btn="jump">Jump</button>
      <button type="button" class="touch-btn touch-boost" data-btn="boost">Boost</button>
      <button type="button" class="touch-btn touch-drift" data-btn="drift">Drift</button>
      <button type="button" class="touch-pause" data-pause aria-label="Pause">II</button>
      <div class="rotate-hint">Turn your phone sideways to play</div>`;
    parent.appendChild(this.root);

    this.stickBase = this.root.querySelector('[data-base]') as HTMLElement;
    this.stickKnob = this.root.querySelector('[data-knob]') as HTMLElement;
    const zone = this.root.querySelector('[data-zone]') as HTMLElement;

    zone.addEventListener('pointerdown', this.onStickDown);
    window.addEventListener('pointermove', this.onStickMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    for (const el of this.root.querySelectorAll<HTMLElement>('[data-btn]')) {
      const name = el.dataset.btn as 'jump' | 'boost' | 'drift';
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // The press first, the capture after, and a failed capture does not
        // undo the press. Capture keeps the button held when a thumb slides
        // off its edge, which is nice to have; recording the press is the
        // whole point, and capture throws for a pointer the browser no longer
        // considers active -- it had been ordered first, so a throw there
        // lost the press entirely.
        this.held[name].add(e.pointerId);
        if (name === 'jump') this.jumpLatched = true;
        el.classList.add('down');
        this.touchedThisFrame = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Not capturable; the press stands regardless.
        }
      });
      const release = (e: PointerEvent): void => this.release(e.pointerId);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    }

    const pause = this.root.querySelector('[data-pause]') as HTMLElement;
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pauseLatched = true;
      this.touchedThisFrame = true;
    });

    // Shown the moment a finger touches the screen anywhere, and up front on a
    // device that says its pointer is a finger. A laptop with a touchscreen
    // shows them the first time it is touched, and not before.
    window.addEventListener('pointerdown', this.onAnyDown);
    if (window.matchMedia?.('(pointer: coarse)').matches) this.activate();
  }

  /** Takes the controls off the page, for tests and for a torn-down game. */
  destroy(): void {
    window.removeEventListener('pointermove', this.onStickMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('pointerdown', this.onAnyDown);
    this.root.remove();
    document.body.classList.remove('touch');
  }

  private onAnyDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.activate();
  };

  /**
   * A finger lifted anywhere lets go of whatever it held.
   *
   * The buttons hear their own pointerup, but only while the finger is over
   * them or captured by them; a thumb that slid off a button whose capture
   * failed would otherwise leave it held down for good.
   */
  private onPointerUp = (e: PointerEvent): void => {
    this.release(e.pointerId);
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stick = { x: 0, y: 0 };
    this.stickBase.hidden = true;
  };

  private release(pointerId: number): void {
    for (const name of ['jump', 'boost', 'drift'] as const) {
      if (!this.held[name].delete(pointerId)) continue;
      if (this.held[name].size === 0) {
        this.root.querySelector(`[data-btn="${name}"]`)?.classList.remove('down');
      }
    }
  }

  private activate(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
  }

  private onStickDown = (e: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stick = { x: 0, y: 0 };
    this.stickBase.style.left = `${e.clientX}px`;
    this.stickBase.style.top = `${e.clientY}px`;
    this.stickBase.hidden = false;
    this.placeKnob(0, 0);
    this.touchedThisFrame = true;
  };

  private onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.placeKnob(dx, dy);
    // Screen y runs down; throttle runs up.
    this.stick = { x: dx / STICK_RADIUS, y: -dy / STICK_RADIUS };
  };

  private placeKnob(dx: number, dy: number): void {
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** This step's input, or null when no touch control has been used. */
  read(): CarInput | null {
    if (!this.active) return null;
    const i = this.input;
    i.steer = shape(this.stick.x);
    i.throttle = shape(this.stick.y);
    // As the keyboard does: one movement steers on the ground and turns in
    // the air, so learning the car once is enough.
    i.pitch = i.throttle;
    i.roll = 0;
    i.jumpPressed = this.jumpLatched;
    this.jumpLatched = false;
    i.jumpHeld = this.held.jump.size > 0;
    i.boost = this.held.boost.size > 0;
    i.drift = this.held.drift.size > 0;
    return i;
  }

  /** The on-screen pause button, once per press. */
  takePause(): boolean {
    const was = this.pauseLatched;
    this.pauseLatched = false;
    return was;
  }

  get anyPressed(): boolean {
    return this.touchedThisFrame;
  }

  endFrame(): void {
    this.touchedThisFrame = false;
  }
}

/**
 * Dead zone, then rescaled so the first movement past it is a small input
 * rather than a jump straight to fourteen percent.
 */
function shape(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD_ZONE) / (1 - DEAD_ZONE));
}
