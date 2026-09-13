// In-game HUD: top bar, minimap, health/ammo, killfeed, announcements, scoreboard, prompts.
window.VAL = window.VAL || {};
VAL.HUD = (function () {
  const U = VAL.U; const $ = id => document.getElementById(id);
  let app = null, game = null, mm = null, mmCtx = null, mmBase = null;
  let lastAnn = null, kfCount = 0, sbVisible = false;
  const agentIcon = (id) => (VAL.Characters && VAL.Characters.AGENTS && VAL.Characters.AGENTS[id] && VAL.Characters.AGENTS[id].icon) || null;
  const agentColor = { jett: '#9fd3ff', sage: '#66cc99', sova: '#4477dd', omen: '#6a5acd', phoenix: '#ff7733', reyna: '#b04ad0', killjoy: '#ffdd33', cypher: '#eeeeee', raze: '#ff9922', brimstone: '#c98a4a' };
  const seenEnemies = new Map(); // ent -> time last seen by team

  function init(a, g) {
    app = a; game = g; mm = $('minimap'); mmCtx = mm.getContext('2d');
    buildTeamStrips(); buildWeaponSlots(); buildMinimapBase();
    $('hud').classList.remove('hidden');
    setCrosshairColor(localStorage.getItem('val_ch') || '#00ff00');
  }
  function setCrosshairColor(c) { document.documentElement.style.setProperty('--ch', c); }
  function teamIconHTML(e) {
    const ic = agentIcon(e.agent);
    return ic ? `<img src="${ic}" alt="${e.agent}">` : `<div class="badge" style="background:${agentColor[e.agent] || '#888'};display:flex;align-items:center;justify-content:center;font-family:var(--f-head);font-size:22px;color:#111">${(e.agent[0] || '?').toUpperCase()}</div>`;
  }
  function buildTeamStrips() {
    const L = $('team-left'), Rr = $('team-right'); L.innerHTML = ''; Rr.innerHTML = '';
    const mine = game.entities.filter(e => e.team === game.player.team), theirs = game.entities.filter(e => e.team !== game.player.team);
    const make = (e) => { const d = document.createElement('div'); d.className = 'tm'; d.innerHTML = teamIconHTML(e) + `<div class="hpb"><i style="width:100%"></i></div>`; d.dataset.name = e.name; e._tm = d; return d; };
    mine.forEach(e => L.appendChild(make(e))); theirs.forEach(e => Rr.appendChild(make(e)));
  }
  function buildWeaponSlots() { $('weapon-slots').innerHTML = ['1 PRIMARY', '2 SECONDARY', '3 MELEE', '4 SPIKE'].map((s, i) => `<div class="ws" data-i="${i}">${s}</div>`).join(''); }
  // ---------- minimap ----------
  // The official Ascent minimap (assets/ascent_minimap.png) is drawn in Riot's own
  // canonical orientation: image x comes from world Z, image y from world X, via the
  // xMultiplier/yMultiplier/scalars that ship with the map data.
  const MM = { size: 260, u0: 0, v0: 0, uS: 1, vS: 1, w: 260, h: 260, oy: 0, img: null, ready: false };
  function mmUV(x, z) {
    const t = game.map.data.mini;
    return [z * 100 * t.xm + t.xs, x * 100 * t.ym + t.ys];
  }
  function mmP(x, z) {
    const uv = mmUV(x, z);
    return [(uv[0] - MM.u0) / MM.uS * MM.w, (uv[1] - MM.v0) / MM.vS * MM.h + MM.oy];
  }
  function buildMinimapBase() {
    const d = game.map.data, b = d.bounds;
    const c0 = mmUV(b.minX, b.minZ), c1 = mmUV(b.maxX, b.maxZ);
    const u0 = Math.min(c0[0], c1[0]), u1 = Math.max(c0[0], c1[0]);
    const v0 = Math.min(c0[1], c1[1]), v1 = Math.max(c0[1], c1[1]);
    const pad = 0.012;
    MM.u0 = u0 - pad; MM.v0 = v0 - pad; MM.uS = (u1 - u0) + pad * 2; MM.vS = (v1 - v0) + pad * 2;
    const ar = MM.vS / MM.uS;
    MM.w = MM.size; MM.h = MM.size * ar; MM.oy = (MM.size - MM.h) / 2;
    const im = new Image();
    im.onload = () => { MM.img = im; MM.ready = true; paintBase(); };
    im.onerror = () => { MM.ready = true; paintBase(); };
    im.src = window.__VAL_ASSETS.minimap;
    paintBase();
  }
  function paintBase() {
    const c = document.createElement('canvas'); c.width = MM.size; c.height = MM.size;
    const ctx = c.getContext('2d');
    const d = game.map.data;
    ctx.fillStyle = 'rgba(10,16,22,0.55)'; ctx.fillRect(0, 0, MM.size, MM.size);
    if (MM.img) {
      ctx.save(); ctx.globalAlpha = 0.95;
      ctx.drawImage(MM.img, MM.u0 * MM.img.width, MM.v0 * MM.img.height, MM.uS * MM.img.width, MM.vS * MM.img.height, 0, MM.oy, MM.w, MM.h);
      ctx.restore();
    } else { // fall back to the traced outline if the art will not load
      const poly = (pts) => { ctx.beginPath(); pts.forEach((pt, i) => { const q = mmP(pt[0], pt[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); };
      poly(d.outline); ctx.fillStyle = 'rgba(200,200,200,0.85)'; ctx.fill();
      for (const v of d.voids) { poly(v); ctx.fillStyle = 'rgba(70,74,80,0.95)'; ctx.fill(); }
    }
    // plant sites on top of the art
    for (const k of ['A', 'B']) {
      const pz = d.plant[k]; const a = mmP(pz.x0, pz.z0), b2 = mmP(pz.x1, pz.z1);
      const x = Math.min(a[0], b2[0]), y = Math.min(a[1], b2[1]), w = Math.abs(b2[0] - a[0]), h = Math.abs(b2[1] - a[1]);
      ctx.fillStyle = 'rgba(198,178,86,0.34)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(232,214,130,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,236,150,0.95)'; ctx.font = 'bold 15px "Bebas Neue", Impact';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(k, x + w / 2, y + h / 2);
    }
    mmBase = c;
  }

  function drawMinimap() {
    const ctx = mmCtx; ctx.clearRect(0, 0, MM.size, MM.size); if (mmBase) ctx.drawImage(mmBase, 0, 0);
    const P = mmP;
    const now = game.time; const p = game.player;
    // spike
    const s = game.spike; if (s.state === 'dropped' || s.state === 'planted') { const [x, y] = P(s.pos.x, s.pos.z); ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fillStyle = s.state === 'planted' ? '#ff4655' : '#ffd766'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
    // barriers during buy
    if (game.phase === 'buy') { ctx.strokeStyle = 'rgba(80,255,220,0.8)'; ctx.lineWidth = 2; for (const t of ['att', 'def']) for (const b of game.map.data.barriers[t]) { const [x0, y0] = P(b[0], b[1]), [x1, y1] = P(b[2], b[3]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); } }
    // teammates + visible enemies
    for (const e of game.entities) {
      if (e === p) continue;
      const mine = e.team === p.team;
      if (!mine) { // shown only if seen recently by any teammate or shooting
        let seen = false; for (const m of game.entities) { if (m.team !== p.team || !m.alive) continue; if (m.isPlayer) { if (e.alive && playerSees(e)) seen = true; } else if (m.target === e && m.visibleTarget) seen = true; }
        if (e.lastFireT && now - (e.lastFireT || -9) < 1.5) seen = true;
        if (seen) seenEnemies.set(e, now); if (!seenEnemies.has(e) || now - seenEnemies.get(e) > 2.5) continue; if (!e.alive) continue;
      }
      const [x, y] = P(e.pos.x, e.pos.z);
      if (!e.alive) { if (mine) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); } continue; }
      ctx.save(); ctx.translate(x, y);
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, 6.28); ctx.fillStyle = mine ? (agentColor[e.agent] || '#3ad6b6') : '#ff4655'; ctx.fill(); ctx.strokeStyle = mine ? '#fff' : '#300'; ctx.lineWidth = 1.5; ctx.stroke();
      // view cone
      ctx.rotate(e.yaw + Math.PI * 1.5); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 14, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fillStyle = mine ? 'rgba(255,255,255,0.25)' : 'rgba(255,70,85,0.3)'; ctx.fill();
      ctx.restore();
    }
    // player
    const cam = app.camera; const px = p.alive ? p.pos.x : cam.position.x, pz = p.alive ? p.pos.z : cam.position.z; const yaw = p.alive ? p.yaw : cam.rotation.y;
    const [x, y] = P(px, pz);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-yaw);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 22, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }
  function playerSees(e) {
    const p = game.player; const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z; const d = Math.hypot(dx, dz); if (d > 70) return false;
    const ang = Math.abs(U.angleWrap(Math.atan2(-dx, -dz) - p.yaw)); if (ang > 0.75) return false;
    return game.map.lineOfSight(p.pos.x, p.pos.y + p.eye, p.pos.z, e.pos.x, e.pos.y + 1.4, e.pos.z);
  }
  // ---------- per frame ----------
  function update(dt) {
    const p = game.player; const g = game;
    // timer
    let t = g.phase === 'buy' ? g.phaseT : g.phase === 'planted' ? g.spikeTime : g.roundTime;
    const timerEl = $('hud-timer');
    if (g.phase === 'planted') { timerEl.textContent = ''; $('hud-spike-ico').classList.remove('hidden'); } else { $('hud-spike-ico').classList.add('hidden'); U.text('hud-timer', U.fmtTime(t)); }
    timerEl.classList.toggle('warn', g.phase !== 'buy' && t < 10 && g.phase !== 'planted');
    U.text('score-left', g.score[p.team]); U.text('score-right', g.score[p.team === 'blue' ? 'red' : 'blue']);
    // phase text
    const pt = $('phase-text');
    if (g.phase === 'buy') { pt.classList.remove('hidden'); U.text('phase-title', 'BUY PHASE'); $('phase-sub').innerHTML = 'PRESS <b>B</b> TO BUY'; }
    else if (g.phase === 'halftime') { pt.classList.remove('hidden'); U.text('phase-title', 'SWITCHING SIDES'); $('phase-sub').innerHTML = ''; }
    else pt.classList.add('hidden');
    // team strips
    for (const e of g.entities) { const d = e._tm; if (!d) continue; d.classList.toggle('dead', !e.alive); d.querySelector('.hpb i').style.width = Math.max(0, e.health) + '%'; }
    // location
    U.text('hud-location', g.playerArea());
    // health / armor
    U.text('hud-hp', Math.ceil(p.health)); $('hud-hp-fill').style.width = Math.max(0, p.health) + '%';
    $('armor-block').classList.toggle('hidden', p.armor <= 0); U.text('hud-armor', Math.ceil(p.armor));
    $('lowhp').classList.toggle('hidden', !(p.alive && p.health <= 25));
    // ammo / weapon
    const w = p.weapon; U.text('hud-weapon', w.def.name); U.text('hud-creds', p.credits.toLocaleString('en-US'));
    const ammoEl = $('hud-ammo'), resEl = $('hud-reserve');
    if (w.isGun) { ammoEl.textContent = w.ammo; resEl.textContent = w.reserve; resEl.parentElement.querySelector('.ammo-sep').style.display = ''; U.text('hud-firemode', w.def.auto ? 'AUTO' : 'SEMI'); }
    else { ammoEl.textContent = ''; resEl.textContent = ''; resEl.parentElement.querySelector('.ammo-sep').style.display = 'none'; U.text('hud-firemode', w.id === 'spike' ? 'PLANT: HOLD FIRE' : 'MELEE'); }
    const slotIdx = { primary: 0, secondary: 1, knife: 2, spike: 3 }[p.slot]; document.querySelectorAll('#weapon-slots .ws').forEach((el, i) => { el.classList.toggle('on', i === slotIdx); el.style.display = (i === 0 && !p.inv.primary) || (i === 3 && !p.inv.spike) ? 'none' : ''; });
    // abilities (Jett): C cloudburst x2, Q updraft x2, E tailwind, X ult
    const ab = p.abilities || { c: 0, q: 0, e: 1, x: 0 };
    $('pips-c').innerHTML = [0, 1].map(i => `<i class="${i < ab.c ? '' : 'off'}"></i>`).join(''); $('pips-q').innerHTML = [0, 1].map(i => `<i class="${i < ab.q ? '' : 'off'}"></i>`).join('');
    $('pips-e').innerHTML = `<i class="${ab.e > 0 ? '' : 'off'}"></i>`; $('pips-x').innerHTML = Array.from({ length: p.ultMax || 7 }, (_, i) => `<i class="${i < (p.ult || 0) ? '' : 'off'}"></i>`).join('');
    document.querySelectorAll('.abil').forEach(el => { const s = el.dataset.slot; el.classList.toggle('disabled', !(ab[s] > 0 || (s === 'x' && (p.ult || 0) >= (p.ultMax || 7)))); });
    // hitmarker
    const hm = $('hitmarker'); hm.classList.toggle('on', g.hitmarkerT > 0); hm.classList.toggle('head', g.hitmarkerHead);
    // damage vignette
    $('dmg-vignette').style.boxShadow = `inset 0 0 160px rgba(255,40,50,${Math.max(0, Math.min(0.75, p.dmgFlash * 1.4))})`;
    if (p.dmgFlash > 0 && p.lastDamageDir) { const d = p.lastDamageDir; const ang = Math.atan2(d.x, d.z) - p.yaw; $('dmg-dirs').innerHTML = `<div class="dmg-dir" style="transform:rotate(${(-ang + Math.PI) * 180 / Math.PI}deg);opacity:${Math.min(1, p.dmgFlash * 2)}"></div>`; } else $('dmg-dirs').innerHTML = '';
    // announcements
    const ann = g.announce[0];
    if (ann !== lastAnn) { lastAnn = ann; const el = $('announce'); if (ann) { el.classList.remove('hidden'); el.className = ann.kind === 'win' ? 'win' : ann.kind === 'lose' ? 'lose' : ''; U.text('ann-title', ann.title); U.text('ann-sub', ann.sub); } else el.classList.add('hidden'); }
    // progress (plant / defuse)
    const s = g.spike; const prog = $('progress');
    if (p.planting && s.state === 'planting') { prog.classList.remove('hidden'); U.text('prog-label', 'PLANTING SPIKE'); $('prog-fill').style.width = (s.progress * 100) + '%'; $('prog-half').classList.remove('show'); }
    else if (p.defusing && s.defuser === p) { prog.classList.remove('hidden'); U.text('prog-label', 'DEFUSING SPIKE'); $('prog-fill').style.width = (s.defuseProgress * 100) + '%'; $('prog-half').classList.add('show'); }
    else prog.classList.add('hidden');
    // prompt
    let prompt = null;
    if (p.alive && !g.uiOpen) {
      const attacker = g.isAttacker(p);
      if (!attacker && s.state === 'planted' && !p.defusing && U.dist(p.pos.x, p.pos.z, s.pos.x, s.pos.z) < 1.8) prompt = ['F', 'DEFUSE SPIKE'];
      else if (attacker && p.inv.spike && g.phase === 'live' && g.map.inPlantZone(p.pos.x, p.pos.z) && !p.planting) prompt = ['4', 'EQUIP SPIKE · HOLD FIRE TO PLANT'];
      else { const sw = g.map.nearestSwitch(p.pos.x, p.pos.z, p.pos.y); if (sw) prompt = ['F', sw.door.broken ? 'DOOR DESTROYED' : (sw.door.closedAmount > 0.5 ? 'OPEN DOOR' : 'CLOSE DOOR')]; else { const pk = g.nearestPickup(p); if (pk) prompt = ['F', 'PICK UP ' + pk.weapon.def.name]; } }
      if (attacker && s.state === 'carried' && s.carrier === p && g.phase === 'live' && g.map.inPlantZone(p.pos.x, p.pos.z) && p.slot === 'spike' && !p.planting) prompt = ['LMB', 'HOLD TO PLANT'];
    }
    const pr = $('prompt'); if (prompt) { pr.classList.remove('hidden'); U.text('prompt-key', prompt[0]); U.text('prompt-text', prompt[1]); } else pr.classList.add('hidden');
    // spectator
    const sp = $('spectator'); if (!p.alive && g.spectating) { sp.classList.remove('hidden'); U.text('spec-name', g.spectating.name.toUpperCase()); } else sp.classList.add('hidden');
    // scope / ADS vignette
    const scEl = $('scope');
    scEl.classList.toggle('hidden', !(p.alive && p.weapon.def.cat === 'sniper' && p.ads > 0.6));
    // scope circle sized in real viewport pixels so the black surround always reaches every edge
    scEl.style.setProperty('--scr', Math.round(Math.min(innerWidth, innerHeight) * 0.364) + 'px');
    const adsEl = $('ads-vignette');
    if (adsEl) adsEl.style.boxShadow = `inset 0 0 26vmin rgba(0,0,0,${(p.alive && p.weapon.def.cat !== 'sniper' ? p.ads * 0.55 : 0).toFixed(2)})`;
    // reticle error = the weapon's live spread projected to screen pixels, exactly what
    // Valorant's crosshair shows (focal length for a 71 deg vertical fov over 1080 units)
    const chEl = $('crosshair');
    const hs = Math.hypot(p.vel.x, p.vel.z);
    const spread = p.currentSpread ? p.currentSpread(hs, p.crouchT > 0.5) : 0;
    chEl.style.setProperty('--err', (Math.min(48, Math.tan(spread) * 757)).toFixed(1) + 'px');
    chEl.style.transform = `scale(${(1 - p.ads * 0.35).toFixed(2)})`;
    $('crosshair').style.display = (p.alive && !(p.weapon.def.cat === 'sniper' && p.ads > 0.6)) ? '' : 'none';
    // killfeed
    if (g.killfeed.length !== kfCount || (g.killfeed.length && g.killfeed[0]._dirty)) { kfCount = g.killfeed.length; renderKillfeed(); }
    // comms
    if (g.lastComms && g.time - g.lastComms.t < 4) $('comms').textContent = g.lastComms.who + ': ' + g.lastComms.text; else $('comms').textContent = '';
    // scoreboard
    const want = VAL.Input.down('scoreboard') || g.phase === 'end';
    if (want !== sbVisible) { sbVisible = want; $('scoreboard').classList.toggle('hidden', !want); }
    if (want) renderScoreboard();
    // round bar
    renderRoundBar();
    drawMinimap();
    // damage numbers
    renderDamageNumbers();
  }
  function renderKillfeed() {
    const p = game.player;
    $('killfeed').innerHTML = game.killfeed.slice(-6).map(k => {
      const mine = k.killerTeam === p.team; const cls = k.killer === p.name ? 'mine' : (k.victim === p.name ? 'enemy' : '');
      const wname = k.weapon === 'spike' ? '' : `<span class="w">${(VAL.WEAPON_BY_ID[k.weapon] || { name: k.weapon.toUpperCase() }).name}</span>`;
      return `<div class="kf ${cls}"><span class="k ${mine ? '' : 'red'}">${k.killer === 'SPIKE' ? 'SPIKE DETONATION' : k.killer}</span>${wname}${k.headshot ? '<span class="hs"></span>' : ''}<span class="v ${k.victimTeam === p.team ? 'blue' : ''}">${k.victim}</span></div>`;
    }).join('');
  }
  function renderScoreboard() {
    const p = game.player; U.text('sb-left', game.score[p.team]); U.text('sb-right', game.score[p.team === 'blue' ? 'red' : 'blue']); U.text('sb-mode', (app.mode || 'unrated').toUpperCase());
    const rows = (team) => game.entities.filter(e => e.team === team).sort((a, b) => b.score - a.score).map(e => `<tr class="${team === p.team ? 'blue' : 'red'} ${e === p ? 'me' : ''} ${e.alive ? '' : 'dead'}"><td>${e.name}${e === p ? ' (YOU)' : ''}</td><td>${(e.agent || '').toUpperCase()}</td><td class="num">${e.score}</td><td class="num">${e.kills}</td><td class="num">${e.deaths}</td><td class="num">${e.assists}</td><td class="num cr">¤${e.credits}</td><td>${e.inv.primary ? e.inv.primary.def.name : (e.inv.secondary ? e.inv.secondary.def.name : '')}${e.armor > 0 ? ' · ' + (e.armorType === 'heavy' ? 'HEAVY' : 'LIGHT') : ''}</td></tr>`).join('');
    $('sb-table').innerHTML = `<tr><th>PLAYER</th><th>AGENT</th><th class="num">SCORE</th><th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">CREDS</th><th>LOADOUT</th></tr>${rows(p.team)}<tr><td colspan="8" style="height:8px;background:rgba(0,0,0,.3)"></td></tr>${rows(p.team === 'blue' ? 'red' : 'blue')}`;
  }
  function renderRoundBar() {
    const rb = $('round-bar'); const total = Math.max(24, game.roundNumber); const p = game.player;
    if (rb.childElementCount !== total) { rb.innerHTML = ''; for (let i = 0; i < total; i++) rb.appendChild(document.createElement('i')); rb.classList.remove('hidden'); }
    game.roundResults.forEach((r, i) => { const el = rb.children[i]; if (el) el.className = r.winner === p.team ? 'b' : 'r'; });
  }
  const dmgEls = [];
  function renderDamageNumbers() {
    const cam = app.camera; const list = game.damageNumbers; let html = '';
    for (const d of list) {
      const v = d.pos.clone().project(cam); if (v.z > 1) continue;
      const s = app.app ? (app.app.uiScale || 1) : 1;
      const x = (v.x * 0.5 + 0.5) * innerWidth / s, y = (-v.y * 0.5 + 0.5) * innerHeight / s - (0.9 - d.t) * 40;
      html += `<div style="position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);font-family:var(--f-cond);font-weight:800;font-size:${d.head ? 22 : 18}px;color:${d.head ? '#ff4655' : '#fff'};text-shadow:0 1px 3px #000;opacity:${Math.min(1, d.t * 2)}">${d.v}</div>`;
    }
    let el = $('dmg-numbers'); if (!el) { el = document.createElement('div'); el.id = 'dmg-numbers'; el.style.cssText = 'position:absolute;inset:0;pointer-events:none'; $('hud').appendChild(el); }
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function hide() { $('hud').classList.add('hidden'); }
  return { init, update, hide, setCrosshairColor, buildTeamStrips };
})();
