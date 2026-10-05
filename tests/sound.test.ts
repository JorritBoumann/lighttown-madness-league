// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Sound } from '../src/audio/sound';

/**
 * Sound safety.
 *
 * jsdom has no Web Audio, which makes this exactly the environment the guards
 * exist for: browsers refuse to start an AudioContext without a gesture, so
 * every sound has to be a no-op until one arrives and after any failure. A game
 * that throws because audio is unavailable is worse than a quiet one, and the
 * failure would land on the first goal of a run rather than at boot.
 */

/** Every one-shot, so a new sound cannot be added without a guard. */
function fireEverything(sound: Sound): void {
  sound.hit(1800);
  sound.goal(true);
  sound.goal(false);
  sound.crowd(1);
  sound.crowd(0);
  sound.timeDilation(true);
  sound.timeDilation(false);
  sound.replaySting(true);
  sound.replaySting(false);
  sound.jump();
  sound.dodge();
  sound.pad(true);
  sound.pad(false);
  sound.countdown(3);
  sound.countdown(0);
  sound.supersonic();
  sound.menuMove();
  sound.menuSelect();
  sound.setBoost(0.7);
  sound.setBoost(0);
}

describe('sound', () => {
  it('is silent rather than broken before anything has unlocked it', () => {
    const sound = new Sound();
    expect(() => fireEverything(sound)).not.toThrow();
  });

  it('survives an environment with no Web Audio at all', () => {
    // unlock() is called from the title screen's first keypress. Here there is
    // no AudioContext to create, which is the case this has to shrug off.
    const sound = new Sound();
    expect(() => sound.unlock()).not.toThrow();
    expect(() => fireEverything(sound)).not.toThrow();
  });

  it('stays quiet when muted', () => {
    const sound = new Sound();
    sound.unlock();
    const muted = sound.toggleMute();
    expect(muted).toBe(true);
    expect(sound.muted).toBe(true);
    expect(() => fireEverything(sound)).not.toThrow();
  });

  it('can be unmuted again', () => {
    const sound = new Sound();
    sound.toggleMute();
    expect(sound.toggleMute()).toBe(false);
    expect(sound.muted).toBe(false);
  });

  it('tolerates being unlocked repeatedly', () => {
    const sound = new Sound();
    for (let i = 0; i < 5; i++) expect(() => sound.unlock()).not.toThrow();
  });
});
