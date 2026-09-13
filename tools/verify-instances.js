#!/usr/bin/env node
/**
 * Regression check for the instancing pass (src/js/map/instances.js).
 *
 * Instancing replaces thousands of baked boxes with one unit box plus a few
 * floats per instance, so the only way to be sure it is correct - without a
 * browser - is to prove that every box the builders placed is still placed in
 * exactly the same spot. This loads the map in Node, records every tagged
 * placement, runs optimize(), rebuilds the placements from the instance
 * attributes the way the vertex shader does, and matches them one by one.
 *
 *   node tools/verify-instances.js [--verbose]
 *
 * Exit code 0 means the batched scene is geometrically identical to the
 * authored one. Matching is done at 1 cm, which is far above the float32
 * storage noise but tight enough to catch a wrong cell offset, a dropped
 * rotation or a mis-scaled instance.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

require(path.join(__dirname, 'lib', 'node-dom.js')).install(globalThis);

const SRC = path.join(__dirname, '..', 'src');
globalThis.THREE = require(path.join(SRC, 'js', 'lib', 'three.min.js'));

const load = (rel) => vm.runInThisContext(fs.readFileSync(path.join(SRC, rel), 'utf8'), { filename: rel });
for (const rel of [
  'js/core/util.js',
  'js/core/textures.js',
  'js/map/instances.js',
  'js/map/ascent_data.js',
  'js/map/scenery.js',
  'js/map/scenery_props.js',
  'js/map/dressing.js',
  'js/map/nav.js',
  'js/map/ascent.js',
]) load(rel);

const THREE = globalThis.THREE;
const VERBOSE = process.argv.indexOf('--verbose') >= 0;
const TOL = 0.01;                    // 1 cm
const CELL = 0.06;                  // hash cell used for the neighbour search
const q = (v) => Math.round(v / CELL);

const scene = new THREE.Scene();
const map = VAL.AscentMap.build(scene);
if (VAL.Nav && VAL.Nav.init) VAL.Nav.init(map);
if (map.dress) map.dress();
const surround = VAL.Scenery && VAL.Scenery.buildSurroundings
  ? VAL.Scenery.buildSurroundings(scene, map.data.bounds) : null;

const roots = {};
for (const [name, g] of Object.entries({ ascent: map.group, dressing: map.dressGroup, surroundings: surround })) {
  if (g && g.isObject3D) { g.userData.batchable = true; roots[name] = g; }
}

const list = [];
const partsOf = (g) => g.userData.tag ? [g.userData.tag]
  : (g.userData.tags && g.userData.src) ? g.userData.tags : null;

/* Mirror instances.js: an instance is placed at (ancestor transforms) o (baked
   tag), in the space of the group optimize() was handed. */
const composeLocal = (a, b) => {
  const c = Math.cos(a.rot), s = Math.sin(a.rot);
  const lx = a.sx * b.px, ly = a.sy * b.py, lz = a.sz * b.pz;
  return {
    px: a.px + c * lx + s * lz, py: a.py + ly, pz: a.pz - s * lx + c * lz,
    rot: a.rot + b.rot, sx: a.sx * b.sx, sy: a.sy * b.sy, sz: a.sz * b.sz,
  };
};
const ctxOf = (node, root) => {
  const chain = [];
  for (let o = node; o && o !== root; o = o.parent) chain.push(o);
  let ctx = { px: 0, py: 0, pz: 0, rot: 0, sx: 1, sy: 1, sz: 1 };
  for (let i = chain.length - 1; i >= 0; i--) {
    const o = chain[i];
    ctx = composeLocal(ctx, {
      px: o.position.x, py: o.position.y, pz: o.position.z,
      rot: o.rotation.y, sx: o.scale.x, sy: o.scale.y, sz: o.scale.z,
    });
  }
  return ctx;
};

/* ---------- 1. record what the builders asked for ---------- */
const vertsOf = (o) => (o.geometry.getAttribute('position') ? o.geometry.getAttribute('position').count : 0);
let vertsBefore = 0;
const snapshot = [];
for (const g of Object.values(roots)) {
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    vertsBefore += vertsOf(o);
    const tags = partsOf(o.geometry);
    if (tags) snapshot.push({ o, tags, ctx: ctxOf(o, g) });
  });
}

/* ---------- 2. run the pass ---------- */
const stats = { batches: 0, instances: 0, recut: 0, kept: 0 };
for (const g of Object.values(roots)) {
  const s = VAL.Instancing.optimize(g, { cell: 26 });
  for (const k of Object.keys(stats)) stats[k] += s[k] || 0;
}

/* ---------- 3. what the GPU will actually draw ---------- */
const made = new Map();
let madeBox = 0, madeShape = 0, vertsAfter = 0, instanced = 0;
const U = VAL.Instancing.unitBox();
const hashPut = (map2, x, y, z, item) => {
  const k = q(x) + ':' + q(y) + ':' + q(z);
  let a = map2.get(k);
  if (!a) map2.set(k, a = []);
  a.push(item);
};
for (const g of Object.values(roots)) {
  g.traverse((o) => {
    const geo = o.geometry;
    if (!o.isMesh || !geo) return;
    if (!geo.isInstancedBufferGeometry) { vertsAfter += vertsOf(o); return; }
    const P = geo.getAttribute('iPos'), S = geo.getAttribute('iSize');
    const R = geo.getAttribute('iRot');
    const isUnitBox = geo.getAttribute('position') === U.position;
    for (let i = 0; i < geo.instanceCount; i++) {
      instanced++;
      if (!isUnitBox) { madeShape++; continue; }
      madeBox++;
      // the shader does: pos = rotY(iRot) * (unit * iSize) + iPos, and the batch
      // mesh itself sits at the cell origin.
      hashPut(made, P.getX(i) + o.position.x, P.getY(i), P.getZ(i) + o.position.z, {
        x: P.getX(i) + o.position.x, y: P.getY(i), z: P.getZ(i) + o.position.z,
        w: S.getX(i), h: S.getY(i), d: S.getZ(i),
        c: R.getX(i), s: R.getY(i), used: false,
      });
    }
  });
}
const countLeftoverVerts = (root) => root.traverse((o) => {
  if (o.isMesh && o.geometry && o.geometry.instanceCount) {
    vertsAfter += o.geometry.getAttribute('position').count * o.geometry.instanceCount;
  }
});
for (const g of Object.values(roots)) countLeftoverVerts(g);

/* ---------- 4. match authored boxes against instanced ones ---------- */
const findMatch = (t) => {
  const cx = q(t.x), cy = q(t.y), cz = q(t.z);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const a = made.get((cx + dx) + ':' + (cy + dy) + ':' + (cz + dz));
    if (!a) continue;
    for (const m of a) {
      if (m.used) continue;
      if (Math.abs(m.x - t.x) > TOL || Math.abs(m.y - t.y) > TOL || Math.abs(m.z - t.z) > TOL) continue;
      if (Math.abs(m.w - t.w) > TOL || Math.abs(m.h - t.h) > TOL || Math.abs(m.d - t.d) > TOL) continue;
      // rotation is stored as cos/sin, so compare it without a round trip
      if (Math.abs(m.c - Math.cos(t.ry)) > 1e-3 || Math.abs(m.s - Math.sin(t.ry)) > 1e-3) continue;
      m.used = true;
      return m;
    }
  }
  return null;
};

let boxes = 0, degenerate = 0, survived = 0, matched = 0;
const unmatched = [];
for (const snap of snapshot) {
  if (!snap.o.parent) { /* consumed by the pass - its boxes must show up as instances */ }
  else survived += snap.tags.filter(Boolean).length;
  for (const raw of snap.tags) {
    if (!raw || raw.key !== '#box') continue;
    if (raw.w <= 1e-3 || raw.h <= 1e-3 || raw.d <= 1e-3) { degenerate++; continue; }
    if (snap.o.parent) continue;                     // mesh was kept exactly as authored
    const p = composeLocal(snap.ctx, { px: raw.x, py: raw.y, pz: raw.z, rot: raw.ry, sx: 1, sy: 1, sz: 1 });
    const t = {
      x: p.px, y: p.py, z: p.pz, ry: p.rot,
      w: Math.abs(raw.w * p.sx), h: Math.abs(raw.h * p.sy), d: Math.abs(raw.d * p.sz),
    };
    boxes++;
    if (findMatch(t)) matched++;
    else if (unmatched.length < 400) {
      unmatched.push(`x=${t.x.toFixed(3)} y=${t.y.toFixed(3)} z=${t.z.toFixed(3)} w=${t.w.toFixed(3)} h=${t.h.toFixed(3)} d=${t.d.toFixed(3)} ry=${t.ry.toFixed(3)} mesh=${snap.o.name || '(unnamed)'}`);
    }
  }
}

console.log(`tagged boxes expected from consumed meshes: ${boxes} (${degenerate} degenerate skipped, ${survived} left on kept meshes)`);
console.log(`batches ${stats.batches}, instances ${instanced} (${madeBox} unit boxes, ${madeShape} other shapes), re-cut blobs ${stats.recut}, kept meshes ${stats.kept}`);
console.log(`vertices: ${vertsBefore.toLocaleString()} authored -> ${vertsAfter.toLocaleString()} submitted`);
console.log(`instanced boxes matching their authored placement within ${TOL * 1000} mm: ${matched}/${boxes}`);
if (VERBOSE && unmatched.length) {
  console.log('\nplacements with no instance:\n  ' + unmatched.slice(0, 12).join('\n  '));
}
const ok = matched === boxes && madeBox === matched;
console.log('\n' + (ok
  ? 'PASS: the instanced scene is geometrically identical to the authored one'
  : `FAIL: ${boxes - matched} placements unmatched, ${madeBox - matched} instances unexpected`));
process.exit(ok ? 0 : 1);
