import * as THREE from 'three';
import { cfg } from '../config';
import type { BoostPad } from '../physics/boostPads';
import {
  ballTexture,
  ballNormalMap,
  ballRoughnessMap,
  carNormalMap,
} from './textures';

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

  const paintNormal = carNormalMap();
  paintNormal.repeat.set(2, 2);
  const base = new THREE.Color(color);
  // Deepened a little. The team colour at full strength made the car the
  // palest thing in a dark arena, and left the accent below nothing to be
  // brighter than; the accent carries the full colour instead.
  const paint = new THREE.MeshPhysicalMaterial({
    color: base.clone().multiplyScalar(0.72),
    normalMap: paintNormal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.3,
    metalness: 0.5,
    // Car paint is pigment under lacquer, and the two highlights that gives —
    // a broad one from the colour and a tight one from the clear coat — are
    // most of why a painted surface looks painted.
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
  });
  // The same colour taken right down, for the lower half of the body.
  //
  // One flat panel from the sill to the shoulder is what made this read as a
  // smooth toy: a real car breaks at the rocker, and that horizontal break is
  // what gives the side a top and a bottom instead of a single bright face.
  const paintLow = new THREE.MeshPhysicalMaterial({
    color: base.clone().multiplyScalar(0.3),
    roughness: 0.42,
    metalness: 0.45,
    clearcoat: 0.6,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x141922, roughness: 0.55, metalness: 0.45 });
  // Glass, not a hole. At metalness 0.8 and roughness 0.12 this was a mirror,
  // and a mirror at dusk reflects a dark sky — so the whole canopy came out as
  // a black blob sitting on the roof, which is the single thing that stopped
  // the car reading as a car.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x2b3f58,
    roughness: 0.08,
    metalness: 0.25,
    clearcoat: 1,
    emissive: 0x16222f,
    emissiveIntensity: 1,
  });
  // The team colour again, but emissive: a light bar and a stripe. The team has
  // to be readable at a glance from the far end of the pitch, and a deepened
  // body alone is not enough to carry that.
  const accent = new THREE.MeshStandardMaterial({
    color: base,
    emissive: base,
    // Low, and then lower again. With the arena's bloom at 0.62 an emissive of
    // 0.9 blew the stripe and the light bar out to white, so the team colour
    // they exist to carry was the one thing you could not read off them; 0.3
    // still smeared a white streak down the whole flank at close range.
    emissiveIntensity: 0.11,
    roughness: 0.3,
  });

  const sill = -hy + h.height * 0.1;
  const rocker = -hy + h.height * 0.3;
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

  // The dark lower half, slightly proud of the bodyside so the break catches
  // its own highlight.
  const rockerShape = new THREE.Shape([
    new THREE.Vector2(hx * 0.96, sill),
    new THREE.Vector2(hx * 0.96, rocker),
    new THREE.Vector2(-hx * 0.94, rocker),
    new THREE.Vector2(-hx * 0.94, sill),
  ]);
  const skirt = new THREE.Mesh(extrude(rockerShape, hz * 1.98, 2), paintLow);
  g.add(skirt);

  // Greenhouse: narrower than the body, which is what creates the shoulder
  // step and stops the roof reading as a lid dropped on a tray. Shorter than it
  // was, too, so there is a painted rear deck behind it rather than glass all
  // the way to the spoiler.
  const cabinShape = new THREE.Shape([
    new THREE.Vector2(hx * 0.44, shoulder),
    new THREE.Vector2(hx * 0.04, roof),
    new THREE.Vector2(-hx * 0.3, roof),
    new THREE.Vector2(-hx * 0.46, shoulder),
  ]);
  const cabin = new THREE.Mesh(extrude(cabinShape, hz * 1.36, 2.5), glass);
  cabin.castShadow = true;
  g.add(cabin);

  // A painted roof cap over the glass, narrower again. Without it the canopy is
  // glass on every face and there is no body colour above the shoulder at all.
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.34, h.height * 0.05, hz * 1.12),
    paint,
  );
  cap.position.set(-hx * 0.13, roof + h.height * 0.01, 0);
  cap.castShadow = true;
  g.add(cap);

  // Team colour where it can actually lie flat: a line along the rocker break
  // down each flank, and one over the roof cap.
  //
  // The first version ran a stripe down the centre of the bonnet, and the
  // bonnet is a slope — so the stripe floated above it at the nose and sank
  // into it at the cowl, and all that showed was a short white dash. A flank
  // is vertical and constant, which is why a side stripe is the one that works
  // on a shape described as a side profile.
  for (const zs of [1, -1]) {
    const flank = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 1.72, h.height * 0.035, hz * 0.04),
      accent,
    );
    flank.position.set(0, rocker, zs * hz * 0.99);
    g.add(flank);
  }
  const roofStripe = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.32, h.height * 0.02, hz * 0.16),
    accent,
  );
  roofStripe.position.set(-hx * 0.13, roof + h.height * 0.05, 0);
  g.add(roofStripe);

  // Wheel arches.
  //
  // An open tube a third again the tyre's radius, coaxial with the wheel. The
  // body hides its inner half and what is left is a fender arc over the top of
  // the wheel — which is the cue that was missing entirely. Without an arch a
  // wheel reads as a button stuck on a smooth flank however well it is placed.
  // Double-sided, because a half-shell seen from inside the arch would
  // otherwise be invisible and the fender would vanish at some angles.
  const archMat = new THREE.MeshStandardMaterial({
    color: 0x141922,
    roughness: 0.6,
    metalness: 0.4,
    side: THREE.DoubleSide,
  });

  // Splitter at the nose, spoiler at the tail: they tell front from back.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.26, h.height * 0.07, hz * 1.8), trim);
  splitter.position.set(hx * 0.9, sill - h.height * 0.02, 0);
  g.add(splitter);

  // Grille across the nose, under the lights.
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.05, h.height * 0.12, hz * 1.1),
    trim,
  );
  grille.position.set(hx * 0.99, sill + h.height * 0.02, 0);
  g.add(grille);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.22, h.height * 0.06, hz * 1.7), trim);
  wing.position.set(-hx * 0.88, shoulder + h.height * 0.26, 0);
  wing.castShadow = true;
  g.add(wing);
  for (const zs of [1, -1]) {
    const stay = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.07, h.height * 0.26, hz * 0.09), trim);
    stay.position.set(-hx * 0.86, shoulder + h.height * 0.13, zs * hz * 0.6);
    g.add(stay);
  }

  // Diffuser under the tail, with fins.
  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.18, h.height * 0.14, hz * 1.5),
    trim,
  );
  diffuser.position.set(-hx * 0.92, sill - h.height * 0.01, 0);
  g.add(diffuser);
  for (const i of [-1, 0, 1]) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 0.2, h.height * 0.16, hz * 0.05),
      paintLow,
    );
    fin.position.set(-hx * 0.93, sill - h.height * 0.01, i * hz * 0.42);
    g.add(fin);
  }

  // Lights: small, and emissive so they catch the bloom — but much less
  // emissive than they were. At 1.8 with the arena's bloom now at 0.62 each
  // headlight bloomed into a white blob bigger than the car's nose.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e0,
    emissive: 0xfff0cc,
    // The headlights are the brightest thing on the car and the car is the
    // nearest thing to the camera, so they bloom harder than anything in the
    // arena. At 0.55 the whole front of the car went to a white blob.
    emissiveIntensity: 0.2,
  });
  for (const zs of [1, -1]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 0.04, h.height * 0.07, hz * 0.26),
      headMat,
    );
    lamp.position.set(hx * 0.985, sill + h.height * 0.18, zs * hz * 0.6);
    g.add(lamp);
  }
  // A light bar across the tail in the team colour, which is what you actually
  // read when a car is ahead of you.
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 0.03, h.height * 0.05, hz * 1.3),
    accent,
  );
  bar.position.set(-hx * 0.99, shoulder - h.height * 0.06, 0);
  g.add(bar);
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff5a3c,
    emissive: 0xff3a18,
    emissiveIntensity: 0.3,
  });
  for (const zs of [1, -1]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 0.03, h.height * 0.06, hz * 0.22),
      tailMat,
    );
    lamp.position.set(-hx * 0.99, shoulder - h.height * 0.15, zs * hz * 0.66);
    g.add(lamp);
  }

  // Wheels. The x positions are the real suspension stations, so the wheelbase
  // you see is the one the car steers on. The z is pushed out past the
  // bodyside rather than the suspension's own 26-30, which sits well inside a
  // hitbox 87 wide: a wheel drawn there is hidden inside the bodywork. It was
  // at 0.88 of the half width, which is *inside* the body's own 0.97, so the
  // tyres sat flush in the flank and read as buttons.
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xaab6c6,
    roughness: 0.22,
    metalness: 0.92,
  });
  for (const spec of [cfg.car.frontWheel, cfg.car.rearWheel]) {
    const tyreGeo = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.radius * 0.78, 20);
    const rimGeo = new THREE.CylinderGeometry(
      spec.radius * 0.52,
      spec.radius * 0.52,
      spec.radius * 0.82,
      14,
    );
    // Spokes, which is what makes a wheel turn visibly instead of being a disc.
    const spokeGeo = new THREE.BoxGeometry(spec.radius * 1.3, spec.radius * 0.16, spec.radius * 0.86);
    // The top half only.
    //
    // A full open tube showed as black crescents poking out past the tyre and
    // below it — the arch's lower half reaches below the pitch, because the
    // wheel centre is only one radius off the ground. A fender is the arc over
    // the wheel and nothing else.
    //
    // After the `rotation.x` below, a point at angle t sits at car-y of -cos t,
    // so the top of the wheel is at t = pi and the upper half runs from pi/2
    // through to 3pi/2.
    const archGeo = new THREE.CylinderGeometry(
      spec.radius * 1.3,
      spec.radius * 1.3,
      spec.radius * 1.0,
      16,
      1,
      true,
      Math.PI / 2,
      Math.PI,
    );
    for (const zs of [1, -1]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      wheel.add(tyre);
      wheel.add(new THREE.Mesh(rimGeo, rimMat));
      for (const turn of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.y = turn;
        wheel.add(spoke);
      }
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(spec.x, ground + spec.radius, zs * hz * 1.0);
      g.add(wheel);

      const arch = new THREE.Mesh(archGeo, archMat);
      arch.rotation.x = Math.PI / 2;
      arch.position.set(spec.x, ground + spec.radius, zs * hz * 0.99);
      g.add(arch);
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
    new THREE.MeshPhysicalMaterial({
      map: ballTexture(),
      // The seams in relief, and dull where the panels are polished. This is
      // what stops it reading as a painted sphere.
      normalMap: ballNormalMap(),
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: ballRoughnessMap(),
      // A lacquer over the panels, which is what gives the tight highlight
      // that tells you the thing has a surface.
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      // A little self-lit: at half-pitch the ball is only about fifteen pixels
      // across, and it has to stay findable against the pitch.
      emissive: 0x33405c,
      emissiveIntensity: 0.3,
      roughness: 0.6,
      metalness: 0.1,
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
