import type { ArenaLayout } from '../core/arenaLayout';
import type { BoostPad } from '../physics/boostPads';
import { cfg } from '../config';

/**
 * The radar.
 *
 * A top-down plan of the arena in the corner of the screen, showing where the
 * ball and every car is. Rocket League is played at a speed where the thing
 * you most often lack is not skill but information: the ball leaves the frame
 * constantly, and a bot behind you is invisible until it hits you.
 *
 * Two departures from a flat shooter radar, both because this game has a third
 * dimension that matters. Height is drawn as a ring that grows with altitude,
 * so a ball above you reads differently from a ball in front of you; and a car
 * that is off the floor gets the same ring, which is how you tell a bot driving
 * at you from one coming down off the wall.
 *
 * Orientation is fixed with the attacking goal at the top rather than rotating
 * with the player. A rotating radar is right in a shooter, where there is no
 * privileged direction; here there are exactly two directions that matter and
 * swapping which one is up every time the car turns round would make the one
 * useful fact harder to read, not easier.
 */

export interface RadarCar {
  x: number;
  z: number;
  y: number;
  /** World-space nose direction; only x and z are used. */
  fwdX: number;
  fwdZ: number;
  team: 0 | 1;
  isPlayer: boolean;
}

export interface RadarState {
  layout: ArenaLayout;
  cars: RadarCar[];
  ball: { x: number; y: number; z: number };
  pads: BoostPad[];
}

const TEAM_FILL = ['#5bc8ff', '#ff8a52'] as const;

export class Radar {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-radar';
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    parent.appendChild(this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  update(state: RadarState): void {
    const rect = this.root.getBoundingClientRect();
    if (rect.width < 1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.width !== rect.width || this.height !== rect.height) {
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const L = state.layout;
    const pad = 8;
    // World +x is up the screen, towards the goal the player attacks; world +z
    // is to the right. The pitch is longer than it is wide, so that puts the
    // long axis up the panel.
    const usableW = this.width - pad * 2;
    const usableH = this.height - pad * 2;
    const scale = Math.min(usableW / (L.halfWidth * 2), usableH / (L.halfLength * 2));
    const cx = this.width / 2;
    const cy = this.height / 2;
    const sx = (z: number) => cx + z * scale;
    const sy = (x: number) => cy - x * scale;

    // The arena footprint, corners cut the way the real one is.
    const hl = L.halfLength;
    const hw = L.halfWidth;
    const cut = L.cornerCut;
    ctx.beginPath();
    const corners: [number, number][] = [
      [hl, hw - cut],
      [hl - cut, hw],
      [-(hl - cut), hw],
      [-hl, hw - cut],
      [-hl, -(hw - cut)],
      [-(hl - cut), -hw],
      [hl - cut, -hw],
      [hl, -(hw - cut)],
    ];
    corners.forEach(([x, z], i) => {
      const px = sx(z);
      const py = sy(x);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 16, 26, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 215, 245, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Halfway line and centre circle, so distances read at a glance.
    ctx.strokeStyle = 'rgba(190, 215, 245, 0.16)';
    ctx.beginPath();
    ctx.moveTo(sx(-hw), sy(0));
    ctx.lineTo(sx(hw), sy(0));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 900 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Goals. The one being attacked is at the top.
    for (const goal of L.goals) {
      const half = (goal.width / 2) * scale;
      ctx.strokeStyle = goal.sign > 0 ? TEAM_FILL[1] : TEAM_FILL[0];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - half, sy(goal.sign * hl));
      ctx.lineTo(cx + half, sy(goal.sign * hl));
      ctx.stroke();
    }

    // Big pads only. Every pad on here is clutter at this size, and the small
    // ones are not worth crossing the pitch for anyway.
    for (const p of state.pads) {
      if (!p.big) continue;
      ctx.beginPath();
      ctx.arc(sx(p.z), sy(p.x), 2, 0, Math.PI * 2);
      ctx.fillStyle = p.cooldown > 0 ? 'rgba(255, 193, 77, 0.2)' : 'rgba(255, 193, 77, 0.75)';
      ctx.fill();
    }

    // The ball, with its height as a ring.
    const bx = sx(state.ball.z);
    const by = sy(state.ball.x);
    const airborne = Math.max(0, state.ball.y - cfg.ball.radius - 20);
    if (airborne > 60) {
      ctx.beginPath();
      ctx.arc(bx, by, 4 + Math.min(1, airborne / cfg.arena.ceiling) * 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Cars, as arrowheads pointing where the nose points.
    for (const car of state.cars) {
      const px = sx(car.z);
      const py = sy(car.x);
      const high = Math.max(0, car.y - 60);
      if (high > 80) {
        ctx.beginPath();
        ctx.arc(px, py, 4 + Math.min(1, high / cfg.arena.ceiling) * 8, 0, Math.PI * 2);
        ctx.strokeStyle = car.isPlayer ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // The heading in screen terms: world +x is up, world +z is right.
      // Canvas y runs downwards, so a positive rotation turns clockwise on
      // screen. With +x drawn upwards and +z to the right, that means the
      // heading angle goes in unnegated: a car facing +x keeps the arrow
      // pointing up, and one facing +z swings it to the right.
      const angle = Math.atan2(car.fwdZ, car.fwdX);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = TEAM_FILL[car.team];
      ctx.fill();
      if (car.isPlayer) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
