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

/** The pitch: mowing stripes, markings, and a tinted area at each end. */
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

  // Mowing stripes, across the short axis the way a roller would run.
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#24542d' : '#1d4826';
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
    [-1, 'rgba(66,165,245,0.26)'],
  ] as [number, string][]) {
    const depth = len(1700);
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.ellipse(px(sign * hl), pz(0), depth, (mouth / (hw * 2)) * H * 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
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
