#!/usr/bin/env node
/**
 * Tests for VAL.ShadowFollow (src/js/core/shadowfollow.js) - the opt-in
 * ?shadowfit= volume that follows the camera.
 *
 * The part worth testing is not the trigonometry, it is the *snapping*: the whole
 * reason the volume may move at all is that it moves on the shadow map's own texel
 * grid, so a camera nudge smaller than a texel must leave the light exactly where it
 * was (that is what stops PCF edges from crawling), and a real move must keep the
 * light's direction unchanged - otherwise the sun would appear to swing with the
 * player.
 *
 *   node tools/test-shadowfollow.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

require(path.join(__dirname, 'lib', 'node-dom.js')).install(globalThis);
const SRC = path.join(__dirname, '..', 'src');
globalThis.THREE = require(path.join(SRC, 'js', 'lib', 'three.min.js'));
globalThis.VAL = globalThis.VAL || {};
vm.runInThisContext(fs.readFileSync(path.join(SRC, 'js', 'core', 'shadowfollow.js'), 'utf8'), { filename: 'js/core/shadowfollow.js' });

const THREE = globalThis.THREE;
const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

function makeSetup(fit) {
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-70, 110, 70);
  sun.target.position.set(14, 0, -45);
  sun.shadow.mapSize.set(3072, 3072);
  const cam = sun.shadow.camera;
  cam.left = -95; cam.right = 95; cam.top = 95; cam.bottom = -95; cam.near = 10; cam.far = 400;
  const camera = new THREE.PerspectiveCamera(71, 1.7, 0.05, 700);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -30);
  camera.updateMatrixWorld(true);
  const api = VAL.ShadowFollow.create(sun, camera, { fit: fit || 35 });
  return { sun, camera, shadowCam: cam, api };
}

/* --- 1. it resizes the volume and keeps a sane depth range --- */
{
  const { sun, shadowCam, api } = makeSetup(35);
  check('bounds follow fit', shadowCam.left === -35 && shadowCam.right === 35 && shadowCam.top === 35 && shadowCam.bottom === -35);
  check('depth range is left alone', shadowCam.near === 10 && shadowCam.far === 400,
    `near ${shadowCam.near}, far ${shadowCam.far}`);
  check('texel = 2*fit/mapSize', Math.abs(api.texel - 70 / 3072) < 1e-9, api.texel.toFixed(5));
}

/* --- 2. the centre sits on the texel grid --- */
{
  const { api } = makeSetup(35);
  for (const [x, z] of [[10.0, 20.0], [0.001, -3.7], [-77.4, 12.9]]) {
    const s = api.snap(x, z);
    const onGrid = (v) => Math.abs(v / api.texel - Math.round(v / api.texel)) < 1e-6;
    check(`snap(${x}, ${z}) on grid`, onGrid(s.x) && onGrid(s.z), `${s.x.toFixed(4)}, ${s.z.toFixed(4)}`);
    check(`snap(${x}, ${z}) stays within a texel`, Math.abs(s.x - x) <= api.texel && Math.abs(s.z - z) <= api.texel);
  }
}

/* --- 3. a sub-texel camera nudge must not move the light --- */
{
  const { sun, camera, api } = makeSetup(35);
  check('first update moves', api.update() === true);
  const p0 = sun.position.clone(), t0 = sun.target.position.clone(), moves0 = api.moves;
  // nudge by a tenth of a texel, staying well inside the same cell
  camera.position.x += api.texel / 10;
  camera.position.z -= api.texel / 10;
  camera.updateMatrixWorld(true);
  const moved = api.update();
  check('sub-texel nudge is ignored', moved === false && api.moves === moves0, `returned ${moved}, moves ${api.moves}`);
  check('light untouched after a nudge', sun.position.distanceTo(p0) < 1e-9 && sun.target.position.distanceTo(t0) < 1e-9);

  // ...and a real move does move it
  camera.position.x += 4;
  camera.updateMatrixWorld(true);
  check('a 4 m move is applied', api.update() === true && api.moves === moves0 + 1);
}

/* --- 4. the sun must never swing: only the centre of the volume changes --- */
{
  const { sun, camera, api } = makeSetup(35);
  const authored = sun.position.clone().sub(sun.target.position);
  const dir0 = authored.clone().normalize();
  for (const [x, z] of [[12, -40], [-55, 8], [30, 30], [0, 0]]) {
    camera.position.set(x, 1.6, z);
    camera.rotation.y = (x * 0.7 + z * 0.3) % 6.283;
    camera.updateMatrixWorld(true);
    api.update();
    const now = sun.position.clone().sub(sun.target.position);
    check(`direction preserved at ${x},${z}`,
      Math.abs(now.distanceTo(authored)) < 1e-6 && now.clone().normalize().dot(dir0) > 0.999999,
      `drift ${now.distanceTo(authored).toExponential(2)}`);
  }
}

/* --- 5. restore() gives the authored volume back --- */
{
  const { sun, shadowCam, api } = makeSetup(35);
  api.update();
  api.restore();
  check('restore puts the original box back', shadowCam.left === -95 && shadowCam.right === 95 && shadowCam.bottom === -95);
  check('restore re-arms the mover', api.update() === true);
}

/* --- 6. it refuses to do anything silly --- */
{
  const sun = new THREE.DirectionalLight();
  const camera = new THREE.PerspectiveCamera();
  check('fit 0 is a no-op', VAL.ShadowFollow.create(sun, camera, { fit: 0 }) === null);
  check('missing pieces are tolerated', VAL.ShadowFollow.create(null, null, { fit: 40 }) === null);
  const tiny = VAL.ShadowFollow.create(sun, camera, { fit: 1 });
  check('a tiny fit is clamped to 8 m', tiny && tiny.fit === 8, tiny && tiny.fit);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '   (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} ShadowFollow checks passed`);
process.exit(failed ? 1 : 0);
