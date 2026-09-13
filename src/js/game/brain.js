// Team strategy brain: assigns plans/roles to bots each round and adapts to information.
window.VAL = window.VAL || {};
(function () {
  const U = VAL.U;
  const HOLDS = {
    def: {
      A: [{ area: 'A Site', watch: 'A Main' }, { area: 'A Rafters', watch: 'A Main' }, { area: 'A Tree', watch: 'Mid Catwalk' }, { area: 'A Site', watch: 'A Tree' }, { area: 'A Wine', watch: 'A Main' }, { area: 'A Garden', watch: 'A Tree' }],
      Mid: [{ area: 'Mid Market', watch: 'Mid Bottom' }, { area: 'Mid Cubby', watch: 'Mid Catwalk' }, { area: 'Mid Pizza', watch: 'Mid Bottom' }, { area: 'Mid Market', watch: 'Mid Courtyard' }],
      B: [{ area: 'B Site', watch: 'B Main' }, { area: 'B Boat House', watch: 'B Main' }, { area: 'B Site', watch: 'Mid Market' }, { area: 'B Site', watch: 'B Main' }, { area: 'B Boat House', watch: 'B Site' }]
    },
    post: {
      A: [{ area: 'A Site', watch: 'A Wine' }, { area: 'A Main', watch: 'A Site' }, { area: 'A Tree', watch: 'A Garden' }, { area: 'A Site', watch: 'A Rafters' }, { area: 'A Site', watch: 'A Tree' }],
      B: [{ area: 'B Main', watch: 'B Site' }, { area: 'B Boat House', watch: 'B Site' }, { area: 'B Site', watch: 'Mid Market' }, { area: 'B Site', watch: 'B Site' }, { area: 'B Main', watch: 'B Site' }]
    },
    retakeStage: { A: ['A Wine', 'A Garden', 'A Rafters'], B: ['Mid Market', 'B Boat House', 'Defender Side Spawn'] }
  };
  const ROUTES = {
    A_main: ['A Lobby', 'A Main', 'A Site'],
    A_mid: ['Mid Top', 'Mid Catwalk', 'Mid Cubby', 'A Tree', 'A Site'],
    B_main: ['B Lobby', 'B Main', 'B Site'],
    B_mid: ['Mid Link', 'Mid Bottom', 'Mid Market', 'B Site'],
    mid: ['Mid Top', 'Mid Catwalk'], midB: ['Mid Link', 'Mid Bottom']
  };

  class TeamBrain {
    constructor(game, team) { this.game = game; this.team = team; this.plan = null; this.roundT = 0; this.infoT = {}; this.rotated = false; }
    callout(name) { return this.game.calloutPos(name); }
    spotIn(area, watchName, tries) {
      // random walkable point inside area with line of sight to the watch point (prefers cover: near wall)
      const w = this.callout(watchName); let best = null, bestScore = -1;
      for (let i = 0; i < (tries || 14); i++) {
        const p = VAL.Nav.randomPointInArea(area); if (!p) break;
        const h = this.game.map.heightAt(p.x, p.z);
        let score = Math.random() * 0.2;
        if (w) { const los = this.game.map.lineOfSight(p.x, h + 1.5, p.z, w.x, this.game.map.heightAt(w.x, w.z) + 1.3, w.z); if (los) score += 1; const d = U.dist(p.x, p.z, w.x, w.z); if (d > 6 && d < 35) score += 0.4; }
        // cover: is there a wall within 1.2 m?
        for (const s of this.game.map.walls) { if (Math.abs(p.x - (s.x0 + s.x1) / 2) > s.len / 2 + 1.5 || Math.abs(p.z - (s.z0 + s.z1) / 2) > s.len / 2 + 1.5) continue; const dx = s.x1 - s.x0, dz = s.z1 - s.z0; let t = ((p.x - s.x0) * dx + (p.z - s.z0) * dz) / (s.len * s.len); t = U.clamp(t, 0, 1); const d = Math.hypot(p.x - (s.x0 + dx * t), p.z - (s.z0 + dz * t)); if (d < 1.4) { score += 0.3; break; } }
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (!best) { const c = this.callout(area); best = c ? VAL.Nav.nearestWalkable(c.x, c.z) : null; }
      return best ? { x: best.x, z: best.z, watch: w } : null;
    }
    bots() { return this.game.entities.filter(e => e.team === this.team && e.isBot); }
    enemies() { return this.game.entities.filter(e => e.team !== this.team); }
    alive(list) { return list.filter(e => e.alive); }
    newRound() {
      this.roundT = 0; this.infoT = {}; this.rotated = false; this.rotateT = 0;
      const bots = this.bots(); const g = this.game;
      if (this.team === g.attackTeam) this.planAttack(bots); else this.planDefense(bots);
      for (const b of bots) { b.state = 'setup'; b.stateT = 0; b.holdSpot = null; b.stop(); }
    }
    planAttack(bots) {
      const r = Math.random(); const player = this.game.player.team === this.team ? this.game.player : null;
      let kind = r < 0.2 ? 'rushA' : r < 0.4 ? 'rushB' : r < 0.55 ? 'splitA' : r < 0.7 ? 'splitB' : 'midDefault';
      const late = this.game.roundNumber > 20;
      const plan = { kind, site: kind.includes('A') ? 'A' : kind.includes('B') ? 'B' : null, executeAt: kind.startsWith('rush') ? 2 : kind.startsWith('split') ? 14 + Math.random() * 10 : 30 + Math.random() * 15, decided: kind !== 'midDefault', assignments: new Map() };
      // spike carrier: random bot (not the player)
      const carrier = bots.length ? U.pick(bots) : null;
      if (carrier) { carrier.inv.spike = true; this.game.spike.carrier = carrier; this.game.spike.state = 'carried'; }
      const shuffled = U.shuffle(bots.slice());
      shuffled.forEach((b, i) => {
        let route; const s = plan.site;
        if (kind === 'rushA') route = ROUTES.A_main; else if (kind === 'rushB') route = ROUTES.B_main;
        else if (kind === 'splitA') route = i < 2 ? ROUTES.A_mid : ROUTES.A_main;
        else if (kind === 'splitB') route = i < 2 ? ROUTES.B_mid : ROUTES.B_main;
        else route = i < 2 ? ROUTES.mid : i < 3 ? ROUTES.midB : i === 3 ? ['A Lobby'] : ['B Lobby'];
        plan.assignments.set(b, { route, role: b === carrier ? 'planter' : (i === shuffled.length - 1 && Math.random() < 0.35 && !kind.startsWith('rush') ? 'lurk' : 'entry'), stageIdx: 0 });
        b.plan = plan;
      });
      // buddy: one bot follows the player if the player attacks
      if (player && shuffled.length) { const buddy = shuffled[shuffled.length - 1]; plan.assignments.get(buddy).role = 'buddy'; }
      this.plan = plan;
    }
    planDefense(bots) {
      const r = Math.random(); const n = bots.length;
      const setups = [['A', 'A', 'Mid', 'B', 'B'], ['A', 'A', 'B', 'B', 'B'], ['A', 'A', 'A', 'B', 'B'], ['A', 'Mid', 'Mid', 'B', 'B'], ['A', 'A', 'Mid', 'Mid', 'B']];
      const setup = U.shuffle(setups[Math.floor(r * setups.length)].slice());
      const plan = { kind: 'defend', assignments: new Map(), siteInfo: { A: 0, B: 0, Mid: 0 } };
      bots.forEach((b, i) => { const site = setup[i % setup.length]; const holds = HOLDS.def[site]; const h = holds[Math.floor(Math.random() * holds.length)]; plan.assignments.set(b, { site, hold: h, role: b.aggro > 0.7 && Math.random() < 0.5 ? 'aggressive' : 'anchor' }); b.plan = plan; });
      this.plan = plan;
    }
    update(dt) {
      this.roundT += dt; const g = this.game;
      if (this.team === g.attackTeam) this.updateAttack(dt); else this.updateDefense(dt);
    }
    // --- attackers ---
    updateAttack(dt) {
      const g = this.game, plan = this.plan; if (!plan) return;
      const live = g.phase === 'live';
      if (!live) return;
      // decide site for midDefault based on where enemies were seen
      if (!plan.decided) {
        let seenA = 0, seenB = 0;
        for (const b of this.alive(this.bots())) for (const [e, k] of b.known) { const a = VAL.Nav.areaAt(k.x, k.z) || ''; if (a.startsWith('A')) seenA++; else if (a.startsWith('B')) seenB++; }
        if (g.roundTime < 60 || seenA + seenB >= 2) {
          plan.site = seenA > seenB ? 'B' : seenA < seenB ? 'A' : (Math.random() < 0.5 ? 'A' : 'B'); plan.decided = true; plan.executeAt = Math.min(plan.executeAt, this.roundT + 4);
          for (const [b, a] of plan.assignments) { a.route = plan.site === 'A' ? (a.route === ROUTES.mid ? ROUTES.A_mid.slice(1) : ROUTES.A_main) : (a.route === ROUTES.midB ? ROUTES.B_mid.slice(1) : ROUTES.B_main); a.stageIdx = 0; }
        }
      }
      // adapt: if we lost 2+ at the site early, and time allows, fake -> rotate to other site (once)
      const dead = this.bots().filter(b => !b.alive).length;
      if (plan.decided && !this.rotated && dead >= 2 && g.roundTime > 45 && g.spike.state === 'carried' && Math.random() < 0.004) {
        this.rotated = true; plan.site = plan.site === 'A' ? 'B' : 'A';
        for (const [b, a] of plan.assignments) { a.route = plan.site === 'A' ? ROUTES.A_main : ROUTES.B_main; a.stageIdx = 0; b.state = 'move'; }
      }
    }
    // --- defenders ---
    updateDefense(dt) {
      const g = this.game, plan = this.plan; if (!plan) return;
      if (g.phase !== 'live' && g.phase !== 'planted') return;
      // aggregate info from callouts
      const info = { A: 0, B: 0, Mid: 0 };
      for (const b of this.alive(this.bots())) for (const [e, k] of b.known) { if (g.time - k.t > 8) continue; const a = VAL.Nav.areaAt(k.x, k.z) || ''; if (a.startsWith('A')) info.A++; else if (a.startsWith('B')) info.B++; else if (a.startsWith('Mid')) info.Mid++; }
      plan.siteInfo = info;
      this.rotateT = (this.rotateT || 0) + dt;
      if (g.spike.state !== 'planted' && this.rotateT > 3) {
        this.rotateT = 0;
        const hot = info.A >= 2 && info.B === 0 ? 'A' : info.B >= 2 && info.A === 0 ? 'B' : null;
        if (hot) {
          const cold = hot === 'A' ? 'B' : 'A';
          // mid player rotates first, then one from the cold site (after delay)
          for (const [b, a] of plan.assignments) {
            if (!b.alive) continue;
            if (a.site === 'Mid' && !a.rotated) { a.site = hot; a.hold = U.pick(HOLDS.def[hot]); a.rotated = true; b.holdSpot = null; b.state = 'move'; }
          }
          const coldBots = [...plan.assignments].filter(([b, a]) => b.alive && a.site === cold);
          if (coldBots.length >= 2 && Math.random() < 0.5) { const [b, a] = coldBots[0]; a.site = hot; a.hold = U.pick(HOLDS.def[hot]); a.rotated = true; b.holdSpot = null; b.state = 'move'; }
        }
      }
    }
    // --- per-bot assignment (called from bot.think) ---
    assign(bot) {
      const g = this.game; if (!bot.alive) return;
      // the bot could not path to, or could not reach, whatever it was sent to - drop the
      // cached spots so this pass picks somewhere new instead of retrying a dead end
      if (bot.needGoal) {
        bot.needGoal = false; bot.holdSpot = null; bot.stage = null;
        const a = this.plan && this.plan.assignments ? this.plan.assignments.get(bot) : null;
        if (a) { a.peekSpot = null; if (a.stageIdx !== undefined) a.stageIdx = Math.min((a.stageIdx || 0) + 1, 99); }
      }
      if (g.phase === 'buy') { bot.state = 'setup'; bot.wantWalk = false; if (!bot.moveTarget && Math.random() < 0.05) { const s = g.spawnPointFor(bot); bot.goTo(s.x + (Math.random() - 0.5) * 4, s.z + (Math.random() - 0.5) * 4); } return; }
      if (g.phase !== 'live' && g.phase !== 'planted') { bot.stop(); return; }
      if (this.team === g.attackTeam) this.assignAttack(bot); else this.assignDefend(bot);
    }
    assignAttack(bot) {
      const g = this.game, plan = this.plan; const a = plan && plan.assignments.get(bot); if (!a) return;
      const spike = g.spike; const site = plan.site;
      // spike on the ground: nearest attacker fetches it
      if (spike.state === 'dropped') {
        const alive = this.alive(this.bots()); let nearest = alive[0]; let nd = 1e9;
        for (const b of alive) { const d = U.dist(b.pos.x, b.pos.z, spike.pos.x, spike.pos.z); if (d < nd) { nd = d; nearest = b; } }
        if (nearest === bot) { bot.state = 'fetch'; bot.goTo(spike.pos.x, spike.pos.z); bot.wantWalk = false; return; }
      }
      if (spike.state === 'planted') { // post plant
        if (!bot.holdSpot || bot.state !== 'postplant') { const h = U.pick(HOLDS.post[spike.site]); bot.holdSpot = this.spotIn(h.area, h.watch); bot.state = 'postplant'; bot.holdCrouch = Math.random() < 0.3; }
        this.holdAt(bot);
        return;
      }
      // planter behaviour when at site
      const sitePos = site ? this.callout(site + ' Site') : null;
      const planted = false;
      if (bot.inv.spike && site && sitePos) {
        const inZone = g.map.inPlantZone(bot.pos.x, bot.pos.z) === site;
        const ps = g.plantSpot(site);
        const dPs = U.dist(bot.pos.x, bot.pos.z, ps.x, ps.z);
        if (inZone && dPs < 1.6 && !bot.visibleTarget) { bot.stop(); if (!bot.planting) g.startPlant(bot); bot.state = 'plant'; return; }
        if (inZone && dPs < 1.6 && bot.visibleTarget && g.roundTime < 20) { bot.stop(); if (!bot.planting) g.startPlant(bot); bot.state = 'plant'; return; } // desperate plant
        const timeUpP = this.roundT > plan.executeAt || g.roundTime < 40;
        if (bot.state === 'plant' || (timeUpP && (this.nearSite(bot, site) < 30 || g.roundTime < 40))) { bot.state = 'plant'; bot.goTo(ps.x, ps.z); bot.wantWalk = this.nearSite(bot, site) < 14 && g.roundTime > 35; return; }
      }
      // route following: stage at each waypoint area until executeAt, then push
      const route = a.route; const lastArea = route[route.length - 1];
      const stageArea = route[Math.min(a.stageIdx, route.length - 1)];
      const timeUp = this.roundT > plan.executeAt || g.roundTime < 32;
      if (a.role === 'buddy' && g.player.alive && g.player.team === this.team) {
        // follow player loosely; if the player idles at spawn, go run the plan instead
        const sp = g.spawnPointFor(g.player); const playerIdle = U.dist(g.player.pos.x, g.player.pos.z, sp.x, sp.z) < 8;
        if (playerIdle && this.roundT > 18) { a.role = 'entry'; bot.state = 'move'; }
        const d = U.dist(bot.pos.x, bot.pos.z, g.player.pos.x, g.player.pos.z);
        if (d > 7) { bot.goTo(g.player.pos.x + (Math.random() - 0.5) * 3, g.player.pos.z + (Math.random() - 0.5) * 3); bot.wantWalk = d < 12 && g.player.moveSpeedFrac < 0.5; }
        else if (d < 3) bot.stop();
        bot.state = 'follow'; return;
      }
      if (a.role === 'lurk' && !timeUp) {
        // lurker holds the opposite lobby/mid
        if (!bot.holdSpot) { const area = site === 'A' ? 'Mid Bottom' : 'Mid Catwalk'; bot.holdSpot = this.spotIn(area, site === 'A' ? 'Mid Market' : 'Mid Cubby'); bot.state = 'hold'; bot.wantWalk = true; }
        this.holdAt(bot); return;
      }
      // move along route
      if (!timeUp && a.stageIdx >= route.length - 2) {
        // wait at the last staging area (before the site) - hold an angle toward the site
        if (!bot.holdSpot) { bot.holdSpot = this.spotIn(stageArea, lastArea); bot.state = 'stage'; }
        this.holdAt(bot); bot.wantWalk = this.nearSite(bot, site) < 30; return;
      }
      const target = this.callout(stageArea); if (!target) return;
      if (U.dist(bot.pos.x, bot.pos.z, target.x, target.z) < 5) { if (a.stageIdx < route.length - 1) { a.stageIdx++; bot.holdSpot = null; } else { // at site: take a post position
          if (!bot.holdSpot) bot.holdSpot = this.spotIn(lastArea, site === 'A' ? 'A Wine' : 'Mid Market'); this.holdAt(bot); return; } }
      const dest = a.stageIdx >= route.length - 1 ? this.spotIn(lastArea, lastArea) : { x: target.x + (Math.random() - 0.5) * 3, z: target.z + (Math.random() - 0.5) * 3 };
      if (dest) bot.goTo(dest.x, dest.z);
      bot.state = 'move'; bot.wantWalk = timeUp ? false : (site && this.nearSite(bot, site) < 28);
      bot.lookTarget = null;
    }
    nearSite(bot, site) { const c = this.callout(site + ' Site'); return c ? U.dist(bot.pos.x, bot.pos.z, c.x, c.z) : 99; }
    holdAt(bot) {
      const hs = bot.holdSpot; if (!hs) return;
      const d = U.dist(bot.pos.x, bot.pos.z, hs.x, hs.z);
      if (d > 1.0) { bot.goTo(hs.x, hs.z); bot.lookTarget = null; bot.wantWalk = d < 10; }
      else { bot.stop(); if (hs.watch) bot.lookTarget = { x: hs.watch.x, z: hs.watch.z, y: this.game.map.heightAt(hs.watch.x, hs.watch.z) + 1.4 };
        // jiggle / re-peek occasionally
        bot.holdT = (bot.holdT || 0) + 0.3; if (bot.holdT > 6 + Math.random() * 10) { bot.holdT = 0; if (Math.random() < 0.35) { const rx = Math.cos(bot.yaw), rz = -Math.sin(bot.yaw); const s = Math.random() < 0.5 ? 1 : -1; const nw = VAL.Nav.nearestWalkable(hs.x + rx * s * 1.5, hs.z + rz * s * 1.5); if (nw) { hs.x = nw.x; hs.z = nw.z; } } }
      }
    }
    assignDefend(bot) {
      const g = this.game, plan = this.plan; const a = plan && plan.assignments.get(bot); if (!a) return;
      const spike = g.spike;
      if (spike.state === 'planted') {
        // retake: go to staging near the site, then push and defuse
        const site = spike.site;
        const alive = this.alive(this.bots());
        const dSpike = U.dist(bot.pos.x, bot.pos.z, spike.pos.x, spike.pos.z);
        const timeLeft = g.spikeTime;
        if (bot.state !== 'retake' && bot.state !== 'defuse') { bot.state = 'retake'; bot.holdSpot = null; const st = U.pick(HOLDS.retakeStage[site]); bot.stage = this.spotIn(st, site + ' Site'); bot.wantWalk = false; }
        // nearest alive defender without visible enemies defuses
        let nearest = alive[0], nd = 1e9; for (const b of alive) { const d = U.dist(b.pos.x, b.pos.z, spike.pos.x, spike.pos.z); if (d < nd) { nd = d; nearest = b; } }
        const rush = timeLeft < 16;
        if (nearest === bot || rush) {
          if (dSpike < 1.4) { bot.stop(); if (!bot.defusing) g.startDefuse(bot); bot.state = 'defuse'; return; }
          bot.goTo(spike.pos.x, spike.pos.z); bot.state = 'retake'; bot.lookTarget = null; return;
        }
        // others: cover from a post spot
        if (!bot.holdSpot) { const h = U.pick(HOLDS.post[site]); bot.holdSpot = this.spotIn(h.area, h.watch); }
        this.holdAt(bot); bot.wantWalk = false; return;
      }
      // regular hold
      if (!bot.holdSpot) { bot.holdSpot = this.spotIn(a.hold.area, a.hold.watch); bot.state = 'hold'; bot.holdCrouch = Math.random() < 0.2; bot.wantWalk = false; }
      // aggressive: early peek forward then return
      if (a.role === 'aggressive' && this.roundT < 25 && !a.peeked) {
        const fwd = a.site === 'A' ? 'A Main' : a.site === 'B' ? 'B Main' : 'Mid Courtyard';
        if (!a.peekSpot) a.peekSpot = this.spotIn(fwd, a.site === 'A' ? 'A Lobby' : a.site === 'B' ? 'B Lobby' : 'Mid Top');
        if (a.peekSpot) { const d = U.dist(bot.pos.x, bot.pos.z, a.peekSpot.x, a.peekSpot.z); if (d > 1.2 && this.roundT < 18) { bot.goTo(a.peekSpot.x, a.peekSpot.z); bot.lookTarget = a.peekSpot.watch ? { x: a.peekSpot.watch.x, z: a.peekSpot.watch.z, y: 1.5 } : null; bot.state = 'peek'; return; } if (this.roundT >= 18 || bot.visibleTarget) a.peeked = true; }
      }
      // late round with no info: reposition / drift toward mid
      if (this.roundT > 55 && !bot.repositioned && Math.random() < 0.02) { bot.repositioned = true; const h = U.pick(HOLDS.def[a.site]); bot.holdSpot = this.spotIn(h.area, h.watch); }
      this.holdAt(bot);
    }
  }
  VAL.TeamBrain = TeamBrain; VAL.HOLDS = HOLDS;
})();
