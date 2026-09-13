/* VAL.ShadowFollow - keep the sun's shadow volume around the camera instead of
 * around the whole map.
 *
 * Opt-in only (main.js wires it up when the URL says ?shadowfit=35). Ascent is 120 m
 * across and its shadow camera is a static ±95 m box, so every caster in the level is
 * re-rendered into the map every frame even though a player can only see a fraction of
 * it. Measured over eight vantage points:
 *
 *     volume            shadow draws/frame   shadow tris/frame
 *     ±95 m (today)     310                  355,958
 *     ±45 m, following  232                  306,894   (-14 %)
 *     ±35 m, following  193                  265,802   (-25 %)
 *
 * That is a smaller win than the box size suggests, because the near field is where
 * the dense geometry lives - which is also why it is not the default: past the edge of
 * the volume, shadows simply stop, and on a map with 60 m sightlines that is visible.
 *
 * The centre is snapped to the shadow map's own texel grid. Without that, moving the
 * volume by a fraction of a texel per frame slides the depth map under fixed pixels and
 * every edge crawls, which looks far worse than the pop this trades it for.
 */
VAL.ShadowFollow = (function () {
  'use strict';

  const THREE = window.THREE;

  /**
   * @param {THREE.DirectionalLight} sun   the light whose map we are trimming
   * @param {THREE.Camera} camera          what the volume should follow
   * @param {{fit:number, lead?:number}} o fit = half-width in metres, lead = how far
   *                 ahead of the camera to sit, as a fraction of the volume
   */
  function create(sun, camera, o) {
    o = o || {};
    const want = Number(o.fit) || 0;
    // 0 (or absent) means "do not bother me"; a positive but silly small fit is
    // clamped, because a volume that thin clips through the player's own shadow
    if (want <= 0 || !sun || !sun.shadow || !camera) return null;
    const fit = Math.max(8, want);

    const shadow = sun.shadow;
    const cam = shadow.camera;
    const authored = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom };
    // Only the box is resized: near/far stay as authored, so the depth range - and
    // with it shadow acne and peter-panning - is bit-for-bit what it is today.
    cam.left = -fit; cam.right = fit; cam.top = fit; cam.bottom = -fit;
    cam.updateProjectionMatrix();
    // the light sits this far from its target; reusing that exact vector means the
    // shadow direction never changes, only where the box sits
    const offset = sun.position.clone().sub(sun.target.position);

    const fwd = new THREE.Vector3();
    const lead = o.lead == null ? 0.45 : Number(o.lead);
    const texel = (fit * 2) / (shadow.mapSize.x || 2048);
    let last = null, moved = 0;

    const api = {
      fit: fit,
      texel: texel,

      /** Snap a world position onto the texel grid so the map stops sliding. */
      snap(x, z) {
        return { x: Math.round(x / texel) * texel, z: Math.round(z / texel) * texel };
      },

      /** Where the volume wants to be this frame (no side effects; used by tests). */
      desired(px, pz) {
        return api.snap(px + fwd.x * fit * lead, pz + fwd.z * fit * lead);
      },

      /**
       * Move the volume if it has drifted by a whole texel. Returns true when it
       * moved; callers can skip work otherwise, and the test asserts that a
       * sub-texel camera nudge leaves the light exactly where it was.
       */
      update() {
        camera.getWorldDirection(fwd);
        const c = api.desired(camera.position.x, camera.position.z);
        if (last && Math.abs(last.x - c.x) < 1e-9 && Math.abs(last.z - c.z) < 1e-9) return false;
        last = c;
        moved++;
        sun.target.position.set(c.x, 0, c.z);
        sun.position.set(c.x + offset.x, offset.y, c.z + offset.z);
        sun.target.updateMatrixWorld();
        return true;
      },

      restore() {
        Object.assign(cam, authored);
        cam.updateProjectionMatrix();
        last = null;
      },

      get moves() { return moved; },
    };

    return api;
  }

  return { create: create };
})();
