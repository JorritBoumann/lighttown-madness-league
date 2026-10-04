import * as THREE from 'three';
import { cfg } from '../config';
import type { BoostPad } from '../physics/boostPads';

/** Blocky but readable car: body, cabin, nose wedge and four wheels. */
export function createCarMesh(color = 0x4fc3f7): THREE.Group {
  const he = cfg.car.halfExtents;
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2), bodyMat);
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(he.x * 0.9, he.y * 1.1, he.z * 1.6),
    new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.2, metalness: 0.7 }),
  );
  cabin.position.set(-he.x * 0.1, he.y * 0.95, 0);
  cabin.castShadow = true;
  g.add(cabin);

  // Nose marker, so which way is forward is never in doubt.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(he.x * 0.35, he.y * 0.5, he.z * 1.7),
    new THREE.MeshStandardMaterial({ color: 0xf5f7ff, roughness: 0.4 }),
  );
  nose.position.set(he.x * 0.92, -he.y * 0.1, 0);
  g.add(nose);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14);
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(sx * he.x * 0.62, -he.y * 0.85, sz * (he.z + 0.03));
      w.castShadow = true;
      g.add(w);
    }
  }

  // Boost flame, hidden until the thrust is on.
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.7, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.9 }),
  );
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-he.x - 0.85, 0, 0);
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
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.2, 1.0, 1.8, 16, 1, true), bigMat)
      : new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 16), smallMat);
    mesh.position.set(pad.x, pad.big ? 0.9 : 0.06, pad.z);
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
          mesh.position.y = 0.9 + Math.sin(time * 3 + i) * 0.1;
        }
      }
    },
  };
}
