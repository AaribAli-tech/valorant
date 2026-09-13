#!/usr/bin/env node
/*
 * tools/scene-stats.js - builds the Ascent map in Node (no GPU) and reports
 * the numbers that actually decide whether the game lags: draw calls, vertex
 * throughput and vertex-buffer bytes.
 *
 *   node tools/scene-stats.js                      # measure src/
 *   node tools/scene-stats.js --save baseline.json # ...and store it
 *   node tools/scene-stats.js --against baseline.json  # print a diff
 *
 * Used as the before/after yardstick for the instanced-building work.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const SRC = path.join(ROOT, 'src');

require('./lib/node-dom').install(globalThis);
globalThis.THREE = require(path.join(SRC, 'js/lib/three.min.js'));

/* ------------------------------------------------------------ module loader */

function loadFromSrc(rel) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) return `skip (missing ${rel})`;
  try {
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: rel });
    return null;
  } catch (e) {
    return `${rel}: ${e.message}`;
  }
}

const ORDER = [
  'js/core/util.js',
  'js/core/textures.js',
  'js/map/ascent_data.js',
  'js/map/scenery.js',
  'js/map/scenery_props.js',
  'js/map/nav.js',
  'js/map/dressing.js',
  'js/map/instances.js',
  'js/map/ascent.js',
];

const problems = [];
for (const rel of ORDER) {
  const err = loadFromSrc(rel);
  if (err) problems.push(err);
}

/* ------------------------------------------------------------- build scene */

const THREE = globalThis.THREE;
const scene = new THREE.Scene();
const t0 = performance.now();
let map = null;
let buildErr = null;
try {
  map = VAL.AscentMap.build(scene);
  if (VAL.Nav && VAL.Nav.init) VAL.Nav.init(map);
  if (map && typeof map.dress === 'function') map.dress();
  if (VAL.Scenery && VAL.Scenery.buildSurroundings) {
    VAL.Scenery.buildSurroundings(scene, map.data.bounds);
  }
} catch (e) {
  buildErr = e;
}
const buildMs = performance.now() - t0;

const NOBATCH = argv.includes('--nobatch');
if (!NOBATCH && VAL.Instancing) {
  for (const g of [map.group, map.dressGroup, scene.getObjectByName('surroundings')]) {
    if (!g) continue;
    g.userData.batchable = true;
    VAL.Instancing.optimize(g, { minCell: Number(arg('--minCell')) || 14, minPerBatch: Number(arg('--minPer')) || 600, maxBatches: Number(arg('--maxB')) || 12 });
  }
}

if (buildErr) {
  console.error('map build failed:', buildErr);
  console.error(buildErr.stack.split('\n').slice(0, 6).join('\n'));
  if (problems.length) console.error('module load problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}

/* ------------------------------------------------------------------ gather */

let meshes = 0;
let visible = 0;
let verts = 0;
let tris = 0;
let bytes = 0;
let instances = 0;
let instancedMeshes = 0;
const rows = [];
const matNames = new Set();
const geoCount = new Map();

scene.traverse((o) => {
  if (!o.isMesh) return;
  meshes++;
  if (o.visible) visible++;
  const g = o.geometry;
  geoCount.set(g.uuid, (geoCount.get(g.uuid) || 0) + 1);
  matNames.add(o.material && o.material.name ? o.material.name : (o.material ? o.material.type : '-'));
  const pos = g.getAttribute('position');
  if (!pos) return;
  const inst = g.isInstancedBufferGeometry ? Math.max(1, g.instanceCount || 0) : 1;
  if (inst > 1) { instancedMeshes++; instances += inst; }
  const vc = pos.count * inst;
  const triCount = (g.index ? g.index.count : pos.count) / 3 * inst;
  verts += vc;
  tris += triCount;
  let b = 0;
  Object.keys(g.attributes).forEach((n) => {
    const a = g.getAttribute(n);
    b += a.array.byteLength;   // an instanced attribute's array already covers all instances
  });
  bytes += b;
  rows.push({ name: o.name || '(unnamed)', draw: 1, inst, verts: vc, tris: triCount, kb: b / 1024, cast: !!o.castShadow });
});

rows.sort((a, b) => b.tris - a.tris);

const sharedGeos = [...geoCount.values()].filter((n) => n > 1).length;
const dupVertsSaved = [...geoCount.entries()].reduce((acc, [, n]) => acc + (n > 1 ? n - 1 : 0), 0);

const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

/* --------------------------------------------------- what a frame really pays
   The point of chunked batches is that most of the map is not visible. Sample a
   few real vantage points and count what survives the frustum - that is the
   number that decides frame time, not the whole-scene total. */
const VANTAGE = [
  ['A main', 4, 2, -44, 0.6], ['A site', -14, 4, -20, 1.9], ['mid', 12, 2, -6, 0.2],
  ['B site', 30, 3, 26, -1.1], ['att spawn', -2, 2, 46, -1.57], ['def spawn', 30, 2, -52, 1.5],
  ['catwalk', -30, 3, 6, 0.8], ['heaven', 18, 12, -30, 2.2],
];
const cam = new THREE.PerspectiveCamera(71, 16 / 9, 0.05, 700);
const _sph = new THREE.Sphere();
const fr = new THREE.Frustum();
const mv = new THREE.Matrix4();
let visDraws = 0, visVerts = 0, visTris = 0;
scene.updateMatrixWorld(true);
for (const [, x, y, z, yaw] of VANTAGE) {
  cam.position.set(x, y, z);
  cam.rotation.set(0, yaw, 0);
  cam.updateMatrixWorld(true);
  mv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  fr.setFromProjectionMatrix(mv);
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.frustumCulled) return;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere || !fr.intersectsSphere(
      _sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld))) return;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const inst = g.isInstancedBufferGeometry ? Math.max(1, g.instanceCount || 0) : 1;
    visDraws++;
    visVerts += pos.count * inst;
    visTris += ((g.index ? g.index.count : pos.count) / 3) * inst;
  });
}
visDraws /= VANTAGE.length; visVerts /= VANTAGE.length; visTris /= VANTAGE.length;

const metrics = {
  visible, meshes, verts, tris, bytes, instances, instancedMeshes,
  materials: matNames.size, buildMs,
};

const saveTo = arg('--save');
if (saveTo) {
  fs.writeFileSync(path.resolve(ROOT, saveTo), JSON.stringify(metrics, null, 2));
  console.log(`\nmetrics written to ${saveTo}`);
}
const against = arg('--against');
if (against) {
  const base = JSON.parse(fs.readFileSync(path.resolve(ROOT, against), 'utf8'));
  const pc = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const arrow = (a, b) => `${pc(a, b) >= 0 ? '+' : ''}${pc(a, b).toFixed(1)}%`;
  console.log('\n=== vs baseline ===');
  for (const k of ['visible', 'verts', 'tris', 'bytes', 'materials']) {
    if (base[k] == null) continue;
    console.log(`  ${k.padEnd(10)} ${fmt(base[k])} -> ${fmt(metrics[k])}   ${arrow(metrics[k], base[k])}`);
  }
  console.log('');
}

console.log(`\n=== Ascent scene (src/, three r${THREE.REVISION}) ===`);
console.log(`built in ${buildMs.toFixed(0)} ms`);
console.log(`draw calls (meshes)      ${fmt(visible)}`);
console.log(`vertices submitted       ${fmt(verts)}   (${(verts / 1e6).toFixed(2)} M)`);
console.log(`triangles submitted      ${fmt(tris)}   (${(tris / 1e6).toFixed(2)} M)`);
console.log(`vertex buffers on GPU    ${(bytes / 1048576).toFixed(2)} MB`);
console.log(`instanced meshes         ${instancedMeshes}  (${fmt(instances)} instances)`);
console.log(`shared geometries        ${sharedGeos} reused in ${dupVertsSaved} extra meshes`);
console.log(`materials                ${matNames.size}`);
console.log('');
console.log(`per frame, avg over ${VANTAGE.length} vantage points (frustum culled):`);
console.log(`  draw calls             ${fmt(Math.round(visDraws))}   (scene total ${fmt(visible)})`);
console.log(`  vertices shaded        ${fmt(visVerts)}   (${(visVerts / 1e6).toFixed(2)} M)`);
console.log(`SWEEP ${fmt(Math.round(visDraws))} draws / ${fmt(visVerts)} verts / ${fmt(visTris)} tris of ${fmt(visible)} draws`);
console.log(`  triangles              ${fmt(visTris)}`);
console.log(`  -> ${(visVerts / verts * 100).toFixed(0)}% of scene geometry is actually submitted`);
if (problems.length) console.log('notes: ' + problems.join(' | '));

console.log('\ntop meshes by triangles submitted:');
console.log('  ' + ['name'.padEnd(26), 'inst', 'verts', 'tris', 'kB buf', 'shadow'].join('  '));
for (const r of rows.slice(0, 18)) {
  console.log('  ' + String(r.name).slice(0, 26).padEnd(26) +
    String(r.inst).padStart(6) + String(fmt(r.verts)).padStart(10) +
    String(fmt(r.tris)).padStart(10) + String(r.kb.toFixed(0)).padStart(8) +
    String(r.cast ? 'yes' : 'no').padStart(8));
}


