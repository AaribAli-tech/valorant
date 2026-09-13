/* VAL.Stats - what the renderer is actually doing, in the corner of the screen.
 *
 *   F3          toggle
 *   ?stats=1    start with it on
 *
 * The numbers come from renderer.info after the frame is submitted, so they are
 * the real per-frame cost: draw calls (colour pass + shadow pass), triangles,
 * compiled programs, buffers. It exists mainly so `?noinstance=1` is an A/B you
 * can watch instead of one you take on faith - the whole point of batching the
 * map is that these numbers go down while the picture does not.
 *
 * Debug only. It is deliberately not part of the HUD: it lives outside #ui so it
 * is not scaled with the 1080-unit design, and it is never laid out during
 * gameplay (fixed size, text swapped at 4 Hz).
 */
VAL.Stats = (function () {
  'use strict';

  let el = null, renderer = null, scene = null, lines = {};
  let on = /[?&]stats=1/.test(location.search);
  let frames = 0, acc = 0, fps = 0, ms = 0, lastSwap = 0;
  const extra = {};

  const STYLE = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483000',
    'font:500 12px/1.5 ui-monospace,Menlo,Consolas,monospace', 'letter-spacing:.02em',
    'color:#dfe7ef', 'background:rgba(10,16,22,.72)', 'padding:8px 11px',
    'border:1px solid rgba(255,255,255,.10)', 'border-radius:3px',
    'white-space:pre', 'pointer-events:none', 'backdrop-filter:blur(3px)',
    'font-variant-numeric:tabular-nums',
  ].join(';');

  function ensure() {
    if (el || !document.body) return el;
    el = document.createElement('div');
    el.id = 'perf';
    el.style.cssText = STYLE;
    for (const k of ['fps', 'calls', 'tris', 'geo', 'inst', 'note']) {
      lines[k] = document.createElement('div');
      if (k === 'fps') lines[k].style.color = '#8ce0a8';
      if (k === 'note') lines[k].style.opacity = '.65';
      el.appendChild(lines[k]);
    }
    document.body.appendChild(el);
    return el;
  }

  const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const fmtK = (n) => (n == null ? '-' : (n / 1000).toFixed(2) + ' M');

  function draw() {
    const info = renderer && renderer.info;
    if (!info) return;
    const r = info.render, m = info.memory;
    lines.fps.textContent = `${fps.toFixed(0)} fps   ${ms.toFixed(2)} ms`;
    lines.calls.textContent = `draws ${fmt(r.calls)}   lines ${fmt(r.lines)}   points ${fmt(r.points)}`;
    lines.tris.textContent = `tris ${fmt(r.triangles)}   programs ${info.programs ? info.programs.length : '-'}`;
    // scene vertex total, counted once at boot - three has no idea what a batch costs
    lines.geo.textContent = `buffers ${fmt(m.geometries)}   textures ${fmt(m.textures)}   scene verts ${fmtK(extra.verts)}`;
    lines.inst.textContent = extra.batches == null
      ? 'instancing  off (?noinstance=1)'
      : `instancing  ${fmt(extra.batches)} batches / ${fmt(extra.instances)} instances`;
    lines.note.textContent = extra.note || 'F3 toggles this panel';
  }

  const api = {
    get on() { return on; },

    attach(rend, scn) {
      renderer = rend; scene = scn || null;
      lastSwap = performance.now();
    if (!window.addEventListener) return;
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'F3') return;
        e.preventDefault();
        api.setEnabled(!on);
      }, true);
      api.setEnabled(on);
    },

    setEnabled(v) {
      on = !!v;
      if (on) {
        ensure();
        // F3 can be pressed long after boot, and counting the scene is only worth
        // doing for someone who is actually looking at the number
        if (extra.verts == null && scene) api.measureScene(scene);
      }
      if (el) el.style.display = on ? 'block' : 'none';
      if (on) draw();
    },

    /** Called from the render loop, once per frame, after the frame is submitted. */
    frame(dt) {
      if (!on) return;
      frames++; acc += dt;
      if (acc >= 0.25) {
        const now = performance.now();
        fps = frames / acc;
        ms = (now - lastSwap) / Math.max(1, frames);
        frames = 0; acc = 0; lastSwap = now;
        draw();   // renderer.info was filled by the frame that just went out
      } else if (!lastSwap) lastSwap = performance.now();
    },

    /** Anything the boot code knows that the renderer does not. */
    setInfo(obj) { Object.assign(extra, obj); if (on) draw(); },

    note(text) { extra.note = text; },
  };

  /**
   * Vertices the scene holds. three does not track this and counting it per frame
   * would cost more than it measures, so the boot code calls it once.
   */
  api.measureScene = function (scene) {
    let verts = 0, meshes = 0;
    if (scene) scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.getAttribute('position')) return;
      const g = o.geometry;
      meshes++;
      verts += g.getAttribute('position').count * (g.isInstancedBufferGeometry ? (g.instanceCount || 1) : 1);
    });
    extra.verts = verts;
    extra.meshes = meshes;
    if (on) draw();
    return { verts, meshes };
  };

  return api;
})();
