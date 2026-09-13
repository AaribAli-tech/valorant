// Agent characters v4: Quaternius Universal Base Characters (CC0) - a real sculpted human
// with a textured face, eyes and brows - dressed by growing fitted garment shells off the
// body mesh itself, so clothing skins with the body instead of floating over it.
//
// Public API is unchanged from the earlier character modules:
//   VAL.Characters.preload()       -> Promise, must resolve before build()
//   VAL.Characters.build(id, opts) -> Character
//   char.group / char.weaponMount / char.hitboxes / char.update(dt, state)
//   char.setOutline(color) / char.reset() / char.dispose() / char.seat(weapon)
window.VAL = window.VAL || {};
(function () {
  const U = VAL.U;

  const AGENTS = {
    jett:      { name: 'Jett', role: 'Duelist', female: true, skin: 0xf0cdb0, hair: 0xf2f2f4, top: 0xeef1f5, top2: 0x8fc4e0, pants: 0x2f4055, boots: 0xdfe3e8, gloves: 0x2e4f93, accent: 0x5fc9e8, hairStyle: 'bob' },
    sage:      { name: 'Sage', role: 'Sentinel', female: true, skin: 0xf2d6c0, hair: 0x1a181f, top: 0x35946c, top2: 0xe8e4d8, pants: 0x2c4a3e, boots: 0x22242a, gloves: 0x2e4f93, accent: 0x7be3a8, hairStyle: 'bun' },
    sova:      { name: 'Sova', role: 'Initiator', skin: 0xe8c6a8, hair: 0xd8c27a, top: 0x35609e, top2: 0xc9a24a, pants: 0x35455e, boots: 0x3b2f24, gloves: 0x2e4f93, accent: 0x66c8ff, hairStyle: 'hood' },
    omen:      { name: 'Omen', role: 'Controller', skin: 0x4a4260, hair: 0x1a1533, top: 0x322858, top2: 0x453878, pants: 0x241e42, boots: 0x171327, gloves: 0x2e4f93, accent: 0x5a7dff, faceless: true, hairStyle: 'hood' },
    phoenix:   { name: 'Phoenix', role: 'Duelist', skin: 0x8a5d40, hair: 0xff8a2a, top: 0xf2f0ea, top2: 0xff7a1e, pants: 0x33353d, boots: 0x22242a, gloves: 0x2e4f93, accent: 0xff9a3c, hairStyle: 'spikes' },
    reyna:     { name: 'Reyna', role: 'Duelist', female: true, skin: 0xdcae8c, hair: 0x2a1633, top: 0x54297c, top2: 0x33203f, pants: 0x342546, boots: 0x2a1633, gloves: 0x2e4f93, accent: 0xc25be8, hairStyle: 'long' },
    killjoy:   { name: 'Killjoy', role: 'Sentinel', female: true, skin: 0xd9a578, hair: 0x6b4a2a, top: 0xf2c94c, top2: 0x36414f, pants: 0x3d4552, boots: 0x22242a, gloves: 0x2e4f93, accent: 0x3ad6b6, beanie: 0xf2c94c, glasses: true, hairStyle: 'beanie' },
    cypher:    { name: 'Cypher', role: 'Sentinel', skin: 0xc0937040 & 0xffffff, hair: 0x2a2a2a, top: 0xf1ede6, top2: 0xc0bab0, pants: 0x4c4c54, boots: 0x22242a, gloves: 0x2e4f93, accent: 0x53e3ff, hat: 0xf1ede6, mask: true, hairStyle: 'hat' },
    raze:      { name: 'Raze', role: 'Duelist', female: true, skin: 0x8a5a3e, hair: 0x2a1a12, top: 0xff9a2e, top2: 0xf2d24a, pants: 0x5c4d40, boots: 0x22242a, gloves: 0x2e4f93, accent: 0xff5a2a, bandana: 0xd9333a, hairStyle: 'bandana' },
    brimstone: { name: 'Brimstone', role: 'Controller', skin: 0xdcb08e, hair: 0x8f8a80, top: 0x74522e, top2: 0xd9762a, pants: 0x4e4e4a, boots: 0x22242a, gloves: 0x2e4f93, accent: 0xff8a2a, cap: 0xd9762a, beard: true, hairStyle: 'cap' },
    generic:   { name: 'Agent', role: 'Duelist', skin: 0xdcb08e, hair: 0x333338, top: 0x77808c, top2: 0x555c66, pants: 0x454b54, boots: 0x222226, gloves: 0x2e4f93, accent: 0x3ad6b6, hairStyle: 'short' }
  };
  AGENTS.cypher.skin = 0xc09370;

  // ---------------------------------------------------------------- roster icons
  function icon(id, d) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    const hex = v => '#' + (v >>> 0).toString(16).padStart(6, '0');
    g.fillStyle = hex(d.top2); g.fillRect(0, 0, 64, 64); g.fillStyle = hex(d.top); g.fillRect(0, 36, 64, 28);
    g.fillStyle = hex(d.skin); g.beginPath(); g.arc(32, 30, 13, 0, 6.28); g.fill();
    g.fillStyle = hex(d.hair);
    if (d.faceless) { g.beginPath(); g.arc(32, 30, 14, 0, 6.28); g.fill(); }
    else { g.beginPath(); g.arc(32, 25, 14, Math.PI, 0); g.fill(); }
    if (!d.faceless) { g.fillStyle = '#2b2b33'; g.fillRect(26, 30, 4, 3); g.fillRect(35, 30, 4, 3); }
    if (d.mask) { g.fillStyle = '#222'; g.fillRect(19, 27, 26, 13); g.fillStyle = hex(d.accent); g.fillRect(21, 32, 22, 2); }
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = 'bold 14px "Barlow Condensed", Arial'; g.textAlign = 'right';
    g.fillText(d.name[0], 60, 16);
    return c.toDataURL('image/png');
  }
  for (const id in AGENTS) {
    AGENTS[id].id = id;
    try { AGENTS[id].icon = icon(id, AGENTS[id]); } catch (e) { AGENTS[id].icon = ''; }
    AGENTS[id].colors = { primary: AGENTS[id].top, secondary: AGENTS[id].pants, accent: AGENTS[id].accent, hair: AGENTS[id].hair, skin: AGENTS[id].skin };
  }

  const matCache = {};
  function mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.82, metalness: 0.04 }, opts || {}));
    return matCache[key];
  }
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; return o; };
  const ball = (r, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); o.position.set(x || 0, y || 0, z || 0); if (sx !== undefined) o.scale.set(sx, sy, sz); o.castShadow = true; return o; };

  // ---------------------------------------------------------------- rig facts
  // Measured bone-local bounds of the Universal Base Character (metres). The model faces
  // +Z, head-local +Z is the face, and +Y runs DOWN the thigh and OUT along the foot.
  //   Head     x +-0.091  y -0.021..0.211  z -0.092..0.131
  //   spine_02 x +-0.159  y -0.003..0.137  z -0.139..0.114
  //   pelvis   x +-0.157  y -0.057..0.141  z -0.120..0.135
  //   thigh_r  x -0.081..0.107  y 0..0.421
  //   hand_r   x -0.033..0.018  y -0.007..0.116
  // hairY is the hairline: hair volumes sit above it so the sculpted face stays clear
  const HEAD = { cy: 0.105, front: 0.118, hairY: 0.181 };

  const REGION = {
    head:  /^(Head|neck_01)$/,
    torso: /^(spine_0[123]|clavicle_[lr])$/,
    uarm:  /^upperarm_[lr]$/,
    farm:  /^lowerarm_[lr]$/,
    hand:  /^(hand_[lr]|index_|middle_|pinky_|ring_|thumb_)/,
    hips:  /^pelvis$/,
    legs:  /^(thigh_[lr]|calf_[lr])$/,
    feet:  /^(foot_[lr]|ball_)/
  };
  function regionOfBone(n) {
    for (const k in REGION) if (REGION[k].test(n)) return k;
    return 'torso';
  }
  // which regions each garment covers
  const GARMENTS = {
    shirt:    { regions: ['torso', 'uarm', 'farm', 'hips'], key: 'top', offset: 0.024, rough: 0.86 },
    trousers: { regions: ['hips', 'legs'], key: 'pants', offset: 0.014, rough: 0.88 },
    boots:    { regions: ['feet'], key: 'boots', offset: 0.02, rough: 0.7 },
    gloves:   { regions: ['hand'], key: 'gloves', offset: 0.008, rough: 0.72 }
  };

  // ---------------------------------------------------------------- asset loading
  const SRC = { male: null, female: null, clips: null, promise: null };

  function loadGLB(url) {
    return new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  }

  // Per-vertex region of the body mesh, and one garment-shell geometry per garment.
  function prepareBody(gltf) {
    const out = { scene: gltf.scene, body: null, extras: [], shells: {}, region: null };
    gltf.scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere();
      if (!out.body || o.geometry.getAttribute('position').count > out.body.geometry.getAttribute('position').count) {
        if (out.body) out.extras.push(out.body);
        out.body = o;
      } else out.extras.push(o);
    });
    const body = out.body, geo = body.geometry;
    const pos = geo.getAttribute('position'), ji = geo.getAttribute('skinIndex'), jw = geo.getAttribute('skinWeight');
    const bones = body.skeleton.bones;
    const region = new Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      const ws = [jw.getX(v), jw.getY(v), jw.getZ(v), jw.getW(v)];
      const is = [ji.getX(v), ji.getY(v), ji.getZ(v), ji.getW(v)];
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { if (ws[k] <= bw) continue; bw = ws[k]; best = is[k]; }
      const b = bones[best];
      region[v] = b ? regionOfBone(b.name) : 'torso';
    }
    out.region = region;
    for (const name in GARMENTS) out.shells[name] = shellGeometry(geo, region, GARMENTS[name]);
    return out;
  }

  // A garment is the body's own surface, grown along its normals - so it skins with the body.
  function shellGeometry(geo, region, spec) {
    const set = new Set(spec.regions);
    const idx = geo.index;
    const count = idx ? idx.count : geo.getAttribute('position').count;
    const at = i => (idx ? idx.getX(i) : i);
    const keep = [];
    for (let t = 0; t < count; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (set.has(region[a]) && set.has(region[b]) && set.has(region[c])) keep.push(a, b, c);
    }
    const out = geo.clone();
    const p = out.getAttribute('position'), n = out.getAttribute('normal');
    const np = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      np[i * 3] = p.getX(i) + n.getX(i) * spec.offset;
      np[i * 3 + 1] = p.getY(i) + n.getY(i) * spec.offset;
      np[i * 3 + 2] = p.getZ(i) + n.getZ(i) * spec.offset;
    }
    out.setAttribute('position', new THREE.BufferAttribute(np, 3));
    out.setIndex(keep);
    out.clearGroups(); out.addGroup(0, keep.length, 0);
    return out;
  }

  function preload(opts) {
    if (SRC.promise) return SRC.promise;
    opts = opts || {};
    const base = opts.base || 'assets/models/';
    SRC.promise = Promise.all([
      loadGLB(opts.male || (base + 'Superhero_Male.glb')),
      loadGLB(opts.female || (base + 'Superhero_Female.glb')),
      loadGLB(opts.anims || (base + 'anims.glb'))
    ]).then(([m, f, a]) => {
      SRC.male = prepareBody(m);
      SRC.female = prepareBody(f);
      SRC.clips = a.animations;
      return SRC;
    });
    return SRC.promise;
  }

  // ---------------------------------------------------------------- head dressing
  function buildFace(head, d) {
    const rig = new THREE.Group(); head.add(rig);
    const hairM = mat(d.hair, { roughness: 0.62 });
    const cy = HEAD.cy, fz = HEAD.front;
    if (d.mask) {
      rig.add(box(0.15, 0.092, 0.08, mat(0x24262c, { roughness: 0.42 }), 0, cy - 0.036, fz - 0.03));
      rig.add(box(0.128, 0.014, 0.014, mat(d.accent, { emissive: d.accent, emissiveIntensity: 1.1 }), 0, cy - 0.024, fz + 0.012));
    }
    if (d.faceless) {
      rig.add(ball(0.098, mat(0x141024, { roughness: 0.5 }), 0, cy, 0.008, 1.02, 1.14, 1.06));
      for (const [x, y] of [[-0.03, 0], [0, 0.026], [0.03, 0]])
        rig.add(box(0.018, 0.01, 0.012, mat(d.accent, { emissive: d.accent, emissiveIntensity: 1.5 }), x, cy + 0.03 + y, fz - 0.002));
    }
    if (d.glasses) {
      const gm = mat(0x1c1e24, { roughness: 0.3, metalness: 0.45 });
      rig.add(box(0.152, 0.03, 0.018, gm, 0, cy + 0.026, fz - 0.006));
      for (const sx of [-1, 1]) rig.add(box(0.018, 0.011, 0.06, gm, sx * 0.082, cy + 0.026, fz - 0.056));
    }
    if (d.beard) rig.add(ball(0.062, hairM, 0, cy - 0.072, fz - 0.072, 1.06, 0.6, 0.92));

    // hair sits as a bowl over the crown so the sculpted face stays clear
    const hy = HEAD.hairY;
    const capMesh = (m, drop) => {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.099, 20, 14, 0, Math.PI * 2, 0, Math.PI * (drop || 0.5)), m);
      g.position.set(0, hy, 0.002); g.scale.set(1.02, 1.0, 1.06);
      g.rotation.x = -0.12; g.castShadow = true; return g;
    };
    const fringe = m => { const f = ball(0.072, m, 0, hy - 0.014, fz - 0.05, 1.14, 0.26, 0.62); f.rotation.x = 0.18; return f; };
    const st = d.hairStyle || 'short';
    if (st === 'hood') {
      rig.add(capMesh(hairM, 0.5));
      rig.add(ball(0.108, mat(d.top2, { roughness: 0.88 }), 0, hy - 0.03, -0.006, 1.08, 1.24, 1.14));
      rig.add(ball(0.106, mat(d.top2, { roughness: 0.88 }), 0, cy - 0.03, -0.07, 0.98, 1.05, 1.0));
    } else if (st === 'hat') {
      rig.add(capMesh(hairM, 0.5));
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.115, 20), mat(d.hat, { roughness: 0.8 }));
      crown.position.set(0, hy + 0.09, 0); crown.castShadow = true; rig.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.016, 24), mat(d.hat, { roughness: 0.8 }));
      brim.position.set(0, hy + 0.032, 0); brim.castShadow = true; rig.add(brim);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.094, 0.102, 0.032, 20), mat(0x2b2b30, { roughness: 0.6 }));
      band.position.set(0, hy + 0.046, 0); rig.add(band);
    } else if (st === 'beanie') {
      rig.add(ball(0.101, mat(d.beanie, { roughness: 0.92 }), 0, hy + 0.012, 0, 1.04, 1.02, 1.08));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.108, 0.04, 20), mat(d.beanie, { roughness: 0.92 }));
      band.position.set(0, hy - 0.024, 0); rig.add(band);
      rig.add(ball(0.08, hairM, 0, cy - 0.04, -0.06, 1.0, 0.55, 0.86));
    } else if (st === 'cap') {
      rig.add(capMesh(hairM, 0.5));
      rig.add(ball(0.099, mat(d.cap, { roughness: 0.8 }), 0, hy + 0.008, 0, 1.03, 0.9, 1.05));
      const peak = box(0.14, 0.016, 0.092, mat(d.cap, { roughness: 0.8 }), 0, hy - 0.012, fz + 0.028);
      peak.rotation.x = -0.18; peak.castShadow = true; rig.add(peak);
    } else if (st === 'bandana') {
      for (let i = 0; i < 8; i++)
        rig.add(ball(0.039, hairM, Math.cos(i * 0.8) * 0.066, hy + 0.03 + (i % 2) * 0.02, -Math.sin(i * 0.8) * 0.068));
      const bnd = new THREE.Mesh(new THREE.CylinderGeometry(0.103, 0.106, 0.05, 20), mat(d.bandana, { roughness: 0.88 }));
      bnd.position.set(0, hy - 0.008, 0); rig.add(bnd);
      rig.add(box(0.05, 0.028, 0.16, mat(d.bandana, { roughness: 0.88 }), -0.06, hy - 0.012, -0.095));
    } else if (st === 'spikes') {
      rig.add(capMesh(hairM, 0.54));
      for (let i = 0; i < 9; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.023, 0.08 + (i % 3) * 0.022, 6), hairM);
        cone.position.set(-0.068 + i * 0.017, hy + 0.058, 0.03 - (i % 2) * 0.05);
        cone.rotation.z = (i - 4) * 0.13; cone.rotation.x = 0.2; cone.castShadow = true; rig.add(cone);
      }
    } else if (st === 'bun') {
      rig.add(capMesh(hairM, 0.6)); rig.add(fringe(hairM));
      rig.add(ball(0.05, hairM, 0, hy + 0.055, -0.07));
      rig.add(box(0.082, 0.018, 0.018, mat(0xd9b24a, { roughness: 0.5, metalness: 0.42 }), 0, hy + 0.05, -0.068));
    } else if (st === 'bob') {
      rig.add(capMesh(hairM, 0.62)); rig.add(fringe(hairM));
      rig.add(ball(0.098, hairM, 0, cy + 0.012, -0.058, 0.95, 1.05, 0.98));
      for (const sx of [-1, 1]) rig.add(ball(0.056, hairM, sx * 0.088, cy - 0.006, -0.038, 0.5, 1.45, 1.05));
    } else if (st === 'long') {
      rig.add(capMesh(hairM, 0.62)); rig.add(fringe(hairM));
      const fall = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.2, 5, 16), hairM);
      fall.scale.set(1.02, 1, 0.72); fall.position.set(0, cy - 0.1, -0.07); fall.castShadow = true; rig.add(fall);
      for (const sx of [-1, 1]) rig.add(ball(0.05, hairM, sx * 0.09, cy - 0.055, -0.03, 0.55, 2.0, 1.1));
    } else {
      rig.add(capMesh(hairM, 0.58)); rig.add(fringe(hairM));
    }
    return rig;
  }

  function gearTint(hex) {
    return new THREE.Color(hex).lerp(new THREE.Color(0x2a2f37), 0.42).getHex();
  }

  function buildGear(bones, d) {
    const rigM = mat(0x262a31, { roughness: 0.72 });
    const strapM = mat(0x191b20, { roughness: 0.82 });
    const spine = bones['spine_02'], hips = bones['pelvis'], thighR = bones['thigh_r'], thighL = bones['thigh_l'];
    if (spine) {
      const vest = new THREE.Group(); spine.add(vest);
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.182, 0.2, 22), mat(gearTint(d.top2), { roughness: 0.82 }));
      shell.scale.set(1, 1, 0.8); shell.position.set(0, 0.065, -0.008); shell.castShadow = true; shell.receiveShadow = true;
      vest.add(shell);
      for (const sx of [-1, 1]) {
        vest.add(box(0.046, 0.14, 0.02, strapM, sx * 0.076, 0.16, 0.08));
        vest.add(box(0.046, 0.13, 0.02, strapM, sx * 0.076, 0.16, -0.09));
        vest.add(box(0.03, 0.05, 0.028, rigM, sx * 0.152, 0.04, 0.03));
      }
      vest.add(box(0.2, 0.03, 0.02, strapM, 0, 0.092, 0.098));
      vest.add(box(0.085, 0.07, 0.045, rigM, 0.05, 0.012, 0.1));
      vest.add(box(0.055, 0.06, 0.04, rigM, -0.08, 0.02, 0.098));
      vest.add(box(0.03, 0.02, 0.012, mat(d.accent, { roughness: 0.42 }), -0.08, 0.066, 0.106));
      vest.add(box(0.05, 0.085, 0.04, rigM, -0.105, 0.14, -0.1));
    }
    if (hips) {
      const belt = new THREE.Group(); hips.add(belt);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.163, 0.05, 22), strapM);
      b.scale.set(1, 1, 0.84); b.position.set(0, 0.108, 0.008); belt.add(b);
      belt.add(box(0.048, 0.042, 0.02, mat(0xb9a06a, { metalness: 0.7, roughness: 0.34 }), 0, 0.108, 0.126));
      belt.add(box(0.07, 0.062, 0.045, rigM, 0.138, 0.092, 0));
      belt.add(box(0.055, 0.055, 0.042, rigM, -0.138, 0.092, -0.012));
    }
    if (thighR) {  // +Y runs down the leg, -X is the outside of the right thigh
      const hol = new THREE.Group(); thighR.add(hol);
      hol.add(box(0.07, 0.13, 0.058, rigM, -0.078, 0.23, 0));
      hol.add(box(0.084, 0.026, 0.07, strapM, -0.07, 0.145, 0));
    }
    if (thighL) {
      const pouch = new THREE.Group(); thighL.add(pouch);
      pouch.add(box(0.062, 0.085, 0.05, rigM, 0.078, 0.215, 0));
      pouch.add(box(0.076, 0.024, 0.062, strapM, 0.07, 0.15, 0));
    }
  }

  // ---------------------------------------------------------------- weapon seating
  const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  function seatWeapon(bones, mount, weapon, forwardIsPlusZ, palm, root) {
    const hand = bones['hand_r']; if (!hand) return;
    hand.updateMatrixWorld(true);
    const barrel = new THREE.Vector3(0, 0, -1);
    const mz = weapon && weapon.userData && weapon.userData.muzzle;
    if (mz) {
      weapon.updateMatrixWorld(true);
      barrel.setFromMatrixPosition(mz.matrixWorld).applyMatrix4(_m2.copy(weapon.matrixWorld).invert());
      if (barrel.lengthSq() > 1e-6) barrel.normalize(); else barrel.set(0, 0, -1);
    }
    const zL = barrel.clone().multiplyScalar(-1);
    let yL = new THREE.Vector3(0, 1, 0);
    if (Math.abs(yL.dot(zL)) > 0.95) yL.set(1, 0, 0);
    const xL = new THREE.Vector3().crossVectors(yL, zL).normalize();
    yL = new THREE.Vector3().crossVectors(zL, xL).normalize();
    const zW = new THREE.Vector3(0, 0, forwardIsPlusZ ? -1 : 1);
    let yW = new THREE.Vector3(0, 1, 0);
    const xW = new THREE.Vector3().crossVectors(yW, zW).normalize();
    yW = new THREE.Vector3().crossVectors(zW, xW).normalize();
    const qWant = new THREE.Quaternion().setFromRotationMatrix(
      _m1.makeBasis(xW, yW, zW).clone().multiply(_m2.makeBasis(xL, yL, zL).invert()));
    const qHand = new THREE.Quaternion(); hand.getWorldQuaternion(qHand);
    if (root) { const qr = new THREE.Quaternion(); root.getWorldQuaternion(qr); qHand.premultiply(qr.invert()); }
    mount.quaternion.copy(qHand.invert()).multiply(qWant);
    // the weapon's own gripR node marks where the hand holds it, so offset the mount until
    // that node lands in the palm instead of dropping the model's origin there
    const palmPt = new THREE.Vector3(-0.024, palm === undefined ? 0.052 : palm, 0.0);
    const gr = weapon && weapon.userData && weapon.userData.gripR;
    if (gr) {
      const gl = new THREE.Vector3();
      gr.getWorldPosition(gl);
      weapon.worldToLocal(gl);
      gl.applyQuaternion(mount.quaternion);
      mount.position.copy(palmPt).sub(gl);
    } else mount.position.copy(palmPt);

  }

  // Cyclic-coordinate-descent IK for a short bone chain. Two bones and four passes is
  // enough to put the off hand on a weapon's foregrip without the elbow flipping.
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  function ccd(chain, effector, target, iters) {
    for (let it = 0; it < (iters || 4); it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const b = chain[i];
        b.updateWorldMatrix(true, true);
        b.getWorldPosition(_v1);
        effector.getWorldPosition(_v2);
        _v3.subVectors(_v2, _v1); if (_v3.lengthSq() < 1e-8) continue; _v3.normalize();
        _v4.subVectors(target, _v1); if (_v4.lengthSq() < 1e-8) continue; _v4.normalize();
        const dot = _v3.dot(_v4); if (dot > 0.9999) continue;
        _q1.setFromUnitVectors(_v3, _v4);
        if (b.parent) b.parent.getWorldQuaternion(_q2); else _q2.identity();
        _q3.copy(_q2).invert().multiply(_q1).multiply(_q2);
        b.quaternion.premultiply(_q3);
        b.updateWorldMatrix(false, true);
      }
    }
  }
  // Copper knuckle plates and a cuff on each glove, parented to the finger bones so they
  // ride the curl. The back of the hand is +X for the right hand and -X for the left.
  const GLOVE_BLUE = 0x2e4f93, COPPER = 0xb8763a;
  function gloveDetail(bones, side) {
    const sgn = side === 'r' ? 1 : -1;
    const plate = mat(COPPER, { roughness: 0.38, metalness: 0.8 });
    const dark = mat(0x1d2026, { roughness: 0.6 });
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      const b1 = bones[f + '_01_' + side], b2 = bones[f + '_02_' + side];
      if (b1) { const k = box(0.008, 0.02, 0.016, plate, sgn * 0.0105, 0.016, 0); k.rotation.z = -sgn * 0.12; b1.add(k); }
      if (b2) b2.add(box(0.006, 0.012, 0.013, dark, sgn * 0.009, 0.012, 0));
    }
    const hand = bones['hand_' + side];
    if (hand) {
      const back = box(0.007, 0.046, 0.052, plate, sgn * 0.02, 0.05, 0.002); back.rotation.z = -sgn * 0.06; hand.add(back);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.03, 16), dark);
      cuff.position.set(0, -0.004, 0.004); cuff.scale.set(0.72, 1, 1); cuff.castShadow = true; hand.add(cuff);
      const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.008, 16), plate);
      trim.position.set(0, 0.012, 0.004); trim.scale.set(0.72, 1, 1); hand.add(trim);
    }
  }

  // ---- hand frames, expressed in the weapon grip node's space ----
  // 'grip'  : pistol-grip hold - palm faces the gun, fingers run forward-and-down over the
  //           top of the grip and curl round it, thumb side up.
  // 'under' : the off hand cupping a handguard from below - palm up, fingers wrap over the
  //           far side, thumb side forward.
  const _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3(), _fm = new THREE.Matrix4();
  function handFrame(side, kind) {
    if (kind === 'under') { _fy.set(side === 'l' ? 0.82 : -0.82, 0.3, -0.5).normalize(); _fx.set(0, 1, 0); }
    else if (kind === 'knife') { _fx.set(side === 'l' ? -1 : 1, 0, 0); _fy.set(0, 0, 1); }   // fist round the handle, thumb toward the blade
    else if (kind === 'guard') { _fy.set(0.15, 0.75, -0.64).normalize(); _fx.set(side === 'l' ? 0.85 : -0.85, 0, -0.5); }   // open hand raised, palm turned in
    else { _fx.set(1, 0, 0); _fy.set(0, -0.32, -0.95).normalize(); }
    _fx.addScaledVector(_fy, -_fx.dot(_fy)).normalize();
    _fz.crossVectors(_fx, _fy).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(_fm.makeBasis(_fx, _fy, _fz));
  }
  // where the grip's axis should pass through, in hand-bone space: through the curled
  // fingers, just proud of the palm face
  const PALM = { r: new THREE.Vector3(-0.024, 0.052, 0.0), l: new THREE.Vector3(0.024, 0.052, 0.0) };
  const FINGERS = ['index', 'middle', 'ring', 'pinky'];
  // curl per phalanx (radians about the finger's local Z, positive curls a right hand)
  const CURL = { grip: [0.55, 1.05, 0.85], under: [0.5, 0.95, 0.75], open: [0.12, 0.2, 0.15] };
  const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3();
  const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _pt = new THREE.Vector3(), _wt = new THREE.Vector3(), _off = new THREE.Vector3();
  const _qg = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qz = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(1, 0, 0);

  // Put one hand on a grip. `other` is the second grip node, used to slide the target back
  // along the weapon when the grip is beyond the arm's reach so the hand still lands on it.
  function handToGrip(bones, side, grip, other, kind, rest) {
    const up = bones['upperarm_' + side], lo = bones['lowerarm_' + side], hd = bones['hand_' + side];
    if (!up || !lo || !hd || !grip) return;
    kind = kind || 'grip';
    grip.getWorldQuaternion(_qg);
    _qh.copy(_qg).multiply(handFrame(side, kind));           // desired hand orientation (world)
    _off.copy(PALM[side]).applyQuaternion(_qh);              // palm offset in world space
    up.getWorldPosition(_s); lo.getWorldPosition(_e); hd.getWorldPosition(_h);
    const reach = (_s.distanceTo(_e) + _e.distanceTo(_h)) * 0.97;
    _p1.setFromMatrixPosition(grip.matrixWorld);
    _pt.copy(_p1); _wt.copy(_pt).sub(_off);
    if (_s.distanceTo(_wt) > reach && other) {
      _p0.setFromMatrixPosition(other.matrixWorld);
      let l = 0, h = 1;
      for (let i = 0; i < 10; i++) {
        const mid = (l + h) * 0.5;
        _pt.copy(_p0).lerp(_p1, mid); _wt.copy(_pt).sub(_off);
        if (_s.distanceTo(_wt) <= reach) l = mid; else h = mid;
      }
      _pt.copy(_p0).lerp(_p1, l); _wt.copy(_pt).sub(_off);
    }
    ccd([up, lo], hd, _wt, 6);
    // the wrist is placed; now turn the hand itself so the palm faces the grip
    hd.parent.getWorldQuaternion(_qp);
    hd.quaternion.copy(_qp.invert()).multiply(_qh);
    hd.updateWorldMatrix(false, true);
    curlFingers(bones, side, kind, rest);
  }
  // The weapon-ready clip already closes the fingers into a grip (the phalanges wrap round
  // in hand space), so the fingers are left to the animation; only an empty hand relaxes.
  function curlFingers(bones, side, kind, rest) {
    if (kind === 'knife') {
      // tighten the animated pistol grip into a fist round the thin handle (extra curl on top of the clip)
      const extra = [0.35, 0.5, 0.4];
      for (const f of FINGERS) for (let k = 0; k < 3; k++) { const bn = bones[f + '_0' + (k + 1) + '_' + side]; if (bn) bn.quaternion.multiply(_qz.setFromAxisAngle(_zAxis, extra[k])); }
      return;
    }
    if (kind !== 'open' && kind !== 'guard') return;
    const sign = side === 'r' ? 1 : -1;
    const amounts = CURL.open;
    for (const f of FINGERS) for (let k = 0; k < 3; k++) {
      const bn = bones[f + '_0' + (k + 1) + '_' + side]; if (!bn) continue;
      const r0 = rest && rest[bn.name];
      if (r0) bn.quaternion.copy(r0);
      bn.quaternion.multiply(_qz.setFromAxisAngle(_zAxis, sign * amounts[k]));
    }
    const t1 = bones['thumb_02_' + side], t2 = bones['thumb_03_' + side];
    if (t1) { const r0 = rest && rest[t1.name]; if (r0) t1.quaternion.copy(r0); t1.quaternion.multiply(_qz.setFromAxisAngle(_zAxis, sign * 0.35)); }
    if (t2) { const r0 = rest && rest[t2.name]; if (r0) t2.quaternion.copy(r0); t2.quaternion.multiply(_qz.setFromAxisAngle(_zAxis, sign * 0.45)); }
  }
  // snapshot the bind-pose rotation of every finger bone so curls are absolute, not additive
  function fingerRest(bones) {
    const rest = {};
    for (const n in bones) if (/^(index|middle|ring|pinky|thumb)_0[1-4]/.test(n)) rest[n] = bones[n].quaternion.clone();
    return rest;
  }
  function holdKind(weapon) {
    const cat = weapon && weapon.userData && weapon.userData.cat;
    if (cat === 'knife' || cat === 'melee' || (weapon && weapon.userData && weapon.userData.id === 'knife')) return 'knife';
    if (cat === 'sidearm' || cat === 'spike') return 'grip';
    return 'under';
  }
  // third person: the weapon rides the right hand, so only the off hand needs solving
  function holdWeapon(bones, mount, rest) {
    const weapon = mount && mount.children[0];
    if (!weapon || !weapon.userData) return;
    weapon.updateWorldMatrix(true, true);
    curlFingers(bones, 'r', 'grip', rest);
    if (weapon.userData.gripL) handToGrip(bones, 'l', weapon.userData.gripL, weapon.userData.gripR, holdKind(weapon), rest);
  }

  const CLIP = {
    idleGun: 'Pistol_Idle_Loop', idleBare: 'Idle_Loop',
    walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', run: 'Sprint_Loop',
    crouchIdle: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop',
    plant: 'Fixing_Kneeling', death: 'Death01', hit: 'Hit_Chest', shoot: 'Pistol_Shoot', reload: 'Pistol_Reload'
  };

  class Character {
    constructor(agentId, opts) {
      const d = AGENTS[agentId] || AGENTS.generic;
      this.def = d; this.agentId = agentId; this.opts = opts || {};
      const src = d.female ? SRC.female : SRC.male;
      if (!src) throw new Error('VAL.Characters.preload() must resolve before build()');

      const g = this.group = new THREE.Group(); g.name = 'agent_' + agentId;
      const model = THREE.SkeletonUtils.clone(src.scene);
      this.model = model; g.add(model);

      this.skinned = []; let bodyMesh = null;
      model.traverse(o => {
        if (!o.isSkinnedMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        this.skinned.push(o);
        if (!bodyMesh || o.geometry.getAttribute('position').count > bodyMesh.geometry.getAttribute('position').count) bodyMesh = o;
      });
      this.bodyMesh = bodyMesh;
      // tint the skin and the brows without losing the sculpted texture
      for (const sm of this.skinned) {
        const m = sm.material.clone();
        if (sm === bodyMesh) m.color = new THREE.Color(d.skin).multiplyScalar(1.18);
        else if (m.name && /hair/i.test(m.name)) m.color = new THREE.Color(d.hair);
        m.roughness = 0.86; m.metalness = 0.02;
        sm.material = m;
      }

      const bones = this.bones = {};
      model.traverse(o => { if (o.isBone) bones[o.name] = o; });
      this.fingerRest = fingerRest(bones);

      // clothing: shells grown off the body, bound to this character's skeleton
      this.garments = [];
      for (const name in GARMENTS) {
        const spec = GARMENTS[name];
        const sm = new THREE.SkinnedMesh(src.shells[name], mat(d[spec.key], { roughness: spec.rough }));
        sm.bind(bodyMesh.skeleton, bodyMesh.bindMatrix);
        sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
        bodyMesh.parent.add(sm);
        this.garments.push(sm);
      }

      this.faceRig = bones['Head'] ? buildFace(bones['Head'], d) : null;
      buildGear(bones, d);
      gloveDetail(bones, 'r'); gloveDetail(bones, 'l');

      const mount = this.weaponMount = new THREE.Group();
      if (bones['hand_r']) bones['hand_r'].add(mount);
      this.parts = { weaponMount: mount, head: bones['Head'], hips: bones['pelvis'], torso: bones['spine_02'] };

      const hbMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
      const hb = (parent, zone, w, h, dp, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), hbMat);
        m.position.set(0, y, z || 0); m.userData.zone = zone; m.userData.char = this;
        m.castShadow = false; m.frustumCulled = false; parent.add(m);
        return { mesh: m, zone };
      };
      this.hitboxes = [];
      if (bones['Head']) this.hitboxes.push(hb(bones['Head'], 'head', 0.22, 0.26, 0.24, 0.09, 0.01));
      if (bones['spine_02']) this.hitboxes.push(hb(bones['spine_02'], 'body', 0.46, 0.58, 0.32, 0.07, 0));
      if (bones['pelvis']) this.hitboxes.push(hb(bones['pelvis'], 'legs', 0.42, 0.92, 0.32, -0.42, 0));

      this.mixer = new THREE.AnimationMixer(model);
      this.actions = {};
      for (const k in CLIP) {
        const clip = THREE.AnimationClip.findByName(SRC.clips, CLIP[k]);
        if (clip) this.actions[k] = this.mixer.clipAction(clip);
      }
      if (this.actions.death) { this.actions.death.loop = THREE.LoopOnce; this.actions.death.clampWhenFinished = true; }
      this.current = null; this.currentName = null;
      this.play('idleGun', 0);
      this.mixer.update(0.016); g.updateMatrixWorld(true);
      this.seat = (weapon) => { this.mixer.update(0); g.updateMatrixWorld(true); seatWeapon(bones, mount, weapon, true, undefined, g); };
      this.seat(null);
      this.dead = false; this.outlineMeshes = []; this.aim = 0;
    }

    play(name, fade) {
      const a = this.actions[name]; if (!a || this.currentName === name) return;
      a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.reset().play();
      if (this.current && this.current !== a) this.current.crossFadeTo(a, fade === undefined ? 0.18 : fade, false);
      this.current = a; this.currentName = name;
    }

    setOutline(color) {
      for (const m of this.outlineMeshes) { if (m.parent) m.parent.remove(m); }
      this.outlineMeshes = [];
      if (color == null) return;
      // Everything the character draws stamps the stencil; the inverted hull is then drawn
      // only where that stencil is absent, so the rim hugs the silhouette instead of
      // painting over the face.
      this.group.traverse(o => {
        if (!o.isMesh || o.userData.zone || o.userData.outline || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) {
          if (mt._stencilBody) continue;
          mt._stencilBody = true; mt.stencilWrite = true; mt.stencilRef = 1;
          mt.stencilFunc = THREE.AlwaysStencilFunc; mt.stencilZPass = THREE.ReplaceStencilOp;
          mt.needsUpdate = true;
        }
      });
      const targets = [this.bodyMesh].concat(this.garments);
      for (const sm of targets) {
        const om = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide,
          stencilWrite: true, stencilWriteMask: 0, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc });
        om.onBeforeCompile = (sh) => {
          sh.uniforms.outlineW = { value: 0.03 };
          sh.vertexShader = 'uniform float outlineW;\n' + sh.vertexShader.replace(
            '#include <skinning_vertex>',
            '#include <skinning_vertex>\n  transformed += normalize(objectNormal) * outlineW;');
        };
        const clone = new THREE.SkinnedMesh(sm.geometry, om);
        clone.bind(sm.skeleton, sm.bindMatrix);
        clone.userData.outline = true; clone.frustumCulled = false; clone.renderOrder = 3;
        clone.castShadow = false; clone.receiveShadow = false;
        sm.parent.add(clone);
        this.outlineMeshes.push(clone);
      }
    }

    update(dt, s) {
      this.group.rotation.y = (s.yaw || 0) + Math.PI;   // the rig faces +Z, the game's yaw 0 faces -Z
      let want;
      if (s.dead) want = 'death';
      else if (s.planting || s.defusing) want = 'plant';
      else if (s.crouching) want = (s.moving > 0.08 ? 'crouchWalk' : 'crouchIdle');
      else if (s.moving > 0.08) want = s.running ? 'run' : (s.moving > 0.45 ? 'jog' : 'walk');
      else want = (s.weaponKind === 'knife' || s.weaponKind === 'spike') ? 'idleBare' : 'idleGun';
      if (s.dead && !this.dead) { this.dead = true; if (this.actions.death) this.actions.death.reset(); }
      if (!s.dead && this.dead) this.dead = false;
      this.play(want, this.currentName === null ? 0 : (s.dead ? 0.08 : 0.18));
      if (this.current && (want === 'walk' || want === 'jog' || want === 'run' || want === 'crouchWalk')) {
        const ref = want === 'run' ? 1.0 : want === 'jog' ? 0.72 : 0.4;
        this.current.setEffectiveTimeScale(U.clamp((s.moving || 0.4) / ref, 0.55, 1.7));
      }
      this.mixer.update(dt);
      if (!s.dead) holdWeapon(this.bones, this.weaponMount, this.fingerRest);
      if (!s.dead) {
        const p = U.clamp(s.aimPitch || 0, -0.9, 0.9);
        this.aim += (p - this.aim) * Math.min(1, dt * 12);
        const sp = this.bones['spine_03'], hd = this.bones['Head'];
        if (sp) sp.rotateX(-this.aim * 0.4);
        if (hd) hd.rotateX(-this.aim * 0.45);
      }
    }

    reset() {
      this.dead = false;
      if (this.actions.death) this.actions.death.stop();
      this.mixer.stopAllAction();
      this.current = null; this.currentName = null;
      this.play('idleGun', 0);
      this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0);
    }
    dispose() { this.mixer.stopAllAction(); }
  }

  // ---------------------------------------------------------------- first-person arms
  const ARM_REGIONS = new Set(['uarm', 'farm', 'hand']);
  function armFilter(geo, region) {
    const idx = geo.index;
    const count = idx ? idx.count : geo.getAttribute('position').count;
    const at = i => (idx ? idx.getX(i) : i);
    const keep = [];
    for (let t = 0; t < count; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (ARM_REGIONS.has(region[a]) && ARM_REGIONS.has(region[b]) && ARM_REGIONS.has(region[c])) keep.push(a, b, c);
    }
    const out = geo.clone(); out.setIndex(keep);
    out.clearGroups(); out.addGroup(0, keep.length, 0);
    return out;
  }

  function buildViewArms(agentId) {
    const d = AGENTS[agentId] || AGENTS.generic;
    const src = d.female ? SRC.female : SRC.male;
    if (!src) throw new Error('preload first');
    const model = THREE.SkeletonUtils.clone(src.scene);
    const group = new THREE.Group(); group.name = 'fp_arms'; group.add(model);
    // where the empty off hand goes while the knife is out: hanging at the side, below and behind
    // the camera, so only the knife hand is on screen (camera space, before the viewmodel scale)
    const restL = new THREE.Object3D(); restL.position.set(-0.24, -0.83, 0.06); group.add(restL);
    const bones = {}; model.traverse(o => { if (o.isBone) bones[o.name] = o; });

    let body = null;
    model.traverse(o => {
      if (!o.isSkinnedMesh) return;
      if (!body || o.geometry.getAttribute('position').count > body.geometry.getAttribute('position').count) body = o;
    });
    // keep only the arms of the body and of the sleeve/glove garments
    const keep = [];
    model.traverse(o => { if (o.isSkinnedMesh && o !== body && o.parent) keep.push(o); });
    for (const o of keep) o.parent.remove(o);           // drop face, eyes, brows
    body.geometry = armFilter(src.body.geometry, src.region);
    const skinMat = body.material.clone();
    skinMat.color = new THREE.Color(d.skin).multiplyScalar(1.18);
    skinMat.roughness = 0.84; body.material = skinMat;
    body.frustumCulled = false; body.castShadow = false; body.receiveShadow = false; body.renderOrder = 10;

    for (const name of ['shirt', 'gloves']) {
      const spec = GARMENTS[name];
      const sm = new THREE.SkinnedMesh(armFilter(src.shells[name], src.region), mat(d[spec.key], { roughness: spec.rough }));
      sm.bind(body.skeleton, body.bindMatrix);
      sm.frustumCulled = false; sm.castShadow = false; sm.renderOrder = 10;
      body.parent.add(sm);
    }
    gloveDetail(bones, 'r'); gloveDetail(bones, 'l');

    const mixer = new THREE.AnimationMixer(model);
    const acts = {};
    const add = (key, name, once) => {
      const clip = THREE.AnimationClip.findByName(SRC.clips, name); if (!clip) return;
      const a = mixer.clipAction(clip);
      if (once) { a.loop = THREE.LoopOnce; a.clampWhenFinished = true; }
      acts[key] = a;
    };
    add('idle', 'Pistol_Idle_Loop'); add('shoot', 'Pistol_Shoot', true); add('reload', 'Pistol_Reload', true);
    const rest = fingerRest(bones);
    let current = null, currentName = null;
    const api = {
      group, mixer, bones, actions: acts, weapon: null,
      play(name, fade) {
        const a = acts[name]; if (!a || currentName === name) return;
        a.enabled = true; a.setEffectiveWeight(1); a.reset().play();
        if (current && current !== a) current.crossFadeTo(a, fade === undefined ? 0.15 : fade, false);
        current = a; currentName = name;
      },
      attach(weapon) { api.weapon = weapon || null; },
      // The arms hold the weapon-ready pose; walk motion comes from the viewmodel bob and the
      // hands follow it because both are solved onto the weapon every frame.
      update(dt) {
        api.play('idle');
        mixer.update(dt);
        const w = api.weapon;
        if (!w || !w.userData) return;
        w.updateWorldMatrix(true, true);
        group.updateWorldMatrix(true, true);
        const kind = holdKind(w);
        if (kind === 'knife') {
          if (w.userData.gripR) handToGrip(bones, 'r', w.userData.gripR, null, 'knife', rest);
          handToGrip(bones, 'l', restL, null, 'guard', rest);
          return;
        }
        if (w.userData.gripR) handToGrip(bones, 'r', w.userData.gripR, w.userData.gripL, 'grip', rest);
        if (w.userData.gripL) handToGrip(bones, 'l', w.userData.gripL, w.userData.gripR, kind, rest);
        else curlFingers(bones, 'l', 'open', rest);
      }
    };
    api.play('idle', 0);
    mixer.update(0.016);
    model.rotation.y = Math.PI;              // the rig faces +Z; the camera looks down -Z
    model.position.set(0, 0, 0);
    group.position.set(0, 0, 0); group.scale.setScalar(1);
    group.updateMatrixWorld(true);
    // anchor the body so the shoulders sit below and behind the camera, the way a torso would
    if (bones['neck_01']) {
      const np = new THREE.Vector3();
      bones['neck_01'].getWorldPosition(np); group.worldToLocal(np);
      model.position.set(-np.x, -np.y - 0.2, -np.z + 0.12);
    }
    group.updateMatrixWorld(true);
    return api;
  }

  // ---------------------------------------------------------------- static merge helper
  function mergeInto(parent) {
    const groups = new Map();
    for (const ch of parent.children.slice()) {
      if (!ch.isMesh || ch.isSkinnedMesh || ch.userData.zone || ch.userData.outline || ch.userData.noMerge) continue;
      if (!ch.geometry || !ch.geometry.getAttribute('position')) continue;
      const key = ch.material.uuid;
      if (!groups.has(key)) groups.set(key, { mat: ch.material, list: [] });
      groups.get(key).list.push(ch);
    }
    for (const { mat: mm, list } of groups.values()) {
      if (list.length < 2) continue;
      let total = 0; const prepared = [];
      for (const mesh of list) {
        let geo = mesh.geometry; geo = geo.index ? geo.toNonIndexed() : geo.clone();
        mesh.updateMatrix(); geo.applyMatrix4(mesh.matrix);
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        total += geo.getAttribute('position').count; prepared.push(geo);
      }
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
      let o = 0;
      for (const geo of prepared) {
        const pa = geo.getAttribute('position'), na = geo.getAttribute('normal'), ua = geo.getAttribute('uv');
        pos.set(pa.array, o * 3); if (na) nor.set(na.array, o * 3); if (ua) uv.set(ua.array, o * 2);
        o += pa.count; geo.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const merged = new THREE.Mesh(geo, mm); merged.castShadow = true; merged.receiveShadow = true;
      for (const mesh of list) parent.remove(mesh);
      parent.add(merged);
    }
  }
  function mergeSkeleton(root) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const c of n.children) if (!c.isMesh) stack.push(c);
      mergeInto(n);
    }
  }

  VAL.Characters = {
    AGENTS, IDS: Object.keys(AGENTS),
    preload,
    build: (id, opts) => new Character(id, opts),
    icon: id => (AGENTS[id] || AGENTS.generic).icon,
    Character, mergeStatic: mergeSkeleton, buildViewArms,
    get ready() { return !!SRC.male; }
  };
})();
