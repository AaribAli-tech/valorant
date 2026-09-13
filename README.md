# VALORANT — Ascent, in the browser

A fan recreation of Valorant on Ascent: home lobby, mode select, queue, VS loading
screen, 5v5 plant/defuse rounds against AI bots, the buy menu, the HUD and Jett's
abilities. Three.js, no build framework, no bundler, no backend — the whole game is
static files, which is what makes it a one-click Vercel deploy.

**Play it now:** `npm run dev` → <http://localhost:3000> — or push this repo to Vercel
and it builds itself (see [Deploying](#deploying)).

---

## Quick start

```bash
npm install        # optional: only used to minify the build (esbuild)
npm run dev        # serves src/ directly, edits show up on refresh
npm run build      # -> public/, the deployable site
npm start          # builds, then serves public/ with production cache headers
npm test           # load-order smoke test + instancing correctness + scene stats
```

`npm install` is genuinely optional: with esbuild present the build minifies JS and
CSS, without it the build just copies. Nothing in the game itself has dependencies.

There is also a zero-tooling path: `VALORANT/PLAY VALORANT.html` is the original
single-file build (13 MB, everything inlined). Double-clicking it still works, it
just re-parses the whole thing on every load and cannot be cached — which is why the
split-up `src/` tree exists.

## Layout

```
src/                       the site as it is deployed
  index.html               complete page: gate/lobby screens, HUD, <script> tags in load order
  css/game.css             every UI screen, authored at 1080 design-units tall
  js/lib/                  vendored three r152 + GLTFLoader + SkeletonUtils
  js/core/                 util, textures (all procedural), input, audio
  js/weapons/              weapon table, view-model builder
  js/map/                  Ascent: collision data, geometry, sky, dressing, nav, instancing
  js/entities/             characters, player controller, bots
  js/game/                 combat, bot brains, abilities, match/round flow
  js/ui/                   HUD, buy menu, agent art, lobby
  js/main.js               boot: build map -> batch -> load agents -> gate -> loop
  js/data/assets.js        manifest of the binary assets
  assets/                  3 GLB character/animation files, agent art, minimap
tools/                     build + serve + measurement scripts (not shipped)
.github/workflows/         CI: syntax, load order, instancing proof, scene budget
public/                    build output (gitignored)
vercel.json                static deploy: build command, output dir, cache headers
VALORANT/                  the original single-file build, kept for reference
```

Scripts are loaded in order with plain `<script>` tags and every module hangs itself
off one `VAL` global — no import maps, no ESM, so the page works from `file://` too.
`tools/smoke.js` fails the build if a `<script>` target is missing or a module stops
registering, which is the only way a static deploy of this project can come up blank.

## Deploying

Vercel reads [`vercel.json`](vercel.json) — `buildCommand: node tools/build.js`,
`outputDirectory: public`.

1. **Git**: import the repo at vercel.com → the framework picker will say **Other** →
   deploy. Nothing else to configure.
2. **CLI**: `npx vercel` (add `--prod` to publish).
3. **Dashboard drag-and-drop**: run `npm run build` and drop the `public/` folder.

Cache policy: `/assets/**` and `/js/lib/**` are `immutable` for a year (the GLB rigs
are 5 MB and never change content under one URL), game code revalidates, and
`index.html` is always revalidated so a new deploy is live immediately.

## Performance: instanced static geometry

Ascent is not one big model — it is ~17,000 small boxes and repeated shapes (facade
panels, skyline blocks, windows, arches, crates, railings, lamp posts) built by
`js/map/ascent.js` and `js/map/dressing.js`. Drawing each as its own mesh is what
makes this kind of game stutter: the cost is per draw call and per byte of vertex
data, not just per triangle.

`js/map/instances.js` fixes that as a post-pass over the finished scene:

1. The builders **tag** every shape they place — `boxAt()`/`bx()` record
   `#box` with width/height/depth/position/yaw, `archAt()` records a shape key.
2. `optimize()` walks a group, buckets by material + shape, and emits one
   `THREE.InstancedBufferGeometry` per (material, shape, region): a single unit box
   (24 vertices) plus 12 floats of per-instance payload — `iPos`, `iSize`, `iRot`,
   `iUv`. 900 facade boxes become 900 instances of the same 24-vertex geometry
   instead of 32,400 vertices and 900 draw calls.
3. A cloned material with a small vertex-shader patch does the transform on the GPU:
   scale → yaw → translate, and the same metre-based UV tiling the baked vertices
   used, so the walls look exactly as before.
4. Geometry that is *not* a repeated shape (floors, roofs, wall runs) is welded
   (shared corners behind an index: 24 vertices per box instead of 36) and then
   re-cut **per triangle** along the same region grid. That matters for the meshes
   with no parts to bin - `buildFloor()` emits one hand-built 52,000-vertex slab
   per material - and a mesh that big spans the whole map, so the frustum can
   never reject it. Cutting on triangle centroids means no triangle is ever split,
   so a chunk boundary just duplicates a few corners: the picture is identical,
   and 31 % of the scene is now culled instead of 4 %.
5. Anything animated or picked at runtime — doors, the spike, lights that toggle,
   character hitboxes, nav and collision volumes — is left exactly as authored, and
   gameplay code never touches a batched mesh.

Measured with `npm run stats` (Node + three r152, no browser, whole Ascent scene —
`tools/baseline-map-stats.json` is the frozen pre-instancing build):

(unique GPU buffers, index arrays included; run it yourself with `npm run stats` -
the scene randomises prop placement per build, so the last digits move a little):

| | before | after | |
|---|---|---|---|
| draw calls | 1,011 | **460** | −54.5 % |
| vertices submitted | 1,557,449 | **771,209** | −50.5 % |
| vertex buffers on GPU | 47.7 MB | **9.6 MB** | −79.9 % |
| largest single mesh | 119,664 tris / 11.2 MB buffer | **16,456 tris / 0.40 MB** | |
| per frame after frustum culling | 289 calls / 1.50 M verts | **179 calls / 0.53 M verts** | −38 % / −65 % |
| instancing reuse | - | 20,722 instances, 521k verts never duplicated | |
| triangles | 529,387 | 532,117 | unchanged, on purpose |

Instancing does not remove triangles — the walls are still there. It removes draw
calls, per-object JS (matrix updates, raycast candidates) and VRAM, which is where
the frame time and the "loads then hitches" behaviour actually come from. The
triangle count being flat in that table is the check that nothing was silently
deleted.

`npm run verify` proves the rewrite is lossless: it records every tagged placement
the builders asked for, runs `optimize()`, then re-derives each placement from the
instance attributes exactly as the vertex shader does and matches them one by one, and checks that the
total triangle count of the scene is *exactly* conserved (~530k before, identical
after - nothing silently deleted, nothing duplicated). The per-run numbers move a
little (~16.7k boxes, ±1 draw call) because prop placement is randomised on every
build; the equality checks are what the exit code depends on.

### Tuning and escape hatch

```
?noinstance=1     build the map the old way (A/B against the numbers above)
?stats=1          start with the perf overlay on; F3 toggles it at any time
?quick=1&side=attack&mode=unrated   skip the lobby and jump into a round
```

The overlay reads `renderer.info` after each frame, so it shows the draw calls and
triangles the GPU really got - including the shadow pass - alongside the fps.
`?noinstance=1&stats=1` against `?stats=1` is the whole experiment, in the corner of
a running match, no devtools.

The same numbers are a gate, not a report: `tools/perf-budget.json` holds ceilings
(draw calls, vertices, GPU megabytes, culled per-frame counts) and
`node tools/scene-stats.js` exits non-zero when the scene busts one - which is how
"the batching stopped working" gets caught in CI (`.github/workflows/checks.yml`)
instead of in a frame-rate complaint. Run `npm run stats` to see them; `--nobudget`
disables the check while you are measuring on purpose.

One shared region plan (`planFor()` in `js/map/instances.js`) sizes the chunks for
both paths - `minCell 14`, `minPerBatch 600` and `maxBatches 12` for instances,
`minSplitTris 4000` and `trisPerBatch 12000` for merged leftovers. `npm run stats`
takes overrides (`--trisPer 6000 --maxB 20 --minSplit 1500`) and prints the average
visible draw calls and shaded vertices over eight vantage points, so the trade is
measurable rather than guessed: on Ascent the curve is flat between 4k and 20k
triangles per chunk - smaller regions buy culling that a 120 m map with long
sightlines mostly cannot use, and every extra chunk costs a draw call in *both* the
colour and the shadow pass.

## Verifying it by eye

Every number above was measured without a browser (Node + the vendored three, so
geometry, transforms and draw counts are proven; shaders are only generated and
structurally checked). That leaves one class of bug the tools cannot see - a
material that *looks* different - and it is worth two minutes in the preview:

1. **Tile scale on a long wall** (A main, mid doors): UV tiling is re-derived per
   instance from `iUv`, so a 16 m facade panel must tile exactly like its baked
   equivalent - obvious if it looks stretched or checkerboarded.
2. **Arch heads** (both site entrances, heaven): front and back rings differ only
   by a baked offset, and each part is a separate instance of the same prototype.
3. **A skyline window at a grazing angle** (spawn view): boxes and their frames
   are one prototype, so a wrong `iSize` axis would show as a squashed frame.
4. **Shadows on the same four spots** - the shader patch is mirrored into a
   `customDepthMaterial`, so a mistake there shows as a missing or doubled shadow,
   not a missing wall.
5. **Anything that moves**: doors, the toggled barrier, bots walking through crates
   (they collide with authored data, never with a batch).

`?noinstance=1` side by side in a second tab is the fastest way to confirm all
five, and `?stats=1` shows the cost while you look.

## Controls (Valorant defaults)

| | |
|---|---|
| Move | `W A S D` |
| Walk (silent) | `Shift` (hold) |
| Crouch / jump | `Ctrl` / `Space` |
| Fire / aim down sights | Left mouse / Right mouse |
| Reload / inspect / drop | `R` / `Y` / `G` |
| Primary / secondary | `1` / `2` (or mouse wheel) |
| Knife / spike | `3` / `4` |
| Plant the spike | equip it (`4`) and hold fire on a site, or hold `F` on a site |
| Defuse / use door / pick up | `F` |
| Buy menu (buy phase) | `B` |
| Scoreboard | `Tab` |
| Menu / pause | `Esc` |

Jett: `C` Cloudburst, `Q` Updraft, `E` Tailwind (dash), `X` Blade Storm. Hold `Space`
in the air to Drift.

Click the game to capture the mouse; `Esc` releases it. First load takes a few
seconds while the characters and animations unpack. `F11` for full screen.

## The match

Standard rules: first to 13, halftime side swap, overtime. 100 s rounds, 4 s plant,
7 s defuse with the half-way checkpoint, 45 s spike fuse. Economy: 3000 for a round
win, loss bonus 1900 / 2400 / 2900, +200 per kill, +300 for a plant.

Bots have a real field of view, reaction time, hearing and team comms. Defenders set
up, rotate and retake; attackers rush, split and take mid control. Weapon stats
(fire rate, damage falloff, reload and equip times, run speed, wall penetration)
follow the real game. The 2D UI uses Riot's official agent art; the 3D side uses CC0
models styled toward Valorant.

Fan recreation for educational purposes. Not affiliated with Riot Games.
