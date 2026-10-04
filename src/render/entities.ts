import * as THREE from 'three';
import { cfg } from '../config';
import type { BoostPad } from '../physics/boostPads';

/** Blocky but readable car, sized from the hitbox: body, cabin, nose, wheels. */
export function createCarMesh(color = 0x4fc3f7): THREE.Group {
  const h = cfg.car.hitbox;
  const hx = h.length / 2;
  const hy = h.height / 2;
  const hz = h.width / 2;
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(h.length, h.height, h.width), bodyMat);
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.9, hy * 1.1, hz * 1.6),
    new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.2, metalness: 0.7 }),
  );
  cabin.position.set(-hx * 0.1, hy * 0.95, 0);
  cabin.castShadow = true;
  g.add(cabin);

  // Nose marker, so which way is forward is never in doubt.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.3, hy * 0.5, hz * 1.7),
    new THREE.MeshStandardMaterial({ color: 0xf5f7ff, roughness: 0.4 }),
  );
  nose.position.set(hx * 0.92, -hy * 0.1, 0);
  g.add(nose);

  // Wheels at the real suspension positions.
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.9 });
  for (const spec of [cfg.car.frontWheel, cfg.car.rearWheel]) {
    const geo = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.radius * 0.8, 14);
    for (const sz of [1, -1]) {
      const w = new THREE.Mesh(geo, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(spec.x, -hy + spec.radius * 0.2, sz * spec.z);
      w.castShadow = true;
      g.add(w);
    }
  }

  // Boost flame, hidden until the thrust is on.
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(hz * 0.5, h.length * 0.9, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.9 }),
  );
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-hx - h.length * 0.42, 0, 0);
  flame.visible = false;
  flame.name = 'flame';
  g.add(flame);

  return g;
}

export function createBallMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(cfg.ball.radius, 3),
    new THREE.MeshStandardMaterial({
      color: 0xe8edf7,
      // A little self-lit: at half-pitch the ball is only about fifteen pixels
      // across, and it has to stay findable against a dark floor.
      emissive: 0x6b7a99,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.25,
      flatShading: true,
    }),
  );
  mesh.castShadow = true;
  return mesh;
}

export interface PadVisuals {
  group: THREE.Group;
  sync(pads: BoostPad[], time: number): void;
}

export function createBoostPadVisuals(pads: BoostPad[]): PadVisuals {
  const group = new THREE.Group();
  const bigMat = new THREE.MeshStandardMaterial({
    color: 0xffc14d,
    emissive: 0xff8c00,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });
  const smallMat = new THREE.MeshStandardMaterial({
    color: 0xffe08a,
    emissive: 0xffaa22,
    emissiveIntensity: 0.5,
    roughness: 0.4,
  });

  const meshes: THREE.Mesh[] = pads.map((pad) => {
    const mesh = pad.big
      ? new THREE.Mesh(new THREE.CylinderGeometry(20, 100, 180, 16, 1, true), bigMat)
      : new THREE.Mesh(new THREE.CylinderGeometry(64, 64, 10, 16), smallMat);
    mesh.position.set(pad.x, pad.big ? 90 : 5, pad.z);
    group.add(mesh);
    return mesh;
  });

  return {
    group,
    sync(list, time) {
      for (let i = 0; i < list.length; i++) {
        const pad = list[i]!;
        const mesh = meshes[i]!;
        const live = pad.cooldown <= 0;
        mesh.visible = live;
        if (live && pad.big) {
          mesh.rotation.y = time * 1.6;
          mesh.position.y = 90 + Math.sin(time * 3 + i) * 10;
        }
      }
    },
  };
}
