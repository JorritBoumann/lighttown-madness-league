import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cfg } from '../src/config';
import { GoalMoment } from '../src/render/goalMoment';

/**
 * The goal celebration.
 *
 * Tested on the two things that break quietly. The time scale is the whole
 * feel of the moment and is pure arithmetic, so it is worth pinning exactly;
 * and a celebration that forgets to put back what it borrowed leaves the goal
 * frame glowing for the rest of the match, which is the sort of bug nobody
 * notices until a screenshot looks wrong.
 */

function harness() {
  const scene = new THREE.Scene();
  const bursts: number[] = [];
  const celebrated: number[] = [];
  const moment = new GoalMoment({
    scene,
    particles: {
      burst: (_p: unknown, count: number) => bursts.push(count),
    } as never,
    stadium: {
      celebrate: (seconds: number) => celebrated.push(seconds),
    } as never,
  });
  return { moment, bursts, celebrated, scene };
}

/** An arena group with the parts the celebration looks for. */
function arena(sign: 1 | -1) {
  const group = new THREE.Group();
  const netMat = new THREE.MeshStandardMaterial();
  const net = new THREE.Mesh(new THREE.PlaneGeometry(1786, 642, 8, 6), netMat);
  net.name = `net-back-${sign}`;
  // Placed and turned as the real one is: at the back of the goal box, facing
  // down the pitch. The bulge falls off from where the ball went through in
  // the net's *local* frame, so a net sitting at the origin would put the hit
  // point five thousand units off the sheet and move nothing.
  net.position.set(sign * (cfg.arena.halfLength + cfg.arena.goalDepth), cfg.arena.goalHeight / 2, 0);
  net.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  net.updateMatrixWorld(true);
  group.add(net);

  const surroundMat = new THREE.MeshStandardMaterial({ emissiveIntensity: 0.9 });
  surroundMat.name = `goal-surround-${sign}`;
  surroundMat.userData.baseEmissive = 0.9;
  const post = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), surroundMat);
  group.add(post);

  const mouthMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16 });
  mouthMat.userData.baseOpacity = 0.16;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(1786, 642), mouthMat);
  mouth.name = `goal-mouth-${sign}`;
  group.add(mouth);

  return { group, net, surroundMat, mouthMat };
}

describe('goal moment timing', () => {
  it('runs at normal speed when nothing has happened', () => {
    const { moment } = harness();
    expect(moment.timeScale).toBe(1);
  });

  it('stops dead on contact', () => {
    const { moment } = harness();
    moment.trigger({ x: 5000, y: 200, z: 0 }, 1, new THREE.Color(0x4fc3f7));
    expect(moment.timeScale).toBeCloseTo(cfg.goal.hitstopScale, 5);
  });

  it('ramps back up rather than snapping', () => {
    const { moment } = harness();
    moment.trigger({ x: 5000, y: 200, z: 0 }, 1, new THREE.Color(0x4fc3f7));
    const seen: number[] = [];
    for (let i = 0; i < 90; i++) {
      moment.update(1 / 60);
      seen.push(moment.timeScale);
    }
    // Monotonic: a return to speed that dips would read as a dropped frame.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-9);
    }
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('is back to full speed by the time the celebration ends', () => {
    const { moment } = harness();
    moment.trigger({ x: 5000, y: 200, z: 0 }, 1, new THREE.Color(0x4fc3f7));
    // The match only pauses for goalPause; the world must not still be in
    // slow motion when the next kickoff starts.
    const total = cfg.goal.hitstop + cfg.goal.slowMotion;
    expect(total).toBeLessThan(cfg.match.goalPause);
    for (let i = 0; i < Math.ceil(total * 60) + 2; i++) moment.update(1 / 60);
    expect(moment.timeScale).toBe(1);
  });
});

describe('goal moment effects', () => {
  it('throws two waves of particles and sets the crowd off', () => {
    const { moment, bursts, celebrated } = harness();
    moment.trigger({ x: 5000, y: 200, z: 0 }, 1, new THREE.Color(0x4fc3f7));
    expect(bursts).toEqual([cfg.goal.sparkCount, cfg.goal.emberCount]);
    expect(celebrated).toEqual([cfg.goal.crowdSeconds]);
  });

  it('bulges the net and returns it to its exact shape', () => {
    const { moment } = harness();
    const { group, net } = arena(1);
    moment.setArena(group);
    const rest = Float32Array.from(net.geometry.getAttribute('position').array as Float32Array);

    moment.trigger({ x: cfg.arena.goalLine, y: 200, z: 120 }, 1, new THREE.Color(0x4fc3f7));
    moment.update(0.05);
    const bulged = net.geometry.getAttribute('position').array as Float32Array;
    let moved = 0;
    for (let i = 0; i < rest.length; i++) if (Math.abs(bulged[i]! - rest[i]!) > 1e-6) moved++;
    expect(moved).toBeGreaterThan(0);

    // And all the way back: a net left dented is a permanent mark on the pitch.
    for (let i = 0; i < 200; i++) moment.update(1 / 60);
    const after = net.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < rest.length; i++) expect(after[i]).toBeCloseTo(rest[i]!, 4);
  });

  it('flares the frame and puts it back', () => {
    const { moment } = harness();
    const { group, surroundMat, mouthMat } = arena(-1);
    moment.setArena(group);

    moment.trigger({ x: -cfg.arena.goalLine, y: 200, z: 0 }, -1, new THREE.Color(0xff7043));
    moment.update(1 / 60);
    expect(surroundMat.emissiveIntensity).toBeGreaterThan(0.9);
    // The mouth glow gets out of the way rather than brightening, so the net
    // taking the ball is visible.
    expect(mouthMat.opacity).toBeLessThan(0.16);

    for (let i = 0; i < 200; i++) moment.update(1 / 60);
    expect(surroundMat.emissiveIntensity).toBeCloseTo(0.9, 5);
    expect(mouthMat.opacity).toBeCloseTo(0.16, 5);
  });

  it('survives a goal with no arena pointed at it', () => {
    // The arena is rebuilt when a round changes the goals. A celebration that
    // assumed a net existed would take the game down on the first goal of a
    // modifier round.
    const { moment } = harness();
    expect(() => {
      moment.trigger({ x: 5000, y: 200, z: 0 }, 1, new THREE.Color(0x4fc3f7));
      for (let i = 0; i < 120; i++) moment.update(1 / 60);
    }).not.toThrow();
  });
});
