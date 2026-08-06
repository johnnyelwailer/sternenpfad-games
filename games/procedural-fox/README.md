# Procedural Fox Sandbox

An isolated, self-contained **mobile-first Three.js prototype** that tests
whether a local coding model can build a playable animated 3D character with
no external art assets. The fox is assembled from primitives (boxes, cones,
spheres), animated procedurally, and parked in a tiny spatial playground.

The point of the experiment is **robust observable animation** rather than
visual complexity: every animation state has a clear signature, every body
part reads independently, and state transitions are continuous.

## Run it

The repo already ships a static file server at `scripts/serve.mjs`. From the
repository root:

```bash
node scripts/serve.mjs 8123 .
```

Then open `http://localhost:8123/games/minimax-procedural-character/` in any
modern browser.

There is **no build step, no install, and no local dependency**. The only
thing fetched at runtime is the Three.js module from the official CDN:

- `three@0.160.0` via `https://unpkg.com/three@0.160.0/build/three.module.js`,
  declared in an `<script type="importmap">` in the HTML.

The import map is the only network dependency. No other assets, fonts, or
sound files are pulled.

## Interactions

The game is intentionally controller-light and uses icons + motion rather
than text-heavy labels. Each control does exactly one thing.

### Touch / pointer (mobile-first)

| Control | Position | Icon | Action |
|---------|----------|------|--------|
| D-pad ▲ | Bottom-left, top | ▲ | Walk forward (fox faces +Z) |
| D-pad ◀ | Bottom-left, left | ◀ | Walk left |
| D-pad ▶ | Bottom-left, right | ▶ | Walk right |
| D-pad ▼ | Bottom-left, bottom | ▼ | Walk back |
| Action button | Bottom-right | ⤴ | **Jump-climb** (single combined action) |

The fox rotates to face its movement direction. Pressing the action button
while grounded launches a jump arc; landing on a higher stepping stone
counts as climbing it. The same button is also how the fox reaches the
glowing goal above the highest stone.

### Keyboard fallback

| Key | Action |
|-----|--------|
| Arrow keys / `W A S D` | Walk |
| `Space` / `Enter` | Jump-climb |

Keyboard presses `preventDefault()` so arrow keys do not scroll the page.

### Observable state

A small pill in the top-right corner mirrors the active animation state so
the animation pipeline is inspectable at a glance:

| Pill icon | Label | Trigger |
|-----------|-------|---------|
| 🦊 | IDLE | Standing still |
| 🐾 | WALK | Moving in any direction |
| ⤴ | JUMP | Airborne after pressing the action button |
| ✨ | WIN | Inside the glowing goal's radius |

Blink is a transient overlay that runs on top of any state every 2–5 seconds
and is signalled by the eyelid meshes sliding over the eyes.

## What's in the scene

Everything is built from primitives. No textures, no model files, no HDRI.

- **Fox** — body, head, snout, two ears, two eyes + eyelids, tail with white
  tip, four legs. All `MeshStandardMaterial`; the fox casts and receives
  shadows.
- **Stepping stones** — five heptagonal cylinders at increasing heights, the
  last one carrying the glowing goal.
- **Rocks** — scattered dodecahedrons around the path as scenery.
- **Grass tufts** — small cones around the path edges.
- **Ground** — a large green circle.
- **Goal** — a pulsing gold icosahedron with a halo ring and a warm
  point light.
- **Camera** — follows the fox from a **front-right 3/4 angle** that
  rotates with the fox's facing direction. The camera offset lives in
  the fox's local frame (+X +Z +Y), so the snout and front of the
  character are always visible from the same relative viewpoint. The
  camera is in front of the fox (not behind it), which keeps the
  stepping stones behind the camera when the fox is at the goal. Track
  motion with a critically-damped lerp.

## Animation system

Each state (`idle`, `walk`, `jump`, `celebrate`) contributes a set of *additive*
pose deltas applied to the fox's named bones:

- `body.position.y` — breathing / bob
- `body.rotation.z` — roll
- `body.scale.{x,y}` — landing / celebration squash
- `head.rotation.x` — pitch
- `tail.rotation.y` / `tail.rotation.x` — wag / lift
- `legFL/FR/BL/BR.rotation.x` — diagonal pair swing
- `earL/earR.rotation.x` — perk / twitch
- `lidL/lidR.scale.y` — blink

State weights are stored as a normalized `{idle, walk, jump, celebrate}`
object and lerped toward a one-hot target on every transition, so the fox
never snaps. Blink is a **separate overlay** that runs independently of the
current state — it can layer on top of idle, walk, jump, or celebrate.

A small `landBounce` transient fires on impact for a visible landing.

## Physics

A simple AABB-free point-on-surface model:

- Vertical velocity integrates gravity each frame.
- The playground exposes a `surfaceAt(x, z)` function that returns the top
  of the highest stone under the fox (or `0` for the ground).
- When the fox's y drops to or below the surface height, it lands: y is
  snapped, vertical velocity zeroed, and the landing bounce plays.

This is enough to make the stepping stones climbable while keeping the code
under one file and predictable to debug.

## WebGL fallback

If the browser cannot create a WebGL context, the page hides the WebGL
canvas and reveals a 2D fallback draw with a simple fox silhouette, a
hand-drawn glowing goal, and a message explaining what happened. No
download or external asset is required for the fallback.

## Files

- `index.html` — single self-contained file: HTML, CSS, import map, and
  the Three.js module script. No external CSS or JS files.
- `README.md` — this file.

## Known limitations

- No sound.
- The 3D scene is intentionally simple: the goal is to stress the animation
  pipeline, not the renderer.
- The 2D fallback is decorative; it does not animate.
- The stones are tuned so the jump-climb action is easy to win; tweak
  `jumpVel` / `gravity` in `index.html` if you want a harder climb.
