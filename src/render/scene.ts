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

  const hemi = new THREE.HemisphereLight(0x8fb6ff, 0x1a2033, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
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
    color: 0x1b2742,
    roughness: 0.85,
    metalness: 0.05,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x263455,
    roughness: 0.6,
    metalness: 0.15,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });

  for (const [i, panel] of layout.panels.entries()) {
    const isFloor = i === 0;
    const geo = new THREE.BoxGeometry(panel.half.x * 2, panel.half.y * 2, panel.half.z * 2);
    const mesh = new THREE.Mesh(geo, isFloor ? floorMat : wallMat);
    mesh.position.set(panel.pos.x, panel.pos.y, panel.pos.z);
    mesh.rotation.y = panel.yaw;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Centre circle and halfway line, so you can read your position at a glance.
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5f7cc0, transparent: true, opacity: 0.55 });
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
