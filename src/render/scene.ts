import * as THREE from 'three';
import { cfg } from '../config';
import { buildArenaLayout, type ArenaLayout } from '../core/arenaLayout';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { skyTexture, pitchTexture, netTexture, wallTexture } from './textures';

export interface Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Draws a frame. Goes through the bloom chain when it is on. */
  draw(): void;
  resize(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Filmic tone mapping rather than three's default clamp. Without it the
  // bright end crushes to white and everything in shadow reads as the same
  // flat navy, which is most of why the first version looked washed out.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.render.exposure;

  const scene = new THREE.Scene();
  const sky = skyTexture();
  scene.background = sky;
  // The same gradient as the environment map, so metal has something to
  // reflect. A metallic surface with no environment is just its base colour,
  // however many lights are pointed at it.
  scene.environment = sky;
  scene.environmentIntensity = cfg.render.environmentIntensity;
  // Far out on purpose. The camera can sit ten thousand units from the far
  // goal, so fog that starts anywhere near the pitch turns the whole far half
  // into haze — which is exactly what the first attempt did.
  scene.fog = new THREE.Fog(0x0b1120, 22000, 48000);

  // Near and far have to suit a pitch 10240 long.
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 10, 40000);
  camera.position.set(-2000, 400, 0);

  // Night. There is no sun, so the floodlights are the light: four cool keys
  // angled in from above the corners, which is also why the shadows under a
  // car point outward from the middle of the pitch rather than all one way.
  //
  // Only one of them casts a shadow. Four shadow maps is four extra passes
  // over the scene for a second and third shadow nobody reads at this camera
  // distance, and the one that does cast is the brightest.
  const hemi = new THREE.HemisphereLight(0x3d5578, 0x121a14, 0.5);
  scene.add(hemi);

  const corners: [number, number, number][] = [
    [1, 1, 1.0],
    [-1, 1, 0.55],
    [1, -1, 0.6],
    [-1, -1, 0.45],
  ];
  let sun: THREE.DirectionalLight | null = null;
  for (const [xs, zs, strength] of corners) {
    const lamp = new THREE.DirectionalLight(0xdce8ff, 2.5 * strength);
    lamp.position.set(xs * 5200, 5200, zs * 4400);
    scene.add(lamp);
    if (!sun) sun = lamp;
  }

  // A warm bounce off the pitch, so the undersides of cars are not black.
  const bounce = new THREE.DirectionalLight(0x6f8f72, 0.22);
  bounce.position.set(0, -1000, 0);
  scene.add(bounce);

  sun = sun!;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Tight to the pitch rather than loose around it: the same map stretched
  // over a bigger volume is what makes a shadow look like a smudge.
  const spanX = cfg.arena.halfLength * 1.05;
  const spanZ = cfg.arena.halfWidth * 1.3;
  sun.shadow.camera.left = -spanX;
  sun.shadow.camera.right = spanX;
  sun.shadow.camera.top = spanZ;
  sun.shadow.camera.bottom = -spanZ;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 16000;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 8;
  scene.add(sun);

  // The arena mesh is owned by the game, not the renderer: a round modifier can
  // change the goal dimensions, and then it has to be rebuilt.

  // Bloom, for the boost flame, the pads and the lit goal mouths. Only the
  // bright end blooms: a threshold below about 0.7 and the white pitch
  // markings start to glow, which looks like a mistake rather than an effect.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    cfg.render.bloomStrength,
    cfg.render.bloomRadius,
    cfg.render.bloomThreshold,
  );
  composer.addPass(bloom);
  // The composer works in linear space, so tone mapping has to happen at the
  // end of the chain instead of in the renderer. Without this pass the image
  // comes out of the composer looking blown out.
  composer.addPass(new OutputPass());

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function draw(): void {
    composer.render();
  }

  return { renderer, scene, camera, draw, resize };
}

/** Visual arena, built from the same layout the colliders use. */
export function buildArenaMesh(): THREE.Group {
  const layout = buildArenaLayout();
  const group = new THREE.Group();
  group.name = 'arena';

  // The floor panel keeps a plain material: the markings go on a separate
  // surface laid just above it, so the pitch can be repainted when a modifier
  // changes the goals without touching the collider geometry's mesh.
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x16351d,
    roughness: 0.95,
    metalness: 0.0,
  });
  const wallTex = wallTexture();
  wallTex.repeat.set(4, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.42,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const rampMat = new THREE.MeshStandardMaterial({
    color: 0x55637a,
    roughness: 0.38,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  // The ceiling is a playable surface but sits between the camera and the pitch,
  // so it is drawn as a faint shell rather than a solid lid.
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x5d6b82,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const goalBoxMat = new THREE.MeshStandardMaterial({
    color: 0x2b3340,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });

  const byKind: Record<string, THREE.Material> = {
    floor: floorMat,
    wall: wallMat,
    ramp: rampMat,
    ceiling: ceilingMat,
    goal: goalBoxMat,
  };

  for (const panel of layout.panels) {
    const geo = new THREE.BoxGeometry(panel.half.x * 2, panel.half.y * 2, panel.half.z * 2);
    const mesh = new THREE.Mesh(geo, byKind[panel.kind ?? 'wall'] ?? wallMat);
    mesh.position.set(panel.pos.x, panel.pos.y, panel.pos.z);
    if (panel.pitch) {
      if (panel.axis === 'z') mesh.rotation.z = panel.pitch;
      else mesh.rotation.x = panel.pitch;
    } else {
      mesh.rotation.y = panel.yaw;
    }
    mesh.receiveShadow = panel.kind !== 'ceiling';
    group.add(mesh);
  }

  group.add(buildPitch(layout));
  // The ceiling is in shot most of the time. A grid on it keeps it reading as a
  // surface you could drive on rather than as empty space.
  group.add(buildCeilingGrid(layout));
  group.add(buildStands(layout));

  for (const goal of layout.goals) {
    group.add(buildGoal(goal));
    // The wall either side of each net carries that end's colours, which is
    // the cue you read when the pitch markings are out of shot.
    const endTex = wallTexture(goal.sign > 0 ? 'orange' : 'blue');
    endTex.repeat.set(1, 1);
    const endMat = new THREE.MeshStandardMaterial({
      map: endTex,
      roughness: 0.42,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const cheekWidth = (layout.halfWidth * 2 - goal.width) / 2;
    for (const zs of [1, -1]) {
      const cheek = new THREE.Mesh(
        new THREE.PlaneGeometry(cheekWidth, layout.ceiling * 0.5),
        endMat,
      );
      cheek.position.set(
        goal.x - goal.sign * 4,
        layout.ceiling * 0.25,
        zs * (goal.width / 2 + cheekWidth / 2),
      );
      cheek.rotation.y = goal.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(cheek);
    }
  }

  return group;
}

/**
 * The painted pitch, as one textured plane just above the floor panel.
 *
 * It was drawn as lines before. Lines cannot carry mowing stripes, a tinted
 * end, or markings thick enough to read at speed, and at a distance a one-pixel
 * line either shimmers or disappears. A texture also means the goal areas are
 * repainted to match when a modifier narrows the nets.
 */
function buildPitch(layout: ArenaLayout): THREE.Mesh {
  const goalWidth = layout.goals[0]?.width ?? cfg.arena.goalWidth;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.halfLength * 2, layout.halfWidth * 2),
    new THREE.MeshStandardMaterial({
      map: pitchTexture(layout, goalWidth),
      roughness: 0.92,
      metalness: 0.0,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 1;
  mesh.receiveShadow = true;
  return mesh;
}

/** A net, a frame, and a lit mouth, per end. */
function buildGoal(goal: ArenaLayout['goals'][number]): THREE.Group {
  const group = new THREE.Group();
  const colour = goal.sign > 0 ? 0xff7043 : 0x42a5f5;
  const hw = goal.width / 2;
  const depth = cfg.arena.goalDepth;
  const inward = -goal.sign;

  // Netting on the back and sides of the box. Drawn as holes in a grid rather
  // than a solid panel, which is the whole reason a goal reads as a goal.
  // One netting material per panel, each with the tiling worked out from the
  // panel's own size. Sharing one material stretches an eight-by-eight grid
  // across the whole mouth, and the netting reads as a solid slab.
  const CELL = 110;
  const netPanel = (w: number, hgt: number): THREE.MeshStandardMaterial => {
    const tex = netTexture();
    tex.repeat.set(Math.max(1, Math.round(w / CELL)), Math.max(1, Math.round(hgt / CELL)));
    return new THREE.MeshStandardMaterial({
      map: tex,
      alphaMap: tex,
      transparent: true,
      alphaTest: 0.4,
      color: 0xeaf1ff,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
  };

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(goal.width, goal.height),
    netPanel(goal.width, goal.height),
  );
  back.position.set(goal.x - inward * depth, goal.height / 2, 0);
  back.rotation.y = goal.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  group.add(back);

  for (const zs of [1, -1]) {
    const side = new THREE.Mesh(
      new THREE.PlaneGeometry(depth, goal.height),
      netPanel(depth, goal.height),
    );
    side.position.set(goal.x - (inward * depth) / 2, goal.height / 2, zs * hw);
    group.add(side);
  }
  const roof = new THREE.Mesh(
    new THREE.PlaneGeometry(depth, goal.width),
    netPanel(depth, goal.width),
  );
  roof.position.set(goal.x - (inward * depth) / 2, goal.height, 0);
  roof.rotation.x = Math.PI / 2;
  roof.rotation.z = Math.PI / 2;
  group.add(roof);

  // Posts and crossbar, in the end's colour so which net is yours is obvious.
  const frameMat = new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.55,
    roughness: 0.3,
    metalness: 0.4,
  });
  const r = 26;
  for (const zs of [1, -1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, goal.height, 12), frameMat);
    post.position.set(goal.x, goal.height / 2, zs * hw);
    post.castShadow = true;
    group.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, goal.width, 12), frameMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(goal.x, goal.height, 0);
  bar.castShadow = true;
  group.add(bar);

  // A glow across the mouth, so a goal is visible from the other end.
  const mouth = new THREE.Mesh(
    new THREE.PlaneGeometry(goal.width, goal.height),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mouth.position.set(goal.x, goal.height / 2, 0);
  mouth.rotation.y = goal.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  group.add(mouth);

  return group;
}

/**
 * Stands, crowd and floodlights.
 *
 * Without them the arena floats in a void, which is the single biggest thing
 * separating this from the references: a stadium is mostly the stadium. The
 * crowd is one instanced mesh of flat quads — forty thousand of them cost
 * nothing as instances and are indistinguishable from spectators at this
 * distance.
 */
function buildStands(layout: ArenaLayout): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stands';
  const hl = layout.halfLength;
  const hw = layout.halfWidth;
  const tiers = 14;
  const rise = 300;
  const tread = 230;
  const start = 160;
  // The bowl starts at the top of the wall, not at floor level. Built from the
  // floor up it is perfectly correct and completely invisible: the arena is a
  // closed box, and the walls hide everything outside them.
  const base = layout.ceiling;

  const concrete = new THREE.MeshStandardMaterial({ color: 0x323a49, roughness: 0.92 });
  const seatGeo = new THREE.BoxGeometry(1, 1, 1);
  const crowd: THREE.Matrix4[] = [];
  const colours: THREE.Color[] = [];
  // Muted clothing colours, not a rainbow: a crowd reads as a crowd because it
  // is dense and slightly varied, and saturated specks look like confetti.
  const palette = [0x1d2534, 0x2a3346, 0x4a2f2a, 0x24405a, 0x3a3f4b, 0x515b6b].map(
    (c) => new THREE.Color(c),
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3(70, 90, 70);
  const pos = new THREE.Vector3();

  for (let t = 0; t < tiers; t++) {
    const inset = start + t * tread;
    const y = base + t * rise;
    const spanX = hl + inset;
    const spanZ = hw + inset;

    // The step itself, as four slabs round the bowl.
    for (const [sx, sz, px, pz] of [
      [spanX * 2 + tread * 2, tread, 0, spanZ + tread / 2],
      [spanX * 2 + tread * 2, tread, 0, -spanZ - tread / 2],
      [tread, spanZ * 2, spanX + tread / 2, 0],
      [tread, spanZ * 2, -spanX - tread / 2, 0],
    ] as [number, number, number, number][]) {
      // Solid from the bowl floor to this tier's lip rather than a thin step:
      // a staircase of floating slabs lets the sky through between the rows
      // and reads as scaffolding.
      const height = y - base + rise;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(sx, height, sz), concrete);
      slab.position.set(px, base + height / 2 - rise, pz);
      group.add(slab);
    }

    // Spectators along each step.
    const step = 150;
    for (let x = -spanX; x <= spanX; x += step) {
      for (const zs of [1, -1]) {
        pos.set(x, y + 45, zs * (spanZ + tread / 2));
        m.compose(pos, q, scale);
        crowd.push(m.clone());
        colours.push(palette[(crowd.length * 7) % palette.length]!);
      }
    }
    for (let z = -spanZ; z <= spanZ; z += step) {
      for (const xs of [1, -1]) {
        pos.set(xs * (spanX + tread / 2), y + 45, z);
        m.compose(pos, q, scale);
        crowd.push(m.clone());
        colours.push(palette[(crowd.length * 11) % palette.length]!);
      }
    }
  }

  const seats = new THREE.InstancedMesh(
    seatGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    crowd.length,
  );
  for (let i = 0; i < crowd.length; i++) {
    seats.setMatrixAt(i, crowd[i]!);
    seats.setColorAt(i, colours[i]!);
  }
  seats.instanceMatrix.needsUpdate = true;
  if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
  group.add(seats);

  // Floodlights at the corners, above the top tier.
  // Well past white so the bloom pass catches them: at night the floodlights
  // are the brightest thing in shot, and a rig lit to 1.0 looks like a grey
  // box on a pole.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.75 });
  const top = base + tiers * rise;
  for (const xs of [1, -1]) {
    for (const zs of [1, -1]) {
      const x = xs * (hl + start + tiers * tread * 0.8);
      const z = zs * (hw + start + tiers * tread * 0.8);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(40, 60, top + 1500, 8), mastMat);
      mast.position.set(x, (top + 1500) / 2, z);
      group.add(mast);
      const rig = new THREE.Mesh(new THREE.BoxGeometry(600, 160, 300), lampMat);
      rig.position.set(x, top + 1500, z);
      rig.lookAt(0, 0, 0);
      group.add(rig);
    }
  }

  return group;
}

/** Sparse grid on the underside of the ceiling. */
function buildCeilingGrid(layout: ArenaLayout): THREE.LineSegments {
  const hl = layout.halfLength;
  const hw = layout.halfWidth;
  const y = layout.ceiling - 2;
  const spacing = 1024;
  const pts: number[] = [];
  for (let x = -hl; x <= hl + 0.001; x += spacing) pts.push(x, y, -hw, x, y, hw);
  for (let z = -hw; z <= hw + 0.001; z += spacing) pts.push(-hl, y, z, hl, y, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x5c76ad, transparent: true, opacity: 0.3 }),
  );
}

/**
 * Frees a built arena group before dropping it.
 *
 * Textures as well as geometry and materials. The arena is rebuilt whenever a
 * round changes the goals, and the pitch alone is a 2560 by 2048 canvas, so
 * leaving the maps behind leaks several megabytes per round — which only shows
 * up twenty rounds into a long run, by which point nothing obviously points at
 * the arena being the cause.
 */
export function disposeArenaMesh(group: THREE.Group): void {
  const freeMaterial = (m: THREE.Material): void => {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    m.dispose();
  };
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) for (const m of mat) freeMaterial(m);
    else if (mat) freeMaterial(mat);
  });
}
