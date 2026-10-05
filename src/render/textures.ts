import * as THREE from 'three';
import type { ArenaLayout } from '../core/arenaLayout';

/**
 * Textures drawn at runtime on a canvas.
 *
 * The game ships no image files on purpose — the same decision as the
 * synthesised audio — so everything here is painted in code. That is also why
 * the pitch markings can respond to a round modifier: a narrower net redraws
 * the goal areas to match rather than leaving paint where the posts used to be.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  return [el, ctx];
}

function finish(el: HTMLCanvasElement, repeat = false): THREE.Texture {
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Sky, as an equirectangular gradient.
 *
 * Doubles as the environment map. That is most of why the car and ball stop
 * looking like flat plastic: a metal surface with nothing to reflect has only
 * its own base colour, however many lights are pointed at it.
 */
export function skyTexture(): THREE.Texture {
  const [el, ctx] = canvas(64, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  // Night. Dark overhead, with a lift towards the horizon where the
  // floodlights catch the air above the bowl — a flat black sky reads as a
  // missing background rather than as night.
  g.addColorStop(0.0, '#04070e');
  g.addColorStop(0.34, '#0a1324');
  g.addColorStop(0.47, '#1b2b45');
  g.addColorStop(0.5, '#243550');
  g.addColorStop(0.54, '#12192a');
  g.addColorStop(1.0, '#070a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);

  // A scatter of stars in the upper half. Faint on purpose: they should be
  // something you notice on a replay, not a planetarium.
  ctx.fillStyle = 'rgba(226,236,255,0.5)';
  for (let i = 0; i < 90; i++) {
    const x = (i * 29.7) % 64;
    const y = (i * 17.3) % 110;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = finish(el);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/** The pitch: banded surface, markings, and a tinted area at each end. */
export function pitchTexture(layout: ArenaLayout, goalWidth: number): THREE.Texture {
  const W = 2560;
  const H = 2048;
  const [el, ctx] = canvas(W, H);
  const hl = layout.halfLength;
  const hw = layout.halfWidth;
  // World units to pixels. The canvas matches the pitch aspect exactly, so a
  // circle drawn here is still a circle on the floor.
  const sx = W / (hl * 2);
  const sz = H / (hw * 2);
  const px = (x: number) => (x + hl) * sx;
  const pz = (z: number) => (z + hw) * sz;
  const len = (uu: number) => uu * sx;

  // Banding across the short axis. Not mowing stripes: this is a cool synthetic
  // surface rather than grass, so the bands read as panels laid across the
  // pitch. They stay either way, because alternating bands passing under the
  // car are a large part of how fast the game feels.
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2b3b5c' : '#253454';
    ctx.fillRect((i / stripes) * W, 0, W / stripes + 1, H);
  }

  // A vignette, so the middle of the pitch is not a flat slab of one colour.
  // Stronger falloff than daylight wants: under floodlights the middle of the
  // pitch is the brightest thing in the arena and the corners fall away.
  const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.66);
  vg.addColorStop(0, 'rgba(214,236,255,0.10)');
  vg.addColorStop(0.55, 'rgba(0,0,0,0.12)');
  vg.addColorStop(1, 'rgba(0,0,0,0.46)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Team areas in front of each net, tinted rather than painted solid: this is
  // the cue that tells you which way you are attacking at a glance.
  const mouth = goalWidth / 2;
  for (const [sign, tint] of [
    [1, 'rgba(255,112,67,0.26)'],
    // Cyan rather than the team's own blue. On a cool floor a blue tint over
    // blue is almost no tint at all, and the end you are attacking has to be
    // readable at a glance: the orange end got that for free, this one did not.
    [-1, 'rgba(120,226,255,0.46)'],
  ] as [number, string][]) {
    const depth = len(1700);
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.ellipse(px(sign * hl), pz(0), depth, (mouth / (hw * 2)) * H * 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Reflections of the light banks overhead, painted on.
  //
  // A real reflection means drawing the scene a second time into a render
  // target, which is a lot of frame for something the camera only ever sees at
  // a glancing angle. Painted streaks under each bank read the same at this
  // angle and cost nothing — and a floor with the lights in it is most of what
  // makes an indoor arena look indoor.
  const banks = 7;
  for (const zs of [1, -1]) {
    for (let i = 0; i < banks; i++) {
      const bx = px(((i - (banks - 1) / 2) / ((banks - 1) / 2)) * hl * 0.76);
      const bz = pz(zs * hw * 0.74);
      const pool = ctx.createRadialGradient(bx, bz, 0, bx, bz, len(1500));
      pool.addColorStop(0, 'rgba(196,222,255,0.20)');
      pool.addColorStop(0.45, 'rgba(176,205,245,0.07)');
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      // Stretched towards the middle of the pitch, the way a reflection of a
      // long bank of lights elongates away from you.
      ctx.translate(bx, bz);
      ctx.scale(1, 2.1);
      ctx.translate(-bx, -bz);
      ctx.fillStyle = pool;
      ctx.fillRect(bx - len(1600), bz - len(1600), len(3200), len(3200));
      ctx.restore();
    }
  }

  // Markings stay bright: they are painted lines catching floodlight, and they
  // are also how you read your position at speed.
  ctx.strokeStyle = 'rgba(238,246,255,0.80)';
  ctx.lineCap = 'round';

  // Halfway line and centre circles.
  ctx.lineWidth = len(26);
  ctx.beginPath();
  ctx.moveTo(px(0), pz(-hw));
  ctx.lineTo(px(0), pz(hw));
  ctx.stroke();
  for (const r of [900, 300]) {
    ctx.beginPath();
    ctx.arc(px(0), pz(0), len(r), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(238,246,255,0.80)';
  ctx.beginPath();
  ctx.arc(px(0), pz(0), len(50), 0, Math.PI * 2);
  ctx.fill();

  // Pitch outline, inset so it is not swallowed by the wall chamfer.
  ctx.lineWidth = len(22);
  ctx.strokeRect(px(-hl) + len(60), pz(-hw) + len(60), len(hl * 2) - len(120), len(hw * 2) - len(120));

  for (const sign of [1, -1]) {
    // Goal area: a box the width of the posts, and an arc beyond it.
    const boxDepth = len(1000);
    const x0 = px(sign * hl) - sign * boxDepth;
    ctx.lineWidth = len(22);
    ctx.beginPath();
    ctx.moveTo(px(sign * hl), pz(-mouth));
    ctx.lineTo(x0, pz(-mouth));
    ctx.lineTo(x0, pz(mouth));
    ctx.lineTo(px(sign * hl), pz(mouth));
    ctx.stroke();

    // The arc a keeper works along.
    ctx.beginPath();
    ctx.arc(
      px(sign * hl),
      pz(0),
      len(2300),
      sign > 0 ? Math.PI * 0.72 : -Math.PI * 0.28,
      sign > 0 ? Math.PI * 1.28 : Math.PI * 0.28,
    );
    ctx.stroke();

    // Corner arcs.
    for (const zs of [1, -1]) {
      ctx.beginPath();
      ctx.arc(
        px(sign * hl) - sign * len(60),
        pz(zs * hw) - zs * len(60),
        len(260),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  return finish(el);
}

/** Goal netting: a grid that is mostly holes. */
export function netTexture(): THREE.Texture {
  const S = 128;
  const [el, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(236,242,255,0.95)';
  ctx.lineWidth = 2.5;
  const cells = 8;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * S;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  return finish(el, true);
}

/** The ball's panelling, as seams over a light shell. */
export function ballTexture(): THREE.Texture {
  const S = 512;
  const [el, ctx] = canvas(S, S);
  ctx.fillStyle = '#eef2fa';
  ctx.fillRect(0, 0, S, S);

  // Hexagons in offset rows, which is close enough to a football's panelling
  // once it is wrapped round a sphere and seen from twenty metres away.
  const r = S / 14;
  ctx.strokeStyle = 'rgba(40,52,74,0.85)';
  ctx.lineWidth = 3;
  ctx.fillStyle = 'rgba(206,217,235,0.9)';
  for (let row = -1; row * r * 1.5 < S + r; row++) {
    for (let col = -1; col * r * Math.sqrt(3) < S + r; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2 ? (r * Math.sqrt(3)) / 2 : 0);
      const cy = row * r * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = cx + Math.cos(a) * r * 0.92;
        const y = cy + Math.sin(a) * r * 0.92;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  return finish(el);
}

/**
 * The boundary wall: a dark kickplate at the bottom, a band of hoardings, and
 * a clean upper face.
 *
 * Large flat white walls were the last thing in shot with no detail on them,
 * and a wall with nothing on it gives the eye no sense of speed as it goes
 * past — the same reason the floor needed markings rather than a grid.
 */
export function wallTexture(team?: 'orange' | 'blue'): THREE.Texture {
  const W = 1024;
  const H = 256;
  const [el, ctx] = canvas(W, H);

  ctx.fillStyle = '#3c4555';
  ctx.fillRect(0, 0, W, H);

  // Upper face, very slightly cooler than the lower, so the two bands read as
  // separate surfaces rather than one.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(150,175,205,0.22)');
  g.addColorStop(1, 'rgba(8,12,20,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Hoardings: alternating panels across the middle of the wall.
  const boardTop = H * 0.44;
  const boardH = H * 0.3;
  const panels = 10;
  // Low contrast on purpose. Alternating white and near-black at this density
  // reads as a zebra crossing and pulls the eye off the pitch, which is the
  // opposite of what detail on a wall is for.
  // The hoardings are the lit band on an otherwise dark wall, which is what
  // gives a sense of speed as it goes past.
  const accent = team === 'orange' ? '#b4532a' : team === 'blue' ? '#2f6796' : '#6c7a8d';
  for (let i = 0; i < panels; i++) {
    ctx.fillStyle = i % 2 ? accent : '#9aa8bb';
    ctx.fillRect((i / panels) * W, boardTop, W / panels + 1, boardH);
  }
  ctx.fillStyle = 'rgba(12,18,28,0.6)';
  ctx.fillRect(0, boardTop - H * 0.015, W, H * 0.015);
  ctx.fillRect(0, boardTop + boardH, W, H * 0.015);

  // Kickplate: scuffed dark band at floor level, where a car actually hits.
  ctx.fillStyle = '#242c38';
  ctx.fillRect(0, H * 0.86, W, H * 0.14);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 120; i++) {
    const x = (i * 97.3) % W;
    ctx.fillRect(x, H * 0.86 + ((i * 13) % (H * 0.14)), 18, 2);
  }

  return finish(el, true);
}

/**
 * The fascia band between the two decks: lit panels in the house colours.
 *
 * A stadium's fascia is where the sponsor boards and the big lit letters go,
 * and it is at exactly the height the chase camera looks at, so it carries a
 * disproportionate amount of the "this is a venue" feeling.
 */
export function fasciaTexture(): THREE.Texture {
  const W = 1024;
  const H = 128;
  const [el, ctx] = canvas(W, H);

  ctx.fillStyle = '#131926';
  ctx.fillRect(0, 0, W, H);

  // Lit panels, alternating house colours with dark gaps between.
  const panels = 12;
  const colours = ['#2f6796', '#1a2130', '#b4532a', '#1a2130'];
  for (let i = 0; i < panels; i++) {
    const x = (i / panels) * W;
    const w = W / panels;
    ctx.fillStyle = colours[i % colours.length]!;
    ctx.fillRect(x + w * 0.06, H * 0.18, w * 0.88, H * 0.64);
  }

  // A lit pipe along the top and bottom edge, which is what reads at distance.
  ctx.fillStyle = 'rgba(190,215,255,0.9)';
  ctx.fillRect(0, 0, W, H * 0.1);
  ctx.fillRect(0, H * 0.9, W, H * 0.1);

  const tex = finish(el, true);
  tex.repeat.set(6, 1);
  return tex;
}

/**
 * A hanging scoreboard, redrawn when the score or clock changes.
 *
 * Returns the draw function rather than a finished texture: the caller owns
 * when it is worth repainting, and repainting a canvas every frame to show a
 * clock that ticks once a second is pure waste.
 */
export function screenCanvas(): {
  texture: THREE.CanvasTexture;
  draw: (info: { blue: number; orange: number; clock: string; label: string }) => void;
} {
  const W = 512;
  const H = 256;
  const [el, ctx] = canvas(W, H);
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;

  const draw = (info: { blue: number; orange: number; clock: string; label: string }): void => {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, W, H);

    // Team blocks either side of the clock, same arrangement as the HUD so the
    // screen and the scoreboard never disagree about which side is which.
    ctx.fillStyle = '#1c4f7d';
    ctx.fillRect(0, 56, 150, 120);
    ctx.fillStyle = '#9c4524';
    ctx.fillRect(W - 150, 56, 150, 120);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eaf2ff';
    ctx.font = 'bold 86px system-ui, sans-serif';
    ctx.fillText(String(info.blue), 75, 118);
    ctx.fillText(String(info.orange), W - 75, 118);

    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillText(info.clock, W / 2, 112);

    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(190,210,240,0.8)';
    ctx.fillText(info.label.toUpperCase().slice(0, 28), W / 2, 206);

    ctx.strokeStyle = 'rgba(150,185,230,0.5)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  };

  draw({ blue: 0, orange: 0, clock: '0:00', label: '' });
  return { texture, draw };
}

/**
 * Turns a height field into a normal map.
 *
 * This is the piece that was missing. Every material in here was a flat colour,
 * so the only surface detail anywhere was geometry — which is why the car and
 * ball read as shapes rather than objects however carefully they were built. A
 * normal map is the cheapest detail there is: it costs no triangles and adds
 * the panel seams, grain and wear that make a surface look like a material.
 *
 * The caller draws greyscale height; this differences it into a normal. Normal
 * maps carry vectors rather than colour, so the texture is left in linear
 * space — tagging one as sRGB bends every normal in it.
 */
export function normalMapFromHeight(
  size: number,
  strength: number,
  drawHeight: (ctx: CanvasRenderingContext2D, s: number) => void,
): THREE.Texture {
  const [, heightCtx] = canvas(size, size);
  heightCtx.fillStyle = '#808080';
  heightCtx.fillRect(0, 0, size, size);
  drawHeight(heightCtx, size);

  const src = heightCtx.getImageData(0, 0, size, size).data;
  const [outEl, outCtx] = canvas(size, size);
  const out = outCtx.createImageData(size, size);

  // Wrapped sampling, so a tiling map has no seam down its edges.
  const at = (x: number, y: number): number => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return src[(yi * size + xi) * 4]! / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel, which is less noisy on hand-drawn height than a plain
      // difference of neighbours.
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));

      const nx = -dx * strength;
      const ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  outCtx.putImageData(out, 0, 0);

  const tex = new THREE.CanvasTexture(outEl);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Hexagons, as a height field: the ball's panels pressed in at the seams. */
function hexHeight(ctx: CanvasRenderingContext2D, s: number, cells: number): void {
  const r = s / cells;
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, s / 220);
  ctx.lineJoin = 'round';
  for (let row = -1; row * r * 1.5 < s + r; row++) {
    for (let col = -1; col * r * Math.sqrt(3) < s + r; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2 ? (r * Math.sqrt(3)) / 2 : 0);
      const cy = row * r * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = cx + Math.cos(a) * r * 0.9;
        const y = cy + Math.sin(a) * r * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/** The ball's seams, as a normal map matching its painted panels. */
export function ballNormalMap(): THREE.Texture {
  return normalMapFromHeight(512, 6, (ctx, s) => hexHeight(ctx, s, 14));
}

/** The ball's roughness: panels polished, seams dull. */
export function ballRoughnessMap(): THREE.Texture {
  const S = 512;
  const [el, ctx] = canvas(S, S);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, S, S);
  // Seams are where dirt sits, so they scatter more than the panel faces.
  ctx.strokeStyle = '#c8c8c8';
  ctx.lineWidth = 5;
  hexHeight(ctx, S, 14);
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * Car paint: panel seams, a vent, and the faint orange-peel of a sprayed
 * surface.
 *
 * Tiled across the bodywork rather than laid out per panel, which a real model
 * would do with proper UVs. At the distance the chase camera sits, what reads
 * is that the surface has grain and creases at all.
 */
export function carNormalMap(): THREE.Texture {
  return normalMapFromHeight(512, 3.2, (ctx, s) => {
    // Shallow creases along the body.
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = s / 160;
    for (const y of [0.3, 0.52, 0.74]) {
      ctx.beginPath();
      ctx.moveTo(0, s * y);
      ctx.bezierCurveTo(s * 0.3, s * (y - 0.03), s * 0.7, s * (y + 0.03), s, s * y);
      ctx.stroke();
    }
    // A vent: a run of short slats.
    ctx.lineWidth = s / 110;
    for (let i = 0; i < 6; i++) {
      const x = s * (0.62 + i * 0.045);
      ctx.beginPath();
      ctx.moveTo(x, s * 0.36);
      ctx.lineTo(x - s * 0.03, s * 0.46);
      ctx.stroke();
    }
    // Orange peel. Sprayed paint is never perfectly flat, and a perfectly
    // flat specular highlight is one of the things that reads as untextured.
    for (let i = 0; i < 2600; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12345.6789) % 1;
      const v = 128 + (((i * 37) % 11) - 5) * 3;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.abs(x) * s, Math.abs(y) * s, 3, 3);
    }
  });
}

/** Fine grain for the pitch, tiled many times over. */
export function floorNormalMap(): THREE.Texture {
  return normalMapFromHeight(256, 1.4, (ctx, s) => {
    for (let i = 0; i < 9000; i++) {
      const x = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) * s;
      const y = Math.abs((Math.sin(i * 39.3468) * 24634.6345) % 1) * s;
      const v = 128 + (((i * 17) % 9) - 4) * 10;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 2, 2);
    }
  });
}

/**
 * The boundary wall in relief: the hoarding panels proud of the wall, a ridge
 * where the boards meet it, and the kickplate scuffed.
 *
 * The wall is the surface that fills the view at eye level while driving, so
 * it earns its own map more than anything else here does.
 */
export function wallNormalMap(): THREE.Texture {
  return normalMapFromHeight(512, 4.5, (ctx, s) => {
    const boardTop = s * 0.44;
    const boardH = s * 0.3;

    // The hoardings stand proud, so their top and bottom edges catch light.
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, boardTop, s, boardH);

    // Seams between the panels.
    ctx.strokeStyle = '#3c3c3c';
    ctx.lineWidth = Math.max(2, s / 180);
    const panels = 10;
    for (let i = 0; i <= panels; i++) {
      const x = (i / panels) * s;
      ctx.beginPath();
      ctx.moveTo(x, boardTop);
      ctx.lineTo(x, boardTop + boardH);
      ctx.stroke();
    }

    // Kickplate, dented where cars actually hit it.
    ctx.fillStyle = '#6e6e6e';
    ctx.fillRect(0, s * 0.86, s, s * 0.14);
    for (let i = 0; i < 70; i++) {
      const x = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) * s;
      const y = s * 0.86 + Math.abs((Math.sin(i * 78.233) * 1234.5) % 1) * s * 0.14;
      const v = 90 + ((i * 29) % 70);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath();
      ctx.ellipse(x, y, s / 70, s / 180, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
