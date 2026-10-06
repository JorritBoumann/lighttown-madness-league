import type { Car } from '../physics/car';

const CIRC = 2 * Math.PI * 52;

export class Hud {
  private readonly root: HTMLElement;
  private readonly boostArc: SVGCircleElement;
  private readonly boostValue: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly help: HTMLElement;
  private device: 'keyboard' | 'gamepad' | null = null;
  private readonly flags: Record<string, HTMLElement> = {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-layer';
    this.root.innerHTML = `
      <div class="hud-help" data-help></div>
      <div class="hud-flags">
        <i data-flag="ground">Ground</i>
        <i data-flag="boost">Boost</i>
        <i data-flag="flip">Flip ready</i>
        <i data-flag="ballcam">Ball cam</i>
      </div>
      <div class="hud-speed">
        <b data-speed>0</b> <span>uu/s</span>
      </div>
      <div class="hud-boost">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.12)" stroke-width="8"/>
          <circle data-arc cx="60" cy="60" r="52" fill="none" stroke="#ffc14d" stroke-width="8"
                  stroke-linecap="round" transform="rotate(-90 60 60)"
                  stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
        </svg>
        <div class="hud-boost-value" data-boost>0</div>
      </div>`;
    parent.appendChild(this.root);

    this.boostArc = this.root.querySelector('[data-arc]') as SVGCircleElement;
    this.boostValue = this.root.querySelector('[data-boost]') as HTMLElement;
    this.speedValue = this.root.querySelector('[data-speed]') as HTMLElement;
    this.help = this.root.querySelector('[data-help]') as HTMLElement;
    this.setDevice('keyboard');
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-flag]')) {
      this.flags[el.dataset.flag as string] = el;
    }
  }

  /**
   * Swaps the controls reminder for whichever device is in use. Showing keyboard
   * hints to someone holding a pad is worse than showing nothing.
   */
  setDevice(device: 'keyboard' | 'gamepad'): void {
    if (device === this.device) return;
    this.device = device;
    this.help.innerHTML =
      device === 'gamepad'
        ? `<div><kbd>RT</kbd>/<kbd>LT</kbd> drive &middot; <kbd>L stick</kbd> steer, pitch in air</div>
           <div><kbd>A</kbd> jump (hold for height, tap again to flip) &middot; <kbd>B</kbd> boost</div>
           <div><kbd>LB</kbd>/<kbd>RB</kbd> air roll &middot; <kbd>X</kbd> powerslide &middot; <kbd>Y</kbd> ball cam &middot; <kbd>Start</kbd> pause</div>`
        : `<div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive &middot; in air: <kbd>W</kbd>/<kbd>S</kbd> pitch, <kbd>A</kbd>/<kbd>D</kbd> yaw</div>
           <div><kbd>Space</kbd> jump (hold for height, tap again to flip) &middot; <kbd>Shift</kbd> boost</div>
           <div><kbd>Q</kbd>/<kbd>E</kbd> air roll &middot; <kbd>C</kbd> powerslide &middot; <kbd>T</kbd> ball cam &middot; <kbd>M</kbd> mute &middot; <kbd>P</kbd> tuning &middot; <kbd>Esc</kbd> pause</div>`;
  }

  update(car: Car, ballCam: boolean): void {
    const frac = Math.max(0, Math.min(1, car.boostFraction));
    this.boostArc.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
    this.boostValue.textContent = String(Math.round(car.boost));

    // Shown in uu/s, the unit everything about Rocket League handling is quoted
    // in: 1410 is the throttle ceiling, 2200 is supersonic, 2300 is the cap.
    this.speedValue.textContent = String(Math.round(car.speed));
    this.speedValue.classList.toggle('supersonic', car.isSupersonic);

    this.setFlag('ground', car.grounded);
    this.setFlag('boost', car.input.boost && car.boost > 0);
    this.setFlag('flip', car.canDoubleJump);
    this.setFlag('ballcam', ballCam);
  }

  /**
   * The room code, kept on screen while playing online.
   *
   * It is the thing you read out to someone who wants to join, and asking them
   * to dig through a menu for it mid-match is asking them not to bother.
   */
  showRoom(code: string): void {
    let chip = this.root.querySelector<HTMLElement>('.hud-room');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'hud-room';
      this.root.appendChild(chip);
    }
    chip.textContent = `Room ${code}`;
  }

  private setFlag(name: string, on: boolean): void {
    this.flags[name]?.classList.toggle('on', on);
  }
}


