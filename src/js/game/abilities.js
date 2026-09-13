// Jett's kit for the player: Cloudburst (C), Updraft (Q), Tailwind (E), Blade Storm (X), Drift (passive)
window.VAL = window.VAL || {};
VAL.Abilities = (function () {
  const U = VAL.U;
  const COST = { c: 200, q: 150 };
  const smokes = []; let scene = null, game = null;
  let smokeTex = null;
  function init(g) { game = g; scene = g.scene; const p = g.player; p.abilities = { c: 0, q: 0, e: 1 }; p.ult = 0; p.ultMax = 7; p.ultActive = false; p.knives = 0; p.dashT = 0; p.eKills = 0; }
  function resetRound(p) { p.abilities.e = 1; p.eKills = 0; p.ultActive = false; p.knives = 0; p.dashT = 0; for (const s of smokes) scene.remove(s.mesh); smokes.length = 0; }
  function buy(p, slot) {
    if (!p.abilities) return { ok: false };
    const max = slot === 'c' ? 2 : 2; if (p.abilities[slot] >= max) return { ok: false, msg: 'MAX CHARGES' };
    if (p.credits < COST[slot]) { if (VAL.Audio) VAL.Audio.play('buy_error'); return { ok: false, msg: 'NOT ENOUGH CREDITS' }; }
    p.credits -= COST[slot]; p.abilities[slot]++; if (VAL.Audio) VAL.Audio.play('buy'); return { ok: true };
  }
  function smokeMaterial() {
    if (!smokeTex) { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(235,240,245,0.6)'); g.addColorStop(1, 'rgba(230,235,240,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); smokeTex = new THREE.CanvasTexture(c); }
    return new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.95, color: 0xe8f0f4 });
  }
  function spawnSmoke(pos) {
    const grp = new THREE.Group(); const R = 4.2;
    for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(smokeMaterial()); const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.55, h = (Math.random() - 0.5) * R * 0.9; s.position.set(Math.cos(a) * r, R * 0.5 + h * 0.5, Math.sin(a) * r); s.scale.setScalar(R * (1.2 + Math.random() * 0.6)); grp.add(s); }
    const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.72, 18, 12), new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 1, transparent: true, opacity: 0.92 })); core.position.y = R * 0.5; grp.add(core);
    grp.position.copy(pos); scene.add(grp);
    const sm = { mesh: grp, x: pos.x, y: pos.y + R * 0.5, z: pos.z, r: R * 0.85, t: 4.5, born: game.time };
    smokes.push(sm); game.map.smokes = smokes;
    if (VAL.Audio) VAL.Audio.play('ability_smoke', { pos });
  }
  // does segment a->b pass through an active smoke?
  function blocksLOS(ax, ay, az, bx, by, bz) {
    for (const s of smokes) {
      const dx = bx - ax, dy = by - ay, dz = bz - az; const L2 = dx * dx + dy * dy + dz * dz; if (L2 < 1e-6) continue;
      let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / L2; t = U.clamp(t, 0, 1);
      const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
      if (px * px + py * py + pz * pz < s.r * s.r) return true;
    }
    return false;
  }
  const projectiles = [];
  function update(dt, g) {
    const p = g.player; const input = VAL.Input;
    for (let i = smokes.length - 1; i >= 0; i--) { const s = smokes[i]; s.t -= dt; const age = g.time - s.born; const k = Math.min(1, age * 4); s.mesh.scale.setScalar(0.2 + 0.8 * k); if (s.t < 0.6) s.mesh.children.forEach(c => { if (c.material) c.material.opacity = Math.max(0, s.t / 0.6) * 0.95; }); if (s.t <= 0) { scene.remove(s.mesh); smokes.splice(i, 1); } }
    for (let i = projectiles.length - 1; i >= 0; i--) { const pr = projectiles[i]; pr.vel.y -= 9.8 * dt; pr.pos.addScaledVector(pr.vel, dt); pr.t -= dt; pr.mesh.position.copy(pr.pos); const h = g.map.heightAt(pr.pos.x, pr.pos.z); const hit = g.map.raycast(pr.prev.x, pr.prev.y, pr.prev.z, pr.vel.x, pr.vel.y, pr.vel.z, 0, {}); if (pr.pos.y <= h + 0.2 || pr.t <= 0 || !g.map.isFloor(pr.pos.x, pr.pos.z)) { scene.remove(pr.mesh); projectiles.splice(i, 1); spawnSmoke(new THREE.Vector3(pr.pos.x, Math.max(h, pr.pos.y - 0.2), pr.pos.z)); } pr.prev.copy(pr.pos); }
    if (!p.alive || g.uiOpen || !p.abilities) return;
    const live = g.phase === 'live' || g.phase === 'planted' || g.phase === 'buy';
    // Drift: hold jump while falling
    if (!p.onGround && input.down('jump') && p.vel.y < -1.2) p.vel.y = -1.2;
    if (p.dashT > 0) { p.dashT -= dt; p.vel.x = p.dashDir.x * 26; p.vel.z = p.dashDir.z * 26; p.vel.y = 0; if (p.dashT <= 0) { p.vel.x *= 0.15; p.vel.z *= 0.15; } }
    if (!live) return;
    if (input.justPressed('ability1') && p.abilities.c > 0) { // Cloudburst
      p.abilities.c--; const eye = p.eyePos(); const dir = p.forwardDir(); const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88ccff, emissiveIntensity: 0.8 })); m.position.copy(eye); scene.add(m);
      projectiles.push({ mesh: m, pos: eye.clone(), prev: eye.clone(), vel: dir.clone().multiplyScalar(22).add(new THREE.Vector3(0, 3, 0)), t: 1.6 });
      if (VAL.Audio) VAL.Audio.play('ability_knife_throw', { vol: 0.5 });
    }
    if (input.justPressed('ability2') && p.abilities.q > 0 && p.onGround) { p.abilities.q--; p.vel.y = 9.5; p.onGround = false; if (VAL.Audio) VAL.Audio.play('ability_updraft'); }
    if (input.justPressed('ability3') && p.abilities.e > 0 && p.dashT <= 0) {
      p.abilities.e--; let dx = 0, dz = 0; if (input.down('forward')) dz -= 1; if (input.down('back')) dz += 1; if (input.down('left')) dx -= 1; if (input.down('right')) dx += 1;
      if (!dx && !dz) dz = -1; const l = Math.hypot(dx, dz); dx /= l; dz /= l; const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      p.dashDir = { x: dx * cy + dz * sy, z: -dx * sy + dz * cy }; p.dashT = 0.28; if (VAL.Audio) VAL.Audio.play('ability_dash');
    }
    if (input.justPressed('ult') && !p.ultActive && p.ult >= p.ultMax) { p.ult = 0; p.ultActive = true; p.knives = 5; p.switchTo('knife', true); p.setWeaponModel('knife'); if (VAL.Audio) VAL.Audio.play('ability_knives'); }
  }
  // called by Player.updateWeapons while ultActive; returns true if it consumed the input
  function updateUlt(p, dt, input, g) {
    if (!p.ultActive) return false;
    if (p.slot !== 'knife') { p.ultActive = false; return false; }
    if (p.fireCd > 0) return true;
    const throwKnife = (spread) => {
      const eye = p.eyePos(); const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
      const yaw = p.yaw + Math.cos(ang) * rad, pitch = p.pitch + Math.sin(ang) * rad;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const def = { id: 'knife', name: 'BLADE STORM', cat: 'melee', dmg: [{ r0: 0, r1: 200, head: 150, body: 50, leg: 50 }], pellets: 1 };
      const hit = g.fireBullet(p, eye, dir, def, true); p.knives--; p.vmKick = 1;
      if (VAL.Audio) VAL.Audio.play('ability_knife_throw', { vol: 0.7 });
      if (hit && hit.ent && !hit.ent.alive) p.knives = 5; // kill refreshes knives
    };
    if (input.mouseDown(0) && !p.triggerHeld) { p.triggerHeld = true; p.fireCd = 0.33; throwKnife(0.002); }
    else if (input.mouseDown(2) && p.knives >= 1 && !p.rightHeld) { p.rightHeld = true; const n = p.knives; for (let i = 0; i < n; i++) throwKnife(0.03); p.fireCd = 0.6; }
    if (!input.mouseDown(0)) p.triggerHeld = false; if (!input.mouseDown(2)) p.rightHeld = false;
    if (p.knives <= 0) { p.ultActive = false; p.switchTo(p.inv.primary ? 'primary' : 'secondary'); }
    return true;
  }
  function onKill(p, victim, wasKnife) { if (!p.abilities) return; p.eKills++; if (p.eKills >= 2 && p.abilities.e < 1) { p.abilities.e = 1; p.eKills = 0; } p.ult = Math.min(p.ultMax, p.ult + 1); if (p.ult === p.ultMax && VAL.Audio) VAL.Audio.play('ult_ready'); }
  function onDeath(p) { if (!p.abilities) return; p.ult = Math.min(p.ultMax, p.ult + 1); }
  return { init, resetRound, buy, update, updateUlt, onKill, onDeath, blocksLOS, smokes, COST };
})();
