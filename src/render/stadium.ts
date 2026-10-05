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
}

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

  const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3241, roughness: 0.94 });
  const structure = new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.8, metalness: 0.3 });

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
          const block = Math.floor((i / count) * s.gangways * 2);
          if (block % 2 === 1 && Math.abs(((i / count) * s.gangways * 2) % 1) < 0.22) continue;

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
  // Muted clothing, not a rainbow: a crowd reads as a crowd because it is dense
  // and slightly varied, and saturated specks look like confetti.
  const palette = [0x1d2534, 0x2a3346, 0x4a2f2a, 0x24405a, 0x3a3f4b, 0x515b6b, 0x6b5340].map(
    (c) => new THREE.Color(c),
  );
  const people = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    // A little self-lit. The four keys are aimed at the pitch, so lighting the
    // crowd off them alone leaves it almost black at gameplay distance — and
    // a crowd you cannot see is the same as no crowd. This stands in for the
    // house lights over the seating.
    new THREE.MeshStandardMaterial({
      roughness: 0.88,
      emissive: 0x161d2b,
      emissiveIntensity: 1,
    }),
    crowd.length,
  );
  const colour = new THREE.Color();
  for (let i = 0; i < crowd.length; i++) {
    people.setMatrixAt(i, crowd[i]!.m);
    colour.copy(palette[i % palette.length]!);
    // Rows further back sit in deeper shadow.
    colour.multiplyScalar(0.85 + crowd[i]!.shade * 0.55);
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
    emissive: 0x24304a,
    emissiveIntensity: 0.5,
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

  // --- roof --------------------------------------------------------------
  // Enclosing the volume is the single biggest thing: open to the sky, the
  // whole arena reads as a lot with seating round it rather than a building.
  const roofY = upper.base + upper.rows * upper.rise + s.roofClearance;
  const roofSpanX = layout.halfLength + upper.inset + upper.rows * upper.tread + 900;
  const roofSpanZ = layout.halfWidth + upper.inset + upper.rows * upper.tread + 900;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(roofSpanX * 2, 120, roofSpanZ * 2),
    new THREE.MeshStandardMaterial({ color: 0x141922, roughness: 0.95 }),
  );
  roof.position.y = roofY;
  group.add(roof);

  // Trusses, so the underside of the roof is structure rather than a lid.
  const trusses: THREE.BufferGeometry[] = [];
  for (let i = -6; i <= 6; i++) {
    const beam = new THREE.BoxGeometry(220, 150, roofSpanZ * 2);
    beam.translate((i / 6) * roofSpanX * 0.86, roofY - 150, 0);
    trusses.push(beam);
  }
  for (let i = -4; i <= 4; i++) {
    const beam = new THREE.BoxGeometry(roofSpanX * 2, 110, 180);
    beam.translate(0, roofY - 300, (i / 4) * roofSpanZ * 0.86);
    trusses.push(beam);
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

  return {
    group,
    update(dt, info) {
      elapsed += dt;

      // Flashes: each speck owns a slot in a repeating cycle and is visible for
      // a few frames of it. Scaling to zero is cheaper than toggling visibility
      // on an instanced mesh and avoids rebuilding the draw list.
      for (let i = 0; i < flashCount; i++) {
        const phase = (elapsed * s.flashRate + i * 0.6180339887) % 1;
        const on = phase < 0.05;
        const p = flashSeats[i]!;
        const size = on ? 1 + (0.05 - phase) * 6 : 0;
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
