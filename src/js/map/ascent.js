// Ascent map builder: geometry from VAL.MapData + collision / raycast / height queries.
window.VAL = window.VAL || {};
VAL.AscentMap = (function () {
  const U = VAL.U;
  const D = () => VAL.MapData;
  const TILE = 2; // texture tile metres (matches VAL.Textures.TILE_METERS)

  function mat(name, color, opts) {
    if (VAL.Textures && VAL.Textures.material) { try { return VAL.Textures.material(name, opts || {}); } catch (e) { console.warn('texture fail', name, e); } }
    return new THREE.MeshStandardMaterial({ color: color || 0xcccccc, roughness: 0.9 });
  }
  const FALLBACK = { plaster_cream: 0xe9dcc4, plaster_white: 0xf1ece2, plaster_terracotta: 0xd9927a, plaster_ochre: 0xd8b26a, plaster_rose: 0xc98a86, sand: 0xc9ad84, stone_block: 0xc2b8a6, stone_grey: 0x9d9a94, brick_red: 0xa8523e, cobble: 0xa79f92, paver_sand: 0xd3c3a3, paver_dark: 0x4d4f55, roof_tile: 0xb5563d, wood_plank: 0xa67c52, wood_dark: 0x5a3d2a, metal_dark: 0x2b2e33, metal_painted_green: 0x2f7d73, concrete: 0x9b9892, grass: 0x5f8a3a, marble_white: 0xece8e0 };
  const matCache = {};
  function M(name) { if (!matCache[name]) matCache[name] = mat(name, FALLBACK[name]); return matCache[name]; }

  // ---------- geometry helpers ----------
  // mergeGeoms delegates to VAL.Instancing.merge: identical merged output, but
  // the geometry also keeps the box list so the batcher can re-issue it as GPU
  // instances instead of one 36-vertex-per-box slab.
  function mergeGeomsRaw(list) {
    const ngs = list.map(g => g.index ? g.toNonIndexed() : g);
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
  // vertical quad from (x0,z0)->(x1,z1) between y0..y1, facing +normal side (double sided material anyway)
  function wallQuad(x0, z0, x1, z1, y0, y1, uOff) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.BufferGeometry();
    const nx = (z1 - z0) / len, nz = -(x1 - x0) / len;
    const v = new Float32Array([x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0]);
    const n = new Float32Array([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz]);
    const u0 = (uOff || 0) / TILE, u1 = u0 + len / TILE, v0 = y0 / TILE, v1 = y1 / TILE;
    const uv = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  function mergeGeoms(list) {
    // VAL.Instancing.merge() produces the exact same merged geometry; when some
    // of the parts are tagged boxes it also remembers them, which lets the
    // batcher re-issue those as GPU instances and merge only the odd shapes.
    return VAL.Instancing ? VAL.Instancing.merge(list) : mergeGeomsRaw(list);
  }

  function boxAt(w, h, d, x, y, z, rotY) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv'); // scale uvs to metres
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, uv.getX(i) * Math.max(w, d) / TILE, uv.getY(i) * h / TILE); }
    const m = new THREE.Matrix4().makeRotationY(rotY || 0); m.setPosition(x, y, z); g.applyMatrix4(m);
    return VAL.Instancing ? VAL.Instancing.tagBox(g, w, h, d, x, y, z, rotY) : g;
  }

  // half-annulus standing in a wall plane: the top of an arched opening
  function archAt(rOuter, rInner, depth, x, y, z, rotY, noShell) {
    const g = new THREE.RingGeometry(rInner, rOuter, 14, 1, 0, Math.PI);
    const ext = new THREE.CylinderGeometry(rOuter, rOuter, depth, 16, 1, true, 0, Math.PI);
    ext.rotateX(Math.PI / 2);
    const shell = ext;
    const front = g.clone(); front.translate(0, 0, depth / 2);
    const back = g.clone(); back.translate(0, 0, -depth / 2);
    const parts = noShell ? [front, back] : [shell, front, back];
    const out = [];
    // The same handful of arch shapes gets rebuilt thousands of times (one per
    // window, per side, per floor). Tag each part with a key that identifies the
    // shape exactly - radii, depth, shell or not, and which of the pieces - so
    // the batcher can instance the shape instead of merging a fresh copy per window.
    const shapeKey = VAL.Instancing
      ? 'arch:' + rOuter.toFixed(3) + ':' + rInner.toFixed(3) + ':' + depth.toFixed(3) + ':' + (noShell ? 1 : 0)
      : null;
    let pi = 0;
    for (const pg of parts) {
      const m = new THREE.Matrix4().makeRotationY(rotY || 0); m.setPosition(x, y, z);
      if (shapeKey) VAL.Instancing.tagShape(pg, shapeKey + ':' + pi, x, y, z, rotY || 0);
      pi++;
      pg.applyMatrix4(m);
      if (!pg.getAttribute('uv')) {
        const c = pg.getAttribute('position').count; const uv = new Float32Array(c * 2);
        pg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      out.push(pg);
    }
    return out;
  }
  // a small baluster row for balconies
  function balusters(len, x, y, z, rotY, list, matKey) {
    const n = Math.max(3, Math.round(len / 0.28));
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * len;
      const px = x + Math.cos(rotY) * t, pz = z - Math.sin(rotY) * t;
      list.push(boxAt(0.07, 0.34, 0.07, px, y + 0.17, pz, rotY));
    }
  }

  // ---------- map object ----------
  function build(scene, opts) {
    opts = opts || {};
    const data = D();
    const map = { group: new THREE.Group(), data, walls: [], steps: [], crates: [], doors: [], barriers: [], barriersActive: true, switches: [], dynamic: [] };
    map.group.name = 'ascent';
    map.group.userData.batchable = true;   // opt this group in to static batching
    scene.add(map.group);

    // ----- heights -----
    const zones = data.zones;
    map.heightAt = function (x, z) {
      let h = 0;
      for (let i = 0; i < zones.length; i++) {
        const zn = zones[i];
        if (x < zn.x0 || x > zn.x1 || z < zn.z0 || z > zn.z1) continue;
        if (zn.t === 'rect') h = zn.h;
        else { const p = zn.axis === 'x' ? x : z; let t = (p - zn.A) / (zn.B - zn.A); t = t < 0 ? 0 : (t > 1 ? 1 : t); h = zn.hA + (zn.hB - zn.hA) * t; }
      }
      return h;
    };
    map.isFloor = function (x, z) {
      if (!U.pointInPoly(x, z, data.outline)) return false;
      for (const v of data.voids) if (U.pointInPoly(x, z, v)) return false;
      return true;
    };
    map.inDropZone = (x, z) => data.drops.some(d => x >= d.x0 - 0.5 && x <= d.x1 + 0.5 && z >= d.z0 - 0.5 && z <= d.z1 + 0.5);

    // ----- collision segments -----
    function addSeg(list, x0, z0, x1, z1, extra) { const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.05) return null; const s = Object.assign({ x0, z0, x1, z1, len, nx: (z1 - z0) / len, nz: -(x1 - x0) / len }, extra || {}); list.push(s); return s; }
    for (const w of data.walls) addSeg(map.walls, w[0], w[1], w[2], w[3], { kind: 'wall', yBot: -2, yTop: 12 });
    for (const s of data.steps) {
      const lo = Math.min(s[4], s[5]), hi = Math.max(s[4], s[5]);
      addSeg(map.steps, s[0], s[1], s[2], s[3], { kind: 'step', hLo: lo, hHi: hi, dh: hi - lo, drop: s[8] === 'drop', hA: s[4], hB: s[5], ax: s[6], az: s[7] });
    }
    for (const c of data.crates) { const cr = { x0: c.x - c.w / 2, x1: c.x + c.w / 2, z0: c.z - c.d / 2, z1: c.z + c.d / 2, y0: c.y, y1: c.y + c.h, kind: 'crate' }; map.crates.push(cr); }
    map.addCrateBox = (x0, z0, x1, z1, y0, y1) => { const cr = { x0, x1, z0, z1, y0, y1, kind: 'crate' }; map.crates.push(cr); return cr; };
    for (const t of ['att', 'def']) for (const b of data.barriers[t]) addSeg(map.barriers, b[0], b[1], b[2], b[3], { kind: 'barrier', team: t });
    // parapets / railings: waist-high collision that bullets clear
    map.rails = [];
    for (const r of (data.rails || [])) {
      const hA = map.heightAt(r[0], r[1]), hB = map.heightAt(r[2], r[3]);
      addSeg(map.rails, r[0], r[1], r[2], r[3], { kind: 'rail', hA, hB, railH: r[4], style: r[5] || 'stone', yBot: Math.min(hA, hB) - 0.1, yTop: Math.max(hA, hB) + r[4] });
    }

    // ----- rendering: floor -----
    buildFloor(map);
    buildWalls(map);
    buildSteps(map);
    buildRails(map);
    buildCrates(map);
    buildDoors(map);
    buildBarriers(map);
    buildDecals(map);
    buildProps(map);
    // Dressing places props with VAL.Nav.randomPointInArea, so it has to run after
    // Nav.init - the caller triggers it once the nav grid exists.
    map.dress = () => {
      if (map._dressed || !VAL.Dressing || opts.noDressing) return;
      map._dressed = true;
      try { map.dressGroup = VAL.Dressing.apply(map, scene); } catch (e) { console.error('dressing failed', e); }
    };

    // ----- queries -----
    map.collide = function (x, z, radius, y, prevX, prevZ, flags) {
      // returns adjusted [x,z]; flags: {isBot, ignoreBarriers}
      let px = x, pz = z;
      const r = radius;
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        const test = (s) => {
          const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
          let t = ((px - s.x0) * dx + (pz - s.z0) * dz) / (s.len * s.len); t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const cx = s.x0 + dx * t, cz = s.z0 + dz * t;
          const ddx = px - cx, ddz = pz - cz; const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r * r && d2 > 1e-9) { const d = Math.sqrt(d2); px = cx + ddx / d * r; pz = cz + ddz / d * r; moved = true; }
          else if (d2 <= 1e-9) { px += s.nx * r; pz += s.nz * r; moved = true; }
        };
        for (const s of map.walls) { if (Math.abs(px - (s.x0 + s.x1) * 0.5) > s.len * 0.5 + r + 0.1 || Math.abs(pz - (s.z0 + s.z1) * 0.5) > s.len * 0.5 + r + 0.1) continue; test(s); }
        for (const s of map.steps) {
          if (Math.abs(px - (s.x0 + s.x1) * 0.5) > s.len * 0.5 + r + 0.1 || Math.abs(pz - (s.z0 + s.z1) * 0.5) > s.len * 0.5 + r + 0.1) continue;
          if (s.dh <= 0.6) continue; // walkable step
          // which side am I on? side A sample (ax,az) has height hA
          const sideA = ((px - s.x0) * s.nx + (pz - s.z0) * s.nz) * ((s.ax - s.x0) * s.nx + (s.az - s.z0) * s.nz) > 0;
          const myH = sideA ? s.hA : s.hB;
          const high = myH >= s.hHi - 0.01;
          if (high && s.drop) continue;         // may jump down
          if (high && y > s.hHi + 1.0) continue; // airborne above railing? no - keep railing
          if (!high && y >= s.hHi - 0.05) continue; // already at the upper level (e.g. jumped/landed on crate)
          test(s);
        }
        for (const c of map.crates) {
          if (y >= c.y1 - 0.05) continue; // standing on top
          if (px + r < c.x0 || px - r > c.x1 || pz + r < c.z0 || pz - r > c.z1) continue;
          // push out along smallest penetration
          const pen = [px + r - c.x0, c.x1 - (px - r), pz + r - c.z0, c.z1 - (pz - r)];
          let mi = 0; for (let i = 1; i < 4; i++) if (pen[i] < pen[mi]) mi = i;
          if (mi === 0) px = c.x0 - r; else if (mi === 1) px = c.x1 + r; else if (mi === 2) pz = c.z0 - r; else pz = c.z1 + r; moved = true;
        }
        for (const s of map.rails) {
          if (Math.abs(px - (s.x0 + s.x1) * 0.5) > s.len * 0.5 + r + 0.1 || Math.abs(pz - (s.z0 + s.z1) * 0.5) > s.len * 0.5 + r + 0.1) continue;
          if (y > s.yTop - 0.15) continue; // standing on top of it
          test(s);
        }
        if (map.barriersActive && !(flags && flags.ignoreBarriers)) for (const s of map.barriers) { if (Math.abs(px - (s.x0 + s.x1) * 0.5) > s.len * 0.5 + r + 0.1 || Math.abs(pz - (s.z0 + s.z1) * 0.5) > s.len * 0.5 + r + 0.1) continue; test(s); }
        for (const d of map.doors) if (d.closedAmount > 0.15) { const s = d.seg; if (Math.abs(px - (s.x0 + s.x1) * 0.5) > s.len * 0.5 + r + 0.1 || Math.abs(pz - (s.z0 + s.z1) * 0.5) > s.len * 0.5 + r + 0.1) continue; test(s); }
        for (const s of map.dynamic) test(s);
        if (!moved) break;
      }
      return [px, pz];
    };
    // top of any crate under (x,z) at or below y+0.6 else null
    map.crateTop = function (x, z, y, r) {
      let best = null;
      for (const c of map.crates) { if (x + r * 0.5 < c.x0 || x - r * 0.5 > c.x1 || z + r * 0.5 < c.z0 || z - r * 0.5 > c.z1) continue; if (c.y1 <= y + 0.6 && (best === null || c.y1 > best)) best = c.y1; }
      return best;
    };
    map.groundAt = function (x, z, y, r) { const h = map.heightAt(x, z); const ct = map.crateTop(x, z, y, r || 0.35); return ct !== null && ct > h ? ct : h; };

    // 3D raycast: returns {dist, point:Vector3, normal:Vector3, kind, hit} or null
    const _p = new THREE.Vector3(), _n = new THREE.Vector3();
    map.raycast = function (ox, oy, oz, dx, dy, dz, maxDist, opt) {
      opt = opt || {};
      let best = maxDist, hit = null;
      const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
      const bx0 = Math.min(ox, ex) - 0.5, bx1 = Math.max(ox, ex) + 0.5, bz0 = Math.min(oz, ez) - 0.5, bz1 = Math.max(oz, ez) + 0.5;
      const testSeg = (s, yLo, yHi, kind, extra) => {
        if (Math.max(s.x0, s.x1) < bx0 || Math.min(s.x0, s.x1) > bx1 || Math.max(s.z0, s.z1) < bz0 || Math.min(s.z0, s.z1) > bz1) return;
        const t = U.segSeg(ox, oz, ex, ez, s.x0, s.z0, s.x1, s.z1);
        if (t === null) return; const dist = t * maxDist; if (dist >= best || dist < 0.001) return;
        const y = oy + dy * dist; if (y < yLo || y > yHi) return;
        best = dist; hit = { dist, kind, seg: s, x: ox + dx * dist, y, z: oz + dz * dist, nx: s.nx, ny: 0, nz: s.nz, extra };
      };
      for (const s of map.walls) testSeg(s, s.yBot, s.yTop, 'wall');
      for (const s of map.steps) testSeg(s, s.hLo - 0.2, s.hHi, 'step');
      for (const s of map.rails) testSeg(s, s.yBot, s.yTop, 'rail');
      for (const d of map.doors) if (d.closedAmount > 0.05) testSeg(d.seg, d.y - 0.1, d.y + 3.6, 'door', d);
      if (map.barriersActive && opt.barriers) for (const s of map.barriers) testSeg(s, -1, 5, 'barrier');
      for (const c of map.crates) { // slab AABB
        if (c.x1 < bx0 || c.x0 > bx1 || c.z1 < bz0 || c.z0 > bz1) continue;
        let tmin = 0, tmax = best; let hitAxis = -1, sign = 0;
        const o = [ox, oy, oz], dd = [dx, dy, dz], lo = [c.x0, c.y0, c.z0], hi = [c.x1, c.y1, c.z1];
        let ok = true;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(dd[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) { ok = false; break; } continue; }
          let t1 = (lo[i] - o[i]) / dd[i], t2 = (hi[i] - o[i]) / dd[i]; let sg = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sg = 1; }
          if (t1 > tmin) { tmin = t1; hitAxis = i; sign = sg; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
        if (ok && tmin > 0.001 && tmin < best) { best = tmin; hit = { dist: tmin, kind: 'crate', x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin, nx: hitAxis === 0 ? sign : 0, ny: hitAxis === 1 ? sign : 0, nz: hitAxis === 2 ? sign : 0 }; }
      }
      // ground
      if (opt.ground !== false && dy < -0.02) {
        let t = 0.5; const stepLen = 0.6;
        while (t < best) { const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t; const h = map.heightAt(x, z); if (y <= h) { // refine
            let t0 = t - stepLen, t1 = t; for (let k = 0; k < 6; k++) { const tm = (t0 + t1) / 2; const ym = oy + dy * tm; const hm = map.heightAt(ox + dx * tm, oz + dz * tm); if (ym <= hm) t1 = tm; else t0 = tm; }
            if (t1 < best) { best = t1; hit = { dist: t1, kind: 'floor', x: ox + dx * t1, y: oy + dy * t1, z: oz + dz * t1, nx: 0, ny: 1, nz: 0 }; } break; }
          t += stepLen; }
      }
      return hit;
    };
    map.lineOfSight = function (ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az; const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-4) return true;
      const h = map.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, { ground: false });
      if (h) return false;
      if (map.smokes && map.smokes.length && VAL.Abilities && VAL.Abilities.blocksLOS(ax, ay, az, bx, by, bz)) return false;
      return true;
    };
    map.segmentBlocked = function (x0, z0, x1, z1) { // for nav smoothing: closed doors / active barriers
      for (const d of map.doors) if (d.closedAmount > 0.15 && U.segSeg(x0, z0, x1, z1, d.seg.x0, d.seg.z0, d.seg.x1, d.seg.z1) !== null) return true;
      if (map.barriersActive) for (const s of map.barriers) if (U.segSeg(x0, z0, x1, z1, s.x0, s.z0, s.x1, s.z1) !== null) return true;
      return false;
    };
    map.setBarriers = function (active) {
      map.barriersActive = active;
      for (const m of map.barrierMeshes) m.visible = active;
    };
    map.inPlantZone = function (x, z) { for (const k of ['A', 'B']) { const p = data.plant[k]; if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return k; } return null; };
    map.areaName = function (x, z) { return (VAL.Nav && VAL.Nav.areaAt) ? VAL.Nav.areaAt(x, z) : null; };
    map.update = function (dt) { for (const d of map.doors) updateDoor(d, dt, map); };
    map.nearestSwitch = function (x, z, y) { let best = null, bd = 2.2; for (const s of map.switches) { const dd = Math.hypot(s.x - x, s.z - z); if (dd < bd && Math.abs(s.y - y) < 2.5) { bd = dd; best = s; } } return best; };
    map.toggleDoor = function (door) { if (door.broken) return false; door.target = door.target > 0.5 ? 0 : 1; if (VAL.Audio) VAL.Audio.play('door_move', { pos: new THREE.Vector3(door.x, door.y + 1.5, door.z) }); return true; };
    map.damageDoor = function (door, dmg) { if (door.broken || door.closedAmount < 0.9) return; door.hp -= dmg; if (door.hp <= 0) { door.broken = true; door.target = 1; if (VAL.Audio) VAL.Audio.play('door_break', { pos: new THREE.Vector3(door.x, door.y + 1.5, door.z) }); } };
    map.resetDoors = function () { for (const d of map.doors) { d.hp = 500; d.broken = false; d.target = 1; d.closedAmount = 0; if (d.setOpen) d.setOpen(1); } };
    return map;
  }

  // ---------- builders ----------
  function buildFloor(map) {
    const data = map.data; const cell = 0.5;
    const b = data.bounds; const groups = {};
    // Ascent's open ground is packed sand; the streets and interiors are stone
    const SAND = [
      { x0: -2, z0: -66, x1: 42, z1: -12 },     // mid courtyard, catwalk, cubby, mid top
      { x0: -10, z0: -66, x1: 2, z1: -34 },     // mid link
      { x0: 40, z0: -56, x1: 60, z1: -18 },     // A lobby / A main
      { x0: 44, z0: -78, x1: 78, z1: -56 },     // A site + garden mouth
      { x0: -30, z0: -66, x1: -8, z1: -46 },    // B main
      { x0: 2, z0: -66, x1: 24, z1: -56 }       // mid bottom
    ];
    const matFor = (x, z) => {
      let m = 'cobble';
      for (const f of data.floorMats) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) m = f.mat;
      if (m === 'paver_dark') m = 'stone_grey';
      if (m === 'cobble' || m === 'paver_sand' || m === 'stone_grey') for (const r of SAND) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) { m = 'sand'; break; }
      return m;
    };
    const cols = Math.ceil((b.maxX - b.minX) / cell), rows = Math.ceil((b.maxZ - b.minZ) / cell);
    map.floorCells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = b.minX + (c + 0.5) * cell, z = b.minZ + (r + 0.5) * cell;
      if (!map.isFloor(x, z)) continue;
      const h = map.heightAt(x, z);
      const m = matFor(x, z);
      (groups[m] = groups[m] || []).push([x, z, h]);
    }
    const UVS = { cobble: 3.2, paver_dark: 1.6, stone_grey: 1.5, stone_block: 1.2, wood_plank: 1.5, paver_sand: 1, sand: 0.9 };
    for (const m in groups) {
      const cells = groups[m]; const n = cells.length; const us = UVS[m] || 1;
      const pos = new Float32Array(n * 18), nor = new Float32Array(n * 18), uv = new Float32Array(n * 12);
      for (let i = 0; i < n; i++) {
        const [x, z, h] = cells[i]; const x0 = x - cell / 2, x1 = x + cell / 2, z0 = z - cell / 2, z1 = z + cell / 2;
        const o = i * 18; const y = h;
        pos.set([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], o);
        for (let k = 0; k < 6; k++) { nor[o + k * 3 + 1] = 1; }
        const u0 = x0 / TILE * us, u1 = x1 / TILE * us, v0 = z0 / TILE * us, v1 = z1 / TILE * us;
        uv.set([u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0], i * 12);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(g, M(m)); mesh.receiveShadow = true; mesh.name = 'floor_' + m; map.group.add(mesh);
    }
    // step risers for ramps rendered as stairs: add vertical faces where neighbouring cells differ (< 0.6 m) so stairs are closed
    const riser = [];
    const cellsAll = Object.values(groups).flat();
    const idx = new Map(); for (const cc of cellsAll) idx.set(Math.round(cc[0] * 2) + ',' + Math.round(cc[1] * 2), cc[2]);
    for (const [x, z, h] of cellsAll) {
      const nb = [[x + cell, z, 1, 0], [x, z + cell, 0, 1]];
      for (const [nx, nz, ax, az] of nb) {
        const key = Math.round(nx * 2) + ',' + Math.round(nz * 2); if (!idx.has(key)) continue; const h2 = idx.get(key); const dh = h2 - h; if (Math.abs(dh) < 0.01 || Math.abs(dh) > 0.6) continue;
        const ex = x + ax * cell / 2, ez = z + az * cell / 2;
        if (ax) riser.push(wallQuad(ex, ez - cell / 2, ex, ez + cell / 2, Math.min(h, h2), Math.max(h, h2)));
        else riser.push(wallQuad(ex - cell / 2, ez, ex + cell / 2, ez, Math.min(h, h2), Math.max(h, h2)));
      }
    }
    if (riser.length) { const mesh = new THREE.Mesh(mergeGeoms(riser), M('stone_block')); mesh.material = mesh.material.clone(); mesh.material.side = THREE.DoubleSide; mesh.receiveShadow = true; map.group.add(mesh); }
  }

  function buildWalls(map) {
    const data = map.data;
    const polys = [data.outline].concat(data.voids);
    const voidMats = ['plaster_cream', 'plaster_white', 'plaster_ochre', 'plaster_cream', 'brick_red', 'plaster_white', 'stone_block', 'plaster_cream', 'plaster_white'];
    const voidH = [7, 8, 6, 7, 9, 8, 7, 8, 6];
    const outlineMats = ['plaster_cream', 'plaster_white', 'plaster_ochre', 'plaster_cream', 'brick_red', 'plaster_white', 'stone_block'];
    const byMat = {};
    const trims = [];
    const windowsG = [], shutterG = [], windowFrames = [], plantG = [], flowerG = [];
    polys.forEach((poly, pi) => {
      const n = poly.length; const isOut = pi === 0;
      const H = isOut ? 8.5 : voidH[pi - 1];
      let runMat = isOut ? outlineMats[0] : voidMats[pi - 1]; let runLen = 0;
      for (let i = 0; i < n; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
        const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.05) continue;
        if (isOut) { runLen += len; if (runLen > 18 + Math.random() * 14) { runLen = 0; runMat = outlineMats[(Math.random() * outlineMats.length) | 0]; } }
        const hBase = Math.min(map.heightAt(x0 + (x1 - x0) * 0.5 - (z1 - z0) * 0.02, z0 + (z1 - z0) * 0.5 + (x1 - x0) * 0.02), map.heightAt(x0 + (x1 - x0) * 0.5 + (z1 - z0) * 0.02, z0 + (z1 - z0) * 0.5 - (x1 - x0) * 0.02));
        // wall as thin box so both sides are shaded correctly; thickness 0.45 (centred on the edge)
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ang = Math.atan2(-(z1 - z0), x1 - x0);
        const g = boxAt(len + 0.45, H + 2, 0.45, cx, hBase - 1 + (H + 2) / 2, cz, ang);
        (byMat[runMat] = byMat[runMat] || []).push(g);
        // base trim (dark stone) and top ledge
        trims.push(boxAt(len + 0.5, 0.35, 0.52, cx, hBase + 0.17, cz, ang));
        trims.push(boxAt(len + 0.5, 0.25, 0.6, cx, hBase + H - 0.12, cz, ang));
        // ---- Venetian facade: arched windows, sills, shutters, balconies, string course ----
        if (len > 4.2) {
          const count = Math.max(1, Math.floor(len / 4.2));
          const nx = (z1 - z0) / len, nz = -(x1 - x0) / len;
          const rowsW = H > 7.4 ? [3.55, 6.35] : (H > 5.6 ? [3.55] : [2.9]);
          // string course between floors
          if (rowsW.length > 1) trims.push(boxAt(len + 0.5, 0.16, 0.56, cx, hBase + 5.05, cz, ang));
          for (let k = 0; k < count; k++) {
            const t = (k + 0.5) / count; const wx = x0 + (x1 - x0) * t, wz = z0 + (z1 - z0) * t;
            const seed = Math.abs(Math.sin(wx * 12.9898 + wz * 78.233) * 43758.5453) % 1;
            for (const side of [1, -1]) {
              const ox = wx + nx * side * 0.24, oz = wz + nz * side * 0.24;
              const dx = Math.cos(ang), dz = -Math.sin(ang);       // along the wall
              for (let ri = 0; ri < rowsW.length; ri++) {
                const wy = rowsW[ri];
                if (wy + 1.5 > H - 0.4) continue;
                const halfW = 0.52, sillY = hBase + wy - 0.95;
                // opening: rectangle plus a half-round head
                windowsG.push(boxAt(halfW * 2, 1.5, 0.1, ox, hBase + wy - 0.2, oz, ang));
                const archTop = hBase + wy + 0.55;
                for (const g of archAt(halfW, 0.0, 0.1, ox, archTop, oz, ang, true)) windowsG.push(g);
                // stone surround
                windowFrames.push(boxAt(halfW * 2 + 0.26, 0.13, 0.2, ox, sillY, oz, ang));                    // sill
                for (const sx of [-1, 1]) windowFrames.push(boxAt(0.13, 1.6, 0.2, ox + dx * sx * (halfW + 0.06), hBase + wy - 0.15, oz + dz * sx * (halfW + 0.06), ang));
                for (const g of archAt(halfW + 0.14, halfW + 0.005, 0.2, ox, archTop, oz, ang)) windowFrames.push(g);
                windowFrames.push(boxAt(0.2, 0.16, 0.22, ox, archTop + halfW + 0.02, oz, ang));               // keystone
                // shutters folded back against the wall
                shutterG.push(boxAt(0.38, 1.55, 0.06, ox + dx * (halfW + 0.28), hBase + wy - 0.18, oz + dz * (halfW + 0.28), ang));
                shutterG.push(boxAt(0.38, 1.55, 0.06, ox - dx * (halfW + 0.28), hBase + wy - 0.18, oz - dz * (halfW + 0.28), ang));
                // balcony on some upper windows
                if (ri === rowsW.length - 1 && rowsW.length > 1 && seed > 0.58) {
                  const bx2 = ox + nx * side * 0.32, bz2 = oz + nz * side * 0.32;
                  windowFrames.push(boxAt(halfW * 2 + 0.7, 0.1, 0.62, bx2, sillY - 0.06, bz2, ang));
                  balusters(halfW * 2 + 0.5, bx2 + nx * side * 0.22, sillY, bz2 + nz * side * 0.22, ang, windowFrames);
                  windowFrames.push(boxAt(halfW * 2 + 0.62, 0.09, 0.12, bx2 + nx * side * 0.22, sillY + 0.38, bz2 + nz * side * 0.22, ang));
                  for (const sx of [-1, 1]) windowFrames.push(boxAt(0.09, 0.4, 0.5, bx2 + dx * sx * (halfW + 0.28), sillY + 0.19, bz2 + dz * sx * (halfW + 0.28), ang));
                } else if (ri === 0 && seed < 0.34) {
                  // window box with planting
                  const bpx = ox + nx * side * 0.15, bpz = oz + nz * side * 0.15;
                  windowFrames.push(boxAt(halfW * 2 + 0.06, 0.22, 0.26, bpx, sillY - 0.12, bpz, ang));
                  for (let fi = 0; fi < 5; fi++) {
                    const ft = (fi / 4 - 0.5) * (halfW * 1.75);
                    const fx = bpx + dx * ft, fz = bpz + dz * ft;
                    const fy = sillY + 0.02 + ((fi * 7919) % 5) * 0.012;
                    const leaf = new THREE.SphereGeometry(0.085, 8, 6);
                    leaf.scale(1, 0.8, 0.9); leaf.translate(fx, fy, fz);
                    plantG.push(leaf);
                    if (fi % 2 === 0) { const fl = new THREE.SphereGeometry(0.036, 6, 5); fl.translate(fx, fy + 0.07, fz); flowerG.push(fl); }
                  }
                }
              }
            }
          }
        }
        // corner quoins: alternating stone blocks up the building's edges
        {
          const qh = Math.min(H - 0.8, 7.0);
          for (let qy = 0.55; qy < qh; qy += 1.05) {
            const w = (Math.floor(qy / 1.05) % 2) ? 0.42 : 0.62;
            trims.push(boxAt(w, 0.5, 0.48, x0 + Math.cos(ang) * (w * 0.5 - 0.02), hBase + qy, z0 - Math.sin(ang) * (w * 0.5 - 0.02), ang));
          }
        }
      }
    });
    for (const m in byMat) { const mesh = new THREE.Mesh(mergeGeoms(byMat[m]), M(m)); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'walls_' + m; map.group.add(mesh); }
    const trimMesh = new THREE.Mesh(mergeGeoms(trims), M('stone_grey')); trimMesh.castShadow = true; trimMesh.receiveShadow = true; map.group.add(trimMesh);
    if (windowsG.length) {
      const wm = new THREE.Mesh(mergeGeoms(windowsG), new THREE.MeshStandardMaterial({ color: 0x2c3a46, roughness: 0.1, metalness: 0.55, envMapIntensity: 1.6 })); map.group.add(wm);
      const sm = new THREE.Mesh(mergeGeoms(shutterG), M('wood_dark')); sm.castShadow = true; map.group.add(sm);
      const fm = new THREE.Mesh(mergeGeoms(windowFrames), M('marble_white')); fm.castShadow = true; fm.receiveShadow = true; map.group.add(fm);
      if (plantG.length) {
        const pm = new THREE.Mesh(mergeGeoms(plantG), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.92 }));
        pm.castShadow = true; map.group.add(pm);
        const fm2 = new THREE.Mesh(mergeGeoms(flowerG), new THREE.MeshStandardMaterial({ color: 0xd94f5c, roughness: 0.8 }));
        fm2.castShadow = true; map.group.add(fm2);
      }
    }
    buildRoofs(map, polys, voidH);
  }

  function buildSteps(map) {
    const faces = [], rails = [];
    for (const s of map.steps) {
      faces.push(wallQuad(s.x0, s.z0, s.x1, s.z1, s.hLo - 0.3, s.hHi));
      faces.push(wallQuad(s.x1, s.z1, s.x0, s.z0, s.hLo - 0.3, s.hHi));
      if (s.dh >= 1.4 && !s.drop) {
        // railing: posts + two bars along the edge on the high side
        const len = s.len; const n = Math.max(2, Math.round(len / 1.6));
        const ang = Math.atan2(-(s.z1 - s.z0), s.x1 - s.x0);
        // offset toward the high side
        const highA = s.hA >= s.hB; const sgn = highA ? 1 : -1;
        const sideDot = ((s.ax - s.x0) * s.nx + (s.az - s.z0) * s.nz) > 0 ? 1 : -1; // side A relative to normal
        const off = 0.18 * sgn * sideDot;
        const ox = s.nx * off, oz = s.nz * off;
        for (let k = 0; k <= n; k++) { const t = k / n; const x = s.x0 + (s.x1 - s.x0) * t + ox, z = s.z0 + (s.z1 - s.z0) * t + oz; rails.push(boxAt(0.08, 1.1, 0.08, x, s.hHi + 0.55, z, ang)); }
        const cx = (s.x0 + s.x1) / 2 + ox, cz = (s.z0 + s.z1) / 2 + oz;
        rails.push(boxAt(len, 0.06, 0.1, cx, s.hHi + 1.08, cz, ang));
        rails.push(boxAt(len, 0.05, 0.05, cx, s.hHi + 0.6, cz, ang));
      }
    }
    if (faces.length) { const m = new THREE.Mesh(mergeGeoms(faces), M('stone_block')); m.receiveShadow = true; m.castShadow = true; map.group.add(m); }
    if (rails.length) { const m = new THREE.Mesh(mergeGeoms(rails), M('metal_dark')); m.castShadow = true; map.group.add(m); }
  }

  // Pitched terracotta roofs. Every wall run gets an eave that overhangs the street
  // and a slope rising away from it, plus a flat ridge cap over building interiors.
  // Direction is decided by map.isFloor so a roof always leans away from playable ground.
  function buildRoofs(map, polys, voidH) {
    const tiles = [], fascia = [], caps = [], gutters = [];
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, uw, uh) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz]);
      const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      const nor = new Float32Array(18); for (let i = 0; i < 6; i++) { nor[i * 3] = nx; nor[i * 3 + 1] = ny; nor[i * 3 + 2] = nz; }
      const uv = new Float32Array([0, 0, uw, 0, uw, uh, 0, 0, uw, uh, 0, uh]);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return g;
    };
    polys.forEach((poly, pi) => {
      const isOut = pi === 0;
      const H = isOut ? 8.5 : voidH[pi - 1];
      // roof run scaled to the building's size so slopes never cross through each other
      let area = 0, perim = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
        area += x0 * z1 - x1 * z0; perim += Math.hypot(x1 - x0, z1 - z0);
      }
      area = Math.abs(area) / 2;
      const inr = perim > 0 ? (2 * area / perim) : 3;
      const run = isOut ? 3.4 : Math.max(0.9, Math.min(3.0, inr * 0.75));
      const rise = run * 0.52, over = 0.62;
      for (let i = 0; i < poly.length; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
        const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.6) continue;
        const nx = (z1 - z0) / len, nz = -(x1 - x0) / len;   // one side normal
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        // point the roof away from playable floor
        let dx = nx, dz = nz;
        if (map.isFloor(mx + nx * 0.6, mz + nz * 0.6)) { dx = -nx; dz = -nz; }
        const top = Math.min(map.heightAt(mx - dx * 0.6, mz - dz * 0.6), map.heightAt(mx + dx * 0.6, mz + dz * 0.6)) + H;
        const ex0 = x0 - dx * over, ez0 = z0 - dz * over, ex1 = x1 - dx * over, ez1 = z1 - dz * over;
        const rx0 = x0 + dx * run, rz0 = z0 + dz * run, rx1 = x1 + dx * run, rz1 = z1 + dz * run;
        const slope = Math.hypot(run + over, rise);
        tiles.push(quad(ex0, top, ez0, ex1, top, ez1, rx1, top + rise, rz1, rx0, top + rise, rz0, len / 1.1, slope / 1.1));
        // underside so the overhang is not see-through, plus a fascia board and gutter
        tiles.push(quad(ex1, top - 0.14, ez1, ex0, top - 0.14, ez0, rx0, top + rise - 0.14, rz0, rx1, top + rise - 0.14, rz1, len / 1.1, slope / 1.1));
        const ang = Math.atan2(-(z1 - z0), x1 - x0);
        fascia.push(boxAt(len + 0.1, 0.2, 0.1, (ex0 + ex1) / 2, top - 0.04, (ez0 + ez1) / 2, ang));
        gutters.push(boxAt(len + 0.1, 0.1, 0.16, (ex0 + ex1) / 2 - dx * 0.06, top - 0.2, (ez0 + ez1) / 2 - dz * 0.06, ang));
      }
      if (!isOut) { // flat ridge cap over the building footprint
        const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
        const g = new THREE.ShapeGeometry(shape); g.rotateX(Math.PI / 2);
        const uv = g.getAttribute('uv'), pos = g.getAttribute('position');
        for (let k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k) / 1.1, pos.getZ(k) / 1.1);
        let hb = 0; for (const p of poly) hb += map.heightAt(p[0], p[1]); hb /= poly.length;
        g.translate(0, hb + H + rise - 0.02, 0);
        caps.push(g);
      }
    });
    const addM = (arr, mat, dbl) => {
      if (!arr.length) return; const mm = M(mat); const m2 = dbl ? mm.clone() : mm; if (dbl) m2.side = THREE.DoubleSide;
      const me = new THREE.Mesh(mergeGeoms(arr), m2); me.castShadow = true; me.receiveShadow = true; me.name = 'roof_' + mat; map.group.add(me);
    };
    addM(tiles, 'roof_tile', true); addM(caps, 'roof_tile', true);
    addM(fascia, 'plaster_cream'); addM(gutters, 'metal_dark');
  }

  // Parapets and railings that flank every staircase and cap the Heaven drop.
  function buildRails(map) {
    const stone = [], coping = [], metal = [];
    for (const s of map.rails) {
      const ang = Math.atan2(-(s.z1 - s.z0), s.x1 - s.x0);
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const gLo = Math.min(s.hA, s.hB), gHi = Math.max(s.hA, s.hB);
      const slope = Math.abs(s.hA - s.hB) > 0.25;
      if (s.style === 'metal') {
        const n = Math.max(2, Math.round(s.len / 1.5));
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = s.x0 + (s.x1 - s.x0) * t, z = s.z0 + (s.z1 - s.z0) * t;
          const g = s.hA + (s.hB - s.hA) * t;
          metal.push(boxAt(0.07, s.railH, 0.07, x, g + s.railH / 2, z, ang));
        }
        const midG = (s.hA + s.hB) / 2;
        metal.push(boxAt(s.len, 0.07, 0.11, cx, midG + s.railH - 0.03, cz, ang));
        metal.push(boxAt(s.len, 0.05, 0.05, cx, midG + s.railH * 0.55, cz, ang));
      } else if (slope) {
        // stepped parapet following the stair: short segments so it stays on the slope
        const n = Math.max(3, Math.round(s.len / 1.2));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2;
          const x = s.x0 + (s.x1 - s.x0) * tm, z = s.z0 + (s.z1 - s.z0) * tm;
          const g = s.hA + (s.hB - s.hA) * tm;
          const L = s.len / n + 0.06;
          stone.push(boxAt(L, s.railH, 0.34, x, g + s.railH / 2, z, ang));
          coping.push(boxAt(L, 0.12, 0.44, x, g + s.railH + 0.05, z, ang));
        }
      } else {
        const h = gHi - gLo + s.railH;
        stone.push(boxAt(s.len + 0.34, h, 0.34, cx, gLo + h / 2, cz, ang));
        coping.push(boxAt(s.len + 0.44, 0.12, 0.44, cx, gLo + h + 0.05, cz, ang));
      }
    }
    const add = (arr, mat) => { if (!arr.length) return; const m = new THREE.Mesh(mergeGeoms(arr), M(mat)); m.castShadow = true; m.receiveShadow = true; map.group.add(m); };
    add(stone, 'plaster_cream'); add(coping, 'stone_block'); add(metal, 'metal_dark');
  }

  function buildCrates(map) {
    const P = VAL.Scenery && VAL.Scenery.props;
    map.data.crates.forEach((c, i) => {
      let obj = null;
      const big = Math.max(c.w, c.d) > 4.5;
      try {
        if (P) {
          if (big && P.generatorBox && i === 19) obj = P.generatorBox();
          else if (P.crate) obj = P.crate(c.w, c.h, c.d, ['green', 'wood', 'red', 'green', 'wood', 'green'][i % 6]);
        }
      } catch (e) { obj = null; }
      if (!obj) { obj = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), M(i % 2 ? 'wood_crate' : 'metal_painted_green')); obj.position.y = c.h / 2; const gg = new THREE.Group(); gg.add(obj); obj = gg; }
      obj.position.set(c.x, c.y, c.z);
      obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (VAL.Characters && VAL.Characters.mergeStatic) { try { VAL.Characters.mergeStatic(obj); } catch (e) { } }
      map.group.add(obj);
    });
  }

  function buildDoors(map) {
    const P = VAL.Scenery && VAL.Scenery.props;
    for (const dd of map.data.doors) {
      const ang = Math.atan2(-(dd.p1[1] - dd.p0[1]), dd.p1[0] - dd.p0[0]);
      const door = { id: dd.id, x: dd.x, z: dd.z, y: dd.y, width: dd.width, hp: 500, broken: false, target: 1, closedAmount: 0, seg: null, group: null };
      door.seg = { x0: dd.p0[0], z0: dd.p0[1], x1: dd.p1[0], z1: dd.p1[1], len: dd.width, nx: (dd.p1[1] - dd.p0[1]) / dd.width, nz: -(dd.p1[0] - dd.p0[0]) / dd.width, kind: 'door' };
      let m = null;
      try { if (P && P.mechDoor) m = P.mechDoor(dd.width, 3.5); } catch (e) { m = null; }
      if (m && m.group) { door.group = m.group; door.setOpen = m.setOpen; }
      else {
        const g = new THREE.Group(); const l = new THREE.Mesh(new THREE.BoxGeometry(dd.width / 2, 3.5, 0.3), M('metal_painted_green')); const r = l.clone();
        l.position.set(-dd.width / 4, 1.75, 0); r.position.set(dd.width / 4, 1.75, 0); g.add(l, r); door.group = g;
        door.setOpen = t => { l.position.x = -dd.width / 4 - t * dd.width / 2; r.position.x = dd.width / 4 + t * dd.width / 2; };
      }
      door.group.userData.noBatch = true;   // slides every round - keep it a real object
      door.group.position.set(dd.x, dd.y, dd.z); door.group.rotation.y = ang; door.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      door.setOpen(1);
      // frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(dd.width + 1.2, 0.5, 1.0), M('metal_dark')); frame.position.set(0, 3.75, 0); door.group.add(frame);
      map.group.add(door.group);
      // switches
      for (const s of dd.switches) {
        const sw = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.18), new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.5, roughness: 0.5 }));
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0x33ffcc, emissive: 0x22ddaa, emissiveIntensity: 1.5 })); lamp.position.set(0, 0.32, 0.1);
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0xffaa22 })); lever.position.set(0, 0, 0.14);
        sw.add(box, lamp, lever); sw.position.set(s.x, s.y + 1.25, s.z); sw.userData.noBatch = true;
        // face toward the door
        sw.lookAt(dd.x, s.y + 1.25, dd.z);
        map.group.add(sw);
        map.switches.push({ x: s.x, z: s.z, y: s.y, door, group: sw, lamp });
      }
      map.doors.push(door);
    }
  }
  function updateDoor(d, dt, map) {
    const want = d.target > 0.5 ? 0 : 1; // closedAmount target
    if (Math.abs(d.closedAmount - want) > 0.001) {
      const sp = dt / 2.4; d.closedAmount += Math.sign(want - d.closedAmount) * Math.min(sp, Math.abs(want - d.closedAmount));
      d.setOpen(1 - d.closedAmount);
    }
    for (const s of map.switches) if (s.door === d && s.lamp) s.lamp.material.color.setHex(d.broken ? 0xff4444 : (d.closedAmount > 0.5 ? 0xff5555 : 0x33ffcc));
  }

  function buildBarriers(map) {
    map.barrierMeshes = [];
    const tex = makeBarrierTexture();
    for (const s of map.barriers) {
      const hb = Math.min(map.heightAt(s.x0, s.z0), map.heightAt(s.x1, s.z1));
      const g = new THREE.PlaneGeometry(s.len, 4.2, 1, 1);
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, color: s.team === 'att' ? 0xffb0b8 : 0xb0fff0 });
      const mesh = new THREE.Mesh(g, m); mesh.userData.noBatch = true; mesh.position.set((s.x0 + s.x1) / 2, hb + 2.1, (s.z0 + s.z1) / 2); mesh.rotation.y = Math.atan2(-(s.z1 - s.z0), s.x1 - s.x0);
      mesh.material.map.repeat.set(s.len / 2, 2); mesh.renderOrder = 5;
      map.group.add(mesh); map.barrierMeshes.push(mesh);
      // frame posts
      for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z1]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.2, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8dde0, emissive: 0x88ffee, emissiveIntensity: 0.4 })); p.position.set(x, hb + 2.1, z); map.group.add(p); map.barrierMeshes.push(p); }
    }
  }
  function makeBarrierTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    for (let i = -256; i < 512; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  function textTexture(txt, color, size, font) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 512); ctx.fillStyle = color; ctx.font = (font || 'bold 400px "Arial Black", Impact, sans-serif'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, 256, 280);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function buildDecals(map) {
    const data = map.data;
    for (const k of ['A', 'B']) {
      const p = data.plant[k]; const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2; const h = map.heightAt(cx, cz);
      const size = Math.min(p.x1 - p.x0, p.z1 - p.z0) * 0.7;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: textTexture(k, 'rgba(230,205,90,0.35)'), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(cx, h + 0.03, cz); m.renderOrder = 2; map.group.add(m);
      // plant zone outline (subtle)
      const eg = new THREE.EdgesGeometry(new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0));
      const line = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xe6cd5a, transparent: true, opacity: 0.35 })); line.rotation.x = -Math.PI / 2; line.position.set(cx, h + 0.04, cz); map.group.add(line);
      // big letter on the nearest wall (find longest wall within 25 m of the site centre)
      let best = null, bl = 0;
      for (const w of map.walls) { const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2; if (Math.hypot(mx - cx, mz - cz) < 22 && w.len > bl && w.len > 6) { bl = w.len; best = w; } }
      if (best) {
        const mx = (best.x0 + best.x1) / 2, mz = (best.z0 + best.z1) / 2;
        // choose side facing the site centre
        const side = ((cx - mx) * best.nx + (cz - mz) * best.nz) > 0 ? 1 : -1;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), new THREE.MeshBasicMaterial({ map: textTexture(k, '#d9d5c9'), transparent: true }));
        sign.position.set(mx + best.nx * side * 0.26, map.heightAt(mx, mz) + 4.2, mz + best.nz * side * 0.26);
        sign.rotation.y = Math.atan2(best.nx * side, best.nz * side);
        map.group.add(sign);
      }
    }
  }

  function buildProps(map) {
    const P = VAL.Scenery && VAL.Scenery.props; if (!P) return;
    const data = map.data; const pr = data.props || {};
    const place = (obj, x, z, rotY, collide) => { if (!obj) return; const h = map.heightAt(x, z); obj.position.set(x, h, z); obj.rotation.y = rotY || 0; obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); if (VAL.Characters && VAL.Characters.mergeStatic) { try { VAL.Characters.mergeStatic(obj); } catch (e) { } } map.group.add(obj); if (collide) map.addCrateBox(x - collide, z - collide, x + collide, z + collide, h, h + 1.2); };
    try {
      if (pr.fountain && P.fountain) place(P.fountain(pr.fountain.r), pr.fountain.x, pr.fountain.z, 0, pr.fountain.r);
      if (pr.well && P.well) place(P.well(), pr.well.x, pr.well.z, 0, 0.9);
      if (pr.tree && P.tree) place(P.tree('broadleaf', 1.2), pr.tree.x, pr.tree.z, 0, 0.35);
    } catch (e) { console.warn('props', e); }
    // callout-based dressing
    const co = {}; for (const c of data.callouts) co[c.sup + ' ' + c.name] = c;
    const near = (name, dx, dz) => { const c = co[name]; return c ? [c.x + dx, c.z + dz] : null; };
    const tryPlace = (fn, name, dx, dz, rot, coll) => { try { const p = near(name, dx, dz); if (!p) return; if (!map.isFloor(p[0], p[1])) return; place(fn(), p[0], p[1], rot, coll); } catch (e) { } };
    if (P.wineRack) { tryPlace(P.wineRack, 'A Wine', 1.5, 0, 0, 0.5); tryPlace(P.wineRack, 'A Wine', -1.5, 0.5, Math.PI, 0.5); }
    if (P.gelatoStand) tryPlace(P.gelatoStand, 'Mid Market', 2.5, 2.5, Math.PI / 2, 0.8);
    if (P.pizzaOven) tryPlace(P.pizzaOven, 'Mid Pizza', -2, 2, 0, 0.7);
    if (P.marketStall) tryPlace(P.marketStall, 'Mid Market', -2.5, -3, 0, 0.9);
    if (P.scaffold) tryPlace(() => P.scaffold(3, 4, 1.2), 'A Rafters', 0, -5, Math.PI / 2, 0);
    if (P.bench) { tryPlace(P.bench, 'Mid Bottom', 1.5, -1.5, Math.PI / 2, 0.4); tryPlace(P.bench, 'A Garden', 0, 2.5, 0, 0.4); }
    if (P.planter) { tryPlace(() => P.planter(1.4), 'A Tree', 3, 3, 0, 0.5); tryPlace(() => P.planter(1.4), 'A Lobby', -4, 4, 0, 0.5); tryPlace(() => P.planter(1.2), 'Defender Side Spawn', 4, 3, 0, 0.5); }
    if (P.barrel) { tryPlace(P.barrel, 'B Boat House', 2, -2, 0, 0.35); tryPlace(P.barrel, 'B Boat House', 2.8, -1.5, 0, 0.35); tryPlace(P.barrel, 'B Main', -2, 4, 0, 0.35); }
    if (P.sandbags) tryPlace(P.sandbags, 'B Site', 3, 3, 0.4, 0.6);
    if (P.lamp) { for (const nm of ['Attacker Side Spawn', 'Defender Side Spawn', 'Mid Courtyard', 'A Lobby', 'B Lobby']) tryPlace(() => P.lamp(4), nm, 5, -5, 0, 0.2); }
    if (P.cypress) { tryPlace(() => P.cypress(6), 'A Garden', -3, 3, 0, 0.3); tryPlace(() => P.cypress(5), 'Defender Side Spawn', -6, 4, 0, 0.3); }
  }

  return { build };
})();
