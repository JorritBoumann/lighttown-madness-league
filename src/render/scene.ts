import * as THREE from 'three';
import { cfg } from '../config';
import { buildArenaLayout, type ArenaLayout } from '../core/arenaLayout';

export interface Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d16);

  // Near and far have to suit a pitch 10240 long.
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 10, 40000);
  camera.position.set(-2000, 400, 0);

  const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x2a3348, 1.1);
  scene.add(hemi);

  // Low fill from the far end, so the car reads against the floor at both ends.
  const fill = new THREE.DirectionalLight(0x6f9bd8, 0.4);
  fill.position.set(-4000, 2000, -2000);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2500, 5000, 2000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = cfg.arena.halfLength * 1.2;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 16000;
  scene.add(sun);

  // The arena mesh is owned by the game, not the renderer: a round modifier can
  // change the goal dimensions, and then it has to be rebuilt.

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, resize };
}

/** Visual arena, built from the same layout the colliders use. */
export function buildArenaMesh(): THREE.Group {
  const layout = buildArenaLayout();
  const group = new THREE.Group();
  group.name = 'arena';

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x2c3c61,
    roughness: 0.85,
    metalness: 0.05,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x3a4a72,
    roughness: 0.55,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const rampMat = new THREE.MeshStandardMaterial({
    color: 0x44557f,
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  // The ceiling is a playable surface but sits between the camera and the pitch,
  // so it is drawn as a faint shell rather than a solid lid.
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x33415f,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const goalBoxMat = new THREE.MeshStandardMaterial({
    color: 0x1d2742,
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

  group.add(buildFloorMarkings(layout));
  // The ceiling is in shot most of the time. A grid on it keeps it reading as a
  // surface you could drive on rather than as empty space.
  group.add(buildCeilingGrid(layout));

  // Goal mouths, tinted per end.
  for (const goal of layout.goals) {
    const mat = new THREE.MeshStandardMaterial({
      color: goal.sign > 0 ? 0xff7043 : 0x42a5f5,
      emissive: goal.sign > 0 ? 0x702a10 : 0x113a60,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(goal.width, goal.height), mat);
    plane.position.set(goal.x, goal.height / 2, 0);
    plane.rotation.y = goal.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(plane);

    // Frame around the mouth.
    const hw = goal.width / 2;
    const frame = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(goal.x, 2, -hw),
      new THREE.Vector3(goal.x, goal.height, -hw),
      new THREE.Vector3(goal.x, goal.height, hw),
      new THREE.Vector3(goal.x, 2, hw),
    ]);
    group.add(
      new THREE.Line(
        frame,
        new THREE.LineBasicMaterial({ color: goal.sign > 0 ? 0xffa183 : 0x8fd0ff }),
      ),
    );
  }

  return group;
}

/**
 * Floor grid, centre circle and halfway line. The grid is the main cue for
 * speed and distance; without it the arena reads as a flat void and nothing
 * feels fast.
 */
function buildFloorMarkings(layout: ArenaLayout): THREE.Group {
  const group = new THREE.Group();
  const hl = layout.halfLength;
  const hw = layout.halfWidth;
  const spacing = 512;
  const y = 2;

  const grid: number[] = [];
  for (let x = -hl; x <= hl + 0.001; x += spacing) grid.push(x, y, -hw, x, y, hw);
  for (let z = -hw; z <= hw + 0.001; z += spacing) grid.push(-hl, y, z, hl, y, z);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  group.add(
    new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x4f6ba3, transparent: true, opacity: 0.4 }),
    ),
  );

  const lineMat = new THREE.LineBasicMaterial({ color: 0x8fa8dc, transparent: true, opacity: 0.75 });
  const circle: THREE.Vector3[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    circle.push(new THREE.Vector3(Math.cos(a) * 900, y + 1, Math.sin(a) * 900));
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), lineMat));
  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, y + 1, -hw),
        new THREE.Vector3(0, y + 1, hw),
      ]),
      lineMat,
    ),
  );

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

/** Frees a built arena group's geometry and materials before dropping it. */
export function disposeArenaMesh(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat?.dispose();
  });
}
