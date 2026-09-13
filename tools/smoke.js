#!/usr/bin/env node
/**
 * Load-order smoke test: runs every script the page loads, in the order the page
 * loads them, inside a minimal DOM, and checks that each module registered the
 * entry points the rest of the game calls. Catches the two failures a static
 * host makes easy - a script listed in the wrong order, and a file that exists in
 * src/ but not in the build.
 *
 *   node tools/smoke.js [--root public]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootArg = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 ? process.argv[i + 1] : 'src';
})();
const ROOT = path.resolve(__dirname, '..', rootArg || 'src');

require(path.join(__dirname, 'lib', 'node-dom.js')).install(globalThis);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);

if (!scripts.length) {
  console.error('no <script src> tags found in ' + path.join(ROOT, 'index.html'));
  process.exit(1);
}

const missing = [];
for (const ref of [...scripts, ...styles]) {
  if (/^https?:/.test(ref)) continue;
  if (!fs.existsSync(path.join(ROOT, ref))) missing.push(ref);
}
if (missing.length) {
  console.error('referenced but not present in ' + ROOT + ':\n  ' + missing.join('\n  '));
  process.exit(1);
}

let THREE;
try { THREE = require(path.join(ROOT, 'js', 'lib', 'three.min.js')); } catch (e) { THREE = null; }
globalThis.THREE = THREE;

// main.js boots the renderer and the game loop, which needs a real GL context.
const loaded = [];
const failed = [];
for (const rel of scripts) {
  if (rel.endsWith('js/main.js')) { loaded.push(rel + ' (skipped: needs WebGL)'); continue; }
  try {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
    loaded.push(rel);
  } catch (e) {
    failed.push(`${rel}: ${e.message}`);
  }
}

// What other modules reach for at boot and during a match.
const EXPECTED = [
  'U', 'Textures', 'Audio', 'Input',                       // core
  'WEAPONS', 'WeaponModels', 'Characters',                 // entities
  'MapData', 'Scenery', 'Dressing', 'AscentMap', 'Nav', 'Instancing',   // map
  'Player', 'Bot', 'Combat', 'TeamBrain', 'Abilities', 'Match',         // game
  'HUD', 'BuyMenu', 'AgentArt', 'Lobby',                    // ui
];
const VAL = globalThis.VAL || {};
const absent = EXPECTED.filter((k) => VAL[k] == null);

// The map is what this project touches most, so build it for real.
let built = '';
try {
  const scene = new THREE.Scene();
  const map = VAL.AscentMap.build(scene);
  built = `${map ? 'ok' : 'no map'}`;
  if (VAL.Instancing) {
    const s = VAL.Instancing.optimize(map.group, { cell: 26 });
    built += `, batches ${s.batches}, instances ${s.instances}`;
  }
} catch (e) {
  failed.push(`AscentMap.build: ${e.message}`);
}

console.log(`${loaded.length} scripts loaded, ${built || 'map build failed'}`);
if (absent.length) console.log('missing VAL modules: ' + absent.join(', '));
for (const f of failed) console.error('  FAIL ' + f);
const ok = !failed.length && !absent.length;
console.log(ok ? 'PASS: page scripts load in order and every module registers' : 'FAIL');
process.exit(ok ? 0 : 1);
