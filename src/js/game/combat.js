// Combat: bullets, hit detection against map + characters, damage, tracers/impacts.
window.VAL = window.VAL || {};
VAL.Combat = (function () {
  const U = VAL.U;
  let scene = null, map = null, game = null;
  const tracers = [], impacts = [], MAX_IMPACTS = 160;
  let impactGeo = null, impactMat = null, tracerMat = null;
  const _ray = new THREE.Raycaster();
  function init(sc, mp, gm) {
    scene = sc; map = mp; game = gm;
    impactGeo = new THREE.CircleGeometry(0.06, 8); impactMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.8 });
  }
  function damageFor(def, dist, zone) {
    let br = def.dmg[def.dmg.length - 1];
    for (const r of def.dmg) if (dist >= r.r0 && dist < r.r1) { br = r; break; }
    return zone === 'head' ? br.head : zone === 'legs' ? br.leg : br.body;
  }
  // hit test against all alive characters except shooter. returns {ent, zone, dist, point}
  function hitCharacters(shooter, origin, dir, maxDist) {
    const ents = game.entities;
    let best = null;
    for (const e of ents) {
      if (e === shooter || !e.alive || !e.char) continue;
      // quick reject: distance from ray to entity centre
      const cx = e.pos.x - origin.x, cy = e.pos.y + 0.9 - origin.y, cz = e.pos.z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z; if (t < 0 || t > maxDist + 1) continue;
      const px = cx - dir.x * t, py = cy - dir.y * t, pz = cz - dir.z * t;
      if (px * px + py * py + pz * pz > 1.6) continue;
      e.char.group.updateMatrixWorld(true); // hitboxes must be current even when no frame has rendered yet
      _ray.set(origin, dir); _ray.far = maxDist; _ray.near = 0;
      const hits = _ray.intersectObjects(e.char.hitboxes.map(h => h.mesh), false);
      if (hits.length) {
        // prefer head if hit both head and body at nearly same distance
        let h = hits[0]; for (const hh of hits) if (hh.object.userData.zone === 'head' && hh.distance < h.distance + 0.12) { h = hh; break; }
        if (!best || h.distance < best.dist) best = { ent: e, zone: h.object.userData.zone, dist: h.distance, point: h.point };
      }
    }
    return best;
  }
  // main entry: fires one bullet (or pellet). Returns hit info.
  const stats = { char: 0, wall: 0, floor: 0, step: 0, crate: 0, door: 0, none: 0, nearMiss: 0, blockedBeforeTarget: 0, samples: [] };
  function fireBullet(shooter, origin, dir, def, primary) {
    const maxDist = 200;
    const wallHit = map.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, { ground: true });
    const wallDist = wallHit ? wallHit.dist : maxDist;
    const ch = hitCharacters(shooter, origin, dir, wallDist);
    if (ch) stats.char++; else if (wallHit) { stats[wallHit.kind] = (stats[wallHit.kind] || 0) + 1; } else stats.none++;
    if (!ch) {
      const t = shooter.target;
      if (!t || !t.alive) { stats.noTarget = (stats.noTarget || 0) + 1; stats.by = stats.by || {}; stats.by[shooter.name + ':noTarget'] = (stats.by[shooter.name + ':noTarget'] || 0) + 1; }
      else {
        const dT = Math.hypot(t.pos.x - origin.x, t.pos.z - origin.z);
        const tx = t.pos.x - origin.x, ty = (t.pos.y + 1.1) - origin.y, tz = t.pos.z - origin.z; const L = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const ang = Math.acos(Math.max(-1, Math.min(1, (tx * dir.x + ty * dir.y + tz * dir.z) / L))) * 180 / Math.PI;
        const blocked = wallHit && wallHit.dist < dT - 0.5; if (blocked) stats.blockedBeforeTarget++; else stats.nearMiss++;
        const los = map.lineOfSight(origin.x, origin.y, origin.z, t.pos.x, t.pos.y + 1.1, t.pos.z);
        stats.by = stats.by || {}; const key = shooter.name + (blocked ? ':blocked' : ':miss') + (los ? '' : ':noLOS') + (shooter.visibleTarget ? '' : ':notVis');
        stats.by[key] = (stats.by[key] || 0) + 1;
        if (ang > 8) stats.wild = (stats.wild || 0) + 1;
        if (stats.samples.length < 40) stats.samples.push({ s: shooter.name, t: t.name, dT: dT.toFixed(1), angOff: ang.toFixed(1), hit: wallHit ? wallHit.kind + '@' + wallHit.dist.toFixed(1) + 'y' + wallHit.y.toFixed(1) : 'none', oy: origin.y.toFixed(1), ty: t.pos.y.toFixed(1), w: def.id, los, vis: shooter.visibleTarget });
      }
    } else { stats.byHit = stats.byHit || {}; stats.byHit[shooter.name] = (stats.byHit[shooter.name] || 0) + 1; }
    let endPoint;
    if (ch) {
      endPoint = ch.point;
      const dmg = damageFor(def, ch.dist, ch.zone);
      game.applyDamage(shooter, ch.ent, dmg, ch.zone, def, dir);
      spawnBlood(ch.point, dir);
    } else if (wallHit) {
      endPoint = new THREE.Vector3(wallHit.x, wallHit.y, wallHit.z);
      if (wallHit.kind === 'door' && wallHit.extra) map.damageDoor(wallHit.extra, damageFor(def, wallHit.dist, 'body'));
      spawnImpact(endPoint, wallHit, def);
    } else endPoint = origin.clone().addScaledVector(dir, maxDist);
    if (primary || Math.random() < 0.3) spawnTracer(shooter, origin, endPoint, def);
    return ch || wallHit;
  }
  function meleeHit(shooter, origin, dir, heavy) {
    const range = 1.9;
    const wallHit = map.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, { ground: false });
    const ch = hitCharacters(shooter, origin, dir, wallHit ? wallHit.dist : range);
    if (ch) {
      // backstab: attacker behind target
      const f = U.fwd(ch.ent.yaw); const toT = { x: ch.ent.pos.x - shooter.pos.x, z: ch.ent.pos.z - shooter.pos.z }; const d = Math.hypot(toT.x, toT.z) || 1;
      const behind = (f.x * toT.x + f.z * toT.z) / d > 0.5;
      const dmg = behind ? 150 : (heavy ? 75 : 50);
      game.applyDamage(shooter, ch.ent, dmg, 'body', VAL.WEAPON_BY_ID.knife, dir);
      if (VAL.Audio) VAL.Audio.play('knife_hit', { pos: ch.point });
      spawnBlood(ch.point, dir);
    } else if (wallHit && VAL.Audio) VAL.Audio.play('bullet_impact_stone', { pos: new THREE.Vector3(wallHit.x, wallHit.y, wallHit.z), vol: 0.4 });
  }
  function spawnTracer(shooter, a, b, def) {
    let start = a.clone();
    if (shooter.isPlayer && shooter.vmWeapon && shooter.vmWeapon.userData.muzzle && shooter.vm.visible) { shooter.vmWeapon.userData.muzzle.getWorldPosition(start); }
    else if (shooter.char && shooter.char.weaponMount) { shooter.char.weaponMount.getWorldPosition(start); start.y += 0.05; }
    const geo = new THREE.BufferGeometry().setFromPoints([start, b]);
    const line = new THREE.Line(geo, tracerMat.clone()); line.frustumCulled = false; scene.add(line);
    tracers.push({ obj: line, t: 0.07 });
  }
  function spawnImpact(p, hit, def) {
    const m = new THREE.Mesh(impactGeo, impactMat);
    m.position.copy(p); const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
    if (n.lengthSq() < 0.5) n.set(0, 1, 0);
    m.position.addScaledVector(n, 0.01); m.lookAt(p.clone().add(n)); scene.add(m);
    impacts.push(m); if (impacts.length > MAX_IMPACTS) { const old = impacts.shift(); scene.remove(old); }
    // dust puff
    const puff = new THREE.Sprite(getPuffMat()); puff.position.copy(p).addScaledVector(n, 0.05); puff.scale.setScalar(0.25); scene.add(puff); tracers.push({ obj: puff, t: 0.25, grow: true });
    if (VAL.Audio) VAL.Audio.play(hit.kind === 'crate' ? 'bullet_impact_wood' : hit.kind === 'door' ? 'bullet_impact_metal' : 'bullet_impact_stone', { pos: p, vol: 0.5 });
  }
  let puffMat = null;
  function getPuffMat() {
    if (puffMat) return puffMat;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(210,200,180,0.9)'); g.addColorStop(1, 'rgba(210,200,180,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); puffMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }); return puffMat;
  }
  let bloodMat = null;
  function spawnBlood(p, dir) {
    if (!bloodMat) { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(180,20,30,0.95)'); g.addColorStop(0.5, 'rgba(150,10,20,0.5)'); g.addColorStop(1, 'rgba(120,0,10,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); bloodMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }); }
    for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(bloodMat); s.position.copy(p).addScaledVector(dir, 0.1 + Math.random() * 0.3); s.position.x += (Math.random() - 0.5) * 0.2; s.position.y += (Math.random() - 0.5) * 0.2; s.scale.setScalar(0.18 + Math.random() * 0.2); scene.add(s); tracers.push({ obj: s, t: 0.3 + Math.random() * 0.2, grow: true }); }
  }
  function update(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i]; t.t -= dt;
      if (t.grow) { t.obj.scale.multiplyScalar(1 + dt * 4); if (t.obj.material) t.obj.material.opacity = Math.max(0, t.t * 3); }
      if (t.t <= 0) { scene.remove(t.obj); if (t.obj.geometry && t.obj.type === 'Line') t.obj.geometry.dispose(); tracers.splice(i, 1); }
    }
  }
  function clearImpacts() { for (const m of impacts) scene.remove(m); impacts.length = 0; }
  return { init, fireBullet, meleeHit, update, damageFor, clearImpacts, hitCharacters, stats };
})();
