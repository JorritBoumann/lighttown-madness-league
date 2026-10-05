import * as THREE from 'three';
import { cfg } from '../config';
import type { BoostPad } from '../physics/boostPads';
import { ballTexture } from './textures';

/**
 * The car.
 *
 * Built from its side profile, extruded across the width. Two earlier attempts
 * placed the corners of a hull by hand and both failed the same way: get one
 * station's width wrong and the body comes out as a splayed flat plate with a
 * dark box sitting on it. A car is recognisable by its silhouette — low nose,
 * rising bonnet, a greenhouse set back and inset from the shoulders — so the
 * silhouette is the thing worth describing directly.
 *
 * An Octane hitbox is 120 long, 87 wide and 39 tall, so the car really is a low
 * wedge. The vertical layout is worked out from the ride height rather than
 * guessed: the hitbox floats `rideHeight` above the ground, so in this frame the
 * ground is at `-(hy + rideHeight)` and a wheel of radius r sits exactly r above
 * it. Get that wrong and the car either hovers or sinks into the pitch.
 */
export function createCarMesh(color = 0x4fc3f7): THREE.Group {
  const h = cfg.car.hitbox;
  const hx = h.length / 2;
  const hy = h.height / 2;
  const hz = h.width / 2;
  const ground = -(hy + cfg.car.rideHeight);
  const g = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.45, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x18222f,
    roughness: 0.12,
    metalness: 0.8,
  });

  const sill = -hy + h.height * 0.1;
  const shoulder = -hy + h.height * 0.46;
  const roof = hy;

  // Lower body: a wedge from a low nose up to the shoulder line, tucked in at
  // both ends so it does not read as a brick.
  const bodyShape = new THREE.Shape([
    new THREE.Vector2(hx * 0.98, sill),
    new THREE.Vector2(hx, sill + h.height * 0.1),
    new THREE.Vector2(hx * 0.72, shoulder - h.height * 0.04),
    new THREE.Vector2(hx * 0.1, shoulder),
    new THREE.Vector2(-hx * 0.66, shoulder),
    new THREE.Vector2(-hx * 0.95, shoulder - h.height * 0.08),
    new THREE.Vector2(-hx, sill + h.height * 0.06),
    new THREE.Vector2(-hx * 0.96, sill),
  ]);
  const body = new THREE.Mesh(extrude(bodyShape, hz * 1.94, 3), paint);
  body.castShadow = true;
  g.add(body);

  // Greenhouse: narrower than the body, which is what creates the shoulder
  // step and stops the roof reading as a lid dropped on a tray.
  const cabinShape = new THREE.Shape([
    new THREE.Vector2(hx * 0.46, shoulder),
    new THREE.Vector2(hx * 0.06, roof),
    new THREE.Vector2(-hx * 0.4, roof),
    new THREE.Vector2(-hx * 0.6, shoulder),
  ]);
  const cabin = new THREE.Mesh(extrude(cabinShape, hz * 1.4, 2.5), glass);
  cabin.castShadow = true;
  g.add(cabin);

  // Splitter at the nose, spoiler at the tail: they tell front from back.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.26, h.height * 0.07, hz * 1.8), trim);
  splitter.position.set(hx * 0.9, sill - h.height * 0.02, 0);
  g.add(splitter);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.22, h.height * 0.06, hz * 1.7), trim);
  wing.position.set(-hx * 0.88, shoulder + h.height * 0.26, 0);
  wing.castShadow = true;
  g.add(wing);
  for (const zs of [1, -1]) {
    const stay = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.07, h.height * 0.26, hz * 0.09), trim);
    stay.position.set(-hx * 0.86, shoulder + h.height * 0.13, zs * hz * 0.6);
    g.add(stay);
  }

  // Lights: small, and emissive so they catch the bloom.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e0,
    emissive: 0xfff0cc,
    emissiveIntensity: 1.8,
  });
  for (const zs of [1, -1]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 0.04, h.height * 0.1, hz * 0.3),
      headMat,
    );
    lamp.position.set(hx * 0.99, sill + h.height * 0.16, zs * hz * 0.58);
    g.add(lamp);
  }
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.03, h.height * 0.07, hz * 0.34),
    new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0xff3a18, emissiveIntensity: 1.2 }),
  );
  for (const zs of [1, -1]) {
    const lamp = tail.clone();
    lamp.position.set(-hx * 1.0, shoulder - h.height * 0.08, zs * hz * 0.6);
    g.add(lamp);
  }

  // Wheels. The x positions are the real suspension stations, so the wheelbase
  // you see is the one the car steers on. The z is pushed out to the bodyside
  // rather than the suspension's own 26-30, which sits well inside a hitbox 87
  // wide: a wheel drawn there is hidden inside the bodywork.
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc2ccda,
    roughness: 0.25,
    metalness: 0.9,
  });
  for (const spec of [cfg.car.frontWheel, cfg.car.rearWheel]) {
    const tyreGeo = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.radius * 0.72, 18);
    const rimGeo = new THREE.CylinderGeometry(
      spec.radius * 0.5,
      spec.radius * 0.5,
      spec.radius * 0.76,
      12,
    );
    for (const zs of [1, -1]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      wheel.add(tyre);
      wheel.add(new THREE.Mesh(rimGeo, rimMat));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(spec.x, ground + spec.radius, zs * hz * 0.88);
      g.add(wheel);
    }
  }

  // Boost flame, hidden until the thrust is on.
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(h.height * 0.3, h.length * 0.8, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.92 }),
  );
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-hx - h.length * 0.38, shoulder - h.height * 0.14, 0);
  flame.visible = false;
  flame.name = 'flame';
  g.add(flame);

  return g;
}

/**
 * Extrudes a side profile across the car's width and centres it.
 *
 * The bevel is what keeps these from looking like cut card: a few units of
 * rounding on every edge catches the light all the way along it.
 */
function extrude(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // ExtrudeGeometry builds along +z from zero, so centre it on the car.
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

export function createBallMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    // Smooth, not faceted: the flat shading was hiding the fact that this is
    // the one object on the pitch the eye tracks continuously.
    new THREE.SphereGeometry(cfg.ball.radius, 32, 24),
    new THREE.MeshStandardMaterial({
      map: ballTexture(),
      // A little self-lit: at half-pitch the ball is only about fifteen pixels
      // across, and it has to stay findable against the pitch.
      emissive: 0x33405c,
      emissiveIntensity: 0.3,
      roughness: 0.22,
      metalness: 0.2,
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

  // Pads sit flat on the pitch and have to be spotted from the far end, so the
  // readable part is the glow, not the geometry: a hexagonal plate with a ring
  // above it, both emissive enough to catch the bloom.
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0xffc14d,
    emissive: 0xff9a1f,
    emissiveIntensity: 0.75,
    roughness: 0.35,
    metalness: 0.3,
  });
  const bigPlateMat = new THREE.MeshStandardMaterial({
    color: 0xffd98a,
    emissive: 0xffa825,
    // Enough to spot from the far end, not enough for the bloom to swallow the
    // shape: past about 1.2 a full pad stops reading as a hexagon and becomes
    // a bright smear on the grass.
    emissiveIntensity: 1.0,
    roughness: 0.3,
    metalness: 0.35,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffc661,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const smallPlate = new THREE.CylinderGeometry(74, 86, 12, 6);
  const bigPlate = new THREE.CylinderGeometry(118, 136, 18, 6);
  const smallHalo = new THREE.RingGeometry(92, 118, 6);
  const bigHalo = new THREE.RingGeometry(150, 190, 6);
  const pillar = new THREE.CylinderGeometry(16, 56, 300, 6, 1, true);

  interface PadParts {
    root: THREE.Group;
    halo: THREE.Mesh;
    column?: THREE.Mesh;
  }

  const parts: PadParts[] = pads.map((pad) => {
    const root = new THREE.Group();
    root.position.set(pad.x, 0, pad.z);

    const plate = new THREE.Mesh(pad.big ? bigPlate : smallPlate, pad.big ? bigPlateMat : plateMat);
    plate.position.y = pad.big ? 9 : 6;
    root.add(plate);

    const halo = new THREE.Mesh(pad.big ? bigHalo : smallHalo, haloMat.clone());
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = pad.big ? 22 : 16;
    root.add(halo);

    let column: THREE.Mesh | undefined;
    if (pad.big) {
      // A full pad is worth crossing the pitch for, so it gets a column that
      // can be seen over the car in front of you.
      column = new THREE.Mesh(
        pillar,
        new THREE.MeshBasicMaterial({
          color: 0xffc661,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      column.position.y = 150;
      root.add(column);
    }

    group.add(root);
    return { root, halo, column };
  });

  return {
    group,
    sync(list, time) {
      for (let i = 0; i < list.length; i++) {
        const pad = list[i]!;
        const part = parts[i]!;
        const live = pad.cooldown <= 0;
        part.root.visible = live;
        if (!live) continue;
        // A slow turn and a breath of scale, so a live pad is distinguishable
        // from a dead one at a glance rather than only by being there.
        const pulse = 1 + Math.sin(time * 2.4 + i) * 0.08;
        part.halo.scale.setScalar(pulse);
        part.halo.rotation.z = time * (pad.big ? 0.9 : 0.4) + i;
        if (part.column) {
          part.column.rotation.y = -time * 1.1;
          part.column.scale.set(pulse, 1, pulse);
        }
      }
    },
  };
}
