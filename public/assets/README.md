# Optional art

Empty by default, and the game is complete without it. Everything on screen is
generated in code: see "The look" in the root README. Anything dropped here is
an upgrade, not a requirement — a missing file is the normal case, and a broken
one falls back to the generated version rather than failing to boot.

Two files are looked for, both named in `src/config.ts` under `assets`:

| File | What it changes |
| --- | --- |
| `environment.hdr` | Reflections on every shiny surface. **Rarely worth supplying**: the arena already captures its own, which is better than a photograph of a different building. See below. |
| `car.glb` | The car body. Fitted to the hitbox on load — measured, scaled, turned to face +x and dropped onto the wheel line — so it does not need preparing to any convention. |

## Which is worth doing first

Neither, probably — and `environment.hdr` least of all now.

The arena photographs itself at boot: six faces from the middle of the pitch,
prefiltered into a radiance map, so every reflective surface carries this
building's own light banks, crowd and hoardings. A downloaded map of somebody
else's sports hall would be an improvement on the hand-drawn gradient it
replaced, and would still be wrong — it would put their lights and their
roofline into our paintwork. Supply one only if you want a deliberately
different look; it overrides the capture.

That leaves the car, which is the smaller win of the two. At chase-camera
distance the car is around forty pixels tall, where silhouette, paint response
and shadow carry it, and the generated body already does those. It matters in
the menu orbit and in close-ups.

## If you generate the car

The risk is not fidelity, it is **art direction**. A photoreal generated car
dropped into a stylised arena reads as a sticker, and looks worse than a
consistent stylised car. Ask for flat, stylised, low-poly; not realistic.

A prompt that suits this game:

> Low-poly stylised arcade rocket-league-style battle car, single colour body
> with dark glass canopy, wide exposed wheels, front splitter and rear wing,
> clean flat-shaded faces, no decals, no text, no branding, no logos, symmetric,
> wheels as separate parts, facing forward along +X, Y up, game-ready, under
> 8000 triangles

Then: no number plates, no badges, nothing resembling a real manufacturer's
design, and nothing derived from Rocket League's own cars.

Licensing to check before shipping anything generated — the free tiers of the
main tools publish your model publicly under CC BY 4.0, which means attribution
and a public model; paid tiers give private models with commercial rights.

## The licence-clean alternative

CC0 libraries are effectively public domain — commercial use, no attribution:

- **Poly Haven** for HDRIs and textures.
- **Quaternius**, **KayKit** and **Kenney** for stylised low-poly models,
  vehicles included.

For a stylised game this is often the better answer than generation: the models
are already in a consistent low-poly style, have sane topology and are small.

## Keep a record

Whatever lands here, note where it came from and under what licence in this
file. A folder of art with no provenance is a problem for whoever ships it.
