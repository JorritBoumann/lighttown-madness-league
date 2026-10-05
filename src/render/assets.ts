import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { cfg } from '../config';

/**
 * Optional art files, and the procedural fallback when they are absent.
 *
 * Everything in the game is generated in code, which costs nothing and carries
 * no licence, but has a ceiling: an artist's bodywork and a photographed
 * environment are out of reach of hand-written canvas code. So both are
 * *optional*. Drop a file in `public/assets` and it is used; leave the folder
 * empty and the game is exactly what it was.
 *
 * That is the point of the design rather than a convenience. It means the
 * repository stays asset-free and licence-free by default, an asset is never a
 * build dependency, and a missing or broken file degrades to something that
 * works instead of a blank screen.
 *
 * Files are fetched with a HEAD first. A loader pointed at a missing file logs
 * a network error and throws, and a console full of red on every boot of a
 * game that is working perfectly is its own kind of bug.
 */

export interface GameAssets {
  /** Radiance map for reflections, if one was supplied. */
  environment: THREE.Texture | null;
  /** Car body, already scaled and oriented to the hitbox, if one was supplied. */
  carModel: THREE.Group | null;
}

export const EMPTY_ASSETS: GameAssets = { environment: null, carModel: null };

/**
 * Whether a file is really there.
 *
 * A 200 is not enough. A dev server with a single-page fallback answers every
 * unknown path with `index.html` and a 200, so the probe said yes for files
 * that do not exist and the loaders were handed HTML — "Bad File Format: bad
 * initial token" from the radiance loader, and `Unexpected token '<'` from the
 * model loader, on every boot. The content type is what distinguishes a real
 * asset from the index page wearing its name.
 */
async function present(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    return !type.includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Fits a loaded model to the car's hitbox.
 *
 * A generated or downloaded car arrives at whatever scale and facing its author
 * used, and in this game the car's forward is +x with the driver's right at -z.
 * Rather than ask for a file prepared just so, the model is measured and fitted:
 * scaled so its longest horizontal axis matches the hitbox length, turned so
 * that axis is +x, and dropped so its underside sits on the wheels' contact
 * line rather than through the floor.
 */
function fitToHitbox(model: THREE.Group): THREE.Group {
  const h = cfg.car.hitbox;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  const wrapper = new THREE.Group();
  // Longest horizontal axis is the length of the car; if it runs along z the
  // model was authored facing sideways to this game's convention.
  if (size.z > size.x) {
    model.rotation.y = Math.PI / 2;
    const swap = size.x;
    size.x = size.z;
    size.z = swap;
  }
  const scale = size.x > 1e-6 ? h.length / size.x : 1;
  model.scale.setScalar(scale);
  model.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
  // Sit the model's underside where the tyres meet the road.
  model.position.y += -h.height / 2 + (size.y * scale) / 2;

  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  wrapper.add(model);
  return wrapper;
}

export async function loadAssets(renderer: THREE.WebGLRenderer): Promise<GameAssets> {
  const out: GameAssets = { environment: null, carModel: null };

  const [hasEnv, hasCar] = await Promise.all([
    present(cfg.assets.environment),
    present(cfg.assets.carModel),
  ]);

  if (hasEnv) {
    try {
      const hdr = await new HDRLoader().loadAsync(cfg.assets.environment);
      // A radiance map has to be prefiltered before it can light anything;
      // handing the raw equirect straight to scene.environment gives hard,
      // wrong reflections.
      const pmrem = new THREE.PMREMGenerator(renderer);
      out.environment = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
    } catch (error) {
      console.warn('Environment map failed to load; using the generated sky.', error);
    }
  }

  if (hasCar) {
    try {
      const gltf = await new GLTFLoader().loadAsync(cfg.assets.carModel);
      out.carModel = fitToHitbox(gltf.scene);
    } catch (error) {
      console.warn('Car model failed to load; using the generated body.', error);
    }
  }

  return out;
}
