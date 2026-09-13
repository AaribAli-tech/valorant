// First-person player: movement, weapons, viewmodel.
window.VAL = window.VAL || {};
(function () {
  const U = VAL.U;
  const R = () => VAL.RULES;

  // recoil pattern generator per weapon class: returns [yawOffset, pitchOffset] in radians for shot index i
  function recoilPattern(w, i) {
    const d2r = Math.PI / 180;
    if (w.cat === 'rifle' || w.cat === 'smg' || w.cat === 'heavy') {
      const climb = w.cat === 'smg' ? 0.22 : (w.cat === 'heavy' ? 0.3 : 0.32);
      const up = Math.min(i, 6) * climb + Math.max(0, i - 6) * 0.05;
      const side = i > 6 ? Math.sin((i - 6) * 0.55) * 0.9 + (i - 6) * 0.05 : 0;
      return [side * d2r, up * d2r];
    }
    if (w.cat === 'sidearm') return [0, Math.min(i, 3) * 0.25 * d2r];
    return [0, 0];
  }

  class Weapon {
    constructor(id) { this.id = id; this.def = VAL.WEAPON_BY_ID[id]; this.ammo = this.def.mag; this.reserve = this.def.reserve; }
    get isGun() { return this.def.cat !== 'melee' && this.def.cat !== 'spike'; }
  }

  class Player {
    constructor(scene, camera, map) {
      this.scene = scene; this.camera = camera; this.map = map;
      this.pos = new THREE.Vector3(0, 0, 0); this.vel = new THREE.Vector3();
      this.yaw = 0; this.pitch = 0; this.crouchT = 0; this.onGround = true; this.alive = true;
      this.health = 100; this.armor = 0; this.armorType = null;
      this.team = 'def'; this.agent = 'jett'; this.name = 'You'; this.isPlayer = true; this.credits = 800;
      this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0;
      this.inv = { primary: null, secondary: new Weapon('classic'), knife: new Weapon('knife'), spike: false };
      this.slot = 'secondary'; this.weapon = this.inv.secondary;
      this.equipT = 0; this.reloadT = 0; this.fireCd = 0; this.shotIdx = 0; this.recoilDecay = 0; this.kick = { x: 0, y: 0 }; this.visKick = { x: 0, y: 0 };
      this.ads = 0; this.adsWant = false; this.inspectT = 0;
      this.footT = 0; this.moveSpeedFrac = 0; this.lastFireT = 0; this.useHeld = 0; this.planting = false; this.defusing = false;
      this.radius = R().capsuleRadius; this.eye = R().eyeHeight; this.stepH = 0;
      this.viewLock = false; // planting / defusing etc
      this.buildViewmodel();
      this.dmgFlash = 0; this.lastDamageDir = null; this.abilities = null; this.ult = 0; this.ultMax = 7;
    }
    // ----- viewmodel -----
    buildViewmodel() {
      this.vm = new THREE.Group(); this.vm.name = 'viewmodel';
      this.camera.add(this.vm);
      this.arms = null; this.vmWeapon = null;
      const WM = VAL.WeaponModels;
      // rigged first-person arms (same skeleton as the third-person agents, so the
      // fingers wrap the weapon exactly as the animation poses them)
      this.fpArms = null;
      if (VAL.Characters && VAL.Characters.buildViewArms) {
        try { this.fpArms = VAL.Characters.buildViewArms(this.agent || 'jett'); this.camera.add(this.fpArms.group); }
        catch (e) { console.warn('fp arms', e); this.fpArms = null; }
      }
      if (!this.fpArms && WM && WM.buildArms) { try { this.arms = WM.buildArms({ glove: '#101114', sleeve: '#e9eaee', accent: '#3dc9c0', skinTone: '#e0b89a' }); this.vm.add(this.arms); } catch (e) { console.warn('arms', e); this.arms = null; } }
      this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      this.muzzleFlash.visible = false; this.muzzleLight = new THREE.PointLight(0xffc070, 0, 8); this.vm.add(this.muzzleLight);
      this.setWeaponModel(this.weapon.id);
      // camera-space light so the viewmodel is never pitch black
      const fill = new THREE.PointLight(0xffffff, 0.6, 3); fill.position.set(0.3, 0.2, 0.2); this.vm.add(fill);
      // draw the viewmodel in its own pass with a narrower FOV
      fill.layers.enable(1);
      if (VAL.App && VAL.App.toVMLayer) { VAL.App.toVMLayer(this.vm); if (this.fpArms) VAL.App.toVMLayer(this.fpArms.group); }
    }
    setWeaponModel(id) {
      if (this.vmWeapon && this.vmWeapon.parent) this.vmWeapon.parent.remove(this.vmWeapon);
      const WM = VAL.WeaponModels; let g = null;
      if (WM && WM.build) { try { g = WM.build(id, 'view'); } catch (e) { console.warn('weapon model', id, e); g = null; } }
      if (!g) { g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, id === 'knife' ? 0.25 : 0.6), new THREE.MeshStandardMaterial({ color: 0x2a2d31 })); m.position.z = -0.25; g.add(m); g.userData.muzzle = new THREE.Object3D(); g.userData.muzzle.position.set(0, 0.03, -0.55); g.add(g.userData.muzzle); }
      this.vmWeapon = g;
      this.vm.add(g);
      if (VAL.App && VAL.App.toVMLayer) VAL.App.toVMLayer(g);
      if (this.fpArms) this.fpArms.attach(g);
      this.vmDef = (WM && WM.VIEW && WM.VIEW[id]) || { pos: [0.24, -0.24, -0.45], rot: [0, 0, 0], adsPos: [0, -0.14, -0.35], bob: { amp: 1, rate: 1 }, recoilKick: { back: 0.05, up: 0.02 } };
      if (g.userData.muzzle) { g.userData.muzzle.add(this.muzzleFlash); this.muzzleFlash.position.set(0, 0, -0.02); }
      g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 10; } });
      if (this.arms) this.arms.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
    }
    // ----- inventory -----
    give(id) {
      const w = new Weapon(id); const cat = w.def.cat;
      if (cat === 'sidearm') { this.inv.secondary = w; this.switchTo('secondary'); }
      else { this.inv.primary = w; this.switchTo('primary'); }
      return w;
    }
    removePrimary() { this.inv.primary = null; if (this.slot === 'primary') this.switchTo('secondary'); }
    switchTo(slot, instant) {
      if (slot === 'primary' && !this.inv.primary) return;
      if (slot === 'spike' && !this.inv.spike) return;
      if (this.slot === slot && !instant) return;
      this.slot = slot; this.weapon = slot === 'spike' ? { id: 'spike', def: VAL.WEAPON_BY_ID.spike, ammo: 0, reserve: 0 } : this.inv[slot];
      this.reloadT = 0; this.shotIdx = 0; this.equipT = instant ? 0 : this.weapon.def.equip; this.ads = 0; this.adsWant = false; this.inspectT = 0;
      this.setWeaponModel(this.weapon.id);
      if (VAL.Audio && !instant) VAL.Audio.play(slot === 'knife' ? 'equip_knife' : (this.weapon.def.cat === 'sidearm' ? 'equip_pistol' : 'equip_rifle'));
    }
    resetForRound(spawn, keepLoadout) {
      this.alive = true; this.health = 100; this.pos.set(spawn.x, this.map.heightAt(spawn.x, spawn.z), spawn.z); this.vel.set(0, 0, 0);
      this.yaw = spawn.yaw || 0; this.pitch = 0; this.crouchT = 0; this.planting = false; this.defusing = false; this.viewLock = false;
      if (!keepLoadout) { this.inv.primary = null; this.inv.secondary = new Weapon('classic'); this.armor = 0; this.armorType = null; }
      else { for (const k of ['primary', 'secondary']) if (this.inv[k]) { this.inv[k].ammo = this.inv[k].def.mag; this.inv[k].reserve = this.inv[k].def.reserve; } }
      this.inv.spike = false; this.switchTo(this.inv.primary ? 'primary' : 'secondary', true);
      this.dmgFlash = 0;
    }
    get speedMult() {
      let m = this.weapon.def.runMult; if (this.slot === 'spike') m = 1; if (this.ads > 0.5 && this.weapon.def.ads) m *= 0.82; return m;
    }
    // ----- per frame -----
    update(dt, input, game) {
      const RU = R();
      if (!this.alive) { this.updateViewmodel(dt, 0); return; }
      // look
      const md = input.consumeMouse();
      if (!game.uiOpen) {
        const adsMul = this.ads > 0.5 && this.weapon.def.ads ? 1 / this.weapon.def.ads.zoom : 1;
        this.yaw -= md.dx * adsMul; this.pitch -= md.dy * adsMul;
        this.pitch = U.clamp(this.pitch, -1.5, 1.5);
        if (md.wheel) this.cycleWeapon(md.wheel > 0 ? 1 : -1);
      }
      // movement input
      let fx = 0, fz = 0;
      const canMove = !game.uiOpen && !this.planting && !this.defusing;
      if (canMove) { if (input.down('forward')) fz -= 1; if (input.down('back')) fz += 1; if (input.down('left')) fx -= 1; if (input.down('right')) fx += 1; }
      const walking = input.down('walk'), crouching = input.down('crouch') && canMove;
      this.crouchT = U.damp(this.crouchT, crouching ? 1 : 0, 14, dt);
      const base = RU.baseSpeed * this.speedMult;
      let speed = base; if (crouching) speed = base * RU.crouchMult; else if (walking) speed = base * RU.walkMult;
      const len = Math.hypot(fx, fz); if (len > 0) { fx /= len; fz /= len; }
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      // local (right=fx, forward=-fz) -> world. forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
      const wx = fx * cy + fz * sy, wz = -fx * sy + fz * cy;
      const tvx = wx * speed, tvz = wz * speed;
      const accel = this.onGround ? (len > 0 ? 65 : 55) : 12;
      this.vel.x = U.damp(this.vel.x, tvx, accel / 6, dt); this.vel.z = U.damp(this.vel.z, tvz, accel / 6, dt);
      // jump / gravity
      if (this.onGround && canMove && input.justPressed('jump') && this.crouchT < 0.6) { this.vel.y = RU.jumpVel; this.onGround = false; if (VAL.Audio) VAL.Audio.play('jump', { vol: 0.5 }); this.jumpT = 0; }
      if (!this.onGround) this.vel.y -= RU.gravity * dt;
      // integrate + collide
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      const [cx, cz] = this.map.collide(nx, nz, this.radius, this.pos.y, this.pos.x, this.pos.z, {});
      this.pos.x = cx; this.pos.z = cz;
      let ny = this.pos.y + this.vel.y * dt;
      const ground = this.map.groundAt(cx, cz, this.pos.y, this.radius);
      if (this.onGround) {
        if (ground <= this.pos.y + 0.6 && ground >= this.pos.y - 0.45) { ny = ground; this.vel.y = 0; } // follow terrain / steps
        else if (ground < this.pos.y - 0.45) { this.onGround = false; this.vel.y = 0; }
        else { ny = this.pos.y; }
      }
      if (!this.onGround && ny <= ground) { ny = ground; this.onGround = true; if (this.vel.y < -3 && VAL.Audio) VAL.Audio.play('land', { vol: 0.6 }); this.vel.y = 0; this.landT = 0.15; }
      this.pos.y = ny;
      // footsteps
      const hs = Math.hypot(this.vel.x, this.vel.z); this.moveSpeedFrac = hs / RU.baseSpeed;
      if (this.onGround && hs > base * 0.6 && !walking && !crouching) { this.footT += dt * hs; if (this.footT > 2.55) { this.footT = 0; if (VAL.Audio) VAL.Audio.play('footstep_stone', { vol: 0.55, pitch: 0.95 + Math.random() * 0.1 }); game.onNoise && game.onNoise(this, 18); } } else this.footT = 1.6;
      // camera
      this.eye = U.lerp(RU.eyeHeight, RU.crouchEyeHeight, this.crouchT);
      this.landT = Math.max(0, (this.landT || 0) - dt);
      this.camera.position.set(this.pos.x, this.pos.y + this.eye - this.landT * 0.4, this.pos.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch + this.visKick.y, this.yaw + this.visKick.x, 0);
      // weapons
      this.updateWeapons(dt, input, game, hs, crouching, walking);
      this.updateViewmodel(dt, hs);
      if (this.dmgFlash > 0) this.dmgFlash -= dt;
    }
    cycleWeapon(dir) {
      const order = ['primary', 'secondary', 'knife']; if (this.inv.spike) order.push('spike');
      let i = order.indexOf(this.slot); for (let k = 0; k < order.length; k++) { i = (i + dir + order.length) % order.length; const s = order[i]; if (s === 'primary' && !this.inv.primary) continue; this.switchTo(s); return; }
    }
    currentSpread(hs, crouching) {
      const w = this.weapon.def; if (!this.weapon.isGun && this.slot !== 'primary' && this.slot !== 'secondary') return 0;
      const d2r = Math.PI / 180;
      let s = w.firstShotSpread || 0.3;
      const run = hs / (R().baseSpeed * this.speedMult);
      if (!this.onGround) s += 4.5;
      else if (run > 0.55) s += (w.cat === 'sniper' ? 8 : 2.6) * (run - 0.3) / 0.7;
      else if (run > 0.12) s += 0.6 * run;
      if (crouching) s *= 0.75;
      if (this.ads > 0.5 && w.ads) s *= (w.cat === 'sniper' ? 0.02 : 0.85);
      else if (w.cat === 'sniper') s = Math.max(s, 4.5); // no-scope
      // consecutive shots bloom
      s += Math.min(this.shotIdx, 8) * (w.cat === 'rifle' ? 0.09 : w.cat === 'smg' ? 0.08 : w.cat === 'sidearm' ? 0.18 : w.cat === 'heavy' ? 0.06 : 0);
      return s * d2r;
    }
    updateWeapons(dt, input, game, hs, crouching, walking) {
      const w = this.weapon; const def = w.def;
      if (this.equipT > 0) this.equipT -= dt;
      if (this.fireCd > 0) this.fireCd -= dt;
      this.recoilDecay += dt; if (this.recoilDecay > 0.35) { this.shotIdx = Math.max(0, this.shotIdx - dt * 18); }
      this.visKick.x = U.damp(this.visKick.x, 0, 14, dt); this.visKick.y = U.damp(this.visKick.y, 0, 14, dt);
      if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const need = def.mag - w.ammo; const take = Math.min(need, w.reserve); w.ammo += take; w.reserve -= take; if (VAL.Audio) VAL.Audio.play('reload_end', { vol: 0.5 }); } }
      if (game.uiOpen) { this.adsWant = false; this.ads = U.damp(this.ads, 0, 14, dt); return; }
      if (this.ultActive && VAL.Abilities && VAL.Abilities.updateUlt(this, dt, input, game)) { if (input.justPressed('primary')) this.switchTo('primary'); if (input.justPressed('secondary')) this.switchTo('secondary'); return; }
      // slots
      if (input.justPressed('primary')) this.switchTo('primary');
      if (input.justPressed('secondary')) this.switchTo('secondary');
      if (input.justPressed('melee')) this.switchTo('knife');
      if (input.justPressed('spike')) this.switchTo('spike');
      if (input.justPressed('inspect') && this.equipT <= 0 && this.reloadT <= 0) this.inspectT = 2.0;
      if (input.justPressed('drop') && this.slot !== 'knife' && this.slot !== 'spike' && game.dropWeapon) game.dropWeapon(this);
      // ADS
      this.adsWant = input.mouseDown(2) && def.ads && this.equipT <= 0 && this.reloadT <= 0 && !this.planting;
      this.ads = U.damp(this.ads, this.adsWant ? 1 : 0, 16, dt);
      // reload
      if (input.justPressed('reload') && w.isGun && w.ammo < def.mag && w.reserve > 0 && this.reloadT <= 0 && this.equipT <= 0) { this.reloadT = def.reload; this.shotIdx = 0; this.inspectT = 0; if (VAL.Audio) { VAL.Audio.play('reload_start', { vol: 0.6 }); setTimeout(() => VAL.Audio.play('reload_mag_out', { vol: 0.5 }), def.reload * 300); setTimeout(() => VAL.Audio.play('reload_mag_in', { vol: 0.5 }), def.reload * 700); } }
      // fire
      const wantFire = def.auto ? input.mouseDown(0) : input.justPressed('MouseLeft');
      const press = input.mouseDown(0);
      if (!press) this.triggerHeld = false;
      const fireNow = def.auto ? press : (press && !this.triggerHeld);
      if (fireNow && this.fireCd <= 0 && this.equipT <= 0 && this.reloadT <= 0 && !this.planting && !this.defusing) {
        this.triggerHeld = true;
        if (this.slot === 'spike') { /* spike: no fire */ }
        else if (this.slot === 'knife') this.meleeAttack(game, false);
        else if (w.ammo > 0) this.fire(game, hs, crouching);
        else { if (w.reserve > 0) { this.reloadT = def.reload; if (VAL.Audio) VAL.Audio.play('reload_start', { vol: 0.6 }); } else if (VAL.Audio) VAL.Audio.play('dryfire', { vol: 0.5 }); this.fireCd = 0.25; }
      }
      if (this.slot === 'knife' && input.mouseDown(2) && this.fireCd <= 0 && this.equipT <= 0) { this.meleeAttack(game, true); }
      // Classic alt fire: 3-round burst on right click
      if (def.id === 'classic' && input.mouseDown(2) && !this.altHeld && this.fireCd <= 0 && this.equipT <= 0 && this.reloadT <= 0 && w.ammo > 0) {
        this.altHeld = true; const n = Math.min(3, w.ammo);
        for (let i = 0; i < n; i++) { this.shotIdx += 1; const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin); const s = this.currentSpread(hs, crouching) + 0.06; const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * s; const yaw = this.yaw + Math.cos(ang) * rad, pitch = this.pitch + Math.sin(ang) * rad; const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); game.fireBullet(this, origin, dir, def, i === 0); }
        w.ammo -= n; this.fireCd = 0.5; this.visKick.y += 0.03; this.vmKick = 1; this.muzzleFlash.visible = true; this.flashT = 0.05; this.muzzleLight.intensity = 3; if (VAL.Audio) VAL.Audio.play('shot_classic', { vol: 0.9 }); game.onNoise && game.onNoise(this, 70);
      }
      if (!input.mouseDown(2)) this.altHeld = false;
      // use key: switches / spike plant / defuse handled by game
      this.useHeld = input.down('use');
      if (input.justPressed('use')) { const sw = this.map.nearestSwitch(this.pos.x, this.pos.z, this.pos.y); if (sw) this.map.toggleDoor(sw.door); }
    }
    fire(game, hs, crouching) {
      const w = this.weapon, def = w.def;
      let rate = def.fireRate; if (this.ads > 0.5 && def.ads && def.ads.fireRate) rate = def.ads.fireRate;
      this.fireCd = 1 / rate; w.ammo--; this.recoilDecay = 0; this.inspectT = 0;
      const spread = this.currentSpread(hs, crouching);
      const [ry, rp] = recoilPattern(def, Math.floor(this.shotIdx));
      const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin);
      const pellets = def.pellets || 1;
      for (let p = 0; p < pellets; p++) {
        // direction from camera with recoil pattern + random spread (uniform disc)
        const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
        const yaw = this.yaw + ry + Math.cos(ang) * rad, pitch = this.pitch + rp + Math.sin(ang) * rad;
        const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        game.fireBullet(this, origin, dir, def, p === 0);
      }
      this.shotIdx += 1;
      // camera kick
      const kickUp = def.cat === 'sniper' ? 0.05 : def.cat === 'sidearm' ? 0.012 : 0.009 + Math.min(this.shotIdx, 6) * 0.0025;
      this.visKick.y += kickUp; this.visKick.x += (Math.random() - 0.5) * kickUp * 0.6;
      this.vmKick = Math.min(1, (this.vmKick || 0) + 1);
      // muzzle flash
      if (!def.feature || def.id !== 'phantom') { this.muzzleFlash.visible = true; this.muzzleFlash.rotation.z = Math.random() * 6.28; this.muzzleFlash.scale.setScalar(def.cat === 'sniper' || def.cat === 'shotgun' ? 1.8 : 1); this.muzzleLight.intensity = 3; this.muzzleLight.position.copy(this.vmDef.pos).add(new THREE.Vector3(0, 0.1, -0.4)); this.flashT = 0.045; }
      if (VAL.Audio) VAL.Audio.play('shot_' + def.id, { vol: 0.9 });
      game.onNoise && game.onNoise(this, def.id === 'phantom' || def.id === 'ghost' || def.id === 'spectre' ? 35 : 70);
      this.lastFireT = performance.now() / 1000;
    }
    meleeAttack(game, heavy) {
      this.fireCd = heavy ? 1.0 : 0.55; this.vmKick = 1; this.meleeT = 0.25;
      if (VAL.Audio) VAL.Audio.play('knife_swing', { vol: 0.6 });
      const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin);
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      game.meleeHit(this, origin, dir, heavy);
    }
    takeDamage(amount, zone, from, dirFrom) {
      if (!this.alive) return 0;
      let dmg = amount;
      if (this.armor > 0) { const toArmor = Math.min(this.armor, dmg * 0.66); this.armor -= toArmor; dmg -= toArmor; }
      this.health -= dmg; this.dmgFlash = 0.5; this.lastDamageDir = dirFrom || null;
      if (this.health <= 0) { this.health = 0; this.alive = false; }
      return dmg;
    }
    // ----- viewmodel animation -----
    updateViewmodel(dt, hs) {
      const vm = this.vm, d = this.vmDef; const t = performance.now() / 1000;
      if (!this.alive) { vm.visible = false; if (this.fpArms) this.fpArms.group.visible = false; return; } vm.visible = true;
      const camScale = 1;
      const hip = d.pos, ads = d.adsPos || d.pos;
      const a = this.ads;
      let px = U.lerp(hip[0], ads[0], a), py = U.lerp(hip[1], ads[1], a), pz = U.lerp(hip[2], ads[2], a);
      // the rigged arms have real human reach, so the weapon is carried closer to the body
      // than the old exaggerated viewmodel arms allowed
      if (this.fpArms) { px *= 0.84 * 0.84; py = (py * 0.7) * 0.84; pz *= 0.95 * 0.84; }
      // bob
      const run = Math.min(1, hs / 6.75); const bobAmp = (d.bob && d.bob.amp || 1) * 0.012 * run * (1 - a * 0.85);
      const bobRate = 10 * (d.bob && d.bob.rate || 1);
      const bx = Math.sin(t * bobRate) * bobAmp, by = Math.abs(Math.cos(t * bobRate)) * bobAmp * 0.9 - (this.crouchT * 0.01);
      // sway from mouse (lag)
      this._swx = U.damp(this._swx || 0, -(this.visKick.x) * 0.5, 10, dt);
      // kick
      this.vmKick = U.damp(this.vmKick || 0, 0, 18, dt);
      const kb = (d.recoilKick && d.recoilKick.back || 0.05) * this.vmKick, ku = (d.recoilKick && d.recoilKick.up || 0.02) * this.vmKick;
      // equip: rise from below
      const eq = this.equipT > 0 ? U.clamp(this.equipT / (this.weapon.def.equip || 0.7), 0, 1) : 0;
      // reload: dip & tilt
      let rl = 0; if (this.reloadT > 0) { const p = 1 - this.reloadT / this.weapon.def.reload; rl = Math.sin(p * Math.PI); }
      // inspect
      let insp = 0; if (this.inspectT > 0) { this.inspectT -= dt; insp = Math.sin((1 - Math.max(0, this.inspectT) / 2) * Math.PI); }
      // melee swing
      let ml = 0; if (this.meleeT > 0) { this.meleeT -= dt; ml = Math.sin(Math.max(0, this.meleeT) / 0.25 * Math.PI); }
      const idle = Math.sin(t * 1.3) * 0.002;
      const VMS = this.fpArms ? 0.84 : (d.scale || 1);
      vm.scale.setScalar(VMS);
      if (this.fpArms) { this.fpArms.group.scale.setScalar(VMS); }
      vm.position.set(px + bx + this._swx * 0.3, py + by + idle - eq * 0.45 - rl * 0.12 + ku * 0.3, pz + kb + insp * 0.05);
      const rot = d.rot || [0, 0, 0];
      vm.rotation.set(rot[0] - ku * 3 + rl * 0.7 + eq * 0.9 - ml * 0.8, rot[1] + this._swx * 2 + insp * 1.2 - ml * 0.6, rot[2] + rl * 0.35 + insp * 0.5 + bx * 2);
      if (this.slot === 'spike' && this.planting) { vm.position.y -= 0.25; vm.rotation.x -= 0.8; }
      // mag animation on reload
      const mag = this.vmWeapon && this.vmWeapon.userData && this.vmWeapon.userData.mag;
      if (mag) { if (!mag.userData.base) mag.userData.base = mag.position.clone(); const drop = rl > 0.2 && rl < 0.95 ? Math.min(1, (rl - 0.2) / 0.3) : 0; mag.position.copy(mag.userData.base); mag.position.y -= drop * 0.18; mag.rotation.x = -drop * 0.6; }
      const slide = this.vmWeapon && this.vmWeapon.userData && (this.vmWeapon.userData.slide || this.vmWeapon.userData.bolt);
      if (slide) { if (!slide.userData.base) slide.userData.base = slide.position.clone(); slide.position.copy(slide.userData.base); slide.position.z += this.vmKick * 0.05; }
      if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.muzzleFlash.visible = false; this.muzzleLight.intensity = 0; } }
      // arms: solved onto the weapon after the viewmodel transform is final
      if (this.fpArms) { this.vm.updateWorldMatrix(true, true); this.fpArms.update(dt); }
      else if (this.arms && VAL.WeaponModels && VAL.WeaponModels.poseArms) { try { VAL.WeaponModels.poseArms(this.arms, this.vmWeapon, this.weapon.id, 1); } catch (e) { } }
      // ADS fov
      const zoom = (this.weapon.def.ads && this.weapon.def.ads.zoom) || 1;
      const targetFov = 71 / U.lerp(1, zoom, this.ads);
      if (Math.abs(this.camera.fov - targetFov) > 0.01) { this.camera.fov = targetFov; this.camera.updateProjectionMatrix(); }
      // hide viewmodel when scoped snipers
      vm.visible = !(this.weapon.def.cat === 'sniper' && this.ads > 0.6);
      if (this.fpArms) this.fpArms.group.visible = vm.visible;
    }
    forwardDir() { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
    eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z); }
  }
  VAL.Player = Player; VAL.Weapon = Weapon; VAL.recoilPattern = recoilPattern;
})();
