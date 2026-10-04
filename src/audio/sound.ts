import { cfg } from '../config';

/**
 * Sound, synthesised with Web Audio rather than loaded from files.
 *
 * No assets to ship, and every sound can scale with what caused it: a hit at
 * 2000uu/s is a different noise from a nudge, which one fixed sample cannot do.
 *
 * Browsers will not start an AudioContext without a gesture, so it is created
 * lazily on the first `unlock()` and the title screen's keypress provides that.
 * Everything no-ops before then and after a failure, because a game that throws
 * because audio is unavailable is worse than a quiet one.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private failed = false;

  /** Boost thrust is sustained, so it is held open rather than triggered. */
  private boostSource: AudioBufferSourceNode | null = null;
  private boostGain: GainNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;

  muted = false;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx || this.failed) {
      void this.ctx?.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = cfg.audio.master;
      this.master.connect(this.ctx.destination);
      this.noise = makeNoise(this.ctx);
    } catch {
      this.failed = true;
    }
  }

  get ready(): boolean {
    return this.ctx !== null && !this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : cfg.audio.master;
    if (this.muted) this.stopBoost();
    return this.muted;
  }

  // --- one-shots ----------------------------------------------------------

  /** Car on ball. `speed` is the closing speed: it sets weight and pitch. */
  hit(speed: number): void {
    if (!this.ctx || this.muted) return;
    const strength = Math.min(1, speed / 2000);
    this.thump(60 + strength * 70, 0.16, 0.35 + strength * 0.5);
    this.crack(0.05 + strength * 0.06, 900 + strength * 2600, 0.2 + strength * 0.5);
  }

  goal(forPlayer: boolean): void {
    if (!this.ctx || this.muted) return;
    // Rising for one scored, falling for one conceded.
    const notes = forPlayer ? [440, 554, 659, 880] : [440, 370, 294];
    for (const [i, freq] of notes.entries()) this.tone(freq, 0.18, 0.3, i * 0.075, 'triangle');
  }

  jump(): void {
    this.tone(520, 0.07, 0.16, 0, 'square', 820);
  }

  dodge(): void {
    this.crack(0.09, 1400, 0.22);
  }

  pad(big: boolean): void {
    this.tone(big ? 760 : 1040, big ? 0.16 : 0.09, big ? 0.22 : 0.13, 0, 'sine', big ? 1180 : 1500);
  }

  countdown(step: number): void {
    this.tone(step <= 0 ? 880 : 440, 0.12, 0.22, 0, 'triangle');
  }

  supersonic(): void {
    this.crack(0.3, 600, 0.12);
  }

  menuMove(): void {
    this.tone(660, 0.04, 0.08, 0, 'square');
  }

  menuSelect(): void {
    this.tone(880, 0.09, 0.14, 0, 'triangle', 1100);
  }

  // --- sustained boost ----------------------------------------------------

  /** `intensity` 0 to 1. Zero stops it. */
  setBoost(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    if (intensity <= 0.001) {
      this.stopBoost();
      return;
    }
    if (!this.boostSource) {
      if (!this.noise || !this.master) return;
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.boostSource = source;
      this.boostFilter = filter;
      this.boostGain = gain;
    }
    const now = ctx.currentTime;
    this.boostGain?.gain.setTargetAtTime(cfg.audio.boost * intensity, now, 0.04);
    this.boostFilter?.frequency.setTargetAtTime(420 + intensity * 420, now, 0.08);
  }

  private stopBoost(): void {
    if (!this.boostSource || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.boostGain?.gain.setTargetAtTime(0, now, 0.05);
    const source = this.boostSource;
    const gain = this.boostGain;
    this.boostSource = null;
    this.boostGain = null;
    this.boostFilter = null;
    // Let the fade finish before tearing the nodes down.
    setTimeout(() => {
      try {
        source.stop();
        gain?.disconnect();
      } catch {
        // Already stopped; nothing to do.
      }
    }, 250);
  }

  // --- primitives ---------------------------------------------------------

  private tone(
    freq: number,
    duration: number,
    gainValue: number,
    delay = 0,
    type: OscillatorType = 'sine',
    glideTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo !== undefined) osc.frequency.linearRampToValueAtTime(glideTo, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainValue, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private thump(freq: number, duration: number, gainValue: number): void {
    this.tone(freq, duration, gainValue, 0, 'sine', freq * 0.45);
  }

  private crack(duration: number, cutoff: number, gainValue: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = cutoff * 0.35;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(cutoff, start);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.2), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(highpass).connect(lowpass).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}

/** A second of white noise, reused by every noise-based sound. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
