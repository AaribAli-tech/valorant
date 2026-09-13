// Map dressing: architectural detail + street-level props that make the traced floor plan read as Ascent.
window.VAL = window.VAL || {};
VAL.Dressing = (function () {
  const U = VAL.U; const TILE = 2;
  const FALL = { stone_block: 0xc2b8a6, stone_grey: 0x9d9a94, marble_white: 0xece8e0, wood_dark: 0x5a3d2a, wood_plank: 0xa67c52, metal_dark: 0x2b2e33, roof_tile: 0xb5563d, brick_red: 0xa8523e, plaster_cream: 0xe9dcc4, metal_painted_green: 0x2f7d73, canvas_striped: 0xd94b4b, fabric_red: 0x8f2a2e, concrete: 0x9b9892 };
  const cache = {};
  function mat(name, extra) {
    const key = name + JSON.stringify(extra || {}); if (cache[key]) return cache[key];
    let m = null; if (VAL.Textures && VAL.Textures.material) { try { m = VAL.Textures.material(name, extra || {}); } catch (e) { m = null; } }
    if (!m) m = new THREE.MeshStandardMaterial({ color: FALL[name] || 0xaaaaaa, roughness: 0.9 });
    cache[key] = m; return m;
  }
  function mergeGeomsRaw(list) {
    const ngs = list.map(g => g.index ? g.toNonIndexed() : g); let vc = 0; for (const g of ngs) vc += g.getAttribute('position').count;
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2); let o = 0;
    for (const ng of ngs) { const p = ng.getAttribute('position'), n = ng.getAttribute('normal'), u = ng.getAttribute('uv'); pos.set(p.array, o * 3); if (n) nor.set(n.array, o * 3); if (u) uv.set(u.array, o * 2); o += p.count; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
  }
  function mergeGeoms(list) {
    // VAL.Instancing.merge() produces the exact same merged geometry; when some
    // of the parts are tagged boxes it also remembers them, which lets the
    // batcher re-issue those as GPU instances and merge only the odd shapes.
    return VAL.Instancing ? VAL.Instancing.merge(list) : mergeGeomsRaw(list);
  }

  function bx(w, h, d, x, y, z, ry) { const g = new THREE.BoxGeometry(w, h, d); const uv = g.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / TILE, uv.getY(i) * h / TILE); const m = new THREE.Matrix4().makeRotationY(ry || 0); m.setPosition(x, y, z); g.applyMatrix4(m);
    return VAL.Instancing ? VAL.Instancing.tagBox(g, w, h, d, x, y, z, ry) : g; }
  function cyl(r0, r1, h, x, y, z, seg, rx, rz) { const g = new THREE.CylinderGeometry(r0, r1, h, seg || 10); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; }
  // seeded random so the map is identical every load
  let seed = 1234567; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const chance = p => rnd() < p;

  function textTex(txt, opts) {
    opts = opts || {}; const c = document.createElement('canvas'); c.width = 512; c.height = 128; const ctx = c.getContext('2d');
    ctx.fillStyle = opts.bg || '#2b2f36'; ctx.fillRect(0, 0, 512, 128); ctx.strokeStyle = opts.border || '#d8b26a'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = opts.fg || '#f1ece2'; ctx.font = (opts.font || 'bold 64px "Bebas Neue", Impact, sans-serif'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, 256, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function apply(map, scene) {
    const data = map.data; const group = new THREE.Group(); group.name = 'dressing'; scene.add(group);
    const P = VAL.Scenery && VAL.Scenery.props;
    const byMat = {}; const push = (name, geo) => (byMat[name] = byMat[name] || []).push(geo);
    const polys = [data.outline].concat(data.voids);
    const walls = map.walls;
    const isFloor = (x, z) => map.isFloor(x, z);
    const hAt = (x, z) => map.heightAt(x, z);
    // ---------- per-edge detail: cornice band, corner pilasters, wall base shadow strip, doors, balconies ----------
    polys.forEach((poly, pi) => {
      const n = poly.length; const isOut = pi === 0; const H = isOut ? 8.5 : [7, 8, 6, 7, 9, 8, 7, 8, 6][pi - 1];
      for (let i = 0; i < n; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
        const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.3) continue;
        const nx = (z1 - z0) / len, nz = -(x1 - x0) / len; const ang = Math.atan2(-(z1 - z0), x1 - x0);
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        // which side is the floor? sample both sides
        const fa = isFloor(mx + nx * 0.6, mz + nz * 0.6), fb = isFloor(mx - nx * 0.6, mz - nz * 0.6);
        const sides = []; if (fa) sides.push(1); if (fb) sides.push(-1);
        const hb = Math.min(fa ? hAt(mx + nx * 0.6, mz + nz * 0.6) : 99, fb ? hAt(mx - nx * 0.6, mz - nz * 0.6) : 99); const base = hb === 99 ? 0 : hb;
        // corner pilaster at each vertex
        push('stone_block', bx(0.55, H + 0.3, 0.55, x0, base + H / 2 - 0.2, z0, ang));
        for (const s of sides) {
          const ox = nx * s, oz = nz * s;
          // floor-level band (grounding shadow): thin dark strip on the floor along the wall
          const strip = new THREE.PlaneGeometry(len, 0.45); strip.rotateX(-Math.PI / 2); const sm = new THREE.Matrix4().makeRotationY(ang); sm.setPosition(mx + ox * 0.45, base + 0.012, mz + oz * 0.45); strip.applyMatrix4(sm); push('_shadow', strip);
          // mid cornice between floors
          if (len > 2.5) push('stone_grey', bx(len, 0.16, 0.22, mx + ox * 0.32, base + 3.35, mz + oz * 0.32, ang));
          if (len > 2.5 && H > 6.5) push('stone_grey', bx(len, 0.12, 0.18, mx + ox * 0.3, base + 6.1, mz + oz * 0.3, ang));
          // ground-floor doors on long walls (decorative)
          if (len > 7 && chance(0.6)) {
            const t = 0.25 + rnd() * 0.5; const dx = x0 + (x1 - x0) * t, dz = z0 + (z1 - z0) * t;
            push('wood_dark', bx(1.3, 2.5, 0.12, dx + ox * 0.2, base + 1.25, dz + oz * 0.2, ang));
            push('stone_block', bx(1.7, 0.2, 0.34, dx + ox * 0.25, base + 2.6, dz + oz * 0.25, ang));
            push('stone_block', bx(0.2, 2.5, 0.34, dx + ox * 0.25 + Math.cos(ang) * 0.75, base + 1.25, dz + oz * 0.25 - Math.sin(ang) * 0.75, ang));
            push('stone_block', bx(0.2, 2.5, 0.34, dx + ox * 0.25 - Math.cos(ang) * 0.75, base + 1.25, dz + oz * 0.25 + Math.sin(ang) * 0.75, ang));
            // step
            push('stone_grey', bx(1.7, 0.12, 0.5, dx + ox * 0.5, base + 0.06, dz + oz * 0.5, ang));
          }
          // balcony at a second-floor window
          if (len > 6 && chance(0.45)) {
            const t = 0.3 + rnd() * 0.4; const wx = x0 + (x1 - x0) * t, wz = z0 + (z1 - z0) * t;
            push('stone_block', bx(2.0, 0.14, 0.8, wx + ox * 0.6, base + 3.55, wz + oz * 0.6, ang));
            for (let k = 0; k <= 4; k++) { const off = -0.9 + k * 0.45; push('metal_dark', bx(0.05, 0.9, 0.05, wx + ox * 0.95 + Math.cos(ang) * off, base + 4.05, wz + oz * 0.95 - Math.sin(ang) * off, ang)); }
            push('metal_dark', bx(2.0, 0.05, 0.05, wx + ox * 0.95, base + 4.5, wz + oz * 0.95, ang));
            push('metal_dark', bx(0.05, 0.9, 0.05, wx + ox * 0.95, base + 4.05, wz + oz * 0.95, ang));
          }
          // awnings on some ground-floor walls
          if (len > 5 && chance(0.28)) {
            const t = 0.3 + rnd() * 0.4; const wx = x0 + (x1 - x0) * t, wz = z0 + (z1 - z0) * t; const w = 2.4 + rnd() * 1.2;
            const aw = new THREE.PlaneGeometry(w, 1.3); aw.rotateX(-Math.PI / 2 + 0.55); const am = new THREE.Matrix4().makeRotationY(ang); am.setPosition(wx + ox * 0.75, base + 2.85, wz + oz * 0.75); aw.applyMatrix4(am); push(chance(0.5) ? 'canvas_striped' : '_awning', aw);
            push('metal_dark', bx(w, 0.06, 0.06, wx + ox * 0.15, base + 3.15, wz + oz * 0.15, ang));
          }
          // wall lanterns
          if (len > 4 && chance(0.35)) {
            const t = 0.15 + rnd() * 0.7; const wx = x0 + (x1 - x0) * t, wz = z0 + (z1 - z0) * t;
            push('metal_dark', bx(0.08, 0.08, 0.5, wx + ox * 0.45, base + 3.0, wz + oz * 0.45, ang + Math.PI / 2));
            push('metal_dark', bx(0.26, 0.36, 0.26, wx + ox * 0.75, base + 2.8, wz + oz * 0.75, ang));
            push('_lamp', bx(0.2, 0.26, 0.2, wx + ox * 0.75, base + 2.8, wz + oz * 0.75, ang));
          }
          // (ivy removed - the sphere clusters read as floating blobs)
        }
      }
    });
    // ---------- arches / lintels over doorways: pairs of wall endpoints facing each other ----------
    const ends = [];
    for (const w of walls) { ends.push({ x: w.x0, z: w.z0, w }); ends.push({ x: w.x1, z: w.z1, w }); }
    const done = new Set();
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j]; if (a.w === b.w) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < 1.6 || d > 6.5) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2; if (!isFloor(mx, mz)) continue;
      // the gap must be open floor along its whole length and the walls roughly collinear across it
      let open = true; for (let t = 0.15; t <= 0.85; t += 0.175) if (!isFloor(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) { open = false; break; }
      if (!open) continue;
      const key = Math.round(mx * 2) + ':' + Math.round(mz * 2); if (done.has(key)) continue; done.add(key);
      const ang = Math.atan2(-(b.z - a.z), b.x - a.x); const base = hAt(mx, mz);
      const hLintel = 3.3 + rnd() * 0.5;
      push('stone_block', bx(d + 0.6, 0.45, 0.7, mx, base + hLintel + 0.22, mz, ang));
      // arch: half-torus above the lintel line for wider gaps, or a keystone for narrow
      if (d > 2.6) { const tor = new THREE.TorusGeometry(d / 2 + 0.1, 0.22, 8, 18, Math.PI); tor.rotateY(ang); tor.translate(mx, base + hLintel - 0.1, mz); push('stone_block', tor); }
      push('stone_block', bx(0.5, 0.55, 0.75, mx, base + hLintel + 0.5, mz, ang));
      // side pilasters
      push('stone_block', bx(0.4, hLintel, 0.6, a.x, base + hLintel / 2, a.z, ang)); push('stone_block', bx(0.4, hLintel, 0.6, b.x, base + hLintel / 2, b.z, ang));
      // banner or string lights across some doorways

      if (chance(0.5) && P && P.mechDoor === undefined) { }
    }
    // ---------- rooftop clutter on void buildings ----------
    data.voids.forEach((poly, i) => {
      const H = [7, 8, 6, 7, 9, 8, 7, 8, 6][i]; let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
      let hb = 0; for (const p of poly) hb += hAt(p[0], p[1]); hb /= poly.length;
      const tries = 6; for (let k = 0; k < tries; k++) {
        const p = poly[Math.floor(rnd() * poly.length)]; const x = cx + (p[0] - cx) * (0.3 + rnd() * 0.5), z = cz + (p[1] - cz) * (0.3 + rnd() * 0.5);
        if (!U.pointInPoly(x, z, poly)) continue;
        const r = rnd();
        if (r < 0.55) push('brick_red', bx(0.7, 1.4 + rnd(), 0.7, x, hb + H + 0.6, z));
        else if (r < 0.55) { push('metal_dark', cyl(0.5, 0.5, 1.2, x, hb + H + 1.1, z, 12)); push('metal_dark', bx(0.08, 1.2, 0.08, x + 0.4, hb + H + 0.5, z)); push('metal_dark', bx(0.08, 1.2, 0.08, x - 0.4, hb + H + 0.5, z)); }
        else if (r < 0.55) { push('metal_dark', bx(0.06, 2.6, 0.06, x, hb + H + 1.3, z)); push('metal_dark', bx(0.9, 0.05, 0.05, x, hb + H + 2.4, z)); push('metal_dark', bx(0.6, 0.05, 0.05, x, hb + H + 2.0, z)); }
        else if (r < 0.55) push('wood_plank', bx(1.2, 0.5, 0.9, x, hb + H + 0.25, z, rnd() * 3));
      }
    });
    // ---------- shop signs near landmarks ----------
    const SIGNS = { GALATO: 'GELATERIA', BENCH: 'OSTERIA', BOOKS: 'LIBRERIA', SHOP: 'MERCATO', BOILER: 'CALDAIA', SWITCH: 'DOGANA', COURTYARD: 'CORTILE', BALCONY: 'ALBERGO', BOATHOUSE: 'CANTIERE', WELL: 'TRATTORIA', LOIN: 'PASTICCERIA', DOG: 'CANILE', ANCHOR: 'PORTO', FOUNTAINE: 'CAFFE', GARDEN: 'GIARDINO', SCAFFOLODING: 'CANTIERE', TREE: 'FIORAIO' };
    for (const lm of data.landmarks || []) {
      const txt = SIGNS[lm.t]; if (!txt) continue;
      let best = null, bd = 1e9; for (const w of walls) { const dx = w.x1 - w.x0, dz = w.z1 - w.z0; let t = ((lm.x - w.x0) * dx + (lm.z - w.z0) * dz) / (w.len * w.len); t = U.clamp(t, 0.2, 0.8); const px = w.x0 + dx * t, pz = w.z0 + dz * t; const d = Math.hypot(px - lm.x, pz - lm.z); if (d < bd && w.len > 3) { bd = d; best = { w, px, pz }; } }
      if (!best) continue;
      const w = best.w; const side = ((lm.x - best.px) * w.nx + (lm.z - best.pz) * w.nz) > 0 ? 1 : -1;
      const sx = best.px + w.nx * side * 0.3, sz = best.pz + w.nz * side * 0.3; const base = hAt(best.px + w.nx * side * 0.6, best.pz + w.nz * side * 0.6);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: textTex(txt), roughness: 0.7 }));
      sign.position.set(sx, base + 3.9, sz); sign.rotation.y = Math.atan2(w.nx * side, w.nz * side); group.add(sign);
      push('wood_dark', bx(3.4, 0.9, 0.08, best.px + w.nx * side * 0.25, base + 3.9, best.pz + w.nz * side * 0.25, Math.atan2(-(w.z1 - w.z0), w.x1 - w.x0)));
    }
    // ---------- street props by area ----------
    const co = {}; for (const c of data.callouts) co[c.sup + ' ' + c.name] = c;
    const placeProp = (obj, x, z, ry, coll) => { if (!obj) return; if (!isFloor(x, z)) return; const h = hAt(x, z); obj.position.set(x, h, z); obj.rotation.y = ry || 0; obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); group.add(obj); if (coll) map.addCrateBox(x - coll, z - coll, x + coll, z + coll, h, h + 1.3); };
    // find a spot near a wall inside an area (so props don't block the middle of lanes)
    const nearWallSpot = (name, tries) => {
      for (let k = 0; k < (tries || 12); k++) {
        const p = VAL.Nav.randomPointInArea(name); if (!p) return null;
        for (const w of walls) { if (Math.abs(p.x - (w.x0 + w.x1) / 2) > w.len / 2 + 2 || Math.abs(p.z - (w.z0 + w.z1) / 2) > w.len / 2 + 2) continue; const dx = w.x1 - w.x0, dz = w.z1 - w.z0; let t = ((p.x - w.x0) * dx + (p.z - w.z0) * dz) / (w.len * w.len); t = U.clamp(t, 0.1, 0.9); const px = w.x0 + dx * t, pz = w.z0 + dz * t; const d = Math.hypot(p.x - px, p.z - pz); if (d < 2.2 && d > 0.9) { const side = ((p.x - px) * w.nx + (p.z - pz) * w.nz) > 0 ? 1 : -1; const sx = px + w.nx * side * 0.78, sz = pz + w.nz * side * 0.78; if (isFloor(sx, sz) && VAL.Nav.walkable(sx, sz)) return { x: sx, z: sz, ry: Math.atan2(-(w.z1 - w.z0), w.x1 - w.x0) }; } }
      }
      return null;
    };
    if (P) {
      const crateAreas = [['Attacker Side Spawn', 3], ['A Lobby', 3], ['A Main', 2], ['B Lobby', 3], ['B Main', 2], ['Mid Top', 2], ['Mid Courtyard', 2], ['A Site', 2], ['B Site', 2], ['Mid Market', 1], ['Defender Side Spawn', 2], ['A Garden', 1], ['Mid Bottom', 1], ['Mid Link', 1]];
      for (const [area, n] of crateAreas) for (let k = 0; k < n; k++) { const s = nearWallSpot(area); if (!s) continue; const r = rnd(); const kind = r < 0.45 ? 'green' : r < 0.8 ? 'wood' : 'metal'; const w = 1.1 + rnd() * 0.6; try { placeProp(P.crate(w, w * 0.9, w, kind), s.x, s.z, s.ry, w / 2); if (chance(0.4)) { const c2 = P.crate(w * 0.8, w * 0.7, w * 0.8, kind === 'green' ? 'metal' : 'green'); c2.position.set(0, w * 0.9, 0); group.children[group.children.length - 1].add(c2); } } catch (e) { } }
      const barrelAreas = ['A Wine', 'A Wine', 'B Boat House', 'B Lobby', 'A Lobby', 'Mid Pizza'];
      for (const area of barrelAreas) { const s = nearWallSpot(area); if (s) try { placeProp(P.barrel(), s.x, s.z, 0, 0.32); } catch (e) { } }
      const benchAreas = ['Attacker Side Spawn', 'Defender Side Spawn', 'A Garden', 'Mid Courtyard'];
      for (const area of benchAreas) { const s = nearWallSpot(area); if (s) try { placeProp(P.bench(), s.x, s.z, s.ry, 0.5); } catch (e) { } }
      const planterAreas = ['Attacker Side Spawn', 'Defender Side Spawn', 'A Garden', 'A Tree', 'Mid Market', 'A Lobby', 'B Lobby'];
      for (const area of planterAreas) { const s = nearWallSpot(area); if (s) try { placeProp(P.planter(1.3), s.x, s.z, s.ry, 0.55); } catch (e) { } }
      // ---------- greenery: cypresses, olive trees and hedging tucked against walls ----------
      const cypressAreas = [['A Garden', 2], ['A Tree', 1], ['Mid Courtyard', 1], ['Attacker Side Spawn', 1], ['Defender Side Spawn', 1]];
      for (const [area, n] of cypressAreas) for (let k = 0; k < n; k++) {
        const s = nearWallSpot(area); if (!s) continue;
        try { placeProp(P.cypress(4.5 + rnd() * 2.4), s.x, s.z, rnd() * 6.28, 0.34); } catch (e) { }
      }
      const treeAreas = ['A Tree', 'A Garden', 'Mid Courtyard', 'Defender Side Spawn'];
      for (const area of treeAreas) { const s = nearWallSpot(area); if (s) try { placeProp(P.tree('olive', 0.9 + rnd() * 0.3), s.x, s.z, rnd() * 6.28, 0.4); } catch (e) { } }
      const bushAreas = [['A Garden', 2], ['Mid Courtyard', 1], ['Attacker Side Spawn', 1], ['Defender Side Spawn', 1], ['A Tree', 1]];
      for (const [area, n] of bushAreas) for (let k = 0; k < n; k++) {
        const s = nearWallSpot(area); if (!s) continue;
        try { placeProp(P.bush(), s.x, s.z, rnd() * 6.28, 0.42); } catch (e) { }
      }
      const lampAreas = ['Attacker Side Spawn', 'Attacker Side Spawn', 'Defender Side Spawn', 'Mid Courtyard', 'A Lobby', 'B Lobby', 'A Site', 'B Site'];
      for (const area of lampAreas) { const s = nearWallSpot(area); if (s) try { placeProp(P.lamp(4.2), s.x, s.z, 0, 0.18); } catch (e) { } }
      const cyAreas = ['A Garden', 'Defender Side Spawn', 'Attacker Side Spawn'];
      for (const area of cyAreas) { const s = nearWallSpot(area); if (s) try { placeProp(P.cypress(5 + rnd() * 2), s.x, s.z, 0, 0.35); } catch (e) { } }
      // scaffolding on Rafters + wooden railing look
      const raf = co['A Rafters']; if (raf && P.scaffold) try { const s = nearWallSpot('A Rafters'); if (s) placeProp(P.scaffold(2.6, 3.4, 1.0), s.x, s.z, s.ry, 0); } catch (e) { }
      // sandbags / logs at B
      if (P.sandbags) { const s = nearWallSpot('B Site'); if (s) try { placeProp(P.sandbags(), s.x, s.z, s.ry, 0.7); } catch (e) { } }
      // stacked logs (B Logs) near B Main entrance
      const bm = co['B Main']; if (bm) { const s = nearWallSpot('B Main'); if (s) { const g = new THREE.Group(); for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), mat('wood_dark')); lg.rotation.z = Math.PI / 2; lg.position.set(0, 0.16 + r * 0.28, (k - (3 - r) / 2) * 0.34); g.add(lg); } placeProp(g, s.x, s.z, s.ry, 0.7); } }
      // market stall + gelato + pizza oven are placed by ascent.js; add a fruit stand in Mid Market and wine racks in Wine
      if (P.marketStall) { const s = nearWallSpot('Mid Market'); if (s) try { placeProp(P.marketStall(), s.x, s.z, s.ry, 0.9); } catch (e) { } }
      if (P.wineRack) { const s = nearWallSpot('A Wine'); if (s) try { placeProp(P.wineRack(), s.x, s.z, s.ry, 0.6); } catch (e) { } }
      // boat in the boathouse
      const bh = co['B Boat House']; if (bh) { const g = new THREE.Group(); const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 4.2, 10, 1, false), mat('wood_plank')); hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.55); hull.position.y = 0.45; g.add(hull); const rim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.08, 6, 18), mat('wood_dark')); rim.rotation.x = Math.PI / 2; rim.scale.set(1.6, 1, 0.55); rim.position.y = 0.9; g.add(rim); const tarp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 1.1), new THREE.MeshStandardMaterial({ color: 0x2e5f9e, roughness: 0.9 })); tarp.position.set(0.3, 0.95, 0); g.add(tarp); const s = nearWallSpot('B Boat House'); if (s) placeProp(g, s.x, s.z, s.ry + Math.PI / 2, 1.2); }
    }
    // ---------- string lights across a few corridors: between parallel walls facing each other ----------
    let lines = 0;
    for (let i = 0; i < walls.length && lines < 6; i++) {
      const w = walls[i]; if (w.len < 4) continue; if (!chance(0.25)) continue;
      const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2; const side = isFloor(mx + w.nx * 0.6, mz + w.nz * 0.6) ? 1 : (isFloor(mx - w.nx * 0.6, mz - w.nz * 0.6) ? -1 : 0); if (!side) continue;
      const hit = map.raycast(mx, hAt(mx + w.nx * side, mz + w.nz * side) + 4.2, mz, w.nx * side, 0, w.nz * side, 12, { ground: false }); if (!hit || hit.kind !== 'wall' || hit.dist < 3) continue;
      const ex = hit.x, ez = hit.z; const y = hit.y; const ang = Math.atan2(-(ez - mz), ex - mx); const d = hit.dist;
      push('_rope', cyl(0.012, 0.012, d, (mx + ex) / 2, y - 0.25, (mz + ez) / 2, 6, 0, Math.PI / 2 + 0 * ang));
      // orient the rope: cyl is along X after rotateZ(90deg); rotate by ang around Y
      const last = byMat._rope[byMat._rope.length - 1]; last.translate(-(mx + ex) / 2, -(y - 0.25), -(mz + ez) / 2); last.rotateY(ang); last.translate((mx + ex) / 2, y - 0.25, (mz + ez) / 2);
      for (let k = 1; k < Math.floor(d / 1.1); k++) { const t = k / Math.floor(d / 1.1); const lx = mx + (ex - mx) * t, lz = mz + (ez - mz) * t; push('_bulb', new THREE.SphereGeometry(0.09, 6, 5).translate(lx, y - 0.32 - Math.sin(t * Math.PI) * 0.35, lz)); }
      lines++;
    }
    // ---------- laundry lines: cloth hung between walls that face each other ----------
    let washing = 0;
    for (let i = 0; i < walls.length && washing < 5; i++) {
      const w = walls[i]; if (w.len < 5) continue; if (!chance(0.22)) continue;
      const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2;
      const side = isFloor(mx + w.nx * 0.6, mz + w.nz * 0.6) ? 1 : (isFloor(mx - w.nx * 0.6, mz - w.nz * 0.6) ? -1 : 0);
      if (!side) continue;
      const y0 = hAt(mx + w.nx * side, mz + w.nz * side) + 5.2;
      const hit = map.raycast(mx, y0, mz, w.nx * side, 0, w.nz * side, 14, { ground: false });
      if (!hit || hit.kind !== 'wall' || hit.dist < 3.5 || hit.dist > 13) continue;
      const ex = hit.x, ez = hit.z, d = hit.dist, ang = Math.atan2(-(ez - mz), ex - mx);
      const rope = cyl(0.014, 0.014, d, 0, 0, 0, 6, 0, Math.PI / 2);
      rope.rotateY(ang); rope.translate((mx + ex) / 2, y0 - 0.1, (mz + ez) / 2); push('_rope', rope);
      const n = Math.max(3, Math.floor(d / 1.3));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n; const lx = mx + (ex - mx) * t, lz = mz + (ez - mz) * t;
        const sag = Math.sin(t * Math.PI) * 0.28;
        const hgt = 0.65 + rnd() * 0.55, wid = 0.45 + rnd() * 0.3;
        const cloth = new THREE.PlaneGeometry(wid, hgt);
        const mm = new THREE.Matrix4().makeRotationY(ang); mm.setPosition(lx, y0 - 0.16 - sag - hgt / 2, lz);
        cloth.applyMatrix4(mm);
        push(['_clothA', '_clothB', '_clothC'][k % 3], cloth);
      }
      washing++;
    }
    // ---------- ground detail: drains, worn patches and gutter channels ----------
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]; if (w.len < 3) continue; if (!chance(0.18)) continue;
      const t = 0.2 + rnd() * 0.6;
      const gx = w.x0 + (w.x1 - w.x0) * t, gz = w.z0 + (w.z1 - w.z0) * t;
      const side = isFloor(gx + w.nx * 1.0, gz + w.nz * 1.0) ? 1 : -1;
      const px = gx + w.nx * side * 0.95, pz = gz + w.nz * side * 0.95;
      if (!isFloor(px, pz)) continue;
      const base = hAt(px, pz); const ang = Math.atan2(-(w.z1 - w.z0), w.x1 - w.x0);
      if (chance(0.45)) {           // grated drain
        push('metal_dark', bx(0.62, 0.03, 0.42, px, base + 0.015, pz, ang));
        for (let b = 0; b < 4; b++) { const off = (b - 1.5) * 0.1; push('_shadow', bx(0.56, 0.02, 0.04, px - Math.sin(ang) * off, base + 0.035, pz - Math.cos(ang) * off, ang)); }
      } else {                      // shallow stone gutter channel
        push('stone_grey', bx(Math.min(w.len * 0.7, 5), 0.04, 0.34, gx + w.nx * side * 0.7, base + 0.02, gz + w.nz * side * 0.7, ang));
      }
    }
    // ---------- merge & add ----------
    const special = {
      _shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
      _lamp: new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffb860, emissiveIntensity: 1.2 }),
      _ivy: new THREE.MeshStandardMaterial({ color: 0x4f7d34, roughness: 1 }),
      _awning: new THREE.MeshStandardMaterial({ color: 0x2f6f5e, roughness: 0.9, side: THREE.DoubleSide }),
      _rope: new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 1 }),
      _flagRed: new THREE.MeshStandardMaterial({ color: 0xc23a45, roughness: 0.9, side: THREE.DoubleSide }),
      _flagTeal: new THREE.MeshStandardMaterial({ color: 0x2fa89b, roughness: 0.9, side: THREE.DoubleSide }),
      _bulb: new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd27a, emissiveIntensity: 1.6 }),
      _clothA: new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.95, side: THREE.DoubleSide }),
      _clothB: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.95, side: THREE.DoubleSide }),
      _clothC: new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.95, side: THREE.DoubleSide })
    };
    for (const name in byMat) {
      const m = special[name] || (name === 'canvas_striped' ? (() => { const mm = mat('canvas_striped'); mm.side = THREE.DoubleSide; return mm; })() : mat(name));
      const mesh = new THREE.Mesh(mergeGeoms(byMat[name]), m); mesh.castShadow = !name.startsWith('_') || name === '_ivy'; mesh.receiveShadow = true; mesh.name = 'dress_' + name; group.add(mesh);
    }
    return group;
  }
  return { apply };
})();
