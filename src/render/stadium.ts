import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cfg } from '../config';
import type { ArenaLayout } from '../core/arenaLayout';
import { fasciaTexture, screenCanvas } from './textures';

/**
 * The building the pitch sits inside.
 *
 * Separate from the arena mesh on purpose. The arena is rebuilt whenever a
 * round changes the goals; the stands are not affected by the goal width and
 * rebuilding them every round was wasted work.
 *
 * The thing that makes an arena feel inhabited is being able to see the crowd
 * from the car, and the playfield is a sealed box 2044 tall whose walls are
 * driveable. So the upper wall is glass (see `scene.ts`) and the bowl starts
 * just above the hoardings behind it: from the floor you are looking through
 * the glass at people, rather than at twenty metres of blank concrete.
 */

export interface StadiumInfo {
  blue: number;
  orange: number;
  /** Already formatted, e.g. "1:28". */
  clock: string;
  label: string;
}

export interface Stadium {
  group: THREE.Group;
  update(dt: number, info: StadiumInfo): void;
  /** Sets the crowd off: flashes come thick and fast for a few seconds. */
  celebrate(seconds: number): void;
}

/** Reused for the spectators' facing rotation. */
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** One straight run of the arena's footprint, with its outward normal. */
interface Edge {
  mid: THREE.Vector2;
  dir: THREE.Vector2;
  normal: THREE.Vector2;
  length: number;
}

/**
 * The eight runs of the arena's plan: two ends, two sides, four cut corners.
 *
 * Working from the real footprint rather than a plain rectangle is what keeps
 * the bowl sitting against the corner diagonals instead of cutting across them.
 */
function footprintEdges(layout: ArenaLayout): Edge[] {
  const hl = layout.halfLength;
  const hw = layout.halfWidth;
  const cut = layout.cornerCut;
  const ex = hl - cut; // where the side walls stop
  const ez = hw - cut; // where the end walls stop

  const corners: THREE.Vector2[] = [
    new THREE.Vector2(hl, ez),
    new THREE.Vector2(ex, hw),
    new THREE.Vector2(-ex, hw),
    new THREE.Vector2(-hl, ez),
    new THREE.Vector2(-hl, -ez),
    new THREE.Vector2(-ex, -hw),
    new THREE.Vector2(ex, -hw),
    new THREE.Vector2(hl, -ez),
  ];

  const edges: Edge[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const span = new THREE.Vector2().subVectors(b, a);
    const length = span.length();
    const dir = span.clone().normalize();
    // Outward normal of a counter-clockwise polygon.
    const normal = new THREE.Vector2(dir.y, -dir.x);
    edges.push({
      mid: new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5),
      dir,
      normal,
      length,
    });
  }
  return edges;
}

/** A box placed along an edge, offset outwards, ready to be merged. */
function edgeSlab(
  edge: Edge,
  outward: number,
  depth: number,
  height: number,
  y: number,
  overlap: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(edge.length + overlap, height, depth);
  const angle = Math.atan2(edge.dir.y, edge.dir.x);
  geo.rotateY(-angle);
  geo.translate(
    edge.mid.x + edge.normal.x * outward,
    y,
    edge.mid.y + edge.normal.y * outward,
  );
  return geo;
}

export function buildStadium(layout: ArenaLayout): Stadium {
  const s = cfg.stadium;
  const group = new THREE.Group();
  group.name = 'stadium';
  const edges = footprintEdges(layout);

  // Almost no environment response. With a dusk sky in the environment map the
  // bowl picked up the warm horizon and the empty aisles read as wedges of
  // salmon carpet — the brightest thing in the stands.
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x1d2330,
    roughness: 0.94,
    envMapIntensity: 0.08,
  });
  const structure = new THREE.MeshStandardMaterial({ color: 0x47505e, roughness: 0.8, metalness: 0.35 });

  // --- seating bowl ------------------------------------------------------
  // Two decks with a fascia between them. One deck reads as a terrace; the
  // break is what makes it read as a building with floors.
  const slabs: THREE.BufferGeometry[] = [];
  const crowd: { m: THREE.Matrix4; shade: number }[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  interface Deck {
    base: number;
    rows: number;
    rise: number;
    tread: number;
    inset: number;
  }
  const lower: Deck = {
    base: s.lowerBase,
    rows: s.lowerRows,
    rise: s.lowerRise,
    tread: s.lowerTread,
    inset: s.lowerInset,
  };
  const upperBase = lower.base + lower.rows * lower.rise + s.fasciaHeight;
  const upper: Deck = {
    base: upperBase,
    rows: s.upperRows,
    rise: s.upperRise,
    tread: s.upperTread,
    inset: lower.inset + lower.rows * lower.tread + s.upperStep,
  };

  for (const deck of [lower, upper]) {
    for (let row = 0; row < deck.rows; row++) {
      const outward = deck.inset + row * deck.tread;
      const y = deck.base + row * deck.rise;
      // Solid from the deck's floor to this row's lip. Floating steps let the
      // sky through between the rows and read as scaffolding.
      const height = y - deck.base + deck.rise;
      for (const edge of edges) {
        slabs.push(
          edgeSlab(edge, outward + deck.tread / 2, deck.tread, height, deck.base + height / 2 - deck.rise, 240),
        );
      }

      // Spectators along the row, with gangways cut through at intervals.
      for (const edge of edges) {
        const step = s.seatSpacing;
        const count = Math.max(1, Math.floor((edge.length + outward * 0.6) / step));
        for (let i = 0; i <= count; i++) {
          const t = i / count - 0.5;
          // Gangways. A continuous band of people looks like a texture; the
          // breaks are what make it read as seating people walk between.
          //
          // Keyed to the position along the row rather than to the seat index.
          // `count` changes from row to row because the rows get longer as they
          // go back, so an index-based aisle landed in a different place in
          // every row and the gaps fanned out into wedges of bare concrete.
          // A real aisle runs straight up the bowl.
          const aisle = Math.abs(((t + 0.5) * s.gangways) % 1 - 0.5);
          if (aisle > 0.38) continue;

          const jitterA = (Math.sin(i * 12.9898 + row * 78.233) * 43758.5453) % 1;
          const jitterB = (Math.sin(i * 39.3468 + row * 11.135) * 24634.6345) % 1;
          // Nudged along the row and in depth. Evenly spaced boxes of one size
          // read as brickwork rather than as people; the gaps and the mismatch
          // are what make a crowd out of them.
          const along = t * (edge.length + outward * 0.6) + jitterA * s.seatSpacing * 0.5;
          const depth = outward + deck.tread * (0.52 + Math.abs(jitterB) * 0.22);
          pos.set(
            edge.mid.x + edge.dir.x * along + edge.normal.x * depth,
            y + s.seatHeight * 0.5 + jitterB * 12,
            edge.mid.y + edge.dir.y * along + edge.normal.y * depth,
          );
          const build = 0.78 + Math.abs(jitterA) * 0.44;
          scale.set(s.seatWidth, s.seatHeight * build, s.seatWidth * 0.8);
          // Facing the pitch, plus a little scatter.
          //
          // Every instance used to take the identity rotation, so a spectator
          // in the end stand and one on the corner diagonal were both aligned
          // to the world axes rather than to their own row — which is a large
          // part of why the crowd read as brickwork. People in a stand face
          // the game, and not one of them is exactly square to it.
          const facing = Math.atan2(-edge.normal.x, -edge.normal.y);
          quat.setFromAxisAngle(UP_AXIS, facing + jitterB * 0.5);
          matrix.compose(pos, quat, scale);
          crowd.push({ m: matrix.clone(), shade: Math.abs(jitterA) });
        }
      }
    }
  }

  const bowl = new THREE.Mesh(mergeGeometries(slabs, false), concrete);
  bowl.name = 'bowl';
  group.add(bowl);
  for (const geo of slabs) geo.dispose();

  // --- crowd -------------------------------------------------------------
  // A body with a head on it, rather than a box.
  //
  // One box per spectator is what made the stands read as a brick wall, and no
  // amount of colour variation fixes a silhouette. Two boxes is enough: the
  // head breaks the top edge of the row, and a row with a broken top edge
  // reads as people even when each one is only a few pixels tall.
  const personParts = [
    new THREE.BoxGeometry(1, 0.68, 1).translate(0, -0.16, 0),
    new THREE.BoxGeometry(0.52, 0.3, 0.52).translate(0, 0.33, 0),
  ];
  const personGeo = mergeGeometries(personParts, false);
  for (const geo of personParts) geo.dispose();

  // Clothing. Mid-tones and the two house colours, not a rainbow and not the
  // near-black it was: a crowd reads because it is dense and varied, and at
  // dusk the old muted palette went to a single dark speckle.
  const palette = [
    0x44557a, 0x6b7f9f, 0xb8c0cc, 0x3f86c4, 0xd4794a, 0x8b93a2, 0xe2e8ef, 0x9a5f6e,
    0x55684f, 0xf0bd78,
  ].map((c) => new THREE.Color(c));
  const people = new THREE.InstancedMesh(
    personGeo,
    // A dark floor of self-lighting, so nobody in the back rows is pure black.
    // The daylight version had none because the sky filled the seating; at dusk
    // the keys are aimed at the pitch and the stands get very little.
    new THREE.MeshStandardMaterial({
      roughness: 0.88,
      // A real crowd is lit by the same floodlights the pitch is, and ours are
      // furniture that does no lighting work. Rather than add four more lights
      // for the sake of some of the smallest geometry in the scene, the
      // spectators carry their own floor of brightness; the variation still
      // comes through the per-instance colour above it.
      emissive: 0x3c4760,
      emissiveIntensity: 1,
    }),
    crowd.length,
  );
  const colour = new THREE.Color();
  for (let i = 0; i < crowd.length; i++) {
    people.setMatrixAt(i, crowd[i]!.m);
    colour.copy(palette[i % palette.length]!);
    // Rows further back sit in deeper shadow.
    colour.multiplyScalar(0.8 + crowd[i]!.shade * 0.45);
    people.setColorAt(i, colour);
  }
  people.instanceMatrix.needsUpdate = true;
  if (people.instanceColor) people.instanceColor.needsUpdate = true;
  people.name = 'crowd';
  group.add(people);

  // --- camera flashes ----------------------------------------------------
  // The cheapest trick in the book and the one that does the most: a few
  // hundred specks popping at random through the crowd. A still crowd reads as
  // scenery, a flickering one reads as people.
  const flashCount = s.flashes;
  const flashes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(s.seatWidth * 2.4, s.seatWidth * 2.4),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    flashCount,
  );
  const flashSeats: THREE.Vector3[] = [];
  for (let i = 0; i < flashCount; i++) {
    const seat = crowd[Math.floor((i * 7919) % crowd.length)]!;
    const p = new THREE.Vector3().setFromMatrixPosition(seat.m);
    flashSeats.push(p);
  }
  flashes.name = 'flashes';
  group.add(flashes);

  // --- fascia and banners ------------------------------------------------
  const fasciaMat = new THREE.MeshStandardMaterial({
    map: fasciaTexture(),
    emissive: 0x2a4472,
    emissiveIntensity: 0.4,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const fasciaY = lower.base + lower.rows * lower.rise + s.fasciaHeight / 2;
  const fasciaOut = lower.inset + lower.rows * lower.tread;
  const fasciaParts: THREE.BufferGeometry[] = [];
  for (const edge of edges) {
    const geo = new THREE.PlaneGeometry(edge.length + 240, s.fasciaHeight);
    const angle = Math.atan2(edge.dir.y, edge.dir.x);
    geo.rotateY(-angle + Math.PI / 2);
    geo.translate(
      edge.mid.x + edge.normal.x * fasciaOut,
      fasciaY,
      edge.mid.y + edge.normal.y * fasciaOut,
    );
    fasciaParts.push(geo);
  }
  group.add(new THREE.Mesh(mergeGeometries(fasciaParts, false), fasciaMat));
  for (const geo of fasciaParts) geo.dispose();

  // --- roof ring ----------------------------------------------------------
  // Open over the pitch, covered over the seating: the shape of an open-air
  // stadium. A lid across the whole arena encloses it like an indoor hall,
  // which is the wrong feeling for a game played under the sky — and it hides
  // the thing a car flying out of the bowl is flying up into.
  const roofY = upper.base + upper.rows * upper.rise + s.roofClearance;
  const roofSpanX = layout.halfLength + upper.inset + upper.rows * upper.tread + 900;
  const roofSpanZ = layout.halfWidth + upper.inset + upper.rows * upper.tread + 900;
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.92 });

  const roofParts: THREE.BufferGeometry[] = [];
  // Four spans round the bowl, leaving the middle open to the sky.
  const innerX = layout.halfLength + upper.inset * 0.6;
  const innerZ = layout.halfWidth + upper.inset * 0.6;
  for (const [sx, sz, px, pz] of [
    [roofSpanX * 2, roofSpanZ - innerZ, 0, (roofSpanZ + innerZ) / 2],
    [roofSpanX * 2, roofSpanZ - innerZ, 0, -(roofSpanZ + innerZ) / 2],
    [roofSpanX - innerX, innerZ * 2, (roofSpanX + innerX) / 2, 0],
    [roofSpanX - innerX, innerZ * 2, -(roofSpanX + innerX) / 2, 0],
  ] as [number, number, number, number][]) {
    const slab = new THREE.BoxGeometry(sx, 110, sz);
    slab.translate(px, roofY, pz);
    roofParts.push(slab);
  }
  const roof = new THREE.Mesh(mergeGeometries(roofParts, false), roofMat);
  group.add(roof);
  for (const geo of roofParts) geo.dispose();

  // Trusses under the covered part only.
  const trusses: THREE.BufferGeometry[] = [];
  for (let i = -6; i <= 6; i++) {
    for (const zs of [1, -1]) {
      const beam = new THREE.BoxGeometry(200, 130, roofSpanZ - innerZ);
      beam.translate((i / 6) * roofSpanX * 0.9, roofY - 130, zs * ((roofSpanZ + innerZ) / 2));
      trusses.push(beam);
    }
  }
  const truss = new THREE.Mesh(mergeGeometries(trusses, false), structure);
  group.add(truss);
  for (const geo of trusses) geo.dispose();

  // --- light banks and shafts --------------------------------------------
  // Banks along the roofline rather than four corner masts: it is what an
  // indoor arena actually has, and it gives the floor long specular streaks
  // to reflect instead of four points.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // Additive and single-sided. Double-sided cones are drawn twice over and
  // fourteen of them across the view adds up to a pale sheet over the whole
  // pitch, which is what the first attempt looked like.
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xbcd4ff,
    transparent: true,
    opacity: s.shaftOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const bankY = roofY - 420;
  const bankParts: THREE.BufferGeometry[] = [];
  for (const zs of [1, -1]) {
    for (let i = -3; i <= 3; i++) {
      const x = (i / 3) * layout.halfLength * 0.76;
      const z = zs * (layout.halfWidth + 520);
      const bank = new THREE.BoxGeometry(900, 90, 260);
      bank.translate(x, bankY, z);
      bankParts.push(bank);

      // A shaft of light down onto the pitch, on every other bank. Additive
      // cones are nothing but overdraw — each one covers a large part of the
      // screen and blends rather than occluding — and fourteen of them cost
      // real fragment time for an effect that reads just as well from six.
      if (i % 2 === 0) {
        const shaft = new THREE.Mesh(new THREE.ConeGeometry(520, bankY * 0.82, 12, 1, true), shaftMat);
        shaft.position.set(x * 0.7, bankY / 2, z * 0.55);
        shaft.rotation.z = zs * -0.18;
        group.add(shaft);
      }
    }
  }

  group.add(new THREE.Mesh(mergeGeometries(bankParts, false), lampMat));
  for (const geo of bankParts) geo.dispose();

  // --- LED ribbon and roof strips ----------------------------------------
  // Light the building with, rather than just light the building.
  //
  // `MeshBasicMaterial` with `toneMapped` off on purpose: these are supposed
  // to be brighter than the tone curve's white point so the bloom pass
  // catches them. Run through tone mapping they come out the same grey as a
  // lit wall, which is what the fascia used to look like.
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, toneMapped: false });
  const warmStripMat = new THREE.MeshBasicMaterial({ color: 0xffb257, toneMapped: false });

  // The ribbon round the top of the playable wall. It marks the line a car
  // leaves when it climbs the wall, which is information as well as decoration.
  const ledParts: THREE.BufferGeometry[] = [];
  for (const edge of edges) {
    ledParts.push(
      edgeSlab(edge, s.ledInset, 22, s.ledHeight, cfg.arena.hoardingHeight + s.ledHeight / 2, 40),
    );
  }
  group.add(new THREE.Mesh(mergeGeometries(ledParts, false), ledMat));
  for (const geo of ledParts) geo.dispose();

  // Warm strips along the inner lip of the roof, following the same footprint.
  // The roof was a grey slab with trusses under it and nothing to say it was
  // the top of a lit building.
  const stripParts: THREE.BufferGeometry[] = [];
  const stripOut = lower.inset + lower.rows * lower.tread + s.upperStep + upper.rows * upper.tread;
  for (const edge of edges) {
    stripParts.push(
      edgeSlab(edge, stripOut * 0.42, s.roofStripDepth, 34, roofY - 150, 60),
    );
  }
  group.add(new THREE.Mesh(mergeGeometries(stripParts, false), warmStripMat));
  for (const geo of stripParts) geo.dispose();

  // A second warm run lower down, at the back of the lower deck. Two lines of
  // light at different heights are what give the bowl depth; one leaves the
  // whole upper half of the frame an unbroken dark mass.
  //
  // The first attempt at this put vertical ribs down the four cut corners and
  // they read as yellow columns standing in the stands — a thing nobody would
  // build. Light in an arena follows the bowl round, it does not stand up in it.
  const ledLowParts: THREE.BufferGeometry[] = [];
  for (const edge of edges) {
    ledLowParts.push(
      edgeSlab(
        edge,
        lower.inset + lower.rows * lower.tread - 40,
        26,
        18,
        lower.base + lower.rows * lower.rise + 30,
        60,
      ),
    );
  }
  group.add(new THREE.Mesh(mergeGeometries(ledLowParts, false), warmStripMat));
  for (const geo of ledLowParts) geo.dispose();

  // --- screens -----------------------------------------------------------
  // A scoreline hanging at each end. A stadium has screens, and this one can
  // show the thing you actually want to know.
  const screens: { texture: THREE.CanvasTexture; draw: (info: StadiumInfo) => void }[] = [];
  for (const sign of [1, -1]) {
    const { texture, draw } = screenCanvas();
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(s.screenWidth, s.screenWidth * 0.5),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    board.position.set(
      sign * (layout.halfLength + lower.inset + 300),
      lower.base + lower.rows * lower.rise + s.fasciaHeight + s.screenWidth * 0.42,
      0,
    );
    board.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(board);

    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(120, s.screenWidth * 0.56, s.screenWidth * 1.06),
      structure,
    );
    housing.position.copy(board.position);
    housing.position.x += sign * 70;
    group.add(housing);
    screens.push({ texture, draw });
  }

  // --- field level -------------------------------------------------------
  // Tunnel mouths in the corners, so the pitch looks like somewhere the cars
  // came out of rather than a sealed tray.
  for (const edge of edges) {
    if (edge.length > 2000) continue; // the corner diagonals only
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(edge.length * 0.5, s.tunnelHeight, 400),
      new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 1 }),
    );
    const angle = Math.atan2(edge.dir.y, edge.dir.x);
    mouth.position.set(
      edge.mid.x + edge.normal.x * 210,
      s.tunnelHeight / 2,
      edge.mid.y + edge.normal.y * 210,
    );
    mouth.rotation.y = -angle;
    group.add(mouth);
  }

  let elapsed = 0;
  let lastText = '';
  let celebrating = 0;

  return {
    group,
    celebrate(seconds) {
      celebrating = Math.max(celebrating, seconds);
    },
    update(dt, info) {
      elapsed += dt;
      if (celebrating > 0) celebrating = Math.max(0, celebrating - dt);

      // Flashes: each speck owns a slot in a repeating cycle and is visible for
      // a few frames of it. Scaling to zero is cheaper than toggling visibility
      // on an instanced mesh and avoids rebuilding the draw list.
      for (let i = 0; i < flashCount; i++) {
        // A goal multiplies both how often a camera fires and how long it
        // stays lit, which is what turns the crowd from scenery into a
        // reaction. The golden ratio offset keeps the specks from firing in
        // visible rows.
        const excited = celebrating > 0;
        const rate = s.flashRate * (excited ? s.flashCelebrationRate : 1);
        const window = excited ? 0.12 : 0.05;
        const phase = (elapsed * rate + i * 0.6180339887) % 1;
        const on = phase < window;
        const p = flashSeats[i]!;
        const size = on ? 1 + (window - phase) * 6 : 0;
        matrix.makeScale(size, size, size);
        matrix.setPosition(p.x, p.y + 20, p.z);
        flashes.setMatrixAt(i, matrix);
      }
      flashes.instanceMatrix.needsUpdate = true;

      const text = `${info.blue}-${info.orange} ${info.clock} ${info.label}`;
      if (text !== lastText) {
        lastText = text;
        for (const screen of screens) {
          screen.draw(info);
          screen.texture.needsUpdate = true;
        }
      }
    },
  };
}
