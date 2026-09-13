// Scenery part 2: out-of-bounds Venetian surroundings, campanile, basilica, island cliff, and the prop library.
window.VAL = window.VAL || {};
(function () {
  const S = VAL.Scenery = VAL.Scenery || {};
  const TILE = 2;
  const FALL = { plaster_cream: 0xe9dcc4, plaster_white: 0xf1ece2, plaster_terracotta: 0xd9927a, plaster_ochre: 0xd8b26a, plaster_rose: 0xc98a86, stone_block: 0xc2b8a6, stone_grey: 0x9d9a94, brick_red: 0xa8523e, roof_tile: 0xb5563d, wood_plank: 0xa67c52, wood_dark: 0x5a3d2a, wood_crate: 0xb08858, metal_dark: 0x2b2e33, metal_painted_green: 0x2f7d73, metal_painted_red: 0x9a2b2b, metal_rust: 0x7a4a2a, concrete: 0x9b9892, marble_white: 0xece8e0, grass: 0x5f8a3a, water: 0x6fb7d6, canvas_striped: 0xd94b4b, fabric_red: 0x8f2a2e, glass: 0xbfe0ee };
  const cache = {};
  function mat(name, opts) {
    const key = name + JSON.stringify(opts || {}); if (cache[key]) return cache[key];
    let m = null;
    if (VAL.Textures && VAL.Textures.material) { try { m = VAL.Textures.material(name, opts || {}); } catch (e) { m = null; } }
    if (!m) m = new THREE.MeshStandardMaterial({ color: FALL[name] || 0xaaaaaa, roughness: 0.85, metalness: name.startsWith('metal') ? 0.6 : 0.05, transparent: name === 'glass' || name === 'water', opacity: name === 'glass' ? 0.35 : name === 'water' ? 0.8 : 1 });
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
  function mesh(geo, m, cast) { const ms = new THREE.Mesh(geo, m); ms.castShadow = cast !== false; ms.receiveShadow = true; return ms; }
  function grp() { return new THREE.Group(); }
  function add(parent, geo, name, x, y, z, ry, cast) { const ms = mesh(geo, mat(name), cast); ms.position.set(x || 0, y || 0, z || 0); if (ry) ms.rotation.y = ry; parent.add(ms); return ms; }
  const rand = (a, b) => a + Math.random() * (b - a);

  // ================= PROPS =================
  const props = {};
  props.crate = function (w, h, d, kind) {
    const g = grp(); const m = kind === 'metal' ? 'metal_dark' : kind === 'green' ? 'metal_painted_green' : kind === 'red' ? 'metal_painted_red' : 'wood_crate';
    const body = add(g, bx(w, h, d, 0, h / 2, 0), m);
    if (kind === 'wood' || !kind) { // edge battens
      const bt = 'wood_dark'; const t = 0.06;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, bx(t, h, t, sx * (w / 2 - t / 2), h / 2, sz * (d / 2 - t / 2)), bt);
      for (const sy of [0.04, h - 0.04]) { add(g, bx(w, t, t, 0, sy, d / 2 - t / 2), bt); add(g, bx(w, t, t, 0, sy, -d / 2 + t / 2), bt); add(g, bx(t, t, d, w / 2 - t / 2, sy, 0), bt); add(g, bx(t, t, d, -w / 2 + t / 2, sy, 0), bt); }
    } else { // metal ribs + hazard label
      for (const sy of [h * 0.3, h * 0.7]) add(g, bx(w + 0.02, 0.05, d + 0.02, 0, sy, 0), kind === 'metal' ? 'metal_painted_red' : 'metal_dark');
      add(g, bx(Math.min(w * 0.5, 0.8), Math.min(h * 0.3, 0.4), 0.01, 0, h * 0.5, d / 2 + 0.006), 'metal_painted_red');
    }
    return g;
  };
  props.barrel = function () { const g = grp(); const b = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), mat('metal_rust')); b.position.y = 0.45; g.add(b); for (const y of [0.2, 0.7]) { const r = mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.04, 14), mat('metal_dark')); r.position.y = y; g.add(r); } return g; };
  props.sandbags = function () { const g = grp(); const m = mat('canvas_striped', { color: 0xa89a78 }); const sb = new THREE.MeshStandardMaterial({ color: 0xa89a78, roughness: 1 }); for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - (r % 2); i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), sb); s.scale.set(1.2, 0.55, 0.8); s.position.set((i - (3 - r % 2) / 2) * 0.6, 0.17 + r * 0.3, 0); s.castShadow = true; g.add(s); } return g; };
  props.bench = function () { const g = grp(); add(g, bx(1.8, 0.06, 0.45, 0, 0.45, 0), 'wood_plank'); add(g, bx(1.8, 0.4, 0.05, 0, 0.7, -0.2), 'wood_plank'); for (const x of [-0.75, 0.75]) { add(g, bx(0.08, 0.45, 0.4, x, 0.22, 0), 'metal_dark'); add(g, bx(0.08, 0.5, 0.06, x, 0.7, -0.2), 'metal_dark'); } return g; };
  props.lamp = function (h) { h = h || 4; const g = grp(); const p = mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 8), mat('metal_dark')); p.position.y = h / 2; g.add(p); const base = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 8), mat('metal_dark')); base.position.y = 0.15; g.add(base); const head = mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), mat('metal_dark')); head.position.y = h + 0.2; g.add(head); const glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd080, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 })); glass.position.y = h + 0.18; g.add(glass); const cap = mesh(new THREE.ConeGeometry(0.35, 0.25, 4), mat('metal_dark')); cap.position.y = h + 0.55; cap.rotation.y = Math.PI / 4; g.add(cap); return g; };
  props.planter = function (w) { w = w || 1.4; const g = grp(); add(g, bx(w, 0.5, 0.6, 0, 0.25, 0), 'stone_block'); add(g, bx(w - 0.16, 0.05, 0.44, 0, 0.5, 0), 'grass', 0, false); for (let i = 0; i < 3; i++) { const b = mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4f7d34, roughness: 1 })); b.position.set((i - 1) * w * 0.3, 0.68, 0); g.add(b); } return g; };
  props.tree = function (kind, size) { size = size || 1; const g = grp(); const trunk = mesh(new THREE.CylinderGeometry(0.14 * size, 0.22 * size, 2.6 * size, 8), mat('wood_dark')); trunk.position.y = 1.3 * size; g.add(trunk); const leaf = new THREE.MeshStandardMaterial({ color: 0x5a8f3c, roughness: 0.95 }); for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry((0.9 + Math.random() * 0.5) * size, 1), leaf); s.position.set((Math.random() - 0.5) * 1.8 * size, (2.8 + Math.random() * 1.4) * size, (Math.random() - 0.5) * 1.8 * size); s.castShadow = true; g.add(s); } for (let i = 0; i < 3; i++) { const br = mesh(new THREE.CylinderGeometry(0.05 * size, 0.09 * size, 1.4 * size, 6), mat('wood_dark')); br.position.set(0, 2.6 * size, 0); br.rotation.set(Math.random() * 0.8 - 0.4, i * 2.1, 0.6); g.add(br); } return g; };
  props.cypress = function (h) { h = h || 6; const g = grp(); const trunk = mesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 6), mat('wood_dark')); trunk.position.y = 0.5; g.add(trunk); const leaf = new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 1 }); const c = new THREE.Mesh(new THREE.ConeGeometry(0.7, h, 8), leaf); c.position.y = h / 2 + 0.6; c.castShadow = true; g.add(c); const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, h * 0.5, 8), leaf); c2.position.y = h * 0.25 + 0.7; g.add(c2); return g; };
  props.bush = function () { const g = grp(); const leaf = new THREE.MeshStandardMaterial({ color: 0x4f7d34, roughness: 1 }); for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + Math.random() * 0.2, 1), leaf); s.position.set((Math.random() - 0.5) * 0.7, 0.4, (Math.random() - 0.5) * 0.7); s.castShadow = true; g.add(s); } return g; };
  // striped canvas, cached per colour - a flat saturated plane at head height reads as a glitch
  const _awnTex = {};
  function awningTexture(color) {
    const key = String(color);
    if (_awnTex[key]) return _awnTex[key];
    const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
    const col = '#' + (color >>> 0).toString(16).padStart(6, '0');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f1ebdf' : col; g.fillRect(i * 32, 0, 32, 32); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    _awnTex[key] = t; return t;
  }
  props.awning = function (w, color) { w = w || 3; const g = grp(); const m = new THREE.MeshStandardMaterial({ map: awningTexture(color || 0xb8473f), roughness: 0.92, side: THREE.DoubleSide }); const c = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.4), m); c.rotation.x = -Math.PI / 2 + 0.5; c.position.set(0, 2.6, -0.6); c.castShadow = true; g.add(c); for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) { const bar = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), mat('metal_dark')); bar.rotation.x = 0.5; bar.position.set(x, 2.6, -0.6); g.add(bar); } return g; };
  props.railing = function (len, h) { len = len || 2; h = h || 1.1; const g = grp(); const n = Math.max(2, Math.round(len / 1.4)); for (let i = 0; i <= n; i++) add(g, bx(0.06, h, 0.06, -len / 2 + i * len / n, h / 2, 0), 'metal_dark'); add(g, bx(len, 0.05, 0.08, 0, h, 0), 'metal_dark'); add(g, bx(len, 0.04, 0.04, 0, h * 0.5, 0), 'metal_dark'); return g; };
  props.scaffold = function (w, h, d) { w = w || 3; h = h || 4; d = d || 1.2; const g = grp(); for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, bx(0.06, h, 0.06, sx * w / 2, h / 2, sz * d / 2), 'metal_dark'); for (let lvl = 1; lvl <= Math.floor(h / 2); lvl++) { const y = lvl * 2; add(g, bx(w, 0.05, d, 0, y, 0), 'wood_plank'); add(g, bx(w, 0.04, 0.04, 0, y + 1, d / 2), 'metal_dark'); add(g, bx(w, 0.04, 0.04, 0, y + 1, -d / 2), 'metal_dark'); } add(g, bx(w, 0.05, 0.05, 0, h * 0.4, d / 2, 0), 'metal_dark'); return g; };
  props.archway = function (w, h, depth) { w = w || 3; h = h || 3.6; depth = depth || 0.6; const g = grp(); add(g, bx(0.4, h - w / 2, depth, -w / 2 - 0.2, (h - w / 2) / 2, 0), 'stone_block'); add(g, bx(0.4, h - w / 2, depth, w / 2 + 0.2, (h - w / 2) / 2, 0), 'stone_block'); const arc = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.2, 0.2, 8, 16, Math.PI), mat('stone_block')); arc.position.y = h - w / 2; g.add(arc); add(g, bx(w + 0.8, 0.3, depth + 0.1, 0, h + 0.35, 0), 'stone_block'); return g; };
  props.pillar = function (h, r) { h = h || 4; r = r || 0.3; const g = grp(); const p = mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 12), mat('marble_white')); p.position.y = h / 2; g.add(p); add(g, bx(r * 2.6, 0.2, r * 2.6, 0, 0.1, 0), 'marble_white'); add(g, bx(r * 2.6, 0.2, r * 2.6, 0, h - 0.1, 0), 'marble_white'); return g; };
  props.fountain = function (r) { r = r || 1.6; const g = grp(); const basin = mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.6, 20), mat('stone_block')); basin.position.y = 0.3; g.add(basin); const water = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.05, 20), mat('water')); water.position.y = 0.55; g.add(water); const col = mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.2, 10), mat('stone_block')); col.position.y = 1.1; g.add(col); const top = mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.2, 14), mat('stone_block')); top.position.y = 1.7; g.add(top); const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 14), mat('water')); w2.position.y = 1.82; g.add(w2); return g; };
  props.well = function () { const g = grp(); const ring = mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.9, 14), mat('stone_block')); ring.position.y = 0.45; g.add(ring); const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0x111 })); hole.position.y = 0.9; g.add(hole); for (const x of [-0.7, 0.7]) add(g, bx(0.1, 2, 0.1, x, 1.9, 0), 'wood_dark'); add(g, bx(1.8, 0.1, 0.1, 0, 2.9, 0), 'wood_dark'); const roof = mesh(new THREE.ConeGeometry(1.2, 0.6, 4), mat('roof_tile')); roof.position.y = 3.2; roof.rotation.y = Math.PI / 4; g.add(roof); return g; };
  props.wineRack = function () { const g = grp(); add(g, bx(1.6, 1.4, 0.6, 0, 0.7, 0), 'wood_dark'); for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) { const b = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.62, 10), mat('wood_plank')); b.rotation.x = Math.PI / 2; b.position.set(-0.6 + i * 0.4, 0.25 + r * 0.45, 0); g.add(b); } return g; };
  props.gelatoStand = function () { const g = grp(); add(g, bx(2.2, 1.0, 0.9, 0, 0.5, 0), 'plaster_white'); add(g, bx(2.3, 0.08, 1.0, 0, 1.04, 0), 'marble_white'); const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.8), mat('glass')); glass.position.set(0, 1.33, 0); g.add(glass); const cols = [0xf5a3b8, 0xfff2b0, 0xa6d8a0, 0x8b5a3c, 0xffffff]; for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 10), new THREE.MeshStandardMaterial({ color: cols[i] })); t.position.set(-0.8 + i * 0.4, 1.18, 0); g.add(t); } const awn = props.awning(2.4, 0xb8473f); awn.position.set(0, 0, 0.1); g.add(awn); return g; };
  props.pizzaOven = function () { const g = grp(); add(g, bx(1.8, 1.0, 1.6, 0, 0.5, 0), 'brick_red'); const dome = mesh(new THREE.SphereGeometry(0.8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('plaster_cream')); dome.position.y = 1.0; g.add(dome); const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), new THREE.MeshStandardMaterial({ color: 0x1a0a05, emissive: 0xff5a1a, emissiveIntensity: 0.8 })); mouth.position.set(0, 1.25, 0.78); g.add(mouth); const chim = mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), mat('brick_red')); chim.position.set(0, 2.1, -0.3); g.add(chim); return g; };
  props.marketStall = function () { const g = grp(); add(g, bx(2.4, 0.9, 1.0, 0, 0.45, 0), 'wood_plank'); for (const x of [-1.1, 1.1]) add(g, bx(0.08, 2.4, 0.08, x, 1.2, -0.45), 'wood_dark'); const awn = props.awning(2.6, 0x3a7d5c); awn.position.set(0, -0.2, 0.3); g.add(awn); const fruit = [0xd93a2b, 0xf0b62a, 0x6fbf3a]; for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: fruit[i % 3] })); f.position.set(-0.8 + (i % 3) * 0.8, 1.0, -0.3 + Math.floor(i / 3) * 0.3); g.add(f); } return g; };
  props.doorFrame = function (w, h) { w = w || 2; h = h || 3; const g = grp(); add(g, bx(0.2, h, 0.3, -w / 2 - 0.1, h / 2, 0), 'stone_block'); add(g, bx(0.2, h, 0.3, w / 2 + 0.1, h / 2, 0), 'stone_block'); add(g, bx(w + 0.4, 0.25, 0.35, 0, h + 0.12, 0), 'stone_block'); return g; };
  props.mechDoor = function (w, h) {
    w = w || 3.2; h = h || 3.5; const g = grp(); const pw = w / 2 + 0.05;
    const mk = () => { const p = grp(); add(p, bx(pw, h, 0.28, 0, h / 2, 0), 'metal_painted_green'); for (let i = 0; i < 3; i++) add(p, bx(pw - 0.2, 0.1, 0.3, 0, 0.6 + i * (h - 1.2) / 2, 0), 'metal_dark'); add(p, bx(pw - 0.3, 0.35, 0.29, 0, h * 0.5, 0), 'metal_painted_red'); const stripe = new THREE.Mesh(new THREE.BoxGeometry(pw - 0.3, 0.35, 0.3), new THREE.MeshStandardMaterial({ color: 0xf2c23a })); stripe.position.set(0, h * 0.5, 0); stripe.scale.set(0.5, 1, 1.02); p.add(stripe); return p; };
    const left = mk(), right = mk(); left.position.x = -pw / 2; right.position.x = pw / 2; g.add(left, right);
    add(g, bx(w + 1.0, 0.5, 0.7, 0, h + 0.25, 0), 'metal_dark');
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a1a, emissiveIntensity: 1.2 })); light.position.set(0, h + 0.55, 0.3); g.add(light);
    return { group: g, setOpen: t => { left.position.x = -pw / 2 - t * pw; right.position.x = pw / 2 + t * pw; light.material.emissiveIntensity = t < 0.98 ? 1.2 + Math.sin(performance.now() / 120) : 0.3; } };
  };
  props.generatorBox = function () { const g = grp(); add(g, bx(6, 2.2, 1.9, 0, 1.1, 0), 'metal_dark'); for (const x of [-2.2, -0.7, 0.8, 2.3]) add(g, bx(0.9, 1.4, 0.05, x, 1.2, 0.97), 'metal_painted_green'); add(g, bx(6.1, 0.25, 2.0, 0, 2.2, 0), 'metal_painted_red'); for (const x of [-2.5, 2.5]) add(g, bx(0.6, 0.6, 0.6, x, 2.5, 0), 'metal_dark'); const yel = new THREE.MeshStandardMaterial({ color: 0xf2c23a }); const st = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.15, 0.02), yel); st.position.set(0, 0.4, 0.96); g.add(st); return g; };
  props.ledgeCap = function (len) { const g = grp(); add(g, bx(len, 0.12, 0.5, 0, 0.06, 0), 'marble_white'); return g; };
  S.props = props;

  // ================= SURROUNDINGS =================
  S.buildSurroundings = function (scene, bounds) {
    const group = new THREE.Group(); group.name = 'surroundings'; group.userData.batchable = true; scene.add(group);
    const byMat = {}; const push = (name, geo) => (byMat[name] = byMat[name] || []).push(geo);
    const plasters = ['plaster_cream', 'plaster_white', 'plaster_terracotta', 'plaster_ochre', 'plaster_rose', 'brick_red'];
    const inside = (x, z, m) => x > bounds.minX - m && x < bounds.maxX + m && z > bounds.minZ - m && z < bounds.maxZ + m;
    const isFloorNear = (x, z, r) => { if (!VAL.MapData) return false; const o = VAL.MapData.outline; for (let dx = -r; dx <= r; dx += r) for (let dz = -r; dz <= r; dz += r) if (VAL.U.pointInPoly(x + dx, z + dz, o)) return true; return false; };
    function building(x, z, w, d, h, ry, matName) {
      push(matName, bx(w, h, d, x, h / 2, z, ry));
      // roof: hipped (4-sided cone scaled) + eaves slab
      const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.72, Math.min(w, d) * 0.45 + 1.2, 4); roof.rotateY(Math.PI / 4 + (ry || 0)); roof.scale(w / Math.max(w, d), 1, d / Math.max(w, d)); roof.translate(x, h + (Math.min(w, d) * 0.45 + 1.2) / 2 - 0.05, z);
      const uv = roof.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TILE * 2, uv.getY(i) * d / TILE * 2);
      push('roof_tile', roof);
      push('stone_grey', bx(w + 0.6, 0.3, d + 0.6, x, h - 0.15, z, ry));
      // windows + shutters
      const cos = Math.cos(ry || 0), sin = Math.sin(ry || 0);
      const floors = Math.max(1, Math.floor((h - 1.5) / 3.2));
      for (let f = 0; f < floors; f++) {
        const wy = 2.2 + f * 3.2; const nx = Math.max(1, Math.floor(w / 3.2)), nz = Math.max(1, Math.floor(d / 3.2));
        for (let i = 0; i < nx; i++) { const lx = -w / 2 + (i + 0.5) * w / nx; for (const s of [1, -1]) { const lz = s * (d / 2 + 0.02); const wx = x + lx * cos + lz * sin, wz = z - lx * sin + lz * cos; push('_window', bx(1.0, 1.6, 0.1, wx, wy, wz, ry)); push('wood_dark', bx(0.4, 1.65, 0.06, wx + 0.75 * cos, wy, wz - 0.75 * sin, ry)); push('wood_dark', bx(0.4, 1.65, 0.06, wx - 0.75 * cos, wy, wz + 0.75 * sin, ry)); } }
        for (let i = 0; i < nz; i++) { const lz = -d / 2 + (i + 0.5) * d / nz; for (const s of [1, -1]) { const lx = s * (w / 2 + 0.02); const wx = x + lx * cos + lz * sin, wz = z - lx * sin + lz * cos; push('_window', bx(0.1, 1.6, 1.0, wx, wy, wz, ry)); } }
      }
      // chimney
      if (Math.random() < 0.6) push('brick_red', bx(0.7, 1.6, 0.7, x + (Math.random() - 0.5) * w * 0.5, h + 1.2, z + (Math.random() - 0.5) * d * 0.5, ry));
    }
    // ring of buildings around the bounds (two rows), skipping spots that overlap the playable floor
    const margin = 3.5; const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    const rows = [[margin, 9], [margin + 14, 11]];
    for (const [off, depth] of rows) {
      const x0 = bounds.minX - off - depth / 2, x1 = bounds.maxX + off + depth / 2, z0 = bounds.minZ - off - depth / 2, z1 = bounds.maxZ + off + depth / 2;
      const along = (ax, az, bxx, bz) => { const len = Math.hypot(bxx - ax, bz - az); let t = 0; while (t < len) { const w = 7 + Math.random() * 7; const tt = t + w / 2; if (tt > len) break; const px = ax + (bxx - ax) * tt / len, pz = az + (bz - az) * tt / len; if (!isFloorNear(px, pz, depth / 2 + 1)) { const h = 7 + Math.random() * 7; const ry = Math.abs(bxx - ax) > Math.abs(bz - az) ? 0 : Math.PI / 2; building(px, pz, ry === 0 ? w : depth, ry === 0 ? depth : w, h, 0, plasters[(Math.random() * plasters.length) | 0]); } t += w + 1.5 + Math.random() * 3; } };
      along(x0, z0, x1, z0); along(x0, z1, x1, z1); along(x0, z0, x0, z1); along(x1, z0, x1, z1);
    }
    // inner-void rooftop dressing: chimneys & antennas on the map's own buildings for skyline variety
    if (VAL.MapData) for (const v of VAL.MapData.voids) { let ax = 0, az = 0; for (const p of v) { ax += p[0]; az += p[1]; } ax /= v.length; az /= v.length; if (VAL.U.pointInPoly(ax, az, v)) push('brick_red', bx(0.6, 1.4, 0.6, ax, 7.6, az)); }
    // campanile on the Bell Tower block
    let bell = null; if (VAL.MapData && VAL.MapData.landmarks) bell = VAL.MapData.landmarks.find(l => l.t === 'BELL');
    const bx0 = bell ? bell.x : 12, bz0 = bell ? bell.z - 2 : -14;
    push('brick_red', bx(6, 34, 6, bx0, 17, bz0)); push('marble_white', bx(6.6, 5, 6.6, bx0, 36.5, bz0));
    for (const [dx, dz] of [[2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]]) for (let i = -1; i <= 1; i++) push('_window', bx(dz ? 1.2 : 0.3, 3.2, dx ? 1.2 : 0.3, bx0 + dx + (dz ? i * 1.7 : 0), 36.5, bz0 + dz + (dx ? i * 1.7 : 0)));
    const spire = new THREE.ConeGeometry(4.2, 9, 4); spire.rotateY(Math.PI / 4); spire.translate(bx0, 43.5, bz0); push('metal_painted_green', spire);
    const orb = new THREE.SphereGeometry(0.6, 10, 8); orb.translate(bx0, 48.5, bz0); push('_gold', orb);
    push('brick_red', bx(7, 1.5, 7, bx0, 39.5, bz0));
    // basilica dome behind defender spawn
    const dcx = 30, dcz = bounds.minZ - 22;
    push('marble_white', bx(30, 14, 22, dcx, 7, dcz)); push('marble_white', bx(34, 2, 26, dcx, 14.5, dcz));
    const drum = new THREE.CylinderGeometry(9, 9, 6, 24); drum.translate(dcx, 18.5, dcz); push('marble_white', drum);
    const dome = new THREE.SphereGeometry(9.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(dcx, 21.5, dcz); push('_dome', dome);
    const lant = new THREE.CylinderGeometry(2, 2.4, 4, 12); lant.translate(dcx, 32.5, dcz); push('marble_white', lant);
    const lc = new THREE.ConeGeometry(2.6, 3, 12); lc.translate(dcx, 36, dcz); push('_dome', lc);
    for (let i = 0; i < 7; i++) { const px = dcx - 12 + i * 4; push('marble_white', bx(1.2, 12, 1.2, px, 6, dcz + 11.5)); }
    for (const sx of [-1, 1]) { const st = new THREE.CylinderGeometry(3, 3, 8, 16); st.translate(dcx + sx * 13, 19, dcz); push('marble_white', st); const sd = new THREE.SphereGeometry(3.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); sd.translate(dcx + sx * 13, 23, dcz); push('_dome', sd); }
    // island cliff skirt under the map
    if (VAL.MapData) {
      const shape = new THREE.Shape(VAL.MapData.outline.map(p => new THREE.Vector2(p[0], p[1])));
      const rock = new THREE.ExtrudeGeometry(shape, { depth: 38, bevelEnabled: true, bevelThickness: 10, bevelSize: 6, bevelSegments: 3, steps: 1 });
      rock.rotateX(Math.PI / 2); rock.translate(0, -1.4 - 10, 0); // bevel (10) sits above the shape plane: push the whole skirt below the floor
      rock.scale(1.06, 1, 1.06); rock.translate(-cx * 0.06, 0, -cz * 0.06);
      // jitter vertices for a rocky look
      const pos = rock.getAttribute('position'); for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < -2) { pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 3); pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 3); pos.setY(i, y - Math.random() * 6); } }
      rock.computeVertexNormals(); push('_rock', rock);
      for (let i = 0; i < 14; i++) { const ch = new THREE.IcosahedronGeometry(2 + Math.random() * 4, 0); const a = Math.random() * Math.PI * 2; const r = 60 + Math.random() * 30; ch.translate(cx + Math.cos(a) * r, -30 - Math.random() * 40, cz + Math.sin(a) * r); push('_rock', ch); }
    }
    const special = { _window: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.4, metalness: 0.2 }), _gold: new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: 0.9, roughness: 0.3 }), _dome: new THREE.MeshStandardMaterial({ color: 0x8fa9a0, roughness: 0.6, metalness: 0.3 }), _rock: new THREE.MeshStandardMaterial({ color: 0x5b5148, roughness: 1, flatShading: true }) };
    for (const name in byMat) { const m = special[name] || mat(name); const ms = new THREE.Mesh(mergeGeoms(byMat[name]), m); ms.castShadow = name !== '_rock'; ms.receiveShadow = true; ms.name = 'sur_' + name; group.add(ms); }
    return group;
  };
})();
