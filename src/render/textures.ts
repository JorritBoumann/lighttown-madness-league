import * as THREE from 'three';
import { cfg } from '../config';
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
  const W = 256;
  const H = 256;
  const [el, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  // Dusk, open to the sky: deep indigo overhead falling through violet into a
  // warm band at the horizon, with the ground half kept dim so the
  // environment map does not light the pitch from below.
  //
  // Daylight was the wrong call. A blue sky at noon lights everything evenly,
  // so nothing in the arena can glow — the LED ribbon, the roof strips and the
  // boost pads were all competing with a lit sky and lost. Dusk gives them
  // something to be brighter than.
  g.addColorStop(0.0, '#1b1636');
  g.addColorStop(0.16, '#2c2150');
  g.addColorStop(0.3, '#4a2c5e');
  g.addColorStop(0.4, '#7e3f5f');
  g.addColorStop(0.46, '#c06a52');
  g.addColorStop(0.49, '#e89a5c');
  g.addColorStop(0.5, '#f0b478');
  g.addColorStop(0.52, '#4a3f48');
  g.addColorStop(0.72, '#26212e');
  g.addColorStop(1.0, '#191620');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Cloud, as flattened bands rather than round puffs. Dusk cloud is lit from
  // underneath and stretched along the horizon; circles read as daytime
  // cumulus whatever colour they are painted.
  for (let i = 0; i < 48; i++) {
    const r0 = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const r1 = Math.abs((Math.sin(i * 78.233) * 1234.5) % 1);
    const r2 = Math.abs((Math.sin(i * 39.425) * 8765.4) % 1);
    const x = r0 * W;
    const y = 18 + r1 * 104;
    const rx = 18 + r2 * 46;
    const ry = rx * (0.12 + r1 * 0.14);
    // Warmer and brighter the nearer the horizon, which is where the last of
    // the light is coming from.
    const warmth = Math.min(1, Math.max(0, (y - 20) / 100));
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, rx);
    const a = 0.1 + warmth * 0.3;
    cloud.addColorStop(0, `rgba(${Math.round(190 + warmth * 60)},${Math.round(150 + warmth * 50)},${Math.round(160 + warmth * 20)},${a})`);
    cloud.addColorStop(1, 'rgba(120,100,140,0)');
    ctx.fillStyle = cloud;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = finish(el);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/** The pitch: mown grass, markings, and a tinted area at each end. */
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

  // Mowing bands, the way a roller leaves them. Alternating bands passing
  // under the car are also a large part of how fast the game feels.
  //
  // Darker and more saturated than the daylight version. Under a warm key at
  // dusk the old mid-greens came back pale and milky — the pitch was the
  // brightest thing in the frame when it should be the thing the arena's
  // lights are pointed at.
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2c6a33' : '#24592b';
    ctx.fillRect((i / stripes) * W, 0, W / stripes + 1, H);
  }

  // A second set of bands across the first, at low contrast. One direction of
  // mowing is a stripe; two is the diamond a groundsman actually leaves, and
  // it is the difference between a pattern and a texture.
  const cross = 11;
  for (let i = 0; i < cross; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(0, (i / cross) * H, W, H / cross + 1);
  }

  // Wear and colour drift, so no two parts of the pitch are the same green.
  for (let i = 0; i < 900; i++) {
    const r0 = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const r1 = Math.abs((Math.sin(i * 78.233) * 1234.5) % 1);
    const r2 = Math.abs((Math.sin(i * 39.425) * 8765.4) % 1);
    const x = r0 * W;
    const y = r1 * H;
    const r = 30 + r2 * 150;
    const patch = ctx.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, r2 > 0.5 ? 'rgba(150,190,120,0.05)' : 'rgba(18,48,24,0.07)');
    patch.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = patch;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // A vignette, so the middle of the pitch is not a flat slab of one colour.
  // The white centre is gone: the floodlights light the middle now, and
  // painting the highlight into the albedo as well made it milky.
  const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.66);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(0,0,0,0.1)');
  vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Team areas in front of each net, tinted rather than painted solid: this is
  // the cue that tells you which way you are attacking at a glance.
  const mouth = goalWidth / 2;
  for (const [sign, tint] of [
    // Back to the teams' own colours: on grass both read clearly, which they
    // did not on a blue floor — a blue tint over blue is almost no tint.
    [1, 'rgba(255,112,67,0.30)'],
    [-1, 'rgba(66,145,245,0.30)'],
  ] as [number, string][]) {
    const depth = len(1700);
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.ellipse(px(sign * hl), pz(0), depth, (mouth / (hw * 2)) * H * 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Markings: painted white on grass, and how you read your position at speed.
  ctx.strokeStyle = 'rgba(250,252,255,0.88)';
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
  ctx.fillStyle = 'rgba(250,252,255,0.88)';
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
 * The boundary wall: kickplate, hoardings, stanchions and a railing.
 *
 * Drawn for one tile covering `WALL_TILE` units of wall by its full solid
 * height, and the caller repeats it to suit each panel's own length — see
 * `wallRepeat`. Tiling a fixed number of times across walls of different
 * lengths is what made this stretch: one tile was spanning two and a half
 * thousand units, so every edge in it was soft and the panels read as blurred
 * rectangles.
 */
export const WALL_TILE = 2048;

/**
 * Panel widths within a tile, as weights.
 *
 * They are normalised to fill the tile exactly. An earlier version advanced by
 * a fixed fraction until it ran off the edge, which cut the last panel in half
 * and butted that half against a whole one at every tile boundary — a hard
 * seam every 1100 units, and the normal map's seams landing nowhere near the
 * albedo's.
 */
const WALL_PANELS = [1.4, 1, 0.75, 1.15, 0.9, 1.3, 0.8, 1.05];

function wallPanels(w: number): { x: number; w: number }[] {
  const total = WALL_PANELS.reduce((a, b) => a + b, 0);
  const out: { x: number; w: number }[] = [];
  let x = 0;
  for (const weight of WALL_PANELS) {
    const width = (w * weight) / total;
    out.push({ x, w: width });
    x += width;
  }
  return out;
}

/**
 * Where each horizontal band sits, in canvas rows.
 *
 * The floor-wall chamfer covers the bottom `wallChamfer` units of a
 * `hoardingHeight`-unit solid band, so anything down there is behind the ramp
 * and never seen. The canvas runs top-of-wall to bottom-of-wall, so that hidden
 * strip is at the *bottom* of the image and the layout is built upwards from
 * it. Getting that the wrong way round put the hoardings behind the ramp and
 * left a blank wall.
 */
function wallBands(h: number) {
  const hidden = h * (cfg.arena.wallChamfer / cfg.arena.hoardingHeight);
  const plateH = h * 0.1;
  const plateTop = h - hidden - plateH;
  const boardH = h * 0.36;
  const boardTop = plateTop - boardH;
  return { hidden, plateH, plateTop, boardH, boardTop, railH: h * 0.05 };
}

export function wallTexture(team?: 'orange' | 'blue'): THREE.Texture {
  const W = 2048;
  const H = 620;
  const [el, ctx] = canvas(W, H);
  const b = wallBands(H);

  // Upper wall: dark, with a slight gradient so it is not a flat fill.
  //
  // It was pale, and that is the single thing that made the arena read as a
  // model rather than a building. A lit arena is dark structure with bright
  // things on it; a white wall at dusk is brighter than the boards, brighter
  // than the ribbon above it, and leaves nothing able to glow.
  const upper = ctx.createLinearGradient(0, b.boardTop, 0, 0);
  upper.addColorStop(0, '#1b2434');
  upper.addColorStop(1, '#2a3547');
  ctx.fillStyle = upper;
  ctx.fillRect(0, 0, W, H);

  // Railing along the top of the boards: two rails on short posts. A real
  // arena has one, and without it the boards ended in mid-air against the
  // stands with nothing marking the top of the playable wall.
  const railTop = b.boardTop - b.railH;
  ctx.fillStyle = 'rgba(12,18,28,0.75)';
  for (const panel of wallPanels(W)) {
    ctx.fillRect(panel.x + panel.w / 2 - 2, railTop, 4, b.railH);
  }
  ctx.fillStyle = '#8da4bd';
  ctx.fillRect(0, railTop, W, 5);
  ctx.fillRect(0, railTop + b.railH * 0.55, W, 4);

  // Hoardings. Panels of differing widths with abstract marks on them: a
  // uniform row of identical blank rectangles is what reads as placeholder.
  // Dark boards carrying bright marks, rather than bright boards carrying dark
  // ones. Every third board takes the house colour; the rest are near-black,
  // and the marks on all of them are what the eye actually catches.
  const house = team === 'orange' ? '#8c3a16' : team === 'blue' ? '#17456e' : '#15294a';
  const post = 7;
  const panels = wallPanels(W);
  panels.forEach((panel, n) => {
    const dark = n % 3 === 1;
    ctx.fillStyle = dark ? house : '#141b27';
    ctx.fillRect(panel.x + post / 2, b.boardTop, panel.w - post, b.boardH);

    // A faint vertical sheen across each board, brightest off-centre, so the
    // panels catch the light unevenly instead of reading as flat swatches.
    const sheen = ctx.createLinearGradient(panel.x, 0, panel.x + panel.w, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.35, 'rgba(160,200,255,0.1)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = sheen;
    ctx.fillRect(panel.x + post / 2, b.boardTop, panel.w - post, b.boardH);

    // A mark on the board: a wordless bar-and-dot device, which at this size
    // reads as signage without pretending to be anybody's logo.
    ctx.fillStyle = dark ? 'rgba(255,214,170,0.92)' : 'rgba(150,205,255,0.9)';
    const cx = panel.x + panel.w / 2;
    const cy = b.boardTop + b.boardH / 2;
    const w = panel.w - post;
    const style = (n * 5 + 3) % 6;
    if (style === 0) {
      ctx.fillRect(cx - w * 0.26, cy - b.boardH * 0.12, w * 0.52, b.boardH * 0.08);
      ctx.fillRect(cx - w * 0.18, cy + b.boardH * 0.03, w * 0.36, b.boardH * 0.08);
    } else if (style === 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, b.boardH * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 2) {
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(cx + (i - 1) * w * 0.17 - w * 0.05, cy - b.boardH * 0.16, w * 0.1, b.boardH * 0.32);
      }
    } else if (style === 3) {
      ctx.fillRect(cx - w * 0.24, cy - b.boardH * 0.04, w * 0.48, b.boardH * 0.09);
    } else if (style === 4) {
      // A chevron pair, drawn as rotated bars.
      ctx.save();
      ctx.translate(cx, cy);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.rotate((s * Math.PI) / 5);
        ctx.fillRect(-w * 0.04, -b.boardH * 0.17, w * 0.08, b.boardH * 0.34);
        ctx.restore();
      }
      ctx.restore();
    } else {
      // A ring, which reads differently from the filled dot at a distance.
      ctx.lineWidth = Math.max(3, b.boardH * 0.06);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx, cy, b.boardH * 0.19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(cx - w * 0.3, cy - b.boardH * 0.03, w * 0.14, b.boardH * 0.06);
      ctx.fillRect(cx + w * 0.16, cy - b.boardH * 0.03, w * 0.14, b.boardH * 0.06);
    }

    // The stanchion between this panel and the next.
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(panel.x + panel.w - post / 2, b.boardTop - b.railH * 0.2, post, b.boardH + b.railH * 0.2);
    ctx.fillStyle = 'rgba(170,215,255,0.3)';
    ctx.fillRect(panel.x + panel.w - post / 2, b.boardTop - b.railH * 0.2, 2, b.boardH + b.railH * 0.2);
  });

  // Trim above and below the boards.
  ctx.fillStyle = '#0d131d';
  ctx.fillRect(0, b.boardTop - H * 0.014, W, H * 0.014);
  // The strip under the boards stays bright: it is the line the car runs
  // along, and it reads at speed the way the ribbon above does.
  ctx.fillStyle = '#9fb6cc';
  ctx.fillRect(0, b.boardTop + b.boardH, W, H * 0.018);

  // Kickplate, sitting immediately on top of the ramp: where a car actually
  // hits. Fine scratches along the direction of travel, not blobs — the first
  // version drew ellipses, which at this scale looked like bubbles stuck on.
  const plate = ctx.createLinearGradient(0, b.plateTop, 0, H);
  plate.addColorStop(0, '#3b4553');
  plate.addColorStop(1, '#262e3a');
  ctx.fillStyle = plate;
  ctx.fillRect(0, b.plateTop, W, H - b.plateTop);
  for (let i = 0; i < 420; i++) {
    const sx = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) * W;
    const sy = b.plateTop + Math.abs((Math.sin(i * 78.233) * 1234.5) % 1) * (H - b.plateTop);
    const len = 8 + ((i * 13) % 42);
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.11)' : 'rgba(18,26,36,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + len, sy + ((i % 3) - 1) * 0.6);
    ctx.stroke();
  }

  return finish(el, true);
}

/** How many times the wall texture tiles across a run of wall this long. */
export function wallRepeat(lengthUnits: number): number {
  return Math.max(1, Math.round(lengthUnits / WALL_TILE));
}

/**
 * The floor-to-wall ramp.
 *
 * This surface is a quarter of everything you see when the camera is low and
 * near a wall, and it was one flat pale colour — the brightest, emptiest thing
 * in the arena. It is drawn as a continuation of the kickplate above it:
 * the same slate, ribbed across the slope, with a dark trim at each edge.
 *
 * The drawing is symmetric along the slope on purpose. The ramps are boxes
 * rotated into place, and which end of the slope a box's `v` runs towards
 * differs between the side walls and the end walls; a design with a top and a
 * bottom would be upside down on half of them.
 */
function drawRamp(ctx: CanvasRenderingContext2D, s: number, shade: (t: number) => string): void {
  ctx.fillStyle = shade(0.5);
  ctx.fillRect(0, 0, s, s);

  // Ribs across the slope: the line the car crosses on its way up.
  const ribs = 11;
  for (let i = 0; i < ribs; i++) {
    const y = ((i + 0.5) / ribs) * s;
    const h = s / ribs;
    ctx.fillStyle = shade(i % 2 ? 0.42 : 0.58);
    ctx.fillRect(0, y - h / 2, s, h);
    ctx.fillStyle = shade(0.78);
    ctx.fillRect(0, y - h / 2, s, Math.max(1, s / 420));
  }

  // Trim at both edges of the slope, where it meets the pitch and the
  // kickplate. Darker than the body, with a bright lip inboard of it.
  const edge = s * 0.055;
  for (const top of [0, s - edge]) {
    ctx.fillStyle = shade(0.2);
    ctx.fillRect(0, top, s, edge);
  }
  ctx.fillStyle = shade(0.85);
  ctx.fillRect(0, edge, s, Math.max(1, s / 340));
  ctx.fillRect(0, s - edge - Math.max(1, s / 340), s, Math.max(1, s / 340));

  // Seams along the run, on the same rhythm as the hoardings above, so the
  // ramp reads as the bottom of the same structure rather than a separate band.
  for (const panel of wallPanels(s)) {
    ctx.fillStyle = shade(0.16);
    ctx.fillRect(panel.x + panel.w - 2, 0, 4, s);
  }
}

/**
 * `rotated` swaps the slope onto `u`, for the ramps whose box has its long
 * side along `z`. The caller tiles the long axis and leaves the slope at one.
 */
export function rampTexture(rotated: boolean): THREE.Texture {
  const S = 1024;
  const [el, ctx] = canvas(S, S);
  if (rotated) {
    ctx.translate(S, 0);
    ctx.rotate(Math.PI / 2);
  }
  drawRamp(ctx, S, (t) => {
    const lo = [24, 30, 40];
    const hi = [104, 118, 136];
    const c = lo.map((v, i) => Math.round(v + (hi[i]! - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  });
  return finish(el, true);
}

export function rampNormalMap(rotated: boolean): THREE.Texture {
  return normalMapFromHeight(512, 2.2, (ctx, s) => {
    if (rotated) {
      ctx.translate(s, 0);
      ctx.rotate(Math.PI / 2);
    }
    drawRamp(ctx, s, (t) => {
      const v = Math.round(60 + t * 150);
      return `rgb(${v},${v},${v})`;
    });
  });
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
/**
 * Grass, as a tiled normal map of blades.
 *
 * The pitch albedo is one image stretched over ten thousand units, so a blade
 * of grass in it would be a quarter of a pixel. Blade detail has to live in a
 * map tiled small and often instead, which is why the pitch used to read as
 * felt: it had the generic floor grain on it, and grain is isotropic — grass
 * is not. Blades run one way, catch the light along their length, and that
 * directionality is most of what tells you it is grass.
 */
export function grassNormalMap(): THREE.Texture {
  return normalMapFromHeight(256, 2.6, (ctx, s) => {
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(0, 0, s, s);
    ctx.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const r0 = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
      const r1 = Math.abs((Math.sin(i * 78.233) * 1234.5) % 1);
      const r2 = Math.abs((Math.sin(i * 39.425) * 8765.4) % 1);
      const x = r0 * s;
      const y = r1 * s;
      // Mostly upright, leaning a little, the way a mown pitch lies.
      const lean = (r2 - 0.5) * 0.9;
      const len = s * (0.016 + r2 * 0.026);
      const bright = Math.round(96 + r2 * 120);
      ctx.strokeStyle = `rgb(${bright},${bright},${bright})`;
      ctx.lineWidth = s / 230;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean * len, y - len);
      ctx.stroke();
    }
  });
}

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
 * The wall in relief: the hoardings standing proud, their seams, and the
 * kickplate scratched.
 */
export function wallNormalMap(): THREE.Texture {
  return normalMapFromHeight(512, 3.4, (ctx, s) => {
    const b = wallBands(s);

    // Boards proud of the wall behind them, with the rail proud again above.
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, b.boardTop, s, b.boardH);
    ctx.fillStyle = '#cfcfcf';
    ctx.fillRect(0, b.boardTop - b.railH, s, 4);
    ctx.fillRect(0, b.boardTop - b.railH * 0.45, s, 3);

    // Stanchions between the panels, at the same rhythm as the albedo — the
    // two share `wallPanels`, so they cannot drift apart.
    const post = Math.max(2, s / 290);
    for (const panel of wallPanels(s)) {
      ctx.fillStyle = '#5a5a5a';
      ctx.fillRect(panel.x + panel.w - post / 2, b.boardTop, post, b.boardH);
    }

    // Kickplate, recessed, with scratches rather than dents.
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(0, b.plateTop, s, s - b.plateTop);
    ctx.lineWidth = 1;
    for (let i = 0; i < 240; i++) {
      const sx = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) * s;
      const sy = b.plateTop + Math.abs((Math.sin(i * 78.233) * 1234.5) % 1) * (s - b.plateTop);
      const len = 5 + ((i * 11) % 26);
      ctx.strokeStyle = i % 2 ? '#8c8c8c' : '#4a4a4a';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + len, sy);
      ctx.stroke();
    }
  });
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

  ctx.fillStyle = '#7e8a99';
  ctx.fillRect(0, 0, W, H);

  // Lit panels, alternating house colours with dark gaps between.
  const panels = 12;
  const colours = ['#35719f', '#dfe6ee', '#c2622f', '#dfe6ee'];
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
