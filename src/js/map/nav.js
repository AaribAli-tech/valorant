// Grid navigation for bots: A* over VAL.MapData.nav (0.5 m cells) with height-aware links.
window.VAL = window.VAL || {};
VAL.Nav = (function () {
  let N = null, map = null;
  let walk = null, hgt = null, area = null, cols = 0, rows = 0, cell = 0.5, x0 = 0, z0 = 0;
  const areaCache = {};

  function init(mapObj) {
    map = mapObj; N = VAL.MapData.nav;
    cols = N.cols; rows = N.rows; cell = N.cell; x0 = N.x0; z0 = N.z0;
    walk = new Uint8Array(cols * rows); hgt = new Float32Array(cols * rows); area = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const line = N.walk[r], aline = N.area[r];
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        walk[i] = line.charCodeAt(c) === 49 ? 1 : 0;
        area[i] = aline.charCodeAt(c) === 46 ? 255 : (aline.charCodeAt(c) - 65);
        if (walk[i]) hgt[i] = map.heightAt(x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell);
      }
    }
    // crates block cells
    for (const cr of VAL.MapData.crates) {
      const c0 = Math.floor((cr.x - cr.w / 2 - 0.3 - x0) / cell), c1 = Math.floor((cr.x + cr.w / 2 + 0.3 - x0) / cell);
      const r0 = Math.floor((cr.z - cr.d / 2 - 0.3 - z0) / cell), r1 = Math.floor((cr.z + cr.d / 2 + 0.3 - z0) / cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && r < rows && c >= 0 && c < cols) walk[r * cols + c] = 0;
    }
  }
  // Props and railings are added to the map after init(), so the grid has to be told about
  // them or bots path straight into a bush and stall there. Cells are only cleared when the
  // result stays connected - a prop must never be able to sever the map.
  function blockObstacles(mapObj) {
    if (!walk) return null;
    const before = walk.slice();
    const flood = (grid) => {
      const seen = new Uint8Array(cols * rows);
      const sp = VAL.MapData.spawns.att[0];
      const [sc, sr] = toCell(sp.x, sp.z);
      let seed = (sc >= 0 && sr >= 0 && sc < cols && sr < rows && grid[sr * cols + sc]) ? sr * cols + sc : -1;
      if (seed < 0) { for (let i = 0; i < grid.length; i++) if (grid[i]) { seed = i; break; } }
      if (seed < 0) return { seen, n: 0 };
      const stack = [seed]; seen[seed] = 1; let n = 0;
      while (stack.length) {
        const i = stack.pop(); n++;
        const c = i % cols, r = (i / cols) | 0;
        if (c > 0 && grid[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
        if (c < cols - 1 && grid[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
        if (r > 0 && grid[i - cols] && !seen[i - cols]) { seen[i - cols] = 1; stack.push(i - cols); }
        if (r < rows - 1 && grid[i + cols] && !seen[i + cols]) { seen[i + cols] = 1; stack.push(i + cols); }
      }
      return { seen, n };
    };
    const cellsOf = (bx0, bz0, bx1, bz1, pad) => {
      const out = [];
      const c0 = Math.floor((bx0 - pad - x0) / cell), c1 = Math.floor((bx1 + pad - x0) / cell);
      const r0 = Math.floor((bz0 - pad - z0) / cell), r1 = Math.floor((bz1 + pad - z0) / cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
        if (r >= 0 && r < rows && c >= 0 && c < cols && walk[r * cols + c]) out.push(r * cols + c);
      return out;
    };
    // one entry per obstacle, so a single badly placed prop can be skipped on its own
    const obstacles = [];
    for (const cr of (mapObj.crates || [])) {
      if (cr.y1 - cr.y0 < 0.35) continue;                 // a kerb is not an obstacle
      obstacles.push(cellsOf(cr.x0, cr.z0, cr.x1, cr.z1, 0.15));
    }
    for (const rl of (mapObj.rails || [])) {
      const cells = [];
      const steps = Math.max(2, Math.ceil(rl.len / (cell * 0.7)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = rl.x0 + (rl.x1 - rl.x0) * t, z = rl.z0 + (rl.z1 - rl.z0) * t;
        for (const q of cellsOf(x, z, x, z, 0.12)) cells.push(q);
      }
      obstacles.push(cells);
    }
    const baseline = flood(before).n;
    // fast path: if blocking everything keeps the map connected, keep it all
    for (const cells of obstacles) for (const i of cells) walk[i] = 0;
    let skipped = 0;
    if (flood(walk).n < baseline * 0.985) {
      // otherwise add them back one at a time and drop whichever ones sever the map
      walk.set(before);
      for (const cells of obstacles) {
        const saved = cells.map(i => walk[i]);
        for (const i of cells) walk[i] = 0;
        if (flood(walk).n < baseline * 0.985) { cells.forEach((i, k) => { walk[i] = saved[k]; }); skipped++; }
      }
    }
    // isolated pockets left behind are harmless, but bots should not be sent into them
    const post = flood(walk);
    let pockets = 0;
    for (let i = 0; i < walk.length; i++) if (walk[i] && !post.seen[i]) { walk[i] = 0; pockets++; }
    let blocked = 0;
    for (let i = 0; i < walk.length; i++) if (before[i] && !walk[i]) blocked++;
    for (const k in areaCache) delete areaCache[k];
    return { obstacles: obstacles.length, skipped, blocked, pockets, reachable: post.n, baseline };
  }

  function toCell(x, z) { return [Math.floor((x - x0) / cell), Math.floor((z - z0) / cell)]; }
  function cellCenter(c, r) { return { x: x0 + (c + 0.5) * cell, z: z0 + (r + 0.5) * cell }; }
  function walkable(x, z) { const [c, r] = toCell(x, z); if (c < 0 || r < 0 || c >= cols || r >= rows) return false; return walk[r * cols + c] === 1; }
  function nearestWalkable(x, z, maxR) {
    maxR = maxR || 12;
    const [c, r] = toCell(x, z);
    if (walkable(x, z)) return { x, z };
    for (let rad = 1; rad <= maxR; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        if (walk[rr * cols + cc]) return cellCenter(cc, rr);
      }
    }
    return null;
  }
  // can move between adjacent cells i -> j ? (height rules: step up <= 0.6, step down <= 0.6 unless drop allowed)
  function linkOK(i, j, c1, r1) {
    if (!walk[j]) return false;
    const dh = hgt[j] - hgt[i];
    if (dh > 0.6) return false;
    if (dh < -0.6) {
      // drop: allowed only inside drop rects
      const p = cellCenter(c1, r1);
      for (const d of VAL.MapData.drops) if (p.x >= d.x0 - 0.6 && p.x <= d.x1 + 0.6 && p.z >= d.z0 - 0.6 && p.z <= d.z1 + 0.6) return true;
      return false;
    }
    return true;
  }
  // Also a step segment of kind 'wall' with small dh (<=0.6) is walkable; doors closed block; handled by caller's dynamic blocking
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  function findPath(ax, az, bx, bz, opts) {
    opts = opts || {};
    const s = nearestWalkable(ax, az), e = nearestWalkable(bx, bz);
    if (!s || !e) return null;
    const [sc, sr] = toCell(s.x, s.z), [ec, er] = toCell(e.x, e.z);
    const start = sr * cols + sc, goal = er * cols + ec;
    if (start === goal) return [{ x: bx, z: bz }];
    const blocked = opts.blocked || null; // Set of cell indices blocked dynamically (closed doors, barriers)
    const gScore = new Float32Array(cols * rows).fill(1e9);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    // binary heap
    const heap = []; const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const h = i => { const c = i % cols, r = (i / cols) | 0; const dc = Math.abs(c - ec), dr = Math.abs(r - er); return (Math.max(dc, dr) + 0.414 * Math.min(dc, dr)) * cell; };
    gScore[start] = 0; push(h(start), start);
    let found = false, iter = 0;
    const avoid = opts.avoid; // function(cellIndex)->extra cost
    while (heap.length && iter++ < 60000) {
      const [f, i] = pop();
      if (closed[i]) continue; closed[i] = 1;
      if (i === goal) { found = true; break; }
      const c = i % cols, r = (i / cols) | 0;
      for (const [dc, dr, w] of DIRS) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (closed[j] || !walk[j]) continue;
        if (dc && dr) { if (!walk[r * cols + cc] || !walk[rr * cols + c]) continue; } // no corner cutting
        if (!linkOK(i, j, cc, rr)) continue;
        if (blocked && blocked.has(j)) continue;
        let cost = w * cell;
        if (avoid) cost += avoid(j, cc, rr);
        const ng = gScore[i] + cost;
        if (ng < gScore[j]) { gScore[j] = ng; came[j] = i; push(ng + h(j), j); }
      }
    }
    if (!found) return null;
    const path = []; let cur = goal;
    while (cur !== -1) { const c = cur % cols, r = (cur / cols) | 0; path.push(cellCenter(c, r)); cur = came[cur]; }
    path.reverse();
    // end exactly on the requested point only if it is walkable; otherwise stop at the nearest walkable cell
    if (walkable(bx, bz)) path[path.length - 1] = { x: bx, z: bz };
    return smooth(path);
  }
  // string-pulling: remove waypoints when a straight (walkable) line exists
  function smooth(path) {
    if (path.length < 3) return path;
    const out = [path[0]]; let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !clearLine(path[i], path[j])) j--;
      out.push(path[j]); i = j;
    }
    return out;
  }
  function clearLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z); const n = Math.ceil(d / (cell * 0.5));
    let prevH = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const [c, r] = toCell(x, z);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
      const idx = r * cols + c; if (!walk[idx]) return false;
      const hh = hgt[idx]; if (prevH !== null && Math.abs(hh - prevH) > 0.6) return false; prevH = hh;
    }
    if (map && map.segmentBlocked && map.segmentBlocked(a.x, a.z, b.x, b.z)) return false;
    return true;
  }
  function cellsInSegment(x1, z1, x2, z2, radius) {
    // cells touched by a thick segment (for dynamic blocking of doors/barriers)
    const set = new Set(); const d = Math.hypot(x2 - x1, z2 - z1); const n = Math.ceil(d / (cell * 0.5)) + 1;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      for (let dx = -radius; dx <= radius; dx += cell) for (let dz = -radius; dz <= radius; dz += cell) {
        const [c, r] = toCell(x + dx, z + dz); if (c >= 0 && r >= 0 && c < cols && r < rows) set.add(r * cols + c);
      }
    }
    return set;
  }
  function areaAt(x, z) {
    const [c, r] = toCell(x, z); if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    let a = area[r * cols + c];
    if (a === 255) { // search neighbours
      for (let rad = 1; rad < 6 && a === 255; rad++) for (let dr = -rad; dr <= rad && a === 255; dr++) for (let dc = -rad; dc <= rad; dc++) { const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue; const v = area[rr * cols + cc]; if (v !== 255) { a = v; break; } }
    }
    if (a === 255) return null;
    return N.areaNames[a];
  }
  function randomPointInArea(name) {
    const idx = N.areaNames.indexOf(name); if (idx < 0) return null;
    if (!areaCache[name]) { const list = []; for (let i = 0; i < cols * rows; i++) if (walk[i] && area[i] === idx) list.push(i); areaCache[name] = list; }
    const list = areaCache[name]; if (!list.length) return null;
    const i = list[Math.floor(Math.random() * list.length)];
    return cellCenter(i % cols, (i / cols) | 0);
  }
  function heightAtCell(x, z) { const [c, r] = toCell(x, z); if (c < 0 || r < 0 || c >= cols || r >= rows) return 0; return hgt[r * cols + c]; }
  return { init, blockObstacles, findPath, walkable, nearestWalkable, areaAt, randomPointInArea, clearLine, cellsInSegment, toCell, cellCenter, heightAtCell, get cols() { return cols; }, get rows() { return rows; } };
})();
