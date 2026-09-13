/*
 * js/map/instances.js - VAL.Instancing
 * ============================================================================
 * Ascent is built out of boxes. Facade dressing, windows, shutters, sills,
 * quoins, the whole out-of-bounds skyline, every crate and lamp post: the map
 * builders produce thousands of them and then glue each material's share into a
 * single merged, non-indexed blob (36 vertices per box, no vertex reuse, one
 * immovable draw call each). That is what makes the browser stutter - measured
 * on this repo's own baseline: ~1000 draw calls, 1.57M vertices and 48 MB of
 * vertex buffers pushed every frame, most of it for pixels the camera cannot see.
 *
 * What this does instead:
 *   - one unit box (24 verts / 36 indices) shared by every batch, uploaded once
 *   - per-instance attributes on a THREE.InstancedBufferGeometry:
 *         iPos (vec3) iSize (vec3) iRot (vec2 cos/sin) iUv (vec2 repeats)
 *   - the transform is folded into the standard AND depth shaders via
 *     onBeforeCompile, so PBR lighting, fog, shadow casting and receive all work
 *   - instances are split over a coarse XZ grid so the frustum can drop a whole
 *     city block instead of being forced to draw all of it
 *
 * Looks are preserved by construction: the box UV convention (one tile per TILE
 * metres, u = max(w,d)/TILE, v = h/TILE) is reproduced per instance, so a
 * batched building shades exactly like the merged one did.
 *
 * Anything that cannot be folded in safely - tilted props, decal planes,
 * animated doors, arches, roof slopes, skinned meshes, transparent materials -
 * is either merged like before or left exactly as authored. The pass is a pure
 * optimisation: `VAL.Instancing.enabled = false` restores the original scene.
 *
 * API
 *   tagBox(geo, w, h, d, x, y, z, ry) -> geo        mark a box at the source
 *   merge(list) -> BufferGeometry                   drop-in for mergeGeoms()
 *   optimize(root, {cell, keep}) -> stats           collapse a built group
 *   configure({vsmShadows})                         shadow-map mode switch
 *   optimize(group, {minCell, minPerBatch, maxBatches})  region granularity
 */
window.VAL = window.VAL || {};
VAL.Instancing = (function () {
  'use strict';

  const THREE = window.THREE;
  if (!THREE) { console.error('[VAL.Instancing] THREE missing'); return { enabled: false, optimize: () => ({}) }; }

  const TILE = 2;          // == VAL.Textures.TILE_METERS and what bx()/boxAt() bake
  const EPS = 1e-4;

  const api = { enabled: true, stats: null, vsmShadows: false };

  /* ---------------------------------------------------------------- tagging */

  /**
   * Remember how a geometry was placed so it can be re-issued as an instance.
   * `key` names the shape: '#box' means the shared unit box scaled by w/h/d,
   * anything else is a prototype built from the first occurrence of that shape.
   */
  function tagShape(g, key, x, y, z, ry, w, h, d) {
    if (g && g.isBufferGeometry) {
      g.userData.tag = {
        key, x: x || 0, y: y || 0, z: z || 0, ry: ry || 0,
        w: w == null ? 1 : Math.abs(w), h: h == null ? 1 : Math.abs(h), d: d == null ? 1 : Math.abs(d),
      };
      if (key === '#box') {
        g.userData.box = { w: g.userData.tag.w, h: g.userData.tag.h, d: g.userData.tag.d, x: g.userData.tag.x, y: g.userData.tag.y, z: g.userData.tag.z, ry: g.userData.tag.ry };
      }
    }
    return g;
  }

  /** Remember the parameters a box geometry was built from. */
  function tagBox(g, w, h, d, x, y, z, ry) {
    return tagShape(g, '#box', x, y, z, ry, w, h, d);
  }

  /**
   * Drop-in replacement for the modules' mergeGeoms(): byte-for-byte the same
   * merged geometry, except that when every input was a tagged box the result
   * also carries `userData.boxes`, which lets optimize() re-issue the whole blob
   * as one instance batch instead of a 36-vertex-per-box slab.
   */
  function merge(list) {
    const geo = mergeGeoms(list);
    if (!list.length) return geo;
    const tags = [];
    let nTagged = 0;
    for (const g of list) {
      const t = g && g.userData && g.userData.tag;
      tags.push(t || null);
      if (t) nTagged++;
    }
    // Stash the parts even when none are boxes: a blob of wall quads is just as
    // worth re-cutting along the region grid, and welding needs the sources.
    geo.userData.tags = tags;
    geo.userData.src = list;
    // optimize() re-issues the tagged parts as GPU instances and re-cuts the rest,
    // so mixed buckets such as window surrounds (boxes plus half-round arch heads)
    // split cleanly instead of being all-or-nothing.
    return geo;
  }

  /**
   * Same concatenation the builders used, but vertices that repeat exactly
   * (every quad stores its shared corners twice, a box three times per edge)
   * are collapsed into an index. Quads then cost 4 vertices instead of 6 and a
   * box 24 instead of 36, with identical output.
   */
  /** Copy a geometry's vertices, expanded through its index, into flat arrays. */
  function appendGeom(g, pos, nor, uv) {
    const p = g.getAttribute('position');
    if (!p) return;
    const n = g.getAttribute('normal'), t = g.getAttribute('uv');
    const index = g.index;
    const count = index ? index.count : p.count;
    const pa = p.array, na = n && n.array, ta = t && t.array;
    for (let i = 0; i < count; i++) {
      const j = index ? index.getX(i) : i;
      pos.push(pa[j * 3], pa[j * 3 + 1], pa[j * 3 + 2]);
      if (nor) nor.push(na ? na[j * 3] : 0, na ? na[j * 3 + 1] : 1, na ? na[j * 3 + 2] : 0);
      if (uv) uv.push(ta ? ta[j * 3] : 0, ta ? ta[j * 3 + 1] : 0);
    }
  }

  /**
   * Turn a triangle soup into an indexed geometry: vertices that repeat exactly
   * (every quad stores its shared corners twice, a box three times per edge) are
   * stored once, so a quad costs 4 vertices instead of 6 and a box 24 instead of
   * 36, with identical output.
   */
  function weldArrays(pos, nor, uv) {
    const out = { pos: [], nor: [], uv: [], idx: [] };
    const seen = new Map();
    const keyOf = (x, y, z, nx, ny, nz, u, v) =>
      Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4) + ',' +
      Math.round(nx * 1e3) + ',' + Math.round(ny * 1e3) + ',' + Math.round(nz * 1e3) + ',' +
      Math.round(u * 1e4) + ',' + Math.round(v * 1e4);
    for (let j = 0; j < pos.length / 3; j++) {
      const k = keyOf(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2],
        nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2], uv[j * 2], uv[j * 2 + 1]);
      let at = seen.get(k);
      if (at === undefined) {
        at = out.pos.length / 3;
        seen.set(k, at);
        out.pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
        out.nor.push(nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2]);
        out.uv.push(uv[j * 2], uv[j * 2 + 1]);
      }
      out.idx.push(at);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(out.nor), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.uv), 2));
    geo.setIndex(out.idx);
    geo.computeBoundingSphere();
    return geo;
  }

  function mergeGeoms(list, weld) {
    if (weld) {
      const pos = [], nor = [], uv = [];
      for (const g of list) appendGeom(g, pos, nor, uv);
      return weldArrays(pos, nor, uv);
    }
    const ngs = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let vc = 0; for (const g of ngs) vc += g.getAttribute('position').count;
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
    let o = 0;
    for (const ng of ngs) {
      const p = ng.getAttribute('position'), n = ng.getAttribute('normal'), u = ng.getAttribute('uv');
      pos.set(p.array, o * 3); if (n) nor.set(n.array, o * 3); if (u) uv.set(u.array, o * 2);
      o += p.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }

  /* ------------------------------------------------------------ unit geometry */

  let UNIT = null;
  function unitBox() {
    if (UNIT) return UNIT;
    const g = new THREE.BoxGeometry(1, 1, 1);   // centred, 24 verts, indexed
    UNIT = { geometry: g, position: g.getAttribute('position'), normal: g.getAttribute('normal'), uv: g.getAttribute('uv'), index: g.getIndex() };
    return UNIT;
  }

  /* ------------------------------------------------------------------ shader */

  let UV_CHUNK = null;
  /**
   * r152 derives every map's UV in the vertex stage from one chunk, and each
   * branch reads `uv` through its own `*_UV` macro (MAP_UV, NORMALMAP_UV, ...).
   * Rewriting that chunk generically - wrap every `vec3( X, 1 )` in the
   * per-instance remap - keeps colour/normal/roughness/emissive maps in sync
   * without hardcoding chunk contents against a pinned three build.
   */
  function uvChunk() {
    if (UV_CHUNK !== null) return UV_CHUNK;
    const src = (THREE.ShaderChunk && THREE.ShaderChunk.uv_vertex) || '';
    UV_CHUNK = src.replace(/vec3\(\s*([A-Za-z_0-9]+)\s*,\s*1\s*\)/g, 'vec3( valInstUv( $1 ), 1 )');
    return UV_CHUNK;
  }

  const DECL = [
    '#ifdef VAL_INSTANCED',
    'attribute vec3 iPos;',
    'attribute vec3 iSize;',
    'attribute vec2 iRot;',
    'attribute vec2 iUv;',
    'vec3 valRotY( vec3 v, vec2 c ) { return vec3( v.x * c.x + v.z * c.y, v.y, -v.x * c.y + v.z * c.x ); }',
    'vec2 valInstUv( vec2 u ) { return u * iUv; }',
    '#endif',
  ].join('\n');

  const APPLY_POS = [
    '#include <begin_vertex>',
    '#ifdef VAL_INSTANCED',
    '\ttransformed *= iSize;',
    '\ttransformed = valRotY( transformed, iRot );',
    '\ttransformed += iPos;',
    '#endif',
  ].join('\n');

  const APPLY_NRM = [
    '#include <beginnormal_vertex>',
    '#ifdef VAL_INSTANCED',
    '\tobjectNormal = valRotY( objectNormal, iRot );',
    '#endif',
  ].join('\n');

  const canPatch = (shader) => shader.vertexShader.indexOf('#include <begin_vertex>') >= 0;

  function inject(shader, withNormals) {
    shader.vertexShader = DECL + '\n' + shader.vertexShader
      .replace('#include <begin_vertex>', APPLY_POS)
      .replace(withNormals ? '#include <beginnormal_vertex>' : '\u0000', APPLY_NRM);
    const uv = uvChunk();
    if (uv && shader.vertexShader.indexOf('#include <uv_vertex>') >= 0) {
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', uv);
    }
  }

  /**
   * A private clone of `material` that knows how to draw instance batches. The
   * clone matters: VAL.Textures hands out cached materials shared with the
   * non-instanced meshes, and patching those would break them.
   */
  function patchMaterial(material) {
    const m = material.clone();
    m.name = (material.name || 'mat') + '#inst';
    m.defines = Object.assign({}, material.defines || {}, { VAL_INSTANCED: '' });
    m.onBeforeCompile = (shader) => { if (canPatch(shader)) inject(shader, true); };
    m.customProgramCacheKey = () => 'valInst';
    return m;
  }

  // three's own mapping of surface side -> shadow side
  const SHADOW_SIDE = { 0: 1, 1: 0, 2: 2 };

  /**
   * Depth material for the shadow pass. Without it three renders the shadow of
   * the *unit box* at the batch origin, so every instanced region would drop one
   * small black cube on the map instead of its real silhouette.
   */
  function depthMaterialFor(material) {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    d.side = material.shadowSide != null ? material.shadowSide : (SHADOW_SIDE[material.side] || material.side);
    d.fog = false;
    if (material.alphaTest > 0 && material.map) { d.alphaMap = material.map; d.alphaTest = material.alphaTest; }
    d.defines = Object.assign({}, material.defines || {}, { VAL_INSTANCED: '' });
    d.onBeforeCompile = (shader) => { if (canPatch(shader)) inject(shader, false); };
    d.customProgramCacheKey = () => 'valInstDepth';
    return d;
  }

  /* --------------------------------------------------------------- batching */

  /**
   * Instance list -> one InstancedBufferGeometry per `cell` metre grid square.
   * The cells are what gives per-region frustum culling back.
   */
  const newBox = () => ({ list: [], minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity, minz: Infinity, maxz: -Infinity });

  // A bounding sphere per instance is rotation invariant, which is what makes
  // chunk bounds cheap to keep conservative for boxes and arches alike.
  const extent = (b, it) => {
    const r = it.rad + 0.02;
    if (it.x - r < b.minx) b.minx = it.x - r;
    if (it.x + r > b.maxx) b.maxx = it.x + r;
    if (it.z - r < b.minz) b.minz = it.z - r;
    if (it.z + r > b.maxz) b.maxz = it.z + r;
    if (it.y - r < b.miny) b.miny = it.y - r;
    if (it.y + r > b.maxy) b.maxy = it.y + r;
  };

  /**
   * Draw-call granularity, shared by the instance batches and the merged
   * leftovers. One mesh per material is the fewest calls but throws culling
   * away; one mesh per tiny cell is good culling but costs hundreds of calls.
   * So: size the cell from the bucket's own extent and population, then give
   * every non-empty cell a mesh of its own. Cells stay contiguous, which is what
   * keeps the resulting bounds tight enough for the frustum to reject them - a
   * greedy "balance the batch sizes" split scatters cells over the whole map and
   * every chunk then covers everything, so nothing is ever culled.
   */
  /**
   * Cell layout for a bucket of `units` items. Returns null when the bucket is
   * too small to be worth splitting. `units` is instance counts for the batched
   * shapes and triangle counts for merged ones - both are "how much is hanging
   * off this draw call", which is the thing culling actually pays for.
   */
  function planFor(units, centers, opts) {
    opts = opts || {};
    const maxB = opts.maxBatches || 12;
    const minCell = opts.minCell || opts.cell || 14;   // opts.cell is the old name
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const c of centers) {
      if (c.x < minx) minx = c.x;
      if (c.x > maxx) maxx = c.x;
      if (c.z < minz) minz = c.z;
      if (c.z > maxz) maxz = c.z;
    }
    const spanX = Math.max(maxx - minx, 1), spanZ = Math.max(maxz - minz, 1);
    const want = Math.min(maxB, Math.max(1, Math.ceil(units)));
    if (want < 2) return null;
    // spread the chunks along the bucket's own aspect ratio: a wall run that is
    // 120 m long and 8 m deep wants 4 x 1 cells, not a square 2 x 2 grid
    const nx = Math.max(1, Math.min(want, Math.round(Math.sqrt(want * spanX / spanZ))));
    const nz = Math.max(1, Math.min(want, Math.ceil(want / nx)));
    return {
      minx: minx, minz: minz,
      cellX: Math.max(minCell, spanX / nx), cellZ: Math.max(minCell, spanZ / nz),
    };
  }

  const cellKey = (plan, x, z) =>
    Math.floor((x - plan.minx) / plan.cellX) + ':' + Math.floor((z - plan.minz) / plan.cellZ);

  /** Group items onto the plan's cells, one group per non-empty cell. */
  function grid(items, centerOf, opts) {
    opts = opts || {};
    const plan = planFor(items.length / (opts.minPerBatch || 600), items.map(centerOf), opts);
    if (!plan) return [items];
    const cells = new Map();
    for (const it of items) {
      const c = centerOf(it);
      const key = cellKey(plan, c.x, c.z);
      let g = cells.get(key);
      if (!g) cells.set(key, g = []);
      g.push(it);
    }
    return [...cells.values()];
  }

  function buildBatches(instances, material, opts) {
    const U = opts.proto || unitBox();
    return grid(instances, (it) => it, opts).map((list) => {
      const b = newBox();
      for (const it of list) extent(b, it);
      b.list = list;
      return makeBatch(b.list, material, U, b, opts);
    });
  }

  function makeBatch(list, material, U, bounds, opts) {
    const n = list.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', U.position);   // shared across every batch of this shape
    geo.setAttribute('normal', U.normal);
    if (U.uv) geo.setAttribute('uv', U.uv);
    if (U.index) geo.setIndex(U.index);

    const iPos = new Float32Array(n * 3);
    const iSize = new Float32Array(n * 3);
    const iRot = new Float32Array(n * 2);
    const iUv = new Float32Array(n * 2);
    const ox = (bounds.minx + bounds.maxx) / 2;
    const oz = (bounds.minz + bounds.maxz) / 2;

    for (let i = 0; i < n; i++) {
      const it = list[i];
      iPos[i * 3] = it.x - ox; iPos[i * 3 + 1] = it.y; iPos[i * 3 + 2] = it.z - oz;
      iSize[i * 3] = it.w; iSize[i * 3 + 1] = it.h; iSize[i * 3 + 2] = it.d;
      iRot[i * 2] = Math.cos(it.ry); iRot[i * 2 + 1] = Math.sin(it.ry);
      // one tile per TILE metres, u along the longer horizontal edge: exactly the
      // convention boxAt()/bx() baked into their merged vertices
      iUv[i * 2] = it.uvu;
      iUv[i * 2 + 1] = it.uvv;
    }

    const IBA = THREE.InstancedBufferAttribute;
    geo.setAttribute('iPos', new IBA(iPos, 3));
    geo.setAttribute('iSize', new IBA(iSize, 3));
    geo.setAttribute('iRot', new IBA(iRot, 2));
    geo.setAttribute('iUv', new IBA(iUv, 2));
    geo.instanceCount = n;

    const box = new THREE.Box3(
      new THREE.Vector3(bounds.minx - ox, bounds.miny, bounds.minz - oz),
      new THREE.Vector3(bounds.maxx - ox, bounds.maxy, bounds.maxz - oz)
    );
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(ox, 0, oz);
    mesh.name = (opts.name || 'inst') + '_' + n;
    mesh.castShadow = opts.castShadow !== false && !api.vsmShadows;
    mesh.receiveShadow = opts.receiveShadow !== false;
    mesh.userData.valInstances = n;
    mesh.userData.noBatch = true;
    if (mesh.castShadow) mesh.customDepthMaterial = depthMaterialFor(material);
    return mesh;
  }

  /* -------------------------------------------------------- the optimize pass */

  const ID = { px: 0, py: 0, pz: 0, rot: 0, sx: 1, sy: 1, sz: 1 };

  /** Local transform expressible as translate + yaw + axis scale? */
  function readTransform(o) {
    if (!o.matrixAutoUpdate || o.isSkinnedMesh) return null;
    const r = o.rotation, p = o.position, s = o.scale;
    if (Math.abs(r.x) > EPS || Math.abs(r.z) > EPS) return null;               // tilt -> leave alone
    if (Math.abs(s.x - s.z) > EPS * Math.max(1, Math.abs(s.x))) return null;   // x/z shear -> leave alone
    if (Math.abs(s.x) < EPS || Math.abs(s.y) < EPS || Math.abs(s.z) < EPS) return null;
    return { px: p.x, py: p.y, pz: p.z, rot: r.y, sx: s.x, sy: s.y, sz: s.z };
  }

  /** a applied to b: world = T(a) R(a) S(a) [ b ] */
  function compose(a, b) {
    const c = Math.cos(a.rot), s = Math.sin(a.rot);
    const lx = a.sx * b.px, ly = a.sy * b.py, lz = a.sz * b.pz;
    return {
      px: a.px + c * lx + s * lz,
      py: a.py + ly,
      pz: a.pz - s * lx + c * lz,
      rot: a.rot + b.rot,
      sx: a.sx * b.sx, sy: a.sy * b.sy, sz: a.sz * b.sz,
    };
  }

  /**
   * The shape once, in its own local space: take the geometry as authored and
   * undo the placement that was baked into it. Every later occurrence with the
   * same key was produced by the same generator call with the same parameters,
   * so it differs only by that placement.
   */
  function prototypeOf(geo, tag) {
    const g = geo.clone();
    const inv = new THREE.Matrix4()
      .makeRotationY(-tag.ry || 0)
      .multiply(new THREE.Matrix4().makeTranslation(-tag.x, -tag.y, -tag.z));
    g.applyMatrix4(inv);
    g.computeBoundingSphere();
    return {
      geometry: g,
      position: g.getAttribute('position'),
      normal: g.getAttribute('normal'),
      uv: g.getAttribute('uv'),
      index: g.getIndex(),
      radius: g.boundingSphere ? g.boundingSphere.radius : 1,
    };
  }

  /** Place a leftover geometry into the batch root's space, if it needs moving. */
  function baked(geo, ctx) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(ctx.px, ctx.py, ctx.pz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ctx.rot),
      new THREE.Vector3(ctx.sx, ctx.sy, ctx.sz)
    );
    const identity = m.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < EPS);
    const g = identity ? geo : geo.clone().applyMatrix4(m);
    if (!g.boundingBox) g.computeBoundingBox();
    return {
      geo: g,
      center: g.boundingBox ? g.boundingBox.getCenter(new THREE.Vector3()) : new THREE.Vector3(),
    };
  }

  /**
   * Parts that are not repeated shapes stay merged - welded (a shared corner is
   * stored once behind an index instead of once per triangle) and split along the
   * region grid so roofs, floors and wall runs become cullable too instead of one
   * always-drawn blob per material.
   *
   * The split works on triangles, not on source parts: a floor or a facade run is
   * a single hand-built geometry covering the whole map, so there are no parts to
   * bin, and it is exactly the kind of mesh the frustum never rejects. Triangles
   * themselves are never cut, so a chunk boundary only duplicates the few corners
   * that straddle it - the picture is identical.
   */
  function mergedMeshes(items, material, flags, name, opts) {
    opts = opts || {};
    const out = [];
    const emit = (geo, tag) => {
      const p = geo && geo.getAttribute('position');
      if (!p || !p.count) return;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = flags.castShadow; mesh.receiveShadow = flags.receiveShadow;
      mesh.name = name + (tag ? '_' + tag : '');
      mesh.userData.noBatch = true;
      out.push(mesh);
    };

    let tris = 0;
    for (const it of items) {
      const g = it.geo;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
    const plan = tris >= (opts.minSplitTris || 4000)
      ? planFor(tris / (opts.trisPerBatch || 12000), items.map((i) => i.center), opts)
      : null;

    if (!plan) {                        // too little to be worth any splitting
      const pos = [], nor = [], uv = [];
      for (const it of items) appendGeom(it.geo, pos, nor, uv);
      emit(weldArrays(pos, nor, uv));
      return out;
    }

    const cells = new Map();
    for (const it of items) {
      const pos = [], nor = [], uv = [];
      appendGeom(it.geo, pos, nor, uv);
      const n = pos.length / 3;
      for (let t = 0; t + 2 < n; t += 3) {
        const key = cellKey(plan,
          (pos[t * 3] + pos[t * 3 + 3] + pos[t * 3 + 6]) / 3,
          (pos[t * 3 + 2] + pos[t * 3 + 5] + pos[t * 3 + 8]) / 3);
        let cell = cells.get(key);
        if (!cell) cells.set(key, cell = { pos: [], nor: [], uv: [] });
        for (let v = t; v < t + 3; v++) {
          cell.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
          cell.nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
          cell.uv.push(uv[v * 2], uv[v * 2 + 1]);
        }
      }
    }
    for (const [key, cell] of cells) emit(weldArrays(cell.pos, cell.nor, cell.uv), key);
    return out;
  }

  const simpleAttrs = (g) => {
    const names = Object.keys(g.attributes);
    return names.every((n) => n === 'position' || n === 'normal' || n === 'uv');
  };

  /**
   * Walk a fully placed group; static boxes become instanced batches, other
   * static meshes get merged per material, anything else stays as authored.
   */
  function optimize(root, opts) {
    opts = opts || {};
    const out = {
      batches: 0, instances: 0, merged: 0, mergedBatches: 0, kept: 0, recut: 0,
      meshesBefore: 0, meshesAfter: 0, vertsBefore: 0, vertsAfter: 0, bytesBefore: 0, bytesAfter: 0,
    };
    if (!api.enabled || !root) return out;
    // Batching is opt-in per group: only scenery that is provably static gets
    // folded in. Everything else in the scene (agents, weapons, hitboxes, the
    // spike) is animated or picked by name at runtime and must stay untouched.
    if (!opts.force && !(root.userData && root.userData.batchable)) return out;

    root.updateMatrixWorld(true);
    const keep = new Set(opts.keep || []);
    const batches = new Map();
    const merges = new Map();
    const pending = [];
    const kill = [];

    const bucketKey = (mesh) => {
      const m = mesh.material;
      return m.uuid + '|' + (m.side || 0) + (m.flatShading ? 'f' : '') +
        (m.vertexColors ? 'c' : '') + (m.map ? 'm' : '') + (m.normalMap ? 'n' : '') +
        '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0) + (mesh.visible ? 1 : 0) +
        '|' + (m.emissive && m.emissive.getHex ? m.emissive.getHex() : 0);
    };

    const eligible = (mesh) => {
      if (mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.userData.noBatch) return false;
      if (mesh.userData.zone || mesh.userData.ent || mesh.userData.outline || mesh.userData.char) return false;
      const m = mesh.material;
      if (!m || m.transparent || m.blending !== THREE.NormalBlending || m.wireframe) return false;
      if (m.vertexColors) return false;
      // geometry groups only drive draw ranges when an array of materials is
      // bound; BoxGeometry always ships six of them, so they are not a reason to
      // skip on their own
      if (Array.isArray(m)) return false;
      const g = mesh.geometry;
      if (!g || !g.isBufferGeometry || !g.getAttribute('position')) return false;
      return simpleAttrs(g);
    };

    const collect = (node, ctx) => {
      if (node.userData.noBatch || keep.has(node.name)) return;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (!child.isMesh && !child.isGroup) { out.kept++; continue; }
        const t = readTransform(child);
        if (!t) { out.kept++; continue; }                 // exotic transform: leave subtree alone
        collect(child, compose(ctx, t));
      }

      if (!node.isMesh || !eligible(node)) { if (!node.isGroup) out.kept++; return; }

      const g = node.geometry;
      const pos = g.getAttribute('position');

      // --- repeated shapes (boxes, arch heads ...) -> GPU instances ----------
      // A single tagged mesh is one instance. A merged blob carries its parts,
      // so the tagged ones are lifted out of it and the rest keeps its merged mesh.
      const parts = g.userData.tag ? [{ geo: g, tag: g.userData.tag }]
        : (g.userData.tags && g.userData.src)
          ? g.userData.src.map((src, i) => ({ geo: src, tag: g.userData.tags[i] }))
          : null;

      if (parts) {
        const picked = parts.filter((pt) => pt.tag);
        const rest = parts.filter((pt) => !pt.tag).map((pt) => pt.geo);
        const usable = picked.length && picked.every((pt) =>
          pt.tag.key !== '#box' || (pt.tag.w > 1e-3 && pt.tag.h > 1e-3 && pt.tag.d > 1e-3));

        // nothing instanced in here, but the blob is still worth welding and
        // splitting along the region grid so the frustum can drop parts of it
        if (!usable && parts.length > 1) {
          const built = mergedMeshes(parts.map((pt) => baked(pt.geo, ctx)), node.material,
            { castShadow: node.castShadow, receiveShadow: node.receiveShadow }, 'cut', opts);
          if (built.length) {
            out.vertsBefore += pos.count;
            out.bytesBefore += attrBytes(g);
            out.recut = (out.recut || 0) + 1;
            for (const mesh of built) pending.push({ mesh, parent: root });
            g.userData.src = null;           // release the references we just used
            kill.push(node);
            return;
          }
        }
        if (usable) {
          const mkey = bucketKey(node);
          for (const { tag, geo: part } of picked) {
            const boxish = tag.key === '#box';
            const t = compose(ctx, { px: tag.x, py: tag.y, pz: tag.z, rot: tag.ry, sx: 1, sy: 1, sz: 1 });
            // boxes are the unit cube scaled; other shapes keep their own size and
            // only inherit the surrounding scale, which the shader applies as iSize
            const w = boxish ? Math.abs(tag.w * t.sx) : Math.abs(t.sx);
            const h = boxish ? Math.abs(tag.h * t.sy) : Math.abs(t.sy);
            const d = boxish ? Math.abs(tag.d * t.sz) : Math.abs(t.sz);
            const key = mkey + '|' + tag.key;
            let bk = batches.get(key);
            if (!bk) {
              batches.set(key, bk = {
                material: node.material, list: [], key: tag.key,
                castShadow: node.castShadow, receiveShadow: node.receiveShadow,
              });
            }
            if (!bk.proto && !boxish) bk.proto = prototypeOf(part, tag);
            bk.list.push({
              x: t.px, y: t.py, z: t.pz, w, h, d, ry: t.rot,
              rad: boxish ? 0.5 * Math.hypot(w, h, d)
                : (bk.proto ? bk.proto.radius * Math.max(w, h, d) : Math.max(w, h, d)),
              uvu: boxish ? Math.max(w, d) / TILE : 1,
              uvv: boxish ? h / TILE : 1,
            });
          }
          out.instances += picked.length;
          out.vertsBefore += pos.count;
          out.bytesBefore += attrBytes(g);
          g.userData.src = null;
          if (rest.length) {
            for (const mesh of mergedMeshes(rest.map((g) => baked(g, ctx)), node.material,
              { castShadow: node.castShadow, receiveShadow: node.receiveShadow }, 'residual', opts)) {
              pending.push({ mesh, parent: root });
            }
          }
          kill.push(node);
          return;
        }
      }

      const key = bucketKey(node);
      let mk = merges.get(key);
      if (!mk) merges.set(key, mk = { material: node.material, items: [], castShadow: node.castShadow, receiveShadow: node.receiveShadow, tris: 0, verts: 0, bytes: 0 });
      mk.items.push(Object.assign({ node }, baked(g, ctx)));
      mk.tris += (g.index ? g.index.count : pos.count) / 3;
      mk.verts += pos.count;
      mk.bytes += attrBytes(g);
    };

    collect(root, ID);

    out.meshesBefore = countMeshes(root);

    for (const bk of batches.values()) {
      const mat = patchMaterial(bk.material);
      const built = buildBatches(bk.list, mat, {
        // the region knobs are forwarded so one option set tunes both the
        // instance batches and the merged leftovers
        minCell: opts.minCell, minPerBatch: opts.minPerBatch, maxBatches: opts.maxBatches,
        name: 'inst_' + bk.key.replace('#box', 'box'),
        castShadow: bk.castShadow, receiveShadow: bk.receiveShadow,
        proto: bk.proto ? { geometry: bk.proto.geometry, position: bk.proto.position, normal: bk.proto.normal, uv: bk.proto.uv, index: bk.proto.index } : null,
      });
      for (const m of built) {
        root.add(m);
        out.batches++;
        // the unit box is shared by every batch, so only the per-instance
        // attributes are paid for again: 12 floats = 48 B per box
        out.vertsAfter += m.geometry.getAttribute('position').count;
        out.bytesAfter += 48 * m.userData.valInstances;   // 12 floats of instance payload
      }
    }

    for (const mk of merges.values()) {
      // one small mesh is already a single draw call and splitting it only costs
      // calls; a big one is worth re-cutting even on its own - which is exactly
      // what the whole-map floor and roof slabs are
      if (mk.items.length < 2 && mk.tris < (opts.minSplitTris || 4000)) { out.kept += mk.items.length; continue; }
      out.vertsBefore += mk.verts;
      out.bytesBefore += mk.bytes;
      const built = mergedMeshes(mk.items, mk.material,
        { castShadow: mk.castShadow, receiveShadow: mk.receiveShadow }, 'merged', opts);
      for (const mesh of built) {
        root.add(mesh);
        out.mergedBatches++;
        out.vertsAfter += mesh.geometry.getAttribute('position').count;
        out.bytesAfter += attrBytes(mesh.geometry);
      }
      out.merged += mk.items.length;
      for (const i of mk.items) kill.push(i.node);
    }

    for (const p of pending) {
      p.parent.add(p.mesh);
      out.vertsAfter += p.mesh.geometry.getAttribute('position').count;
      out.bytesAfter += attrBytes(p.mesh.geometry);
    }
    for (const bk of batches.values()) if (bk.proto) out.protoBytes = (out.protoBytes || 0) + attrBytes(bk.proto.geometry);
    if (out.batches) out.bytesAfter += 840;   // the one shared unit box
    for (const node of kill) if (node.parent) node.parent.remove(node);
    out.meshesAfter = countMeshes(root);
    api.stats = out;
    return out;
  }

  function attrBytes(g) {
    let b = 0;
    for (const k of Object.keys(g.attributes)) b += g.getAttribute(k).array.byteLength;
    if (g.index) b += g.index.array.byteLength;
    return b;
  }
  function countMeshes(o) { let n = 0; o.traverse((c) => { if (c.isMesh) n++; }); return n; }

  api.tagBox = tagBox;
  api.tagShape = tagShape;
  api.merge = merge;
  api.mergeGeoms = mergeGeoms;
  api.optimize = optimize;
  api.patchMaterial = patchMaterial;
  api.unitBox = unitBox;
  api.configure = (cfg) => { api.vsmShadows = !!(cfg && cfg.vsmShadows); };
  return api;
})();
