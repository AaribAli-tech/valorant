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
   (shared corners behind an index: 24 vertices per box instead of 36) and re-cut
   along the same region grid, so it is still one mesh per material per region
   rather than one blob spanning the whole map.
5. Anything animated or picked at runtime — doors, the spike, lights that toggle,
   character hitboxes, nav and collision volumes — is left exactly as authored, and
   gameplay code never touches a batched mesh.

Measured with `npm run stats` (Node + three r152, no browser, whole Ascent scene —
`tools/baseline-map-stats.json` is the frozen pre-instancing build):

| | before | after | |
|---|---|---|---|
| draw calls | 1,011 | **385** | −61.9 % |
| vertices submitted | 1,570,019 | **822,540** | −47.6 % |
| vertex buffers on GPU | 47.9 MB | **9.9 MB** | −79.3 % |
| per frame after frustum culling | 289 calls / 1.52 M verts | **159 calls / 0.66 M verts** | −45 % / −57 % |
| triangles | 533,561 | 532,393 | unchanged, on purpose |

Instancing does not remove triangles — the walls are still there. It removes draw
calls, per-object JS (matrix updates, raycast candidates) and VRAM, which is where
the frame time and the "loads then hitches" behaviour actually come from. The
triangle count being flat in that table is the check that nothing was silently
deleted.

`npm run verify` proves the rewrite is lossless: it records every tagged placement
the builders asked for, runs `optimize()`, then re-derives each placement from the
instance attributes exactly as the vertex shader does and matches them one by one
(~16.8k boxes per run, to within 1 cm, which is the float32 storage tolerance; the
count itself drifts a little because prop placement is randomised per build).

### Tuning and escape hatch

```
?noinstance=1     ship the unbatched build (A/B against the numbers above)
?quick=1&side=attack&mode=unrated   skip the lobby and jump into a round
```

The region granularity lives in one place (`grid()` in `js/map/instances.js`,
defaults `minCell 14`, `minPerBatch 600`, `maxBatches 12`) and
`node tools/scene-stats.js --minPer 250 --maxB 40` sweeps it: smaller regions trade
draw calls for culling, and on a map with Ascent's long sightlines the middle ground
wins.

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
