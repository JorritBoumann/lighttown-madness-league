import * as THREE from 'three';
import { cfg } from '../config';
import { buildArenaLayout } from '../core/arenaLayout';

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
  scene.fog = new THREE.Fog(0x0a0d16, 90, 220);

  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.1, 600);
  camera.position.set(-20, 8, 0);

  const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x2a3348, 1.15);
  scene.add(hemi);

  // Low fill from the far end, so the car reads against the floor at both ends.
  const fill = new THREE.DirectionalLight(0x6f9bd8, 0.45);
  fill.position.set(-50, 20, -20);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(40, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = cfg.arena.length * 0.7;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.far = 220;
  scene.add(sun);

  scene.add(buildArenaMesh());

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
function buildArenaMesh(): THREE.Group {
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

  // The ceiling is a playable surface but sits between the camera and the pitch,
  // so it is drawn as a faint shell rather than a solid lid.
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x3a4a72,
    roughness: 0.55,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ceilingY = cfg.arena.wallHeight + 1;

  for (const [i, panel] of layout.panels.entries()) {
    const isFloor = i === 0;
    const isCeiling = !isFloor && panel.pos.y >= ceilingY - 0.001 && panel.half.x > 10;
    const geo = new THREE.BoxGeometry(panel.half.x * 2, panel.half.y * 2, panel.half.z * 2);
    const mesh = new THREE.Mesh(geo, isFloor ? floorMat : isCeiling ? ceilingMat : wallMat);
    mesh.position.set(panel.pos.x, panel.pos.y, panel.pos.z);
    if (panel.pitch) {
      if (panel.axis === 'z') mesh.rotation.z = panel.pitch;
      else mesh.rotation.x = panel.pitch;
    } else {
      mesh.rotation.y = panel.yaw;
    }
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Floor grid: the main cue for speed and distance. Without it the arena reads
  // as a flat void and nothing feels fast. Bounded to the pitch, so it does not
  // poke through the walls.
  group.add(buildFloorGrid(layout.halfLength, layout.halfWidth));

  // Centre circle and halfway line, so you can read your position at a glance.
  const lineMat = new THREE.LineBasicMaterial({ color: 0x7e9ad6, transparent: true, opacity: 0.7 });
  const circlePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    circlePts.push(new THREE.Vector3(Math.cos(a) * 9, 0.02, Math.sin(a) * 9));
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts), lineMat));
  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.02, -layout.halfWidth),
        new THREE.Vector3(0, 0.02, layout.halfWidth),
      ]),
      lineMat,
    ),
  );

  // Goal mouths, tinted per end.
  for (const goal of layout.goals) {
    const mat = new THREE.MeshStandardMaterial({
      color: goal.sign > 0 ? 0xff7043 : 0x42a5f5,
      emissive: goal.sign > 0 ? 0x702a10 : 0x113a60,
      roughness: 0.4,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(goal.width, goal.height), mat);
    plane.position.set(goal.x, goal.height / 2, 0);
    plane.rotation.y = goal.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(plane);

    // Frame around the mouth.
    const frameMat = new THREE.LineBasicMaterial({
      color: goal.sign > 0 ? 0xffa183 : 0x8fd0ff,
    });
    const hw = goal.width / 2;
    const frame = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(goal.x, 0.05, -hw),
      new THREE.Vector3(goal.x, goal.height, -hw),
      new THREE.Vector3(goal.x, goal.height, hw),
      new THREE.Vector3(goal.x, 0.05, hw),
    ]);
    group.add(new THREE.Line(frame, frameMat));
  }

  return group;
}

/** Grid lines on the floor, clipped to the playing surface. */
function buildFloorGrid(halfLength: number, halfWidth: number, spacing = 6): THREE.LineSegments {
  const pts: number[] = [];
  const y = 0.015;
  for (let x = -halfLength; x <= halfLength + 0.001; x += spacing) {
    pts.push(x, y, -halfWidth, x, y, halfWidth);
  }
  for (let z = -halfWidth; z <= halfWidth + 0.001; z += spacing) {
    pts.push(-halfLength, y, z, halfLength, y, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x4f6ba3, transparent: true, opacity: 0.45 }),
  );
}
