// Bot AI: perception with FOV + reaction time, human-like aim error, nav pathing, team strategy.
window.VAL = window.VAL || {};
(function () {
  const U = VAL.U;
  const R = () => VAL.RULES;
  const NAMES = { jett: 'Jett', sage: 'Sage', sova: 'Sova', omen: 'Omen', phoenix: 'Phoenix', reyna: 'Reyna', killjoy: 'Killjoy', cypher: 'Cypher', raze: 'Raze', brimstone: 'Brimstone' };

  class Bot {
    constructor(game, map, agent, team, name, skill) {
      this.game = game; this.map = map; this.agent = agent; this.team = team; this.name = name || NAMES[agent] || agent;
      this.isPlayer = false; this.isBot = true;
      this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.aimYaw = 0; this.aimPitch = 0;
      this.alive = true; this.health = 100; this.armor = 0; this.armorType = null; this.credits = 800; this.radius = R().capsuleRadius;
      this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0; this.lossStreak = 0;
      this.inv = { primary: null, secondary: new VAL.Weapon('classic'), knife: new VAL.Weapon('knife'), spike: false };
      this.slot = 'secondary'; this.weapon = this.inv.secondary;
      // skill 0..1 (0.35 = silver-ish, 0.7 = diamond-ish)
      this.skill = skill == null ? 0.35 + Math.random() * 0.3 : skill;
      this.reaction = U.lerp(0.42, 0.17, this.skill) + Math.random() * 0.05;   // seconds to start responding
      this.aimSigma = U.lerp(0.85, 0.3, this.skill);                            // degrees of wobble at ~25 m
      this.headPref = U.lerp(0.15, 0.55, this.skill);
      this.turnSpeed = U.lerp(5.5, 11, this.skill);                             // rad/s
      this.fov = U.lerp(95, 115, this.skill) * Math.PI / 180;                   // horizontal detection FOV
      this.aggro = 0.3 + Math.random() * 0.5;                                   // 0 passive .. 1 aggressive
      // perception memory
      this.known = new Map();   // ent -> {x,z,y,t,seen,vx,vz}
      this.target = null; this.targetSince = 0; this.lastSeenTarget = 0; this.noticeT = 0;
      this.aimErr = { x: 0, y: 0 }; this.settle = 0;
      this.fireCd = 0; this.burst = 0; this.burstPause = 0; this.shotIdx = 0; this.reloadT = 0; this.equipT = 0;
      // movement
      this.path = null; this.pathI = 0; this.moveTarget = null; this.repathT = 0; this.wantWalk = false; this.wantCrouch = false; this.stuckT = 0; this.lastPos = new THREE.Vector3();
      this.lookTarget = null;    // {x,y,z} to look at while moving/holding
      this.state = 'idle'; this.stateT = 0; this.role = 'support'; this.plan = null;
      this.holdSpot = null; this.holdT = 0; this.peekT = 0; this.peekDir = 0;
      this.planting = false; this.defusing = false; this.actionT = 0; this.onGround = true;
      this.perceptT = Math.random() * 0.1; this.thinkT = Math.random() * 0.3; this.sayT = 0;
      this.char = null; this.eye = R().eyeHeight; this.crouchT = 0; this.strafeT = 0; this.strafeDir = 0;
      this.buildBody();
    }
    buildBody() {
      if (VAL.Characters && VAL.Characters.build) { try { this.char = VAL.Characters.build(this.agent, { team: this.team }); } catch (e) { console.warn('char build', e); this.char = null; } }
      if (!this.char) this.char = fallbackChar(this.agent);
      this.char.hitboxes.forEach(h => { h.mesh.userData.ent = this; h.mesh.userData.char = this.char; h.mesh.userData.zone = h.zone; });
      this.game.scene.add(this.char.group);
      this.setWeaponModel(this.weapon.id);
    }
    setWeaponModel(id) {
      const mount = this.char.weaponMount || (this.char.parts && this.char.parts.weaponMount);
      if (!mount) return;
      while (mount.children.length) mount.remove(mount.children[0]);
      let g = null; if (VAL.WeaponModels && VAL.WeaponModels.build) { try { g = VAL.WeaponModels.build(id, 'world'); } catch (e) { g = null; } }
      if (!g) { g = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, id === 'knife' ? 0.25 : 0.6), new THREE.MeshStandardMaterial({ color: 0x222 })); g.position.z = -0.2; }
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
      // third-person weapons are rigid, so collapse them to one mesh per material
      if (VAL.Characters && VAL.Characters.mergeStatic) { try { VAL.Characters.mergeStatic(g); } catch (e) { } }
      mount.add(g); this.worldWeapon = g;
      if (this.char && this.char.seat) { try { this.char.seat(g); } catch (e) { } }
    }
    give(id) { const w = new VAL.Weapon(id); if (w.def.cat === 'sidearm') { this.inv.secondary = w; this.switchTo('secondary'); } else { this.inv.primary = w; this.switchTo('primary'); } return w; }
    switchTo(slot, instant) {
      if (slot === 'primary' && !this.inv.primary) slot = 'secondary';
      this.slot = slot; this.weapon = slot === 'spike' ? { id: 'spike', def: VAL.WEAPON_BY_ID.spike, ammo: 0, reserve: 0 } : this.inv[slot];
      this.equipT = instant ? 0 : this.weapon.def.equip; this.reloadT = 0; this.shotIdx = 0; this.setWeaponModel(this.weapon.id);
    }
    bestWeaponSlot() { return this.inv.primary ? 'primary' : 'secondary'; }
    resetForRound(spawn, keepLoadout) {
      this.alive = true; this.health = 100; this.pos.set(spawn.x, this.map.heightAt(spawn.x, spawn.z), spawn.z); this.vel.set(0, 0, 0); this.yaw = spawn.yaw || 0; this.aimYaw = this.yaw; this.pitch = 0; this.aimPitch = 0;
      if (!keepLoadout) { this.inv.primary = null; this.inv.secondary = new VAL.Weapon('classic'); this.armor = 0; this.armorType = null; }
      else for (const k of ['primary', 'secondary']) if (this.inv[k]) { this.inv[k].ammo = this.inv[k].def.mag; this.inv[k].reserve = this.inv[k].def.reserve; }
      this.inv.spike = false; this.switchTo(this.bestWeaponSlot(), true);
      this.known.clear(); this.target = null; this.path = null; this.moveTarget = null; this.state = 'setup'; this.stateT = 0; this.planting = false; this.defusing = false; this.holdSpot = null; this.plan = null; this.crouchT = 0; this.wantCrouch = false;
      if (this.wasDead) { this.rebuildBody(); this.wasDead = false; } // death pose is baked into the rig: start each round with a fresh body
      this.char.group.visible = true; this.char.dead = false; if (this.char.reset) this.char.reset();
      this.char.group.position.copy(this.pos);
      this.char.update(0.016, this.animState(false));
    }
    get speedMult() { let m = this.weapon.def.runMult || 1; if (this.slot === 'spike') m = 1; return m; }
    eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + U.lerp(R().eyeHeight, R().crouchEyeHeight, this.crouchT), this.pos.z); }
    forwardDir() { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
    takeDamage(amount, zone, from, dirFrom) {
      if (!this.alive) return 0;
      let dmg = amount; if (this.armor > 0) { const ta = Math.min(this.armor, dmg * 0.66); this.armor -= ta; dmg -= ta; }
      this.health -= dmg;
      // getting shot: notice the attacker (approximately) immediately
      if (from && from.team !== this.team) { this.remember(from, true, 0.35); if (!this.target || Math.random() < 0.7) { this.target = from; this.noticeT = Math.min(this.noticeT, this.reaction * 0.5); } }
      if (this.planting || this.defusing) { if (Math.random() < 0.6) { this.planting = false; this.defusing = false; this.game.cancelAction && this.game.cancelAction(this); } }
      if (this.health <= 0) { this.health = 0; this.die(); }
      return dmg;
    }
    rebuildBody() {
      // the skinned rig can simply be reset; only the old procedural bodies needed rebuilding
      if (this.char && this.char.reset) { this.char.reset(); return; }
      const old = this.char; const outline = this._outline;
      if (old) { this.game.scene.remove(old.group); try { old.dispose && old.dispose(); } catch (e) { } }
      this.buildBody();
      if (outline && this.char.setOutline) this.char.setOutline(outline);
    }
    die() {
      this.alive = false; this.target = null; this.planting = false; this.defusing = false; this.wantCrouch = false; this.wasDead = true;
      if (this.char) this.char.update(0, this.animState(true));
    }
    // ---------------- perception ----------------
    remember(ent, seen, posNoise) {
      const k = this.known.get(ent) || {};
      const n = posNoise || 0; k.x = ent.pos.x + (Math.random() - 0.5) * n * 2; k.z = ent.pos.z + (Math.random() - 0.5) * n * 2; k.y = ent.pos.y; k.t = this.game.time; k.seen = seen; k.vx = ent.vel.x; k.vz = ent.vel.z;
      this.known.set(ent, k);
    }
    canSee(e, relaxed) {
      if (!e.alive) return false;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z; const d2 = dx * dx + dz * dz;
      if (d2 > 85 * 85) return false;
      const ang = Math.atan2(-dx, -dz); let diff = Math.abs(U.angleWrap(ang - this.yaw));
      const fov = relaxed ? this.fov * 0.75 + 1.0 : this.fov * 0.5;
      if (diff > fov) return false;
      const eye = this.eyePos(); const th = e.pos.y + (e.crouchT > 0.5 ? 0.9 : 1.45);
      if (this.map.lineOfSight(eye.x, eye.y, eye.z, e.pos.x, th, e.pos.z)) return true;
      return this.map.lineOfSight(eye.x, eye.y, eye.z, e.pos.x, e.pos.y + 0.6, e.pos.z);
    }
    perceive(dt) {
      const g = this.game; const now = g.time;
      // visible enemies
      let best = null, bestScore = -1;
      for (const e of g.entities) {
        if (e.team === this.team || !e.alive) continue;
        if (this.canSee(e)) {
          const d = U.dist(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
          const ang = Math.abs(U.angleWrap(U.yawTo(this.pos.x, this.pos.z, e.pos.x, e.pos.z) - this.yaw));
          const k = this.known.get(e);
          const wasKnown = k && (now - k.t) < 3;
          // peripheral / far targets take longer to notice
          const noticeNeeded = this.reaction * (1 + ang * 0.8) * (d > 40 ? 1.4 : 1) * (wasKnown ? 0.5 : 1) * (e.moveSpeedFrac > 0.5 ? 0.8 : 1.15) * (e.crouchT > 0.5 ? 1.2 : 1);
          const seenState = this._seen && this._seen.get(e) || 0;
          const acc = seenState + dt; this._seen = this._seen || new Map(); this._seen.set(e, acc);
          if (acc >= noticeNeeded) {
            this.remember(e, true, 0);
            const score = 1 / (d + 3) + (e === this.target ? 0.15 : 0) + (ang < 0.3 ? 0.1 : 0);
            if (score > bestScore) { bestScore = score; best = e; }
          }
        } else if (this._seen) this._seen.set(e, Math.max(0, (this._seen.get(e) || 0) - dt * 2));
      }
      if (best) {
        if (this.target !== best) { this.target = best; this.targetSince = now; this.settle = 0; this.aimErr.x = (Math.random() - 0.5) * 3; this.aimErr.y = (Math.random() - 0.5) * 2; this.callout(best); }
        this.lastSeenTarget = now;
      } else if (this.target && now - this.lastSeenTarget > 2.5) { this.target = null; }
      // forget stale info
      for (const [e, k] of this.known) if (!e.alive || now - k.t > 14) this.known.delete(e);
      this.visibleTarget = !!best;
    }
    callout(e) { // share info with team (comms) after small delay
      const g = this.game; const now = g.time; if (now - this.sayT < 2) return; this.sayT = now;
      for (const m of g.entities) if (m !== this && m.team === this.team && m.isBot && m.alive) { setTimeout(() => { if (e.alive) m.remember(e, false, 3); }, 500 + Math.random() * 700); }
      if (g.onBotCallout) g.onBotCallout(this, e);
    }
    hear(source, radius) {
      if (source.team === this.team || !this.alive) return;
      const d = U.dist(this.pos.x, this.pos.z, source.pos.x, source.pos.z);
      if (d > radius) return;
      this.remember(source, false, Math.min(6, 1 + d * 0.15));
    }
    // ---------------- combat ----------------
    combat(dt) {
      const t = this.target; const g = this.game;
      if (!t || !t.alive) { this.burst = 0; return false; }
      const d = U.dist(this.pos.x, this.pos.z, t.pos.x, t.pos.z);
      // aim point: head or chest, with lead
      const wantHead = Math.random() < this.headPref || this.weapon.def.cat === 'sniper';
      this._aimHead = this._aimHead == null ? wantHead : (Math.random() < 0.02 ? wantHead : this._aimHead);
      const lead = 0.08 * (1 - this.skill * 0.5);
      const ax = t.pos.x + t.vel.x * lead, az = t.pos.z + t.vel.z * lead;
      const ay = t.pos.y + (this._aimHead ? (t.crouchT > 0.5 ? 1.05 : 1.55) : (t.crouchT > 0.5 ? 0.7 : 1.15));
      const eye = this.eyePos();
      const wantYaw = Math.atan2(-(ax - eye.x), -(az - eye.z));
      const wantPitch = Math.atan2(ay - eye.y, Math.hypot(ax - eye.x, az - eye.z));
      // aim error: Ornstein-Uhlenbeck wobble in degrees, larger when far / target moving / self moving / not settled
      this.settle = Math.min(1, this.settle + dt / (0.55 - this.skill * 0.25));
      const tSpeed = Math.hypot(t.vel.x, t.vel.z), mySpeed = Math.hypot(this.vel.x, this.vel.z);
      const sigma = this.aimSigma * (0.35 + 0.65 * Math.min(1, d / 25)) * (1 + tSpeed * 0.06) * (1 + mySpeed * 0.1) * (1.5 - 0.9 * this.settle) * (this.crouchT > 0.5 ? 0.85 : 1);
      const th = dt * 6;
      this.aimErr.x += (-this.aimErr.x * th) + U.gauss() * sigma * Math.sqrt(th) * 0.9;
      this.aimErr.y += (-this.aimErr.y * th) + U.gauss() * sigma * Math.sqrt(th) * 0.6;
      const d2r = Math.PI / 180;
      // recoil pushes their aim up too (they pull down imperfectly)
      const [ry, rp] = VAL.recoilPattern(this.weapon.def, Math.floor(this.shotIdx));
      const control = 0.25 + this.skill * 0.6; // fraction of recoil compensated
      const tgtYaw = wantYaw + this.aimErr.x * d2r + ry * (1 - control);
      const tgtPitch = wantPitch + this.aimErr.y * d2r + rp * (1 - control);
      // smooth turn with max speed
      const dy = U.angleWrap(tgtYaw - this.yaw), dp = tgtPitch - this.pitch;
      const maxStep = this.turnSpeed * dt;
      this.yaw += U.clamp(dy * Math.min(1, dt * 14), -maxStep, maxStep);
      this.pitch += U.clamp(dp * Math.min(1, dt * 14), -maxStep, maxStep);
      this.pitch = U.clamp(this.pitch, -1.4, 1.4);
      // decide to fire: within tolerance of the true target direction
      const errAng = Math.hypot(U.angleWrap(this.yaw - wantYaw), this.pitch - wantPitch);
      // fire once the reticle is roughly on the target (about the target's angular size, min 2.5 deg); misses come from wobble + spread
      const targetAng = Math.atan2(0.45, Math.max(1, d));
      const tol = Math.max(2.5 * d2r, targetAng * 1.6) * (this.weapon.def.cat === 'sniper' ? 0.6 : 1);
      const def = this.weapon.def; const canShoot = this.visibleTarget && this.equipT <= 0 && this.reloadT <= 0 && !this.planting && !this.defusing;
      this._dbg = { err: (errAng * 180 / Math.PI).toFixed(1), tol: (tol * 180 / Math.PI).toFixed(1), vis: this.visibleTarget, eq: this.equipT.toFixed(2), rl: this.reloadT.toFixed(2), cd: this.fireCd.toFixed(2), bp: this.burstPause.toFixed(2), ammo: this.weapon.ammo, d: d.toFixed(1) };
      if (canShoot && this.slot !== 'knife' && this.weapon.ammo <= 0) { this.startReload(); return true; }
      if (canShoot && this.slot === 'knife' && this.inv.primary) this.switchTo(this.bestWeaponSlot());
      // counter-strafe: plant the feet as soon as the reticle is close (humans stop before shooting)
      if (canShoot && errAng < tol * 1.6 && this.strafeDir === 0) { this.vel.x *= 0.25; this.vel.z *= 0.25; }
      if (canShoot && errAng < tol && this.fireCd <= 0 && this.burstPause <= 0) {
        if (this.slot === 'knife') { if (d < 1.8) { this.fireCd = 0.6; g.meleeHit(this, eye, this.forwardDir(), false); } }
        else this.fireShot(eye, d);
      }
      return true;
    }
    fireShot(eye, d) {
      const w = this.weapon, def = w.def;
      const rate = def.fireRate; this.fireCd = 1 / rate; w.ammo--; this.shotIdx += 1; this.shotT = 0; this.shotsFired = (this.shotsFired || 0) + 1;
      // burst discipline: rifles 4-9 bullets then pause; pistols/snipers tap
      this.burst++;
      const burstLen = def.cat === 'rifle' ? (d < 12 ? 12 : 4 + Math.round(this.skill * 4 + Math.random() * 3)) : def.cat === 'smg' ? 8 : def.cat === 'heavy' ? 15 : 1;
      if (this.burst >= burstLen) { this.burst = 0; this.burstPause = def.cat === 'sniper' ? 0.9 : def.cat === 'sidearm' ? 0.14 + (1 - this.skill) * 0.1 : def.semi ? 0.25 : 0.28 + Math.random() * 0.25; if (def.cat === 'rifle' && Math.random() < 0.5) this.shotIdx = 0; }
      // spread: first shot + movement + bloom
      const d2r = Math.PI / 180; let s = def.firstShotSpread || 0.3; const mySpeed = Math.hypot(this.vel.x, this.vel.z);
      if (mySpeed > 3.5) s += (def.cat === 'sniper' ? 8 : 2.6); else if (mySpeed > 1.2) s += 0.6; if (this.crouchT > 0.5) s *= 0.75;
      if (def.cat === 'sniper' && d > 6) s *= 0.05; // scoped
      s += Math.min(this.shotIdx, 6) * (def.cat === 'rifle' ? 0.07 : def.cat === 'smg' ? 0.06 : def.cat === 'sidearm' ? 0.1 : def.cat === 'heavy' ? 0.05 : 0);
      const pellets = def.pellets || 1;
      for (let p = 0; p < pellets; p++) {
        const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * s * d2r;
        const yaw = this.yaw + Math.cos(ang) * rad, pitch = this.pitch + Math.sin(ang) * rad; // recoil is already in the bot's aim
        const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        this.game.fireBullet(this, eye, dir, def, p === 0);
      }
      this.game.onNoise && this.game.onNoise(this, def.id === 'phantom' || def.id === 'ghost' || def.id === 'spectre' ? 35 : 70);
      if (VAL.Audio) VAL.Audio.play('shot_' + def.id, { pos: eye, vol: 0.9 });
      this.muzzleT = 0.05;
    }
    startReload() { const w = this.weapon; if (!w.isGun || w.reserve <= 0 || this.reloadT > 0) return; this.reloadT = w.def.reload; if (VAL.Audio) VAL.Audio.play('reload_start', { pos: this.pos, vol: 0.5 }); }
    // ---------------- movement ----------------
    goTo(x, z, opts) {
      opts = opts || {};
      if (this.moveTarget && U.dist2(this.moveTarget.x, this.moveTarget.z, x, z) < 1 && this.path) return;
      // a goal inside a prop or a wall can never be pathed to; snap it onto open ground first
      if (!VAL.Nav.walkable(x, z)) { const nw = VAL.Nav.nearestWalkable(x, z); if (nw) { x = nw.x; z = nw.z; } }
      this.moveTarget = { x, z }; this.path = null; this.repathT = 0; this.pathFails = 0;
    }
    stop() { this.moveTarget = null; this.path = null; }
    atTarget(r) { return !this.moveTarget || U.dist(this.pos.x, this.pos.z, this.moveTarget.x, this.moveTarget.z) < (r || 1.2); }
    followPath(dt, speed) {
      if (!this.moveTarget) { this.desiredVel = { x: 0, z: 0 }; return; }
      if (!this.path || this.repathT <= 0) {
        this.repathT = 1.5 + Math.random();
        const blocked = this.game.dynamicBlocked ? this.game.dynamicBlocked(this) : null;
        this.path = VAL.Nav.findPath(this.pos.x, this.pos.z, this.moveTarget.x, this.moveTarget.z, { blocked });
        this.pathI = 0;
        if (!this.path) {
          // Standing still until the brain happens to reassign is what made bots look frozen.
          // Try again from open ground, then fall back to steering straight at the goal.
          this.pathFails = (this.pathFails || 0) + 1;
          const here = VAL.Nav.walkable(this.pos.x, this.pos.z) ? null : VAL.Nav.nearestWalkable(this.pos.x, this.pos.z);
          if (here) { this.pos.x = U.lerp(this.pos.x, here.x, 0.5); this.pos.z = U.lerp(this.pos.z, here.z, 0.5); }
          if (this.pathFails >= 3) { this.moveTarget = null; this.path = null; this.needGoal = true; this.desiredVel = { x: 0, z: 0 }; return; }
          this.repathT = 0.25;
          const dxq = this.moveTarget.x - this.pos.x, dzq = this.moveTarget.z - this.pos.z;
          const dq = Math.hypot(dxq, dzq) || 1;
          this.desiredVel = { x: dxq / dq * speed * 0.7, z: dzq / dq * speed * 0.7 };
          return;
        }
        this.pathFails = 0;
      }
      this.repathT -= dt;
      // advance waypoints
      while (this.pathI < this.path.length - 1 && U.dist(this.pos.x, this.pos.z, this.path[this.pathI].x, this.path[this.pathI].z) < 0.9) this.pathI++;
      const wp = this.path[this.pathI];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z; const d = Math.hypot(dx, dz);
      if (d < 0.05) { this.desiredVel = { x: 0, z: 0 }; return; }
      let vx = dx / d * speed, vz = dz / d * speed;
      // teammate separation
      for (const m of this.game.entities) { if (m === this || !m.alive) continue; const mx = this.pos.x - m.pos.x, mz = this.pos.z - m.pos.z; const md = Math.hypot(mx, mz); if (md < 1.3 && md > 0.01) { vx += mx / md * (1.3 - md) * 4; vz += mz / md * (1.3 - md) * 4; } }
      this.desiredVel = { x: vx, z: vz };
      // stuck detection
      // stuck recovery: first try sliding along the obstacle, then repath, then nudge
      if (U.dist(this.pos.x, this.pos.z, this.lastPos.x, this.lastPos.z) < 0.05 * dt * 60) {
        this.stuckT += dt;
        if (this.stuckT > 0.35) {
          const side = (this.stuckSide = this.stuckSide || (Math.random() < 0.5 ? 1 : -1));
          this.desiredVel = { x: vx * 0.4 - vz / speed * side * speed * 0.8, z: vz * 0.4 + vx / speed * side * speed * 0.8 };
        }
        if (this.stuckT > 1.1) { this.repathT = 0; this.path = null; this.stuckSide = -(this.stuckSide || 1); }
        if (this.stuckT > 2.2) {
          this.stuckT = 0; this.stuckSide = null; this.needGoal = true;
          const nw = VAL.Nav.nearestWalkable(this.pos.x + (Math.random() - 0.5) * 2.5, this.pos.z + (Math.random() - 0.5) * 2.5);
          if (nw) { this.pos.x = U.lerp(this.pos.x, nw.x, 0.35); this.pos.z = U.lerp(this.pos.z, nw.z, 0.35); }
        }
      } else { this.stuckT = 0; this.stuckSide = null; }
      this.lastPos.copy(this.pos);
    }
    physics(dt) {
      const RU = R();
      const dv = this.desiredVel || { x: 0, z: 0 };
      const acc = this.onGround ? 10 : 2;
      this.vel.x = U.damp(this.vel.x, dv.x, acc, dt); this.vel.z = U.damp(this.vel.z, dv.z, acc, dt);
      if (!this.onGround) this.vel.y -= RU.gravity * dt;
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      const [cx, cz] = this.map.collide(nx, nz, this.radius, this.pos.y, this.pos.x, this.pos.z, { isBot: true });
      this.pos.x = cx; this.pos.z = cz;
      let ny = this.pos.y + this.vel.y * dt;
      const ground = this.map.groundAt(cx, cz, this.pos.y, this.radius);
      if (this.onGround) { if (ground <= this.pos.y + 0.7 && ground >= this.pos.y - 0.5) { ny = ground; this.vel.y = 0; } else if (ground < this.pos.y - 0.5) { this.onGround = false; this.vel.y = 0; } else ny = this.pos.y; }
      if (!this.onGround && ny <= ground) { ny = ground; this.onGround = true; this.vel.y = 0; }
      this.pos.y = ny;
      this.crouchT = U.damp(this.crouchT, this.wantCrouch ? 1 : 0, 10, dt);
      const hs = Math.hypot(this.vel.x, this.vel.z); this.moveSpeedFrac = hs / RU.baseSpeed;
      // footsteps (running only)
      if (this.onGround && hs > 3.6) { this.footT = (this.footT || 0) + dt * hs; if (this.footT > 2.55) { this.footT = 0; if (VAL.Audio) VAL.Audio.play('footstep_stone', { pos: this.pos, vol: 0.5, pitch: 0.95 + Math.random() * 0.1 }); this.game.onNoise && this.game.onNoise(this, 18); } }
    }
    // face movement direction / look target when not in combat
    idleLook(dt) {
      let ty = this.yaw, tp = 0;
      if (this.lookTarget) { ty = Math.atan2(-(this.lookTarget.x - this.pos.x), -(this.lookTarget.z - this.pos.z)); const dd = Math.hypot(this.lookTarget.x - this.pos.x, this.lookTarget.z - this.pos.z); tp = Math.atan2((this.lookTarget.y || this.pos.y + 1.4) - (this.pos.y + 1.5), dd) * 0.5; }
      else if (this.moveTarget && Math.hypot(this.vel.x, this.vel.z) > 0.5) ty = Math.atan2(-this.vel.x, -this.vel.z);
      // suspicious known enemy positions: glance toward them
      const k = this.bestKnown(); if (!this.lookTarget && k && Math.random() < 0.6) { ty = Math.atan2(-(k.x - this.pos.x), -(k.z - this.pos.z)); }
      const step = this.turnSpeed * 0.6 * dt;
      this.yaw += U.clamp(U.angleWrap(ty - this.yaw) * Math.min(1, dt * 6), -step, step);
      this.pitch = U.damp(this.pitch, tp, 4, dt);
    }
    bestKnown() { let best = null, bt = -1; for (const [e, k] of this.known) { if (!e.alive) continue; if (k.t > bt) { bt = k.t; best = k; } } return best; }
    animState(dead) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const kind = this.slot === 'knife' ? 'knife' : this.slot === 'spike' ? 'spike' : (this.weapon.def.cat === 'sidearm' ? 'pistol' : this.weapon.def.cat);
      return { moving: Math.min(1, hs / 5.4), running: hs > 3.5, crouching: this.crouchT > 0.5, aimPitch: this.pitch, yaw: this.yaw, dead: !!dead || !this.alive, planting: this.planting, defusing: this.defusing, shooting: (this.shotT || 1) < 0.1, weaponKind: kind };
    }
    // ---------------- main update ----------------
    update(dt) {
      const g = this.game;
      if (!this.alive) { if (this.char) { this.char.group.position.copy(this.pos); this.char.update(dt, this.animState(true)); } return; }
      this.shotT = (this.shotT || 0) + dt;
      if (this.fireCd > 0) this.fireCd -= dt; if (this.burstPause > 0) this.burstPause -= dt; if (this.equipT > 0) this.equipT -= dt;
      if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const w = this.weapon; const need = w.def.mag - w.ammo; const take = Math.min(need, w.reserve); w.ammo += take; w.reserve -= take; } }
      if (this.shotT > 0.22) this.shotIdx = Math.max(0, this.shotIdx - dt * 22);
      this.perceptT -= dt; if (this.perceptT <= 0) { this.perceptT = 0.1; this.perceive(0.1); }
      this.thinkT -= dt; if (this.thinkT <= 0) { this.thinkT = 0.25 + Math.random() * 0.15; this.think(); }
      const inCombat = this.combat(dt);
      if (inCombat) {
        // stop to shoot (counter-strafe), occasional strafe/crouch
        const d = this.target ? U.dist(this.pos.x, this.pos.z, this.target.pos.x, this.target.pos.z) : 99;
        this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = 0.45 + Math.random() * 0.6; const r = Math.random(); this.strafeDir = (this.burstPause > 0 && r < 0.18) ? -1 : (this.burstPause > 0 && r < 0.36) ? 1 : 0; this.wantCrouch = Math.random() < 0.28 && d > 6; }
        if (this.slot === 'knife' && !this.inv.primary && d > 2.5 && this.inv.secondary.ammo > 0) this.switchTo('secondary');
        if (this.strafeDir !== 0 && this.burst === 0) { const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw); const sp = R().baseSpeed * this.speedMult; this.desiredVel = { x: rx * this.strafeDir * sp, z: rz * this.strafeDir * sp }; }
        else this.desiredVel = { x: 0, z: 0 };
        if (this.slot === 'knife' && this.target && d < 12) { this.goTo(this.target.pos.x, this.target.pos.z); this.followPath(dt, R().baseSpeed); }
        if (this.planting || this.defusing) { this.planting = false; this.defusing = false; g.cancelAction && g.cancelAction(this); }
      } else {
        this.wantCrouch = this.holdCrouch || false;
        if (this.reloadT <= 0 && this.weapon.isGun && this.weapon.ammo < this.weapon.def.mag * 0.4 && this.weapon.reserve > 0 && !this.planting && !this.defusing) this.startReload();
        const sp = R().baseSpeed * this.speedMult * (this.wantWalk ? R().walkMult : 1) * (this.wantCrouch ? R().crouchMult : 1);
        if (this.planting || this.defusing) this.desiredVel = { x: 0, z: 0 }; else this.followPath(dt, sp);
        this.idleLook(dt);
      }
      this.physics(dt);
      if (this.char) { this.char.group.position.copy(this.pos); this.char.update(dt, this.animState(false)); }
    }
    // ---------------- strategy (per-bot think, uses team brain) ----------------
    think() {
      const g = this.game; const brain = g.brains && g.brains[this.team]; if (!brain) return;
      try { brain.assign(this); } catch (e) { if (!this._thinkErr) { this._thinkErr = true; console.warn('bot think error', this.name, e); } }
    }
  }

  // ------------- fallback character (if VAL.Characters missing) -------------
  function fallbackChar(agent) {
    const group = new THREE.Group(); const col = { jett: 0x9fd3ff, sage: 0x66cc99, sova: 0x4477dd, omen: 0x443377, phoenix: 0xff7733, reyna: 0x8833aa, killjoy: 0xffdd33, cypher: 0xeeeeee, raze: 0xff9922, brimstone: 0x996633 }[agent] || 0x888888;
    const m = new THREE.MeshStandardMaterial({ color: col });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.28), m); body.position.y = 1.3; group.add(body);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 0.28), new THREE.MeshStandardMaterial({ color: 0x222233 })); legs.position.y = 0.5; group.add(legs);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe0b89a })); head.position.y = 1.62; group.add(head);
    const mount = new THREE.Object3D(); mount.position.set(0.25, 1.25, -0.3); group.add(mount);
    const hb = (mesh, zone) => ({ mesh, zone });
    [body, legs, head].forEach(x => { x.castShadow = true; });
    const ch = { group, parts: { head, torso: body, hips: legs }, hitboxes: [hb(head, 'head'), hb(body, 'body'), hb(legs, 'legs')], weaponMount: mount, dead: false };
    ch.update = (dt, st) => { group.rotation.y = st.yaw || 0; if (st.dead) { group.rotation.z = Math.min(Math.PI / 2, (group.rotation.z || 0) + dt * 4); group.position.y += 0; } else group.rotation.z = 0; body.position.y = st.crouching ? 0.95 : 1.3; head.position.y = st.crouching ? 1.15 : 1.62; };
    ch.setOutline = () => { }; ch.reset = () => { group.rotation.z = 0; }; ch.dispose = () => { };
    return ch;
  }
  VAL.Bot = Bot;
})();
