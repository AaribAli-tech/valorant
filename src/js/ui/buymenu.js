// Buy menu (replica of Valorant's buy phase shop)
window.VAL = window.VAL || {};
VAL.BuyMenu = (function () {
  const U = VAL.U; const $ = id => document.getElementById(id);
  let app = null, game = null, open = false, hoverId = null, built = false;
  const CATS = { sidearm: 'bm-sidearms', smg: 'bm-smgs', shotgun: 'bm-shotguns', rifle: 'bm-rifles', sniper: 'bm-snipers', heavy: 'bm-heavies' };
  function init(a, g) {
    app = a; game = g;
    if (!built) { build(); built = true; }
    $('bm-close').onclick = () => close();
    document.querySelectorAll('.bm-requests button').forEach(b => b.onclick = () => { if (VAL.Audio) VAL.Audio.play('ui_click'); game.lastComms = { t: game.time, who: 'You', text: b.textContent }; });
  }
  function icon(id) { try { return VAL.WeaponModels && VAL.WeaponModels.iconDataURL ? VAL.WeaponModels.iconDataURL(id, 256, 96) : ''; } catch (e) { return ''; } }
  function build() {
    for (const w of VAL.WEAPONS) {
      const col = CATS[w.cat]; if (!col) continue;
      const el = document.createElement('div'); el.className = 'bm-item'; el.dataset.id = w.id;
      el.innerHTML = `<img alt="${w.name}"><div class="bm-price">${w.cost ? '¤' + w.cost.toLocaleString('en-US') : 'FREE'}</div><div class="bm-name">${w.name}</div><div class="bm-sell hidden">SELL</div>`;
      el.onmouseenter = () => { hoverId = w.id; renderDetail(w); if (VAL.Audio) VAL.Audio.play('ui_hover', { vol: 0.3 }); };
      el.onclick = () => { const r = game.playerBuy('weapon', w.id); if (r.ok) refresh(); };
      $(col).appendChild(el);
    }
    for (const s of VAL.SHIELDS) {
      const el = document.createElement('div'); el.className = 'bm-item armor ' + s.id; el.dataset.id = s.id;
      el.innerHTML = `<div class="shield-ico"></div><div class="bm-price">¤${s.cost.toLocaleString('en-US')}</div><div class="bm-name">${s.name}</div><div class="bm-sell hidden">SELL</div>`;
      el.onmouseenter = () => { renderShieldDetail(s); };
      el.onclick = () => { const r = game.playerBuy('shield', s.id); if (r.ok) refresh(); };
      $('bm-armor').appendChild(el);
    }
    document.querySelectorAll('.bm-ab[data-ab]').forEach(el => el.onclick = () => { if (VAL.Abilities) { const r = VAL.Abilities.buy(game.player, el.dataset.ab); if (r.ok) refresh(); } });
  }
  let iconsLoaded = false;
  function loadIcons() { if (iconsLoaded) return; iconsLoaded = true; document.querySelectorAll('.bm-item img').forEach(img => { const id = img.parentElement.dataset.id; const u = icon(id); if (u) img.src = u; else img.style.display = 'none'; }); }
  function renderDetail(w) {
    const runSpeed = (VAL.RULES.baseSpeed * w.runMult).toFixed(2).replace(/\.?0+$/, '');
    const fireText = w.cat === 'melee' ? 'MELEE' : (w.auto ? 'Auto' : 'Semi');
    const ranges = w.dmg;
    const stat = (l, v, u, pct) => `<div class="bd-stat"><div class="l">${l}</div><div class="v">${v}</div><div class="u">${u}</div><div class="b"><i style="width:${Math.round(pct * 100)}%"></i></div></div>`;
    $('bm-detail').innerHTML = `
      <div class="bd-head"><b>${w.name}</b><span>${w.catText.replace(/S$/, '')}</span></div>
      <div class="bd-fire"><span>PRIMARY FIRE</span><span>▮▮▮ ${fireText}</span><span>⇒ ${w.pen}</span></div>
      <div class="bd-stats">
        ${stat('FIRE RATE', w.fireRate, 'RDS/SEC', Math.min(1, w.fireRate / 16))}
        ${stat('RUN SPEED', runSpeed, 'M/SEC', w.runMult)}
        ${stat('EQUIP SPEED', w.equip, 'SEC', 1 - w.equip / 2)}
        ${stat('1ST SHOT SPREAD', w.firstShotSpread, 'DEG (HIP/ADS)', 1 - Math.min(1, w.firstShotSpread / 5))}
        ${stat('RELOAD SPEED', w.reload, 'SEC', 1 - w.reload / 6)}
        ${stat('MAGAZINE', w.mag, 'RDS', Math.min(1, w.mag / 50))}
      </div>
      <div class="bd-dmg">
        <div class="h"><span>DAMAGE</span>${ranges.map(r => `<i>${r.r0}–${r.r1}m</i>`).join('')}</div>
        <div class="bd-row"><span>HEAD</span>${ranges.map(r => `<i>${Math.round(r.head)}</i>`).join('')}</div>
        <div class="bd-row"><span>BODY</span>${ranges.map(r => `<i>${Math.round(r.body)}</i>`).join('')}</div>
        <div class="bd-row"><span>LEGS</span>${ranges.map(r => `<i>${Math.round(r.leg)}</i>`).join('')}</div>
        ${w.pellets > 1 ? `<div class="bd-row"><span>PELLETS</span><i>${w.pellets}</i></div>` : ''}
      </div>`;
  }
  function renderShieldDetail(s) {
    $('bm-detail').innerHTML = `<div class="bd-head"><b>${s.name}</b><span>ARMOR</span></div><div class="bd-stats"><div class="bd-stat"><div class="l">ARMOR</div><div class="v">${s.armor}</div><div class="u">POINTS</div><div class="b"><i style="width:${s.armor * 2}%"></i></div></div><div class="bd-stat"><div class="l">DAMAGE ABSORBED</div><div class="v">66%</div><div class="u">UNTIL DEPLETED</div><div class="b"><i style="width:66%"></i></div></div></div><div style="padding:12px;font-size:13px;color:#cfd3d6;line-height:1.5">Shields absorb 66% of incoming damage until they break. Heavy shields carry over between rounds while you're alive.</div>`;
  }
  function refresh() {
    const p = game.player;
    document.querySelectorAll('#buymenu .bm-item').forEach(el => {
      const id = el.dataset.id; const w = VAL.WEAPON_BY_ID[id]; const sh = VAL.SHIELDS.find(s => s.id === id);
      let owned = false, cost = 0;
      if (w) { owned = (p.inv.primary && p.inv.primary.id === id) || (p.inv.secondary && p.inv.secondary.id === id); cost = w.cost; }
      else if (sh) { owned = p.armorType === id; cost = sh.cost; }
      el.classList.toggle('owned', owned); el.classList.toggle('cant', !owned && p.credits < cost);
      el.querySelector('.bm-sell').classList.toggle('hidden', !owned || id === 'classic');
      const pr = el.querySelector('.bm-price'); if (pr) pr.textContent = owned ? 'OWNED' : (cost ? '¤' + cost.toLocaleString('en-US') : 'FREE');
    });
    U.text('bm-creds', p.credits.toLocaleString('en-US'));
    if (p.abilities) document.querySelectorAll('.bm-ab[data-ab]').forEach(el => { const s = el.dataset.ab; const n = p.abilities[s]; const cost = VAL.Abilities.COST[s]; el.classList.toggle('owned', n >= 2); el.querySelector('.ab-txt span').textContent = n >= 2 ? 'FULL' : (n > 0 ? `${n}/2 · ¤${cost}` : `¤${cost}`); });
    const ls = game.lossStreak[p.team]; const minNext = Math.min(VAL.ECON.max, p.credits + VAL.ECON.loss[Math.min(ls, 2)]);
    $('bm-min').textContent = '¤ ' + minNext.toLocaleString('en-US');
    const gun = $('bm-lo-gun'); gun.style.backgroundImage = p.inv.primary ? `url(${icon(p.inv.primary.id)})` : (p.inv.secondary ? `url(${icon(p.inv.secondary.id)})` : ''); gun.style.backgroundSize = 'contain'; gun.style.backgroundRepeat = 'no-repeat'; gun.style.backgroundPosition = 'center';
  }
  function show() {
    if (game.phase !== 'buy' || !game.player.alive) { if (VAL.Audio) VAL.Audio.play('buy_error', { vol: 0.5 }); return; }
    open = true; game.uiOpen = true; $('buymenu').classList.remove('hidden'); loadIcons(); refresh();
    if (!hoverId) renderDetail(game.player.weapon.def.cat === 'melee' ? VAL.WEAPON_BY_ID.classic : game.player.weapon.def);
    VAL.Input.unlock(); if (VAL.Audio) VAL.Audio.play('ui_click', { vol: 0.5 });
  }
  function close() { if (!open) return; open = false; game.uiOpen = false; $('buymenu').classList.add('hidden'); if (app.state === 'match') VAL.Input.lock(); if (VAL.Audio) VAL.Audio.play('ui_back', { vol: 0.5 }); }
  function toggle() { open ? close() : show(); }
  function update(dt) {
    if (!open) return;
    if (game.phase !== 'buy') { close(); return; }
    U.text('bm-time', U.fmtTime(game.phaseT)); U.text('bm-creds', game.player.credits.toLocaleString('en-US'));
  }
  return { init, show, close, toggle, update, refresh, get isOpen() { return open; } };
})();
