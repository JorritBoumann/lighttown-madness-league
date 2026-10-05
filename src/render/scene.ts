import * as THREE from 'three';
import { cfg } from '../config';
import { buildArenaLayout, type ArenaLayout } from '../core/arenaLayout';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  skyTexture,
  pitchTexture,
  netTexture,
  wallTexture,
  rampTexture,
  rampNormalMap,
  floorNormalMap,
  wallNormalMap,
  wallRepeat,
} from './textures';
import { ResolutionScaler } from './resolutionScaler';

export interface Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Draws a frame. Goes through the bloom chain when it is on. */
  draw(): void;
  /** Feeds the frame time to the adaptive resolution and resizes if it moved. */
  pace(frameMs: number): void;
  /** Current pixel ratio, for the debug readout. */
  readonly pixelRatio: number;
  resize(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // The starting point is the display's own ratio; the scaler takes it from
  // here based on measured frame time.
  const scaler = new ResolutionScaler(Math.min(devicePixelRatio, 2));
  renderer.setPixelRatio(scaler.scale);
  renderer.shadowMap.enabled = true;
  // PCFSoft was removed in this version of three and silently downgraded,
  // which meant a warning on every boot for a setting that was not applying.
  renderer.shadowMap.type = THREE.PCFShadowMap;
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
  scene.fog = new THREE.Fog(0xb9d2e8, 26000, 54000);

  // Near and far have to suit a pitch 10240 long.
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 10, 40000);
  camera.position.set(-2000, 400, 0);

  // Daylight. One sun, high and to one side, with the sky filling the shadows.
  // The floodlight banks stay as furniture but do no lighting work.
  // Generous sky fill. One sun plus a roof over the seating leaves the stands
  // in deep shadow, which is physically right and reads as murk — outdoors
  // the sky itself lights everything the sun does not.
  const hemi = new THREE.HemisphereLight(0xccdffa, 0x6f8f5e, 1.25);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0xbcd4f0, 0.35);
  fill.position.set(-4000, 2600, -2600);
  scene.add(fill);

  let sun: THREE.DirectionalLight | null = new THREE.DirectionalLight(0xfff6e8, 2.4);
  sun.position.set(3200, 6000, 2400);
  scene.add(sun);

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
    // A hidden or detached canvas reports zero, and so does a window that has
    // not laid out yet. Sizing the buffers to nothing there leaves a 0x0 draw
    // target that renders nothing and never recovers, because no resize event
    // follows. This used to be reachable only from a window resize; the
    // adaptive resolution calls it during play, so it has to be safe.
    if (w < 1 || h < 1) return;
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

  function pace(frameMs: number): void {
    const next = scaler.sample(frameMs);
    if (next === null) return;
    renderer.setPixelRatio(next);
    resize();
  }

  return {
    renderer,
    scene,
    camera,
    draw,
    pace,
    resize,
    get pixelRatio() {
      return scaler.scale;
    },
  };
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
    color: 0x2f6b36,
    roughness: 0.95,
    metalness: 0.0,
  });
  // The arena wall comes in two bands, and this is the change that stops the
  // environment feeling empty. The playfield is a sealed box 2044 tall whose
  // walls are driveable, so it used to present twenty metres of blank wall at
  // exactly the height you look at while driving. Now only the bottom is
  // solid; above it the wall is glass, and the crowd is right there behind it.
  // One material per distinct run of wall, tiled to that run's own length.
  //
  // A fixed number of repeats across walls of different lengths stretches the
  // texture differently on each: at four tiles the long walls were spanning
  // two and a half thousand units per tile, so every edge was soft and the
  // hoardings read as blurred rectangles. Cached by repeat count, so the two
  // side walls share one material rather than making their own.
  const wallMaterials = new Map<number, THREE.MeshStandardMaterial>();
  const wallMaterialFor = (lengthUnits: number): THREE.MeshStandardMaterial => {
    const tiles = wallRepeat(lengthUnits);
    const existing = wallMaterials.get(tiles);
    if (existing) return existing;
    const map = wallTexture();
    map.repeat.set(tiles, 1);
    const relief = wallNormalMap();
    relief.wrapS = relief.wrapT = THREE.RepeatWrapping;
    relief.repeat.set(tiles, 1);
    const material = new THREE.MeshStandardMaterial({
      map,
      normalMap: relief,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.46,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    wallMaterials.set(tiles, material);
    return material;
  };
  const wallMat = wallMaterialFor(cfg.arena.halfLength * 2);
  // Front faces only, and barely there. Double-sided glass with depth writing
  // off stacks every panel the view passes through — the far wall, both side
  // walls, the near wall — and four layers of a 12% tint is an opaque white
  // sheet. A dark tint also keeps the crowd behind it legible, which is the
  // entire point of making the wall transparent.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6f8dae,
    transparent: true,
    opacity: 0.07,
    roughness: 0.25,
    metalness: 0,
    envMapIntensity: 0.15,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  // Ramps get their own material per (orientation, tile count). The old one
  // was a single flat pale colour, and because the ramp is a quarter of the
  // frame whenever the camera is low near a wall, that one fill was the
  // largest and emptiest surface in the arena. It now continues the kickplate
  // above it, tiled on the same rhythm as the hoardings.
  const rampMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const rampMaterialFor = (lengthUnits: number, rotated: boolean): THREE.MeshStandardMaterial => {
    const tiles = wallRepeat(lengthUnits);
    const key = `${tiles}:${rotated}`;
    const existing = rampMaterials.get(key);
    if (existing) return existing;
    const map = rampTexture(rotated);
    const relief = rampNormalMap(rotated);
    relief.wrapS = relief.wrapT = THREE.RepeatWrapping;
    for (const tex of [map, relief]) {
      if (rotated) tex.repeat.set(1, tiles);
      else tex.repeat.set(tiles, 1);
    }
    const material = new THREE.MeshStandardMaterial({
      map,
      normalMap: relief,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.42,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    rampMaterials.set(key, material);
    return material;
  };
  const rampMat = rampMaterialFor(cfg.arena.halfLength * 2, false);
  // The ceiling is a playable surface but sits between the camera and the pitch,
  // so it is drawn as a faint shell rather than a solid lid.
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xc5d2e0,
    transparent: true,
    opacity: 0.04,
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

  const solidTop = cfg.arena.hoardingHeight;
  for (const panel of layout.panels) {
    // A plain wall is drawn as two panels: solid hoardings up to the top of the
    // boards, glass from there to the ceiling. Everything else is unchanged.
    const bands: { height: number; centre: number; material: THREE.Material }[] =
      panel.kind === 'wall' && !panel.pitch && panel.half.y * 2 > solidTop * 1.5
        ? [
            {
              height: solidTop,
              centre: solidTop / 2,
              // Tiled to this run's own length, so nothing is stretched.
              material: wallMaterialFor(Math.max(panel.half.x, panel.half.z) * 2),
            },
            {
              height: panel.half.y * 2 - solidTop,
              centre: solidTop + (panel.half.y * 2 - solidTop) / 2,
              material: glassMat,
            },
          ]
        : [
            {
              height: panel.half.y * 2,
              centre: panel.pos.y,
              material:
                panel.kind === 'ramp'
                  ? // The long side of the box is the run of wall it follows;
                    // the short side is the slope. Which of the two is `u` on
                    // the box's top face depends on that, so the texture is
                    // generated to match rather than tiled blindly.
                    rampMaterialFor(
                      Math.max(panel.half.x, panel.half.z) * 2,
                      panel.half.z > panel.half.x,
                    )
                  : (byKind[panel.kind ?? 'wall'] ?? wallMat),
            },
          ];

    for (const band of bands) {
      const geo = new THREE.BoxGeometry(panel.half.x * 2, band.height, panel.half.z * 2);
      const mesh = new THREE.Mesh(geo, band.material);
      mesh.position.set(panel.pos.x, band.centre, panel.pos.z);
      if (panel.pitch) {
        if (panel.axis === 'z') mesh.rotation.z = panel.pitch;
        else mesh.rotation.x = panel.pitch;
      } else {
        mesh.rotation.y = panel.yaw;
      }
      mesh.receiveShadow = panel.kind !== 'ceiling' && band.material === wallMat;
      group.add(mesh);
    }
  }

  group.add(buildPitch(layout));
  // The ceiling is in shot most of the time. A grid on it keeps it reading as a
  // surface you could drive on rather than as empty space.
  group.add(buildCeilingGrid(layout));

  for (const goal of layout.goals) {
    group.add(buildGoal(goal));
    // The wall either side of each net carries that end's colours, which is
    // the cue you read when the pitch markings are out of shot.
    const cheekW = (layout.halfWidth * 2 - goal.width) / 2;
    const endTex = wallTexture(goal.sign > 0 ? 'orange' : 'blue');
    endTex.repeat.set(wallRepeat(cheekW), 1);
    const endRelief = wallNormalMap();
    endRelief.wrapS = endRelief.wrapT = THREE.RepeatWrapping;
    endRelief.repeat.set(wallRepeat(cheekW), 1);
    const endMat = new THREE.MeshStandardMaterial({
      map: endTex,
      normalMap: endRelief,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.42,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const cheekWidth = cheekW;
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
 * It was drawn as lines before. Lines cannot carry surface banding, a tinted
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
      // Grain, tiled small and often. The markings and light pools live in the
      // big albedo; this is the fine texture underneath them, which is what
      // makes a glancing highlight break up instead of sliding across a sheet
      // of glass.
      normalMap: (() => {
        const grain = floorNormalMap();
        // Tiled small and often: at 48 tiles across a pitch this wide each
        // speck is the size of a car and the floor reads as crumpled paper.
        // The grain wants to be below the size of anything on it.
        grain.repeat.set(130, 104);
        return grain;
      })(),
      normalScale: new THREE.Vector2(0.2, 0.2),
      // Some sheen, so the car and the lit goal mouths catch on it. A fully
      // matte floor is the giveaway that a scene is untextured geometry.
      roughness: 0.55,
      metalness: 0.08,
      envMapIntensity: cfg.render.pitchEnvIntensity,
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
  // Named so the goal celebration can find it and bulge it.
  back.name = `net-back-${goal.sign}`;
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
  mouth.name = `goal-mouth-${goal.sign}`;
  (mouth.material as THREE.Material).userData.baseOpacity = 0.16;
  group.add(mouth);

  // A surround around the mouth, lit in the end's colour.
  //
  // The goal is the thing you aim at from the far end of a pitch ten thousand
  // units long, and a dark rectangle with thin posts disappears at that
  // distance. The surround gives it a shape to find.
  const surroundMat = new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.9,
    roughness: 0.35,
    metalness: 0.45,
  });
  // The celebration flares these, so it needs to find them and know what to
  // put them back to.
  surroundMat.userData.baseEmissive = 0.9;
  surroundMat.name = `goal-surround-${goal.sign}`;
  const band = 70;
  const surroundX = goal.x + goal.sign * 20;
  // Lintel across the top, then an upright each side of the mouth.
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(44, band, goal.width + band * 2),
    surroundMat,
  );
  lintel.position.set(surroundX, goal.height + band / 2, 0);
  group.add(lintel);
  for (const zs of [1, -1]) {
    const upright = new THREE.Mesh(
      new THREE.BoxGeometry(44, goal.height + band, band),
      surroundMat,
    );
    upright.position.set(surroundX, (goal.height + band) / 2, zs * (goal.width / 2 + band / 2));
    group.add(upright);
  }

  // And a lit floor strip across the line, which is what tells you the ball
  // actually crossed rather than rattled the frame.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(goal.width, 90),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.PI / 2;
  line.position.set(goal.x, 3, 0);
  group.add(line);

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


/**
 * Captures the arena's own reflections, once, from the middle of the pitch.
 *
 * Better than a photographed radiance map, not just cheaper. Every reflective
 * surface here — the car's paint and clear coat, the ball's panels, the glass,
 * the floor sheen — was reflecting a 64x256 gradient drawn by hand, which is
 * why they all read as plastic. A downloaded map of somebody else's sports hall
 * would be an improvement and would still be wrong: it would put their lights
 * and their roofline into our paintwork.
 *
 * So the scene photographs itself. Six faces at 256, prefiltered into a
 * radiance map, and the car now carries this building's light banks across its
 * flanks as it turns.
 *
 * Called once, before any car or ball exists, which is deliberate twice over:
 * those move, so baking them in would smear a stale car across every
 * reflection, and capturing with an environment already assigned would feed
 * the map back into itself.
 */
export function captureArenaEnvironment(
  render: Renderer,
  height: number,
): THREE.Texture | null {
  const { renderer, scene } = render;
  const previous = scene.environment;
  // Capture the arena lit by lights and sky alone; an environment already in
  // place would be reflected into its own replacement.
  scene.environment = null;

  const target = new THREE.WebGLCubeRenderTarget(cfg.render.envCaptureSize);
  const camera = new THREE.CubeCamera(10, 40000, target);
  camera.position.set(0, height, 0);

  try {
    camera.update(renderer, scene);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const map = pmrem.fromCubemap(target.texture).texture;
    pmrem.dispose();
    target.dispose();
    return map;
  } catch (error) {
    // A capture failing should cost reflections, not the game.
    console.warn('Environment capture failed; keeping the generated sky.', error);
    scene.environment = previous;
    target.dispose();
    return null;
  }
}
