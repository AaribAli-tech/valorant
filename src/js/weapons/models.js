// Weapon models (all 18 guns + knife + spike), first-person arms with 2-bone IK, icon renderer.
// Conventions: origin at pistol grip / trigger, barrel along -Z, +Y up, metres.
window.VAL = window.VAL || {};
VAL.WeaponModels = (function () {
  const MAT = {};
  function M(name) {
    if (MAT[name]) return MAT[name];
    const defs = {
      gunmetal: { color: 0x2a2d31, roughness: 0.42, metalness: 0.8 }, polymer: { color: 0x15161a, roughness: 0.75, metalness: 0.1 },
      dark: { color: 0x1a1c20, roughness: 0.5, metalness: 0.65 }, grey: { color: 0x3d4148, roughness: 0.5, metalness: 0.6 },
      light: { color: 0x8d949c, roughness: 0.35, metalness: 0.8 }, wood: { color: 0x6d4a2f, roughness: 0.7, metalness: 0.05 },
      teal: { color: 0x2ea9a1, roughness: 0.4, metalness: 0.5, emissive: 0x0a2a28, emissiveIntensity: 0.4 }, red: { color: 0xb8323f, roughness: 0.5, metalness: 0.3 },
      glass: { color: 0x6fb7d6, roughness: 0.1, metalness: 0.9, emissive: 0x112233, emissiveIntensity: 0.4 }, blade: { color: 0x1a1d22, roughness: 0.3, metalness: 0.9 },
      edge: { color: 0xb8c4cc, roughness: 0.2, metalness: 1.0 }, spike: { color: 0x0f1216, roughness: 0.5, metalness: 0.6 }, spikeGlow: { color: 0x2ff5e5, emissive: 0x2ff5e5, emissiveIntensity: 1.6 },
      glove: { color: 0x33373e, roughness: 0.85, metalness: 0.05 }, knuckle: { color: 0x8a919a, roughness: 0.5, metalness: 0.4 }, sleeve: { color: 0xe9eaee, roughness: 0.85, metalness: 0 },
      accent: { color: 0x3dc9c0, emissive: 0x3dc9c0, emissiveIntensity: 0.9 }, accentSoft: { color: 0x5aa9c8, roughness: 0.6 }, skin: { color: 0xe0b89a, roughness: 0.7 }, gold: { color: 0xc9a24a, roughness: 0.3, metalness: 0.9 }
    };
    MAT[name] = new THREE.MeshStandardMaterial(defs[name] || { color: 0x888888 }); return MAT[name];
  }
  // ---- primitive helpers ----
  function box(parent, w, h, d, mat, x, y, z, ry, rx, rz) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(mat)); m.position.set(x || 0, y || 0, z || 0); if (ry) m.rotation.y = ry; if (rx) m.rotation.x = rx; if (rz) m.rotation.z = rz; parent.add(m); return m; }
  function cylZ(parent, r, len, mat, x, y, z, r2, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 == null ? r : r2, len, seg || 14), M(mat)); m.rotation.x = Math.PI / 2; m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; }
  function cylX(parent, r, len, mat, x, y, z, r2, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 == null ? r : r2, len, seg || 14), M(mat)); m.rotation.z = Math.PI / 2; m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; }
  function node(parent, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; }
  // side profile: pts = [[z,y],...] (muzzle = negative z), extruded symmetrically to thickness t along X, with optional holes
  function side(parent, pts, t, mat, bevel, holes) {
    const sh = new THREE.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
    if (holes) for (const h of holes) { const hp = new THREE.Path(); h.forEach((p, i) => i ? hp.lineTo(p[0], p[1]) : hp.moveTo(p[0], p[1])); hp.closePath(); sh.holes.push(hp); }
    const b = bevel || 0;
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.002, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, steps: 1 });
    g.rotateY(-Math.PI / 2); g.translate(t / 2 - b, 0, 0); if (b > 0) g.translate(0, 0, 0);
    const m = new THREE.Mesh(g, M(mat)); parent.add(m); return m;
  }
  function serrations(parent, z0, z1, y, x, n, mat) { for (let i = 0; i < n; i++) box(parent, 0.003, 0.02, 0.003, mat || 'dark', x, y, z0 + (z1 - z0) * (i + 0.5) / n); }
  function finish(g, ud) { g.userData = Object.assign({ scope: null }, ud); g.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); return g; }

  // ================= PISTOLS =================
  function pistol(o) {
    const g = new THREE.Group(); const L = o.len || 0.19; // slide length
    const zf = -L + 0.06, zr = 0.06; // slide front / rear
    if (!o.revolver && !o.twin) {
      // slide with sloped nose
      const slide = side(g, [[zf, 0.032], [zf, 0.05], [zf + 0.02, 0.062], [zr - 0.005, 0.062], [zr, 0.052], [zr, 0.032]], 0.03, 'gunmetal', 0.003);
      slide.name = 'slide';
      serrations(g, zr - 0.035, zr - 0.006, 0.05, 0.016, 5); serrations(g, zr - 0.035, zr - 0.006, 0.05, -0.016, 5);
      if (o.vents) for (let i = 0; i < 3; i++) box(g, 0.034, 0.006, 0.012, 'dark', 0, 0.062, zf + 0.03 + i * 0.022);
      box(g, 0.03, 0.006, 0.008, 'light', 0, 0.066, zf + 0.012); box(g, 0.03, 0.007, 0.01, 'light', 0, 0.066, zr - 0.012); // sights
      box(g, 0.032, 0.012, 0.03, 'dark', 0.0, 0.056, zr - 0.06); // ejection port
      cylZ(g, 0.008, 0.02, 'light', 0, 0.047, zf - 0.006); // barrel tip
      // frame
      side(g, [[zf + 0.01, 0.012], [zf + 0.01, 0.033], [zr - 0.002, 0.033], [zr - 0.002, 0.004], [zf + 0.05, 0.004]], 0.03, 'polymer', 0.002);
      box(g, 0.026, 0.012, 0.03, 'dark', 0, 0.02, zf + 0.025); // accessory rail
      g.userData_slide = slide;
    }
    // trigger guard + trigger
    side(g, [[-0.012, -0.03], [-0.012, 0.01], [0.045, 0.01], [0.045, -0.03]], 0.012, 'polymer', 0, [[[-0.004, -0.024], [-0.004, 0.004], [0.037, 0.004], [0.037, -0.024]]]);
    box(g, 0.006, 0.02, 0.005, 'light', 0, -0.008, 0.02, 0, 0.3);
    // grip (angled) + magazine baseplate
    const gripMat = o.gripMat || 'polymer';
    side(g, [[0.028, 0.012], [0.07, 0.012], [0.095, -0.105], [0.05, -0.105]], 0.03, gripMat, 0.003);
    for (let i = 0; i < 3; i++) box(g, 0.032, 0.004, 0.036, 'dark', 0, -0.02 - i * 0.025, 0.06 + i * 0.006);
    let mag = box(g, 0.03, 0.008, 0.046, 'gunmetal', 0, -0.108, 0.073);
    if (o.mag) { mag = box(g, 0.026, o.mag, 0.036, 'gunmetal', 0, -0.105 - o.mag / 2, 0.075, 0, 0, 0); }
    if (o.revolver) {
      // frame + cylinder + heavy barrel shroud with top rib
      side(g, [[-0.02, 0.012], [-0.02, 0.07], [0.06, 0.07], [0.06, 0.012]], 0.034, 'gunmetal', 0.003);
      cylZ(g, 0.021, 0.042, 'light', 0, 0.045, 0.0, 0.021, 8);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cylZ(g, 0.005, 0.044, 'dark', Math.cos(a) * 0.014, 0.045 + Math.sin(a) * 0.014, 0.0, 0.005, 6); }
      side(g, [[-L + 0.02, 0.03], [-L + 0.02, 0.066], [-0.02, 0.066], [-0.02, 0.03]], 0.03, 'gunmetal', 0.003); // shroud
      box(g, 0.012, 0.01, L - 0.04, 'light', 0, 0.072, -L / 2 + 0.0); // rib
      cylZ(g, 0.01, L - 0.03, 'dark', 0, 0.045, -L / 2 + 0.0);
      box(g, 0.02, 0.008, 0.01, 'light', 0, 0.081, -L + 0.03); // front sight
      box(g, 0.01, 0.02, 0.02, 'gunmetal', 0, 0.06, 0.07, 0, -0.5); // hammer
      g.children.forEach(c => { if (c.material === M('polymer') && c.geometry.type === 'ExtrudeGeometry') c.material = M('wood'); });
    }
    if (o.twin) { // Shorty: two short barrels over/under, wooden grip
      cylZ(g, 0.012, 0.17, 'gunmetal', 0, 0.062, -0.07); cylZ(g, 0.012, 0.17, 'gunmetal', 0, 0.038, -0.07);
      box(g, 0.036, 0.055, 0.05, 'gunmetal', 0, 0.05, 0.025); box(g, 0.03, 0.02, 0.03, 'light', 0, 0.08, 0.03);
      g.children.forEach(c => { if (c.material === M('polymer')) c.material = M('wood'); });
    }
    if (o.suppressor) { cylZ(g, 0.016, 0.11, 'dark', 0, 0.047, zf - 0.055); for (let i = 0; i < 3; i++) cylZ(g, 0.0168, 0.004, 'grey', 0, 0.047, zf - 0.02 - i * 0.03); }
    if (o.compensator) { box(g, 0.034, 0.036, 0.028, 'grey', 0, 0.048, zf - 0.014); for (let i = 0; i < 3; i++) box(g, 0.036, 0.004, 0.005, 'dark', 0, 0.066, zf - 0.006 - i * 0.008); }
    const muzzleZ = o.twin ? -0.155 : o.revolver ? -L + 0.02 : zf - (o.suppressor ? 0.11 : 0) - (o.compensator ? 0.028 : 0);
    const muzzle = node(g, 0, o.twin ? 0.062 : o.revolver ? 0.045 : 0.047, muzzleZ);
    const gripR = node(g, 0.004, -0.05, 0.064); gripR.rotation.x = -0.2; const gripL = node(g, -0.02, -0.055, 0.048); gripL.rotation.x = -0.2;
    return finish(g, { muzzle, slide: g.userData_slide || null, mag, gripR, gripL, length: -muzzleZ + 0.1 });
  }

  // ================= LONG GUNS =================
  function longGun(o) {
    const g = new THREE.Group();
    const RL = o.recvLen || 0.3, RH = o.recvH || 0.075, T = o.thick || 0.048;
    // receiver: upper (sloped top toward rear) + lower
    side(g, [[-RL, 0.03], [-RL, 0.03 + RH], [0.06, 0.03 + RH], [0.09, 0.03 + RH * 0.6], [0.09, 0.03]], T, 'gunmetal', 0.004);
    side(g, [[-RL * 0.9, 0.0], [-RL * 0.9, 0.032], [0.085, 0.032], [0.085, 0.0]], T * 0.92, 'dark', 0.003);
    // pistol grip, trigger, guard
    side(g, [[0.02, 0.005], [0.06, 0.005], [0.085, -0.1], [0.045, -0.1]], 0.032, 'polymer', 0.003);
    side(g, [[-0.03, -0.03], [-0.03, 0.005], [0.03, 0.005], [0.03, -0.03]], 0.012, 'gunmetal', 0, [[[-0.022, -0.024], [-0.022, 0.0], [0.022, 0.0], [0.022, -0.024]]]);
    box(g, 0.006, 0.022, 0.005, 'light', 0, -0.01, 0.0, 0, 0.3);
    // handguard
    const hgL = o.handguard == null ? 0.22 : o.handguard; const hgZ0 = -RL, hgZ1 = -RL - hgL;
    if (hgL > 0) {
      side(g, [[hgZ1, 0.03], [hgZ1, 0.03 + RH * 0.8], [hgZ0, 0.03 + RH * 0.85], [hgZ0, 0.03]], T * 0.95, o.wood ? 'wood' : 'polymer', 0.005);
      if (!o.wood) for (let i = 0; i < Math.floor(hgL / 0.03); i++) box(g, T + 0.002, 0.006, 0.014, 'dark', 0, 0.03 + RH * 0.45, hgZ1 + 0.012 + i * 0.03); // rail slots
    }
    // barrel(s)
    const bl = o.len, bz0 = hgZ1, br = o.barrelR || 0.011; const by = 0.03 + RH * 0.55;
    if (o.twinBarrel) { cylZ(g, br, bl, 'gunmetal', -0.017, by, bz0 - bl / 2); cylZ(g, br, bl, 'gunmetal', 0.017, by, bz0 - bl / 2); box(g, 0.05, 0.03, 0.04, 'gunmetal', 0, by, bz0 - bl + 0.05); }
    else if (o.multiBarrel) { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cylZ(g, 0.0085, bl, 'gunmetal', Math.cos(a) * 0.026, by + Math.sin(a) * 0.026, bz0 - bl / 2); } cylZ(g, 0.042, 0.05, 'dark', 0, by, bz0 - bl + 0.03); cylZ(g, 0.042, 0.05, 'dark', 0, by, bz0 - 0.05); cylZ(g, 0.01, bl, 'dark', 0, by, bz0 - bl / 2); }
    else { cylZ(g, br, bl, 'gunmetal', 0, by, bz0 - bl / 2); if (o.heavyBarrel) cylZ(g, br * 1.6, bl * 0.5, 'dark', 0, by, bz0 - bl * 0.25); }
    if (o.tube) cylZ(g, 0.011, bl * 0.92 + hgL * 0.5, 'gunmetal', 0, by - 0.03, bz0 - bl * 0.46 + hgL * 0.25);
    if (o.pump) { box(g, T * 1.1, 0.04, 0.13, 'wood', 0, by - 0.035, bz0 - 0.11); for (let i = 0; i < 4; i++) box(g, T * 1.12, 0.004, 0.006, 'dark', 0, by - 0.035, bz0 - 0.06 - i * 0.03); }
    if (o.gasTube) { cylZ(g, 0.007, hgL + bl * 0.55, 'gunmetal', 0, by + 0.035, hgZ0 - (hgL + bl * 0.55) / 2); box(g, 0.03, 0.04, 0.03, 'gunmetal', 0, by + 0.02, bz0 - bl * 0.55); }
    let muzzleZ = bz0 - bl;
    if (o.suppressor) { cylZ(g, 0.021, 0.17, 'dark', 0, by, muzzleZ - 0.085); for (let i = 0; i < 4; i++) cylZ(g, 0.0215, 0.005, 'grey', 0, by, muzzleZ - 0.03 - i * 0.04); muzzleZ -= 0.17; }
    if (o.brake) { box(g, 0.036, 0.036, 0.06, 'grey', 0, by, muzzleZ - 0.03); for (let i = 0; i < 3; i++) { box(g, 0.05, 0.005, 0.007, 'dark', 0, by + 0.019, muzzleZ - 0.012 - i * 0.016); box(g, 0.005, 0.05, 0.007, 'dark', 0.019, by, muzzleZ - 0.012 - i * 0.016); } muzzleZ -= 0.06; }
    // top rail + sights
    box(g, 0.02, 0.008, RL - 0.02, 'dark', 0, 0.03 + RH + 0.004, -RL / 2 + 0.02);
    for (let i = 0; i < Math.floor((RL - 0.02) / 0.012); i++) box(g, 0.021, 0.004, 0.006, 'grey', 0, 0.03 + RH + 0.009, -RL + 0.02 + i * 0.012);
    box(g, 0.01, 0.022, 0.01, 'light', 0, by + 0.03, bz0 - bl + 0.025); // front post
    box(g, 0.026, 0.014, 0.014, 'dark', 0, 0.03 + RH + 0.012, 0.03); // rear sight
    if (o.carry) { side(g, [[-RL * 0.85, 0.03 + RH + 0.008], [-RL * 0.85, 0.03 + RH + 0.05], [-0.02, 0.03 + RH + 0.05], [-0.02, 0.03 + RH + 0.008]], 0.03, 'gunmetal', 0.003, [[[-RL * 0.75, 0.03 + RH + 0.016], [-RL * 0.75, 0.03 + RH + 0.04], [-0.06, 0.03 + RH + 0.04], [-0.06, 0.03 + RH + 0.016]]]); }
    // charging handle (right side)
    box(g, 0.014, 0.012, 0.03, 'light', T / 2 + 0.006, 0.03 + RH * 0.7, -RL * 0.35);
    box(g, 0.006, 0.008, RL * 0.5, 'dark', T / 2 + 0.002, 0.03 + RH * 0.7, -RL * 0.5); // ejection port slot
    // scope
    let scope = null;
    if (o.scope && o.scope !== 'none') {
      const s = { small: [0.015, 0.09], mid: [0.02, 0.17], big: [0.03, 0.3] }[o.scope];
      const sy = 0.03 + RH + 0.03 + s[0]; const sz = -RL * 0.45; scope = node(g, 0, sy, sz);
      cylZ(g, s[0], s[1], 'dark', 0, sy, sz); cylZ(g, s[0] * 1.35, 0.035, 'dark', 0, sy, sz - s[1] / 2 + 0.005, s[0] * 1.15); cylZ(g, s[0] * 1.25, 0.03, 'dark', 0, sy, sz + s[1] / 2 - 0.005, s[0] * 1.1);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(s[0] * 1.05, 16), M('glass')); lens.position.set(0, sy, sz - s[1] / 2 - 0.013); lens.rotation.y = Math.PI; g.add(lens);
      box(g, 0.022, 0.03, 0.025, 'dark', 0, sy - s[0] - 0.012, sz - s[1] * 0.28); box(g, 0.022, 0.03, 0.025, 'dark', 0, sy - s[0] - 0.012, sz + s[1] * 0.28);
      cylX(g, 0.012, 0.03, 'dark', 0, sy + s[0] + 0.005, sz); cylZ(g, 0.012, 0.03, 'dark', s[0] + 0.005, sy, sz); // turrets
    } else if (o.smallOptic) { box(g, 0.026, 0.03, 0.05, 'dark', 0, 0.03 + RH + 0.026, -RL * 0.35); const l = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.02), M('glass')); l.position.set(0, 0.03 + RH + 0.03, -RL * 0.35 - 0.026); l.rotation.y = Math.PI; g.add(l); }
    // magazine
    let mag = null; const mz = o.mag && o.mag.front != null ? o.mag.front : -RL * 0.5;
    if (o.mag) {
      const mh = o.mag.h || 0.16, mw = o.mag.w || 0.03;
      if (o.mag.drum) mag = cylX(g, mh / 2, 0.075, 'gunmetal', 0, 0.0 - mh / 2 + 0.01, mz);
      else if (o.mag.box) { mag = box(g, 0.12, 0.15, 0.17, 'grey', -0.09, -0.02, mz); box(g, 0.125, 0.02, 0.175, 'dark', -0.09, 0.055, mz); }
      else if (o.mag.curve) mag = side(g, [[mz - 0.03, 0.0], [mz + 0.035, 0.0], [mz + 0.045, -mh * 0.45], [mz + 0.02, -mh], [mz - 0.035, -mh * 0.98], [mz - 0.035, -mh * 0.45]], mw, 'gunmetal', 0.003);
      else mag = side(g, [[mz - 0.03, 0.0], [mz + 0.03, 0.0], [mz + 0.038, -mh], [mz - 0.022, -mh]], mw, 'gunmetal', 0.003);
      if (mag && !o.mag.box && !o.mag.drum) box(g, mw + 0.004, 0.01, 0.07, 'dark', 0, -mh - 0.003, mz + 0.006, 0, 0.0);
    }
    // stock
    const st = o.stock || 'fixed'; const sy0 = 0.03, sy1 = 0.03 + RH * 0.85;
    if (st === 'fixed') { side(g, [[0.09, sy0], [0.09, sy1], [0.36, sy1 - 0.01], [0.38, sy1 - 0.02], [0.38, sy0 - 0.045], [0.3, sy0 - 0.03]], T * 0.9, o.wood ? 'wood' : 'polymer', 0.005); box(g, T * 0.95, sy1 - sy0 + 0.04, 0.02, 'dark', 0, (sy0 + sy1) / 2 - 0.015, 0.385); }
    else if (st === 'adj') { cylZ(g, 0.013, 0.2, 'gunmetal', 0, sy1 - 0.02, 0.19); side(g, [[0.24, sy0 - 0.01], [0.24, sy1 + 0.005], [0.34, sy1 + 0.005], [0.35, sy0 - 0.04], [0.28, sy0 - 0.03]], T * 0.85, 'polymer', 0.004); box(g, T * 0.9, 0.09, 0.015, 'dark', 0, sy0 + 0.02, 0.352); }
    else if (st === 'skel') { side(g, [[0.09, sy0 - 0.01], [0.09, sy1 + 0.01], [0.4, sy1 + 0.005], [0.4, sy0 - 0.06], [0.3, sy0 - 0.05]], T * 0.7, 'gunmetal', 0.004, [[[0.13, sy0 + 0.01], [0.13, sy1 - 0.015], [0.34, sy1 - 0.02], [0.34, sy0 - 0.02]]]); box(g, T * 0.8, 0.1, 0.02, 'polymer', 0, sy0 - 0.005, 0.405); box(g, 0.03, 0.02, 0.1, 'polymer', 0, sy1 + 0.02, 0.28); }
    else if (st === 'bullpup') { side(g, [[0.09, sy0 - 0.02], [0.09, sy1 + 0.01], [0.28, sy1 + 0.01], [0.29, sy0 - 0.06], [0.2, sy0 - 0.06]], T, 'polymer', 0.005); }
    else if (st === 'fold') { cylZ(g, 0.008, 0.2, 'gunmetal', 0.02, sy1 - 0.01, 0.19); cylZ(g, 0.008, 0.2, 'gunmetal', 0.02, sy0 + 0.01, 0.19); box(g, 0.03, sy1 - sy0, 0.02, 'gunmetal', 0.02, (sy0 + sy1) / 2, 0.29); }
    if (o.foregrip) side(g, [[hgZ1 + hgL * 0.25 - 0.015, 0.03], [hgZ1 + hgL * 0.25 + 0.015, 0.03], [hgZ1 + hgL * 0.25 + 0.02, -0.06], [hgZ1 + hgL * 0.25 - 0.02, -0.06]], 0.026, 'polymer', 0.003);
    if (o.bipod) { for (const s of [-1, 1]) { box(g, 0.008, 0.14, 0.008, 'gunmetal', s * 0.03, by - 0.08, bz0 - bl * 0.75, 0, 0, s * 0.35); } box(g, 0.05, 0.02, 0.03, 'gunmetal', 0, by - 0.02, bz0 - bl * 0.75); }
    if (o.lever) side(g, [[-0.02, -0.03], [0.05, -0.03], [0.09, -0.02], [0.09, -0.005], [0.03, -0.005], [-0.005, -0.06]], 0.012, 'gunmetal', 0, [[[0.0, -0.02], [0.04, -0.02], [0.06, -0.012], [0.02, -0.012]]]);
    if (o.boltHandle) { cylX(g, 0.006, 0.05, 'light', T / 2 + 0.025, 0.03 + RH * 0.6, -RL * 0.2); const k = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), M('dark')); k.position.set(T / 2 + 0.05, 0.03 + RH * 0.6, -RL * 0.2); g.add(k); }
    if (o.topHandle) { side(g, [[-RL * 0.7, 0.03 + RH + 0.01], [-RL * 0.7, 0.03 + RH + 0.07], [-RL * 0.25, 0.03 + RH + 0.07], [-RL * 0.25, 0.03 + RH + 0.01]], 0.025, 'dark', 0.003, [[[-RL * 0.62, 0.03 + RH + 0.025], [-RL * 0.62, 0.03 + RH + 0.055], [-RL * 0.33, 0.03 + RH + 0.055], [-RL * 0.33, 0.03 + RH + 0.025]]]); }
    if (o.accent) box(g, T + 0.002, 0.012, 0.05, o.accent, 0, 0.03 + RH * 0.35, -RL * 0.65);
    const bolt = box(g, 0.012, 0.014, 0.04, 'light', T / 2 + 0.004, 0.03 + RH * 0.75, -RL * 0.3);
    const muzzle = node(g, 0, by, muzzleZ);
    const gripR = node(g, 0.004, -0.05, 0.052); gripR.rotation.x = -0.2; const gripL = node(g, 0.04, 0.014, o.foregrip ? hgZ1 + hgL * 0.25 - 0.01 : (hgL > 0 ? hgZ1 + hgL * 0.62 : bz0 - 0.04)); if (o.foregrip) { gripL.position.set(0.004, -0.035, hgZ1 + hgL * 0.25); gripL.rotation.x = -0.15; }
    return finish(g, { muzzle, bolt, mag, gripR, gripL, scope, length: -muzzleZ + 0.4 });
  }
  function knife() {
    const g = new THREE.Group();
    side(g, [[0.0, -0.012], [0.0, 0.012], [0.11, 0.014], [0.115, -0.01]], 0.022, 'polymer', 0.003); // handle
    for (let i = 0; i < 4; i++) box(g, 0.024, 0.004, 0.005, 'grey', 0, 0.0, 0.02 + i * 0.022);
    box(g, 0.026, 0.036, 0.01, 'light', 0, 0, -0.005); // guard
    side(g, [[-0.01, -0.016], [-0.01, 0.014], [-0.14, 0.012], [-0.2, 0.0], [-0.14, -0.012]], 0.004, 'blade', 0);
    side(g, [[-0.012, -0.018], [-0.012, -0.011], [-0.14, -0.014], [-0.195, -0.002]], 0.0045, 'edge', 0);
    for (let i = 0; i < 5; i++) box(g, 0.005, 0.007, 0.006, 'edge', 0, 0.016, -0.03 - i * 0.012);
    const gripR = node(g, 0.0, 0.0, 0.058); gripR.rotation.x = Math.PI / 2;   // handle axis through the fist, blade out the thumb side
    return finish(g, { muzzle: node(g, 0, 0, -0.2), gripR, length: 0.3 });
  }
  function spike() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 8), M('spike')); body.position.y = 0.15; g.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 8, 24), M('spikeGlow')); ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; g.add(ring);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; box(g, 0.02, 0.22, 0.02, 'spikeGlow', Math.cos(a) * 0.12, 0.15, Math.sin(a) * 0.12); }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.06, 8), M('spike')); top.position.y = 0.33; g.add(top);
    box(g, 0.14, 0.02, 0.02, 'gunmetal', 0, 0.4, 0); box(g, 0.02, 0.06, 0.02, 'gunmetal', -0.06, 0.37, 0); box(g, 0.02, 0.06, 0.02, 'gunmetal', 0.06, 0.37, 0);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), M('spikeGlow')); core.position.y = 0.36; g.add(core);
    const gripR = node(g, 0.14, 0.2, 0); gripR.rotation.z = -Math.PI / 2; const gripL = node(g, -0.14, 0.2, 0); gripL.rotation.z = Math.PI / 2;
    return finish(g, { muzzle: node(g, 0, 0.4, 0), gripR, gripL, length: 0.4 });
  }

  const BUILDERS = {
    classic: () => pistol({ len: 0.19 }),
    shorty: () => pistol({ len: 0.16, twin: true }),
    frenzy: () => pistol({ len: 0.2, mag: 0.075, compensator: true, vents: true }),
    ghost: () => pistol({ len: 0.21, suppressor: true }),
    sheriff: () => pistol({ len: 0.27, revolver: true }),
    stinger: () => longGun({ len: 0.11, recvLen: 0.24, recvH: 0.075, stock: 'fold', mag: { h: 0.15, w: 0.026, curve: true }, handguard: 0.07, brake: true, thick: 0.05 }),
    spectre: () => longGun({ len: 0.13, recvLen: 0.27, recvH: 0.068, stock: 'adj', mag: { h: 0.17, w: 0.028 }, handguard: 0.11, suppressor: true, foregrip: true, smallOptic: true }),
    bucky: () => longGun({ len: 0.32, recvLen: 0.22, recvH: 0.075, stock: 'fixed', wood: true, handguard: 0.0, pump: true, tube: true, barrelR: 0.013 }),
    judge: () => longGun({ len: 0.22, recvLen: 0.3, recvH: 0.085, stock: 'bullpup', mag: { h: 0.14, drum: true, front: -0.13 }, handguard: 0.13, barrelR: 0.015, brake: true }),
    bulldog: () => longGun({ len: 0.2, recvLen: 0.22, recvH: 0.08, stock: 'bullpup', mag: { h: 0.16, w: 0.03, front: 0.17 }, handguard: 0.13, carry: true }),
    guardian: () => longGun({ len: 0.36, recvLen: 0.3, recvH: 0.08, stock: 'fixed', mag: { h: 0.14, w: 0.03 }, handguard: 0.2, scope: 'mid' }),
    phantom: () => longGun({ len: 0.16, recvLen: 0.3, recvH: 0.07, stock: 'adj', mag: { h: 0.18, w: 0.03 }, handguard: 0.25, suppressor: true, barrelR: 0.014, smallOptic: true, accent: 'teal' }),
    vandal: () => longGun({ len: 0.24, recvLen: 0.27, recvH: 0.072, stock: 'fixed', mag: { h: 0.19, w: 0.032, curve: true }, handguard: 0.17, gasTube: true, brake: true, wood: true }),
    marshal: () => longGun({ len: 0.42, recvLen: 0.24, recvH: 0.07, stock: 'fixed', wood: true, handguard: 0.15, tube: true, lever: true, scope: 'mid' }),
    outlaw: () => longGun({ len: 0.5, recvLen: 0.3, recvH: 0.08, stock: 'skel', mag: { h: 0.09, w: 0.03 }, handguard: 0.15, twinBarrel: true, scope: 'big', bipod: true, boltHandle: true }),
    operator: () => longGun({ len: 0.56, recvLen: 0.34, recvH: 0.09, stock: 'skel', mag: { h: 0.12, w: 0.034 }, handguard: 0.2, barrelR: 0.017, brake: true, scope: 'big', bipod: true, boltHandle: true, heavyBarrel: true }),
    ares: () => longGun({ len: 0.36, recvLen: 0.32, recvH: 0.085, stock: 'fixed', mag: { h: 0.17, drum: true, front: -0.1 }, handguard: 0.2, carry: true, bipod: true, barrelR: 0.013 }),
    odin: () => longGun({ len: 0.42, recvLen: 0.34, recvH: 0.1, stock: 'skel', mag: { box: true, front: -0.1 }, handguard: 0.0, multiBarrel: true, topHandle: true, thick: 0.06 }),
    knife: knife, spike: spike
  };
  function build(id, quality) {
    const fn = BUILDERS[id] || BUILDERS.classic; const g = fn();
    if (quality === 'world') { g.traverse(o => { if (o.isMesh) o.castShadow = true; }); }
    const wd = VAL.WEAPON_BY_ID ? VAL.WEAPON_BY_ID[id] : null;
    g.userData.id = id; g.userData.cat = wd ? wd.cat : (id === 'knife' ? 'knife' : id === 'spike' ? 'spike' : 'rifle');
    g.name = 'weapon_' + id; return g;
  }
  // ---- first-person view placement (camera space, camera at origin looking -Z) ----
  const VIEW = {};
  const rifleV = { pos: [0.19, -0.15, -0.38], rot: [0.02, 0.06, 0.02], adsPos: [0, -0.095, -0.34], scale: 0.8, bob: { amp: 1, rate: 1 }, recoilKick: { back: 0.045, up: 0.02 } };
  const pistolV = { pos: [0.17, -0.15, -0.34], rot: [0.02, 0.07, 0.02], adsPos: [0, -0.095, -0.34], scale: 0.8, bob: { amp: 0.8, rate: 1 }, recoilKick: { back: 0.035, up: 0.03 } };
  const sniperV = { pos: [0.19, -0.16, -0.42], rot: [0.02, 0.06, 0.02], adsPos: [0, -0.095, -0.34], scale: 0.8, bob: { amp: 1.1, rate: 0.9 }, recoilKick: { back: 0.09, up: 0.05 } };
  const heavyV = { pos: [0.19, -0.16, -0.38], rot: [0.02, 0.06, 0.02], adsPos: [0, -0.105, -0.34], scale: 0.8, bob: { amp: 1.2, rate: 0.85 }, recoilKick: { back: 0.05, up: 0.02 } };
  ['classic', 'shorty', 'frenzy', 'ghost', 'sheriff'].forEach(k => VIEW[k] = pistolV);
  ['stinger', 'spectre', 'bucky', 'judge', 'bulldog', 'guardian', 'phantom', 'vandal'].forEach(k => VIEW[k] = rifleV);
  ['marshal', 'outlaw', 'operator'].forEach(k => VIEW[k] = sniperV); ['ares', 'odin'].forEach(k => VIEW[k] = heavyV);
  // forward grip, fist low right, blade rising toward the centre; a wider viewmodel FOV keeps the near hand from filling the screen
  VIEW.knife = { pos: [0.21, -0.27, -0.40], rot: [0.5, 0.55, 0.0], adsPos: [0.21, -0.27, -0.40], scale: 0.85, fov: 66, bob: { amp: 1, rate: 1 }, recoilKick: { back: 0.02, up: 0.0 } };
  VIEW.spike = { pos: [0.18, -0.34, -0.42], rot: [0.1, 0.3, 0], adsPos: [0.18, -0.34, -0.42], scale: 0.85, bob: { amp: 1, rate: 1 }, recoilKick: { back: 0, up: 0 } };

  // ---- arms ----
  // Hand local frame: wrist at origin, fingers point -Z, back of hand +Y (palm faces -Y), thumb on -X for the right hand (+X for the left).
  const HAND = { len: 0.092, width: 0.084, thick: 0.03 };
  function capZ(len, r, mat) { const geo = new THREE.CapsuleGeometry(r, Math.max(0.004, len - r * 2), 3, 8); geo.rotateX(Math.PI / 2); geo.translate(0, 0, -len / 2); return new THREE.Mesh(geo, M(mat)); }
  function fingerChain(parent, x, lens, radius, mat) {
    const joints = []; let p = parent;
    for (let i = 0; i < 3; i++) {
      const j = new THREE.Group(); j.position.set(i === 0 ? x : 0, 0, i === 0 ? -HAND.len + 0.006 : -lens[i - 1] + 0.004); p.add(j);
      j.add(capZ(lens[i], radius * (1 - i * 0.1), mat)); joints.push(j); p = j;
    }
    return joints;
  }
  function hand(parent, side) {
    const h = new THREE.Group(); parent.add(h);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(HAND.width, HAND.thick, HAND.len), M('glove')); palm.position.set(0, 0, -HAND.len / 2); h.add(palm);
    const palmCap = new THREE.Mesh(new THREE.CylinderGeometry(HAND.thick / 2, HAND.thick / 2, HAND.width, 10), M('glove')); palmCap.rotation.z = Math.PI / 2; palmCap.position.set(0, 0, -HAND.len + 0.004); h.add(palmCap);
    box(h, HAND.width * 0.78, 0.008, 0.028, 'knuckle', 0, HAND.thick / 2 + 0.002, -HAND.len + 0.024);
    box(h, HAND.width * 0.6, 0.006, 0.02, 'knuckle', 0, HAND.thick / 2 + 0.001, -HAND.len * 0.5);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.047, 0.055, 14), M('glove')); cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0, 0.022); h.add(cuff);
    const strip = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0035, 6, 20), M('accent')); strip.position.set(0, 0, 0.004); h.add(strip);
    const fingers = [];
    const xs = [-0.031, -0.01, 0.011, 0.031].map(v => v * (side > 0 ? 1 : -1)); // index next to the thumb (-X on the right hand)
    const lens = [[0.036, 0.024, 0.02], [0.038, 0.026, 0.021], [0.035, 0.024, 0.02], [0.028, 0.02, 0.017]];
    for (let i = 0; i < 4; i++) fingers.push(fingerChain(h, xs[i], lens[i], 0.0092 - i * 0.0006, 'glove'));
    const thumbRoot = new THREE.Group(); thumbRoot.position.set(-side * (HAND.width / 2 - 0.004), -0.004, -0.028); thumbRoot.rotation.set(0.15, side * 1.0, 0); h.add(thumbRoot);
    const tj1 = new THREE.Group(); thumbRoot.add(tj1); tj1.add(capZ(0.038, 0.011, 'glove'));
    const tj2 = new THREE.Group(); tj2.position.set(0, 0, -0.034); tj1.add(tj2); tj2.add(capZ(0.03, 0.0095, 'glove'));
    h.userData = { fingers, thumb: [thumbRoot, tj1, tj2], side };
    return h;
  }
  function setHandPose(h, pose) {
    const ud = h.userData; if (!ud || !ud.fingers) return;
    const curls = pose.curls || null; const base = pose.curl == null ? 0.2 : pose.curl;
    ud.fingers.forEach((chain, i) => { const c = curls && curls[i] != null ? curls[i] : base; chain[0].rotation.x = -c * 1.2; chain[1].rotation.x = -c * 1.45; chain[2].rotation.x = -c * 1.0; chain[0].rotation.y = (pose.spread || 0) * (i - 1.5) * 0.12 * (ud.side > 0 ? 1 : -1); });
    const t = pose.thumb == null ? base : pose.thumb; ud.thumb[1].rotation.x = -t * 0.8; ud.thumb[2].rotation.x = -t * 0.9;
  }
  function armSegment(parent, len, r0, r1, mat) {
    const geo = new THREE.CylinderGeometry(r1, r0, len, 14); geo.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(geo, M(mat)); parent.add(m);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r0, 12, 8), M(mat)); parent.add(ball);
    return m;
  }
  function buildArms(skin) {
    skin = skin || {};
    if (skin.sleeve) M('sleeve').color.set(skin.sleeve); if (skin.accent) { M('accent').color.set(skin.accent); M('accent').emissive.set(skin.accent); }
    const arms = new THREE.Group(); arms.name = 'arms';
    const mk = (side) => {
      const shoulder = new THREE.Group(); shoulder.position.set(side * 0.25, -0.4, -0.04); arms.add(shoulder);
      armSegment(shoulder, 0.32, 0.052, 0.046, 'sleeve');
      const elbow = new THREE.Group(); elbow.position.set(0, -0.32, 0); shoulder.add(elbow);
      armSegment(elbow, 0.31, 0.046, 0.038, 'sleeve');
      const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.043, 0.085, 14), M('glove')); bracer.position.y = -0.27; elbow.add(bracer);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0445, 0.0455, 0.012, 14), M('accentSoft')); stripe.position.y = -0.22; elbow.add(stripe);
      const wrist = new THREE.Group(); wrist.position.set(0, -0.31, 0); elbow.add(wrist);
      const hd = hand(wrist, side);
      return { shoulder, elbow, wrist, hand: hd, L1: 0.32, L2: 0.31 };
    };
    arms.userData = { left: mk(-1), right: mk(1) };
    arms.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
    return arms;
  }
  // hand orientation bases (hand-local -> grip-node-local). columns = images of local X, Y, Z axes.
  const basisQ = (X, Y, Z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z)));
  const BASIS = {
    vgripR: basisQ([0, -1, 0], [1, 0, 0], [0, 0, 1]),   // palm faces -X (toward the grip), fingers forward, thumb up
    vgripL: basisQ([0, 1, 0], [-1, 0, 0], [0, 0, 1]),   // mirrored: palm faces +X
    under: basisQ([0, 0, 1], [0, -1, 0], [1, 0, 0]),    // palm faces up, fingers point -X (wrap the left side of the handguard)
    cradleL: basisQ([0, 0, -1], [0, -1, 0], [-1, 0, 0])
  };
  const POSES = { grip: { curls: [0.45, 0.9, 0.95, 0.95], thumb: 0.55 }, under: { curl: 0.7, thumb: 0.45, spread: 0.3 }, wrap: { curl: 0.8, thumb: 0.5 }, rest: { curl: 0.25, thumb: 0.2, spread: 0.4 }, knife: { curls: [0.85, 0.95, 0.95, 0.95], thumb: 0.7 } };
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3(), _up = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
  function solveArm(arm, targetLocal, hintDir, handQuat) {
    const S = arm.shoulder.position; const L1 = arm.L1, L2 = arm.L2;
    _t.copy(targetLocal).sub(S); let d = _t.length(); const maxD = L1 + L2 - 0.005; if (d > maxD) { _t.multiplyScalar(maxD / d); d = maxD; } if (d < 0.05) d = 0.05;
    const dir = _v.copy(_t).normalize();
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d); const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const hint = _up.copy(hintDir).addScaledVector(dir, -hintDir.dot(dir)).normalize();
    if (!isFinite(hint.x) || hint.lengthSq() < 1e-6) hint.set(0, -1, 0);
    const upper = dir.clone().multiplyScalar(Math.cos(a)).add(hint.clone().multiplyScalar(Math.sin(a))).normalize();
    _q.setFromUnitVectors(_down, upper); arm.shoulder.quaternion.copy(_q);
    const elbowPos = S.clone().add(upper.clone().multiplyScalar(L1));
    const toT = targetLocal.clone().sub(elbowPos).normalize();
    const toTlocal = toT.applyQuaternion(_q.clone().invert());
    arm.elbow.quaternion.setFromUnitVectors(_down, toTlocal);
    if (handQuat) { const q = arm.shoulder.quaternion.clone().multiply(arm.elbow.quaternion).invert().multiply(handQuat); arm.wrist.quaternion.copy(q); }
  }
  const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _hint = new THREE.Vector3(), _pq = new THREE.Quaternion();
  // gripPoint: where the grip axis passes through the hand, in hand-local space (palm centre, just below the palm surface)
  function gripTarget(arms, node, basis, gripPoint) {
    node.getWorldPosition(_wp); const pos = arms.worldToLocal(_wp.clone());
    node.getWorldQuaternion(_wq); arms.getWorldQuaternion(_pq); const q = _pq.clone().invert().multiply(_wq).multiply(basis); // fresh quaternion per hand (shared temps must not leak)
    const gp = (gripPoint || new THREE.Vector3(0, -0.02, -0.05)).clone().applyQuaternion(q);
    pos.sub(gp); // place the wrist so that the grip point lands on the node
    return { pos, q };
  }
  function poseArms(arms, weapon, id, blend) {
    if (!arms || !arms.userData.right) return;
    const A = arms.userData; const ud = weapon && weapon.userData; if (!arms.parent) return;
    arms.parent.updateMatrixWorld(true);
    const restR = { pos: new THREE.Vector3(0.3, -0.4, -0.22), q: null }, restL = { pos: new THREE.Vector3(-0.32, -0.42, -0.18), q: null };
    const R = A.right, L = A.left;
    const def = VAL.WEAPON_BY_ID ? VAL.WEAPON_BY_ID[id] : null; const cat = def ? def.cat : 'rifle';
    if (id === 'knife') {
      const tR = ud && ud.gripR ? gripTarget(arms, ud.gripR, BASIS.vgripR) : restR;
      solveArm(R, tR.pos, _hint.set(0.7, -1, 0.15), tR.q); setHandPose(R.hand, POSES.knife);
      solveArm(L, restL.pos, _hint.set(-0.8, -1, 0.2), null); setHandPose(L.hand, POSES.rest);
      L.shoulder.visible = false; R.shoulder.visible = true; return;
    }
    L.shoulder.visible = true; R.shoulder.visible = true;
    const tR = ud && ud.gripR ? gripTarget(arms, ud.gripR, BASIS.vgripR) : restR;
    const leftBasis = (cat === 'sidearm') ? BASIS.vgripL : (id === 'spike' ? BASIS.cradleL : BASIS.under);
    const tL = ud && ud.gripL ? gripTarget(arms, ud.gripL, leftBasis) : restL;
    solveArm(R, tR.pos, _hint.set(0.75, -1, 0.1), tR.q); setHandPose(R.hand, POSES.grip);
    solveArm(L, tL.pos, _hint.set(-0.85, -1, 0.25), tL.q); setHandPose(L.hand, cat === 'sidearm' ? POSES.wrap : POSES.under);
  }
  // ---- icon renderer ----
  let iconRenderer = null, iconScene = null, iconCam = null; const iconCache = {};
  function iconDataURL(id, w, h) {
    w = w || 256; h = h || 96; const key = id + '_' + w + 'x' + h; if (iconCache[key]) return iconCache[key];
    try {
      if (!iconRenderer) { iconRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); iconRenderer.outputColorSpace = THREE.SRGBColorSpace; iconScene = new THREE.Scene(); iconScene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6)); const key2 = new THREE.DirectionalLight(0xffffff, 1.4); key2.position.set(1, 1.2, 1.5); iconScene.add(key2); iconCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10); }
      iconRenderer.setSize(w, h, false);
      const g = build(id, 'world'); iconScene.add(g);
      const bb = new THREE.Box3().setFromObject(g); const size = bb.getSize(new THREE.Vector3()); const c = bb.getCenter(new THREE.Vector3());
      const span = Math.max(size.z * 1.1, size.y * (w / h) * 1.1); const halfW = span / 2, halfH = halfW * h / w;
      iconCam.left = -halfW; iconCam.right = halfW; iconCam.top = halfH; iconCam.bottom = -halfH; iconCam.updateProjectionMatrix();
      iconCam.position.set(c.x + 3, c.y, c.z); iconCam.lookAt(c.x, c.y, c.z);
      const saved = []; g.traverse(o => { if (o.isMesh) { saved.push([o, o.material]); o.material = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.6, metalness: 0.2 }); } });
      iconRenderer.setClearColor(0x000000, 0); iconRenderer.render(iconScene, iconCam);
      const url = iconRenderer.domElement.toDataURL('image/png');
      saved.forEach(([o, m]) => o.material = m); iconScene.remove(g);
      iconCache[key] = url; return url;
    } catch (e) { console.warn('icon render failed', e); return ''; }
  }
  return { build, VIEW, buildArms, poseArms, iconDataURL, BUILDERS, M };
})();
