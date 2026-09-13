// Match controller: rounds, economy, spike, damage/kills, spectating, bot buying.
window.VAL = window.VAL || {};
(function () {
  const U = VAL.U;
  const R = () => VAL.RULES, E = () => VAL.ECON;
  const TEAMMATES = [['sage', 'himlate'], ['sova', 'cherwood'], ['omen', 'sickeez'], ['phoenix', 'vandalprince']];
  const ENEMIES = [['reyna', 'notaimbot'], ['killjoy', 'kj turret'], ['cypher', 'fadedd'], ['raze', 'boombot andy'], ['brimstone', 'stimbeacon']];

  class Match {
    constructor(app) {
      this.app = app; this.scene = app.scene; this.camera = app.camera; this.map = app.map; this.player = app.player;
      this.entities = [this.player]; this.bots = []; this.time = 0; this.uiOpen = false;
      this.roundNumber = 1; this.score = { blue: 0, red: 0 }; this.lossStreak = { blue: 0, red: 0 };
      this.phase = 'idle'; this.phaseT = 0; this.roundTime = 0; this.spikeTime = 0;
      this.spike = { state: 'none', carrier: null, pos: new THREE.Vector3(), site: null, planter: null, defuser: null, progress: 0, defuseProgress: 0, defuseHalf: false, mesh: null };
      this.killfeed = []; this.announce = []; this.events = []; this.roundResults = [];
      this.fx = [];
      this.brains = {}; this.spectating = null; this.pickups = []; this.hitmarkerT = 0; this.hitmarkerHead = false; this.damageNumbers = [];
      this.calloutMap = {}; for (const c of this.map.data.callouts) { this.calloutMap[c.sup + ' ' + c.name] = c; this.calloutMap[c.name] = this.calloutMap[c.name] || c; }
      this.plantSpots = {};
      this.overtime = false; this.matchOver = false; this.playerStats = { dmg: 0 };
      this.buildSpikeMesh();
    }
    buildSpikeMesh() {
      let g = null; if (VAL.WeaponModels && VAL.WeaponModels.build) { try { g = VAL.WeaponModels.build('spike', 'world'); } catch (e) { g = null; } }
      if (!g) { g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0x1fbfb0, emissiveIntensity: 0.6 })); m.position.y = 0.18; g.add(m); }
      const light = new THREE.PointLight(0x33ffe0, 0, 6); light.position.y = 0.5; g.add(light); g.userData.light = light;
      g.visible = false; this.scene.add(g); this.spike.mesh = g;
    }
    calloutPos(name) { const c = this.calloutMap[name]; return c ? { x: c.x, z: c.z } : null; }
    plantSpot(site) {
      if (this.plantSpots[site]) return this.plantSpots[site];
      const p = this.map.data.plant[site]; const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      const toward = this.calloutPos(site === 'A' ? 'A Main' : 'B Main');
      let x = cx, z = cz; if (toward) { x += (toward.x - cx) * 0.25; z += (toward.z - cz) * 0.25; }
      // pick the walkable nav cell inside the zone (1 m margin, clear of crates) closest to the desired point
      let best = null, bd = 1e9;
      for (let zz = p.z0 + 1; zz <= p.z1 - 1; zz += 0.5) for (let xx = p.x0 + 1; xx <= p.x1 - 1; xx += 0.5) {
        if (!VAL.Nav.walkable(xx, zz)) continue;
        let nearCrate = false; for (const c of this.map.crates) if (xx > c.x0 - 0.8 && xx < c.x1 + 0.8 && zz > c.z0 - 0.8 && zz < c.z1 + 0.8) { nearCrate = true; break; }
        if (nearCrate) continue;
        const d = U.dist2(xx, zz, x, z); if (d < bd) { bd = d; best = { x: xx, z: zz }; }
      }
      const nw = best || VAL.Nav.nearestWalkable(x, z) || { x: cx, z: cz };
      this.plantSpots[site] = nw; return nw;
    }
    // ---------------- setup ----------------
    start(opts) {
      opts = opts || {};
      this.attackTeam = opts.startSide === 'attack' ? 'blue' : opts.startSide === 'defend' ? 'red' : (Math.random() < 0.5 ? 'blue' : 'red');
      this.player.team = 'blue'; this.player.credits = E().start;
      for (const [agent, name] of TEAMMATES) { const b = new VAL.Bot(this, this.map, agent, 'blue', name); this.bots.push(b); this.entities.push(b); }
      for (const [agent, name] of ENEMIES) { const b = new VAL.Bot(this, this.map, agent, 'red', name); b._outline = 0xff4655; b.char.setOutline && b.char.setOutline(0xff4655); this.bots.push(b); this.entities.push(b); }
      this.brains.blue = new VAL.TeamBrain(this, 'blue'); this.brains.red = new VAL.TeamBrain(this, 'red');
      VAL.Combat.init(this.scene, this.map, this);
      if (VAL.Abilities) VAL.Abilities.init(this);
      this.startRound(true);
    }
    isAttacker(ent) { return ent.team === this.attackTeam; }
    spawnPointFor(ent) {
      const list = this.map.data.spawns[this.isAttacker(ent) ? 'att' : 'def'];
      const idx = ent === this.player ? 0 : (this.entities.filter(e => e.team === ent.team).indexOf(ent) % list.length);
      const s = list[idx];
      // face toward map centre
      const yaw = U.yawTo(s.x, s.z, 14, -50);
      return { x: s.x, z: s.z, yaw };
    }
    startRound(firstOfHalf) {
      this.phase = 'buy'; this.phaseT = firstOfHalf ? R().firstBuyTime : R().buyTime; this.roundTime = R().roundTime; this.spikeTime = 0;
      this.spike.state = 'none'; this.spike.carrier = null; this.spike.planter = null; this.spike.defuser = null; this.spike.progress = 0; this.spike.defuseProgress = 0; this.spike.defuseHalf = false; this.spike.mesh.visible = false; this.spike.site = null;
      this.map.setBarriers(true); this.map.resetDoors();
      for (const p of this.pickups) this.scene.remove(p.mesh); this.pickups = [];
      VAL.Combat.clearImpacts && VAL.Combat.clearImpacts();
      for (const e of this.entities) { const sp = this.spawnPointFor(e); e.resetForRound(sp, !firstOfHalf && e.keepLoadout); e.keepLoadout = false; e.damagedBy = {}; }
      if (VAL.Abilities) VAL.Abilities.resetRound(this.player);
      this.spectating = null; this.uiOpen = false;
      // spike: attackers - random carrier (player 20% if attacker)
      const attackers = this.entities.filter(e => this.isAttacker(e));
      const carrier = (this.player.team === this.attackTeam && Math.random() < 0.2) ? this.player : U.pick(attackers.filter(e => e !== this.player));
      this.announce.length = 0;
      for (const f of this.fx) { this.scene.remove(f.mesh); if (f.light) this.scene.remove(f.light); }
      this.fx.length = 0;
      this.brains.blue.newRound(); this.brains.red.newRound();
      for (const e of attackers) e.inv.spike = false;
      carrier.inv.spike = true; this.spike.carrier = carrier; this.spike.state = 'carried';
      // bots buy
      for (const b of this.bots) this.botBuy(b);
      this.pushAnnounce(firstOfHalf && this.roundNumber === 1 ? 'MATCH START' : 'ROUND ' + this.roundNumber, this.isAttacker(this.player) ? 'ATTACKING' : 'DEFENDING', 2.5);
      if (VAL.Audio) VAL.Audio.play('round_start', { vol: 0.6 });
      this.events.push({ type: 'roundStart', round: this.roundNumber });
      if (this.roundNumber === 1 && this.player.team !== this.attackTeam) { /* nothing */ }
      this.roundStartTime = this.time;
    }
    goLive() {
      this.phase = 'live'; this.map.setBarriers(false); this.uiOpen = false;
      if (VAL.Audio) VAL.Audio.play('barrier_drop', { vol: 0.7 });
      this.events.push({ type: 'live' });
    }
    // ---------------- economy ----------------
    botBuy(b) {
      const creds = () => b.credits; const buy = (id) => { const d = VAL.WEAPON_BY_ID[id]; if (!d || b.credits < d.cost) return false; b.credits -= d.cost; b.give(id); return true; };
      const shield = (kind) => { const s = VAL.SHIELDS.find(x => x.id === kind); if (b.credits < s.cost || b.armor >= s.armor) return false; b.credits -= s.cost; b.armor = s.armor; b.armorType = kind; return true; };
      const teamAvg = this.entities.filter(e => e.team === b.team && e.isBot).reduce((a, e) => a + e.credits, 0) / 4;
      const hasRifle = b.inv.primary && b.inv.primary.def.cost >= 2000;
      const pistolRound = (this.roundNumber === 1 || this.roundNumber === 13) && !this.overtime;
      if (pistolRound) { const r = Math.random(); if (r < 0.4) buy('ghost'); else if (r < 0.6) buy('sheriff'); else if (r < 0.8) { shield('light'); if (Math.random() < 0.5) buy('frenzy'); } else { buy('frenzy'); } b.switchTo(b.bestWeaponSlot(), true); return; }
      if (hasRifle) { // just top up armour / pistol
        if (b.armor < 50) { if (!shield('heavy')) shield('light'); }
        if (b.inv.secondary.id === 'classic' && creds() >= 1300) buy('ghost');
        b.switchTo('primary', true); return;
      }
      const canFull = creds() >= 3900, teamFull = teamAvg >= 3400;
      if (canFull || (creds() >= 2900 && teamFull)) {
        const awper = (b.agent === 'sova' || b.agent === 'reyna' || b.agent === 'cypher') && creds() >= 5700 && Math.random() < 0.35;
        if (awper) buy('operator'); else buy(Math.random() < 0.55 ? 'vandal' : 'phantom');
        if (!shield('heavy')) shield('light');
        if (creds() >= 500 && b.inv.secondary.id === 'classic' && Math.random() < 0.5) buy('ghost');
      } else if (creds() >= 2000 && (teamAvg >= 1800 || Math.random() < 0.5)) { // force / half buy
        const r = Math.random();
        if (creds() >= 2650 && r < 0.4) { buy('guardian'); shield('light'); }
        else if (r < 0.7) { buy('spectre'); shield('light'); }
        else if (creds() >= 2450) { buy('bulldog'); shield('light'); }
        else { buy('marshal'); shield('light'); if (creds() >= 800) buy('sheriff'); }
      } else if (creds() >= 900 && Math.random() < 0.45) { // light eco
        if (Math.random() < 0.5) buy('sheriff'); else { buy('ghost'); shield('light'); }
      } // else save
      b.switchTo(b.bestWeaponSlot(), true);
    }
    playerBuy(kind, id) {
      const p = this.player; if (this.phase !== 'buy') return { ok: false, msg: 'BUY PHASE OVER' };
      if (kind === 'weapon') {
        const d = VAL.WEAPON_BY_ID[id]; if (!d) return { ok: false };
        const slot = d.cat === 'sidearm' ? 'secondary' : 'primary';
        if (p.inv[slot] && p.inv[slot].id === id) { // sell back
          p.credits += d.cost; if (slot === 'primary') p.removePrimary(); else { p.inv.secondary = new VAL.Weapon('classic'); if (p.slot === 'secondary') p.switchTo('secondary', true); }
          return { ok: true, sold: true };
        }
        if (p.credits < d.cost) { if (VAL.Audio) VAL.Audio.play('buy_error'); return { ok: false, msg: 'NOT ENOUGH CREDITS' }; }
        // refund replaced weapon (bought this round) — simplified: refund existing primary cost
        if (p.inv[slot] && p.inv[slot].id !== 'classic') p.credits += p.inv[slot].def.cost;
        p.credits -= d.cost; p.give(id); if (VAL.Audio) VAL.Audio.play('buy'); return { ok: true };
      }
      if (kind === 'shield') {
        const s = VAL.SHIELDS.find(x => x.id === id); if (!s) return { ok: false };
        if (p.armorType === id) { p.credits += s.cost; p.armor = 0; p.armorType = null; return { ok: true, sold: true }; }
        if (p.credits < s.cost) { if (VAL.Audio) VAL.Audio.play('buy_error'); return { ok: false, msg: 'NOT ENOUGH CREDITS' }; }
        if (p.armorType) { const old = VAL.SHIELDS.find(x => x.id === p.armorType); p.credits += old.cost; }
        p.credits -= s.cost; p.armor = s.armor; p.armorType = id; if (VAL.Audio) VAL.Audio.play('buy'); return { ok: true };
      }
      return { ok: false };
    }
    // ---------------- update ----------------
    update(dt) {
      this.time += dt;
      if (this.matchOver) return;
      const p = this.player;
      if (this.phase === 'buy') { this.phaseT -= dt; if (this.phaseT <= 0) this.goLive(); }
      else if (this.phase === 'live') { this.roundTime -= dt; if (this.roundTime <= 0) this.endRound(this.defendTeam(), 'TIME EXPIRED'); }
      else if (this.phase === 'planted') { this.spikeTime -= dt; if (this.spikeTime <= 0) this.detonate(); }
      else if (this.phase === 'end') { this.phaseT -= dt; if (this.phaseT <= 0) this.nextRound(); }
      else if (this.phase === 'halftime') { this.phaseT -= dt; if (this.phaseT <= 0) this.startRound(true); }
      // brains
      if (this.phase === 'live' || this.phase === 'planted') { this.brains.blue.update(dt); this.brains.red.update(dt); }
      // entities
      const input = VAL.Input;
      for (const e of this.entities) { if (e === p) e.update(dt, input, this); else e.update(dt); }
      if (VAL.Abilities) VAL.Abilities.update(dt, this);
      this.updateSpike(dt);
      this.updatePickups(dt);
      this.updatePlayerActions(dt);
      this.updateSpectator(dt);
      this.map.update(dt);
      VAL.Combat.update(dt);
      // win checks
      if (this.phase === 'live' || this.phase === 'planted') this.checkWin();
      // audio listener
      if (VAL.Audio && VAL.Audio.setListener) { const cam = this.camera; const f = new THREE.Vector3(); cam.getWorldDirection(f); VAL.Audio.setListener(cam.position, f); }
      for (let i = this.announce.length - 1; i >= 0; i--) { this.announce[i].t -= dt; if (this.announce[i].t <= 0) this.announce.splice(i, 1); }
      for (let i = this.killfeed.length - 1; i >= 0; i--) { this.killfeed[i].t -= dt; if (this.killfeed[i].t <= 0) this.killfeed.splice(i, 1); }
      for (let i = this.damageNumbers.length - 1; i >= 0; i--) { this.damageNumbers[i].t -= dt; if (this.damageNumbers[i].t <= 0) this.damageNumbers.splice(i, 1); }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i]; f.t += dt;
        f.mesh.scale.setScalar(1 + f.t * 40);
        f.mat.opacity = Math.max(0, 0.9 - f.t * 0.6);
        if (f.light) f.light.intensity = Math.max(0, 30 - f.t * 20);
        if (f.t >= f.life) { this.scene.remove(f.mesh); if (f.light) this.scene.remove(f.light); f.mesh.geometry.dispose(); f.mat.dispose(); this.fx.splice(i, 1); }
      }
      if (this.hitmarkerT > 0) this.hitmarkerT -= dt;
    }
    defendTeam() { return this.attackTeam === 'blue' ? 'red' : 'blue'; }
    aliveCount(team) { return this.entities.filter(e => e.team === team && e.alive).length; }
    checkWin() {
      const att = this.attackTeam, def = this.defendTeam();
      if (this.spike.state === 'planted') { if (this.aliveCount(def) === 0) this.endRound(att, 'ENEMY ELIMINATED'); return; }
      if (this.aliveCount(att) === 0) this.endRound(def, 'ENEMY ELIMINATED');
      else if (this.aliveCount(def) === 0) this.endRound(att, 'ENEMY ELIMINATED');
    }
    endRound(winner, reason) {
      if (this.phase === 'end') return;
      const loser = winner === 'blue' ? 'red' : 'blue';
      this.phase = 'end'; this.phaseT = R().roundEndDelay; this.score[winner]++;
      // spike explosion visual continues; planting/defusing cancelled
      for (const e of this.entities) { e.planting = false; e.defusing = false; }
      // economy
      for (const e of this.entities) {
        if (e.team === winner) e.credits += E().win; else { const ls = this.lossStreak[loser]; e.credits += E().loss[Math.min(ls, 2)]; }
        if (this.isAttacker(e) && this.spike.planted) e.credits += E().plant;
        if (this.overtime) e.credits = 5000;
        e.credits = Math.min(E().max, e.credits);
        e.keepLoadout = e.alive; // survivors keep weapons
      }
      this.lossStreak[loser]++; this.lossStreak[winner] = 0;
      const playerWon = winner === this.player.team;
      const flawless = this.aliveCount(winner) === 5;
      this.pushAnnounce(playerWon ? 'VICTORY' : 'DEFEAT', reason + (flawless ? '  •  FLAWLESS' : ''), R().roundEndDelay - 0.5, playerWon ? 'win' : 'lose');
      if (VAL.Audio) VAL.Audio.play(playerWon ? 'round_win' : 'round_lose', { vol: 0.8 });
      this.roundResults.push({ round: this.roundNumber, winner, reason, attackTeam: this.attackTeam });
      this.events.push({ type: 'roundEnd', winner, reason });
      this.map.setBarriers(false);
    }
    nextRound() {
      const need = R().roundsToWin;
      const b = this.score.blue, r = this.score.red;
      if ((b >= need || r >= need) && Math.abs(b - r) >= (this.overtime ? 2 : 1)) { this.gameOver(b > r ? 'blue' : 'red'); return; }
      if (b === 12 && r === 12 && !this.overtime) { this.overtime = true; }
      this.roundNumber++;
      if (this.roundNumber === R().halfAt + 1) { // switch sides
        this.attackTeam = this.defendTeam(); for (const e of this.entities) { e.credits = E().start; e.keepLoadout = false; } this.lossStreak = { blue: 0, red: 0 };
        this.phase = 'halftime'; this.phaseT = 5; this.pushAnnounce('SWITCHING SIDES', this.isAttacker(this.player) ? 'YOU ARE NOW ATTACKING' : 'YOU ARE NOW DEFENDING', 4.5);
        this.events.push({ type: 'halftime' });
        return;
      }
      if (this.overtime && (this.roundNumber - 25) % 2 === 1 && this.roundNumber > 25) { this.attackTeam = this.defendTeam(); for (const e of this.entities) e.keepLoadout = false; }
      this.startRound(false);
    }
    gameOver(winner) { this.matchOver = true; this.phase = 'gameover'; this.events.push({ type: 'gameover', winner }); if (this.app.onMatchEnd) this.app.onMatchEnd(winner); }
    // ---------------- damage / kills ----------------
    fireBullet(shooter, origin, dir, def, primary) { return VAL.Combat.fireBullet(shooter, origin, dir, def, primary); }
    meleeHit(shooter, origin, dir, heavy) { return VAL.Combat.meleeHit(shooter, origin, dir, heavy); }
    applyDamage(from, to, dmg, zone, def, dir) {
      if (!to.alive || this.phase === 'end') return;
      if (from && from.team === to.team) return; // no friendly fire
      const dealt = to.takeDamage(dmg, zone, from, dir);
      if (from) from.hitsLanded = (from.hitsLanded || 0) + 1;
      to.damagedBy = to.damagedBy || {}; if (from) to.damagedBy[from.name] = { ent: from, t: this.time };
      if (from === this.player) { this.hitmarkerT = 0.12; this.hitmarkerHead = zone === 'head'; this.playerStats.dmg += dealt; this.damageNumbers.push({ t: 0.9, v: Math.round(dealt), pos: to.pos.clone().add(new THREE.Vector3(0, 1.9, 0)), head: zone === 'head' }); if (VAL.Audio) VAL.Audio.play(zone === 'head' ? 'hit_head' : (to.armor > 0 ? 'hit_armor' : 'hit_body'), { vol: 0.7 }); }
      else if (to === this.player && VAL.Audio) VAL.Audio.play('hit_body', { vol: 0.5, pitch: 0.8 });
      if (!to.alive) this.onKill(from, to, def, zone === 'head');
    }
    onKill(killer, victim, def, headshot) {
      victim.deaths++;
      if (killer && killer !== victim) { killer.kills++; killer.score += headshot ? 150 : 100; killer.credits = Math.min(E().max, killer.credits + E().kill); }
      // assists
      for (const k in victim.damagedBy || {}) { const d = victim.damagedBy[k]; if (d.ent !== killer && this.time - d.t < 6 && d.ent.team !== victim.team) { d.ent.assists++; d.ent.score += 50; } }
      this.killfeed.push({ t: 6, killer: killer ? killer.name : '', killerTeam: killer ? killer.team : null, victim: victim.name, victimTeam: victim.team, weapon: def ? def.id : 'knife', headshot });
      this.events.push({ type: 'kill', killer, victim, headshot });
      if (VAL.Audio) VAL.Audio.play('death', { pos: victim.pos, vol: 0.7 });
      // drop spike / weapon
      if (victim.inv.spike) { victim.inv.spike = false; this.dropSpike(victim.pos); }
      if (victim.inv.primary && victim !== this.player) this.dropWeaponAt(victim.inv.primary, victim.pos);
      if (victim === this.player) { this.spectating = null; this.uiOpen = false; if (this.player.slot === 'spike') this.player.switchTo('secondary', true); if (VAL.Abilities) VAL.Abilities.onDeath(this.player); }
      if (killer === this.player) { if (VAL.Audio) VAL.Audio.play('ui_click', { vol: 0.2 }); if (VAL.Abilities) VAL.Abilities.onKill(this.player, victim); }
      // ace?
      const killerTeamAlive = killer ? this.entities.filter(e => e.team !== killer.team && e.alive).length : 1;
      if (killer && killerTeamAlive === 0 && killer.roundKills === undefined) { }
    }
    onNoise(source, radius) { for (const b of this.bots) if (b.alive && b !== source) b.hear(source, radius); }
    // ---------------- spike ----------------
    dropSpike(pos) { this.spike.state = 'dropped'; this.spike.carrier = null; this.spike.pos.set(pos.x, this.map.heightAt(pos.x, pos.z), pos.z); this.spike.mesh.visible = true; this.spike.mesh.position.copy(this.spike.pos); this.spike.mesh.rotation.set(0.4, Math.random() * 6, 0.3); }
    updateSpike(dt) {
      const s = this.spike;
      if (s.state === 'carried' && s.carrier) { if (!s.carrier.alive) this.dropSpike(s.carrier.pos); }
      if (s.state === 'dropped') {
        for (const e of this.entities) if (e.alive && this.isAttacker(e) && U.dist(e.pos.x, e.pos.z, s.pos.x, s.pos.z) < 1.2) { s.state = 'carried'; s.carrier = e; e.inv.spike = true; s.mesh.visible = false; if (VAL.Audio) VAL.Audio.play('spike_pickup', { pos: s.pos }); if (e === this.player) this.pushAnnounce('SPIKE PICKED UP', '', 1.5); break; }
        s.mesh.rotation.y += dt * 0.5;
      }
      if (s.state === 'planting' && s.planter) {
        const pl = s.planter;
        if (!pl.alive || !pl.planting) { s.state = 'carried'; s.planter = null; s.progress = 0; return; }
        s.progress += dt / R().plantTime;
        if (s.progress >= 1) this.plantSpike(pl);
      }
      if (s.state === 'planted') {
        // beeping
        const total = R().spikeFuse; const t = this.spikeTime; const interval = t > 20 ? 1.0 : t > 10 ? 0.5 : t > 5 ? 0.25 : 0.125;
        this.beepT = (this.beepT || 0) - dt; if (this.beepT <= 0) { this.beepT = interval; if (VAL.Audio) VAL.Audio.play(t > 10 ? 'spike_beep' : 'spike_beep_fast', { pos: s.pos, vol: 0.8 }); s.mesh.userData.light.intensity = 3; }
        if (s.mesh.userData.light.intensity > 0) s.mesh.userData.light.intensity = Math.max(0, s.mesh.userData.light.intensity - dt * 12);
        // defusing
        if (s.defuser) {
          const d = s.defuser;
          if (!d.alive || !d.defusing || U.dist(d.pos.x, d.pos.z, s.pos.x, s.pos.z) > 1.8) { s.defuser = null; if (!s.defuseHalf) s.defuseProgress = 0; else s.defuseProgress = 0.5; }
          else { s.defuseProgress += dt / R().defuseTime; if (s.defuseProgress >= 0.5 && !s.defuseHalf) { s.defuseHalf = true; } if (s.defuseProgress >= 1) this.defused(d); }
        }
      }
    }
    startPlant(ent) {
      const s = this.spike; if (s.state !== 'carried' || s.carrier !== ent || this.phase !== 'live') return false;
      const site = this.map.inPlantZone(ent.pos.x, ent.pos.z); if (!site) return false;
      ent.planting = true; s.state = 'planting'; s.planter = ent; s.progress = 0; s.site = site;
      if (VAL.Audio) VAL.Audio.play('spike_plant_start', { pos: ent.pos, vol: 0.8 });
      this.onNoise(ent, 30);
      return true;
    }
    plantSpike(ent) {
      const s = this.spike; s.state = 'planted'; s.planted = true; s.carrier = null; ent.planting = false; ent.inv.spike = false; if (ent.slot === 'spike') ent.switchTo(ent.bestWeaponSlot ? ent.bestWeaponSlot() : 'secondary', true);
      s.pos.set(ent.pos.x, this.map.heightAt(ent.pos.x, ent.pos.z), ent.pos.z); s.mesh.visible = true; s.mesh.position.copy(s.pos); s.mesh.rotation.set(0, ent.yaw, 0);
      this.phase = 'planted'; this.spikeTime = R().spikeFuse; s.defuseProgress = 0; s.defuseHalf = false; s.defuser = null;
      ent.score += 100;
      this.pushAnnounce('SPIKE PLANTED', '', 2.5);
      if (VAL.Audio) VAL.Audio.play('spike_planted', { vol: 0.9 });
      this.events.push({ type: 'planted', site: s.site, by: ent });
      // defenders hear it everywhere (they get the site info)
      for (const b of this.bots) if (!this.isAttacker(b)) b.remember(ent, false, 4);
    }
    startDefuse(ent) {
      const s = this.spike; if (s.state !== 'planted' || this.isAttacker(ent) || !ent.alive) return false;
      if (U.dist(ent.pos.x, ent.pos.z, s.pos.x, s.pos.z) > 1.8) return false;
      if (s.defuser && s.defuser !== ent) return false;
      ent.defusing = true; s.defuser = ent; if (s.defuseProgress < 0.5 && !s.defuseHalf) s.defuseProgress = 0; else s.defuseProgress = 0.5;
      if (VAL.Audio) VAL.Audio.play('spike_defuse_start', { pos: s.pos, vol: 0.8 });
      this.onNoise(ent, 25);
      for (const b of this.bots) if (this.isAttacker(b) && b.alive && U.dist(b.pos.x, b.pos.z, s.pos.x, s.pos.z) < 30) b.remember(ent, false, 1.5);
      return true;
    }
    cancelAction(ent) { const s = this.spike; if (s.planter === ent) { s.state = 'carried'; s.planter = null; s.progress = 0; } if (s.defuser === ent) { s.defuser = null; if (!s.defuseHalf) s.defuseProgress = 0; } ent.planting = false; ent.defusing = false; }
    defused(ent) { const s = this.spike; s.state = 'defused'; ent.defusing = false; ent.score += 100; if (VAL.Audio) VAL.Audio.play('spike_defused', { vol: 0.9 }); this.endRound(this.defendTeam(), 'SPIKE DEFUSED'); }
    detonate() {
      const s = this.spike; s.state = 'exploded';
      if (VAL.Audio) VAL.Audio.play('spike_explode', { pos: s.pos, vol: 1 });
      for (const e of this.entities) { if (!e.alive) continue; const d = U.dist(e.pos.x, e.pos.z, s.pos.x, s.pos.z); if (d < 9) { e.takeDamage(999, 'body', null); if (!e.alive) this.killfeed.push({ t: 6, killer: 'SPIKE', killerTeam: this.attackTeam, victim: e.name, victimTeam: e.team, weapon: 'spike', headshot: false }); } else if (d < 26) e.takeDamage(Math.round(120 * (1 - (d - 9) / 17)), 'body', null); }
      this.explosionFx(s.pos);
      this.endRound(this.attackTeam, 'SPIKE DETONATED');
    }
    explosionFx(pos) {
      const geo = new THREE.SphereGeometry(1, 24, 16); const mat = new THREE.MeshBasicMaterial({ color: 0x9fffee, transparent: true, opacity: 0.9, depthWrite: false });
      const m = new THREE.Mesh(geo, mat); m.position.copy(pos).add(new THREE.Vector3(0, 1, 0)); this.scene.add(m);
      const light = new THREE.PointLight(0x66ffe0, 30, 60); light.position.copy(m.position); this.scene.add(light);
      this.fx.push({ mesh: m, mat, light, t: 0, life: 1.6 });
      this.shake = 1.2;
    }
    // ---------------- player interactions ----------------
    updatePlayerActions(dt) {
      const p = this.player; const s = this.spike; if (!p.alive) return;
      const input = VAL.Input;
      const inZone = this.map.inPlantZone(p.pos.x, p.pos.z);
      const attacker = this.isAttacker(p);
      // planting: spike equipped + fire held, or F held in zone
      if (attacker && p.inv.spike && this.phase === 'live' && inZone && ((p.slot === 'spike' && input.mouseDown(0)) || input.down('use'))) {
        if (!p.planting) { if (p.slot !== 'spike') p.switchTo('spike', true); this.startPlant(p); }
      } else if (p.planting) { this.cancelAction(p); }
      // defusing
      if (!attacker && s.state === 'planted' && input.down('use') && U.dist(p.pos.x, p.pos.z, s.pos.x, s.pos.z) < 1.8) { if (!p.defusing) this.startDefuse(p); }
      else if (p.defusing) this.cancelAction(p);
      // pickups: F near a dropped weapon (swap)
      if (input.justPressed('use')) {
        for (const pk of this.pickups) { if (U.dist(pk.pos.x, pk.pos.z, p.pos.x, p.pos.z) < 1.6) { this.pickup(p, pk); break; } }
      }
    }
    dropWeaponAt(weapon, pos) {
      let mesh = null; if (VAL.WeaponModels && VAL.WeaponModels.build) { try { mesh = VAL.WeaponModels.build(weapon.id, 'world'); } catch (e) { mesh = null; } }
      if (!mesh) { mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: 0x222 })); }
      const h = this.map.heightAt(pos.x, pos.z); mesh.position.set(pos.x + (Math.random() - 0.5) * 0.6, h + 0.12, pos.z + (Math.random() - 0.5) * 0.6); mesh.rotation.set(0, Math.random() * 6, Math.PI / 2 * 0.9);
      this.scene.add(mesh); this.pickups.push({ weapon, mesh, pos: mesh.position.clone() });
    }
    dropWeapon(p) {
      const w = p.slot === 'primary' ? p.inv.primary : (p.slot === 'secondary' && p.inv.secondary.id !== 'classic' ? p.inv.secondary : null); if (!w) return;
      const f = U.fwd(p.yaw); this.dropWeaponAt(w, new THREE.Vector3(p.pos.x + f.x * 1.2, p.pos.y, p.pos.z + f.z * 1.2));
      if (p.slot === 'primary') p.removePrimary(); else { p.inv.secondary = new VAL.Weapon('classic'); p.switchTo('secondary', true); }
    }
    pickup(p, pk) {
      const d = pk.weapon.def; const slot = d.cat === 'sidearm' ? 'secondary' : 'primary';
      if (p.inv[slot] && (slot === 'primary' || p.inv[slot].id !== 'classic')) { const old = p.inv[slot]; this.dropWeaponAt(old, p.pos); }
      p.inv[slot] = pk.weapon; p.switchTo(slot); this.scene.remove(pk.mesh); this.pickups.splice(this.pickups.indexOf(pk), 1);
      if (VAL.Audio) VAL.Audio.play('equip_rifle', { vol: 0.6 });
    }
    updatePickups(dt) { for (const pk of this.pickups) pk.mesh.rotation.y += dt * 0.2; }
    nearestPickup(p) { for (const pk of this.pickups) if (U.dist(pk.pos.x, pk.pos.z, p.pos.x, p.pos.z) < 1.6) return pk; return null; }
    // ---------------- spectator ----------------
    updateSpectator(dt) {
      const p = this.player; const cam = this.camera;
      if (p.alive) { this.spectating = null; return; }
      const mates = this.entities.filter(e => e.team === p.team && e.alive && e !== p);
      if (!this.spectating || !this.spectating.alive) this.spectating = mates[0] || null;
      if (VAL.Input.justPressed('MouseLeft') || (VAL.Input.mouseDown(0) && !this._specClick)) { this._specClick = true; if (mates.length > 1) { const i = mates.indexOf(this.spectating); this.spectating = mates[(i + 1) % mates.length]; } }
      if (!VAL.Input.mouseDown(0)) this._specClick = false;
      const md = VAL.Input.consumeMouse();
      if (this.spectating) {
        const s = this.spectating; const eye = s.eyePos();
        // third-person-ish over the shoulder
        const f = s.forwardDir(); cam.position.set(eye.x - f.x * 2.2, eye.y + 0.6, eye.z - f.z * 2.2);
        const [cx, cz] = this.map.collide(cam.position.x, cam.position.z, 0.3, cam.position.y, cam.position.x, cam.position.z, {}); cam.position.x = cx; cam.position.z = cz;
        cam.rotation.order = 'YXZ'; cam.rotation.set(s.pitch, s.yaw, 0);
      } else {
        // free cam over the map
        this.freeYaw = (this.freeYaw == null ? p.yaw : this.freeYaw) - md.dx; this.freePitch = U.clamp((this.freePitch == null ? -0.6 : this.freePitch) - md.dy, -1.5, 1.5);
        if (!this.freePos) this.freePos = new THREE.Vector3(p.pos.x, p.pos.y + 6, p.pos.z);
        const sp = 12 * dt; const cy = Math.cos(this.freeYaw), sy = Math.sin(this.freeYaw);
        if (VAL.Input.down('forward')) { this.freePos.x -= sy * sp; this.freePos.z -= cy * sp; } if (VAL.Input.down('back')) { this.freePos.x += sy * sp; this.freePos.z += cy * sp; }
        if (VAL.Input.down('left')) { this.freePos.x -= cy * sp; this.freePos.z += sy * sp; } if (VAL.Input.down('right')) { this.freePos.x += cy * sp; this.freePos.z -= sy * sp; }
        cam.position.copy(this.freePos); cam.rotation.order = 'YXZ'; cam.rotation.set(this.freePitch, this.freeYaw, 0);
      }
      if (cam.fov !== 71) { cam.fov = 71; cam.updateProjectionMatrix(); }
    }
    dynamicBlocked(bot) {
      // nav cells blocked by closed doors (for everyone) and barriers (during buy)
      const now = this.time; if (this._blockedT && now - this._blockedT < 0.5 && this._blocked) return this._blocked;
      const set = new Set();
      for (const d of this.map.doors) if (d.closedAmount > 0.15) for (const c of VAL.Nav.cellsInSegment(d.seg.x0, d.seg.z0, d.seg.x1, d.seg.z1, 0.5)) set.add(c);
      if (this.map.barriersActive) for (const s of this.map.barriers) for (const c of VAL.Nav.cellsInSegment(s.x0, s.z0, s.x1, s.z1, 0.5)) set.add(c);
      this._blocked = set; this._blockedT = now; return set;
    }
    pushAnnounce(title, sub, t, kind) { this.announce.push({ title, sub, t, kind: kind || 'info', total: t }); }
    onBotCallout(bot, enemy) { if (bot.team !== this.player.team) return; const area = VAL.Nav.areaAt(enemy.pos.x, enemy.pos.z) || 'unknown'; this.events.push({ type: 'comms', who: bot.name, text: 'Enemy spotted ' + area }); this.lastComms = { t: this.time, who: bot.name, text: 'Enemy spotted: ' + area }; }
    playerArea() { return VAL.Nav.areaAt(this.player.pos.x, this.player.pos.z) || ''; }
  }
  VAL.Match = Match;
})();
