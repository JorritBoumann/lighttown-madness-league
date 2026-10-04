// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { MenuScreen } from '../src/ui/menuScreen';
import { Sound } from '../src/audio/sound';

/**
 * The menu's navigation and the sound's safety behaviour. Both are small, and
 * both fail quietly: a menu that cannot wrap is merely annoying, but audio that
 * throws when a browser blocks it takes the game down with it.
 */

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const items = [
  { id: 'a', label: 'First' },
  { id: 'b', label: 'Second' },
  { id: 'c', label: 'Third' },
];

function open(): MenuScreen {
  const menu = new MenuScreen(host);
  menu.show({ title: 'Title', items });
  return menu;
}

describe('menu navigation', () => {
  it('starts on the first item', () => {
    expect(open().selected?.id).toBe('a');
  });

  it('moves down and up', () => {
    const menu = open();
    menu.move(1);
    expect(menu.selected?.id).toBe('b');
    menu.move(-1);
    expect(menu.selected?.id).toBe('a');
  });

  it('wraps at both ends rather than sticking', () => {
    const menu = open();
    menu.move(-1);
    expect(menu.selected?.id).toBe('c');
    menu.move(1);
    expect(menu.selected?.id).toBe('a');
  });

  it('jumps to an item by number', () => {
    const menu = open();
    expect(menu.pick(2)?.id).toBe('b');
    expect(menu.selected?.id).toBe('b');
  });

  it('ignores a number with no item behind it', () => {
    const menu = open();
    expect(menu.pick(9)).toBe(null);
    expect(menu.pick(0)).toBe(null);
    // And the highlight has not moved.
    expect(menu.selected?.id).toBe('a');
  });

  it('resets to the first item when shown again', () => {
    const menu = open();
    menu.move(1);
    menu.show({ title: 'Again', items });
    expect(menu.selected?.id).toBe('a');
  });

  it('hides and shows', () => {
    const menu = open();
    expect(menu.visible).toBe(true);
    menu.hide();
    expect(menu.visible).toBe(false);
  });

  it('marks exactly one item as highlighted in the markup', () => {
    const menu = open();
    menu.move(1);
    const on = host.querySelectorAll('.menu-list li.on');
    expect(on).toHaveLength(1);
    expect(on[0]!.textContent).toContain('Second');
  });

  it('copes with an empty menu rather than throwing', () => {
    const menu = new MenuScreen(host);
    menu.show({ title: 'Nothing', items: [] });
    expect(menu.selected).toBe(null);
    expect(() => menu.move(1)).not.toThrow();
  });
});

describe('sound safety', () => {
  it('does nothing and throws nothing before it is unlocked', () => {
    const sound = new Sound();
    expect(sound.ready).toBe(false);
    expect(() => {
      sound.hit(1500);
      sound.goal(true);
      sound.jump();
      sound.pad(true);
      sound.countdown(3);
      sound.setBoost(0.8);
      sound.setBoost(0);
    }).not.toThrow();
  });

  it('survives a browser with no AudioContext at all', () => {
    const original = window.AudioContext;
    // jsdom has none, but be explicit about the case being covered.
    (window as { AudioContext?: typeof AudioContext }).AudioContext = undefined;
    const sound = new Sound();
    expect(() => sound.unlock()).not.toThrow();
    expect(sound.ready).toBe(false);
    expect(() => sound.hit(1000)).not.toThrow();
    (window as { AudioContext?: typeof AudioContext }).AudioContext = original;
  });

  it('toggles mute and reports the new state', () => {
    const sound = new Sound();
    expect(sound.muted).toBe(false);
    expect(sound.toggleMute()).toBe(true);
    expect(sound.muted).toBe(true);
    expect(sound.toggleMute()).toBe(false);
  });

  it('stays silent while muted', () => {
    const sound = new Sound();
    sound.toggleMute();
    expect(sound.ready).toBe(false);
    expect(() => sound.setBoost(1)).not.toThrow();
  });
});
