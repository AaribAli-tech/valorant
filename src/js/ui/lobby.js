// Lobby (home screen) content + match loading (VS) screen
window.VAL = window.VAL || {};
VAL.Lobby = (function () {
  const $ = id => document.getElementById(id);
  const MISSIONS = [
    ['Use Your Abilities', 44, 200, '+8,250XP'], ['Deal Damage', 4652, 25000, '+8,100XP'], ['Play A Game', 1, 10, '+12,000XP'], ['Purchase Weapons', 0, 20, '+2,000XP'], ['Get Headshots', 0, 5, '+2,000XP']
  ];
  let dailyLeft = 18 * 3600 + 9 * 60 + 29, dailyTimer = null;
  const AGENT_COL = { jett: ['#dfe8ef', '#4f8fb5'], sage: ['#bfe7d6', '#2f7a63'], sova: ['#9db8e6', '#2b4a8c'], omen: ['#6b5a9e', '#1d1638'], phoenix: ['#ffb38a', '#b3471d'], reyna: ['#c58ad6', '#4a1e5c'], killjoy: ['#ffe27a', '#8a6d12'], cypher: ['#f0ece4', '#6a6f78'], raze: ['#ffc27a', '#b35a17'], brimstone: ['#d6a06a', '#5a3a22'] };
  const NAMES = { jett: 'Jett', sage: 'Sage', sova: 'Sova', omen: 'Omen', phoenix: 'Phoenix', reyna: 'Reyna', killjoy: 'Killjoy', cypher: 'Cypher', raze: 'Raze', brimstone: 'Brimstone' };
  const BANNERS = [
    ['#5a1f3c', '#d84a86', 'VCT MASTERS WINNER'], ['#0b2a5c', '#2f7fd6', 'CHAMPION'], ['#d8d2c0', '#8a7a5a', 'CHAMPION'], ['#c96a2a', '#5a2f6e', 'CHAMPION'], ['#2a2f4a', '#6b7bb8', 'CHAMPION']
  ];
  const ART = { ascent: window.__VAL_ASSETS.menuBg };
  const art = id => (VAL.AgentArt && VAL.AgentArt[id]) || null;
  let dressed = false;
  // Riot's official agent art on every UI surface: home-screen hero, featured cards, party avatars
  function dress() {
    if (dressed) return; dressed = true;
    const jett = art('jett');
    const hero = $('lobby-hero'); if (hero && jett && jett.full) hero.src = jett.full;
    const nc = $('nc-ascent'); if (nc) nc.style.backgroundImage = 'url(' + ART.ascent + ')';
    const na = $('nc-agent'); if (na && jett && jett.bust) { na.style.backgroundImage = 'url(' + jett.bust + ')'; na.style.backgroundColor = (jett.grad && jett.grad[1]) || '#2b4a5c'; }
    const nm = $('nc-mode'); if (nm) nm.style.backgroundImage = 'url(' + ART.ascent + ')';
    document.querySelectorAll('[data-agent]').forEach(el => { const a = art(el.dataset.agent); if (a && a.icon) el.innerHTML = '<img src="' + a.icon + '" alt="">'; });
  }
  function show() {
    dress();
    const m = $('missions');
    if (!m.childElementCount) m.innerHTML = MISSIONS.map(([n, a, b, xp]) => `<div class="mission"><div class="mn">${n}</div><div class="mb"><i style="width:${Math.min(100, a / b * 100)}%"></i></div><div class="mv">${a.toLocaleString('en-US')} / ${b.toLocaleString('en-US')}<b>${xp}</b></div></div>`).join('');
    if (!dailyTimer) dailyTimer = setInterval(() => { dailyLeft = Math.max(0, dailyLeft - 1); const h = Math.floor(dailyLeft / 3600), mi = Math.floor(dailyLeft % 3600 / 60), s = dailyLeft % 60; const el = $('daily-timer'); if (el) el.textContent = `${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }, 1000);
  }
  function portraitHTML(agent, name) {
    const a = art(agent);
    const c = (a && a.grad && a.grad.length >= 2) ? [a.grad[0], a.grad[1]] : (AGENT_COL[agent] || ['#999', '#333']);
    const bust = a && a.bust;
    const face = bust ? `<div style="width:100%;height:100%;background:linear-gradient(160deg,${c[0]},${c[1]})"><img src="${bust}" style="width:100%;height:100%;object-fit:cover;object-position:50% 0"></div>` : `<div style="width:100%;height:100%;background:linear-gradient(160deg,${c[0]},${c[1]});display:flex;align-items:center;justify-content:center;font-family:var(--f-head);font-size:64px;color:rgba(255,255,255,.85)">${(NAMES[agent] || agent)[0]}</div>`;
    return `<div class="ld-portrait"><div class="face">${face}</div><div class="pname">${name.toUpperCase()}</div></div>`;
  }
  function bannerHTML(i, agent) {
    const b = BANNERS[i % BANNERS.length]; const c = AGENT_COL[agent] || ['#999', '#333'];
    return `<div class="ld-banner"><div class="art" style="background:linear-gradient(100deg,${b[0]} 0%,${b[1]} 55%,${c[1]} 100%);"><div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.05) 0 12px,transparent 12px 24px)"></div><div style="position:absolute;right:16px;top:12px;font-family:var(--f-head);font-size:54px;color:rgba(255,255,255,.22);letter-spacing:.1em">${(NAMES[agent] || agent).toUpperCase()}</div></div><div class="title">${b[2]}</div></div>`;
  }
  function renderLoading(mode, side) {
    const team = [['jett', 'You'], ['sage', 'himlate'], ['sova', 'cherwood'], ['omen', 'sickeez'], ['phoenix', 'vandalprince']];
    const enemy = [['reyna', 'notaimbot'], ['killjoy', 'kj turret'], ['cypher', 'fadedd'], ['raze', 'boombot andy'], ['brimstone', 'stimbeacon']];
    $('ld-mode').textContent = (mode || 'unrated').toUpperCase();
    $('ld-left-title').textContent = side === 'attack' ? 'ATTACKING' : 'DEFENDING'; $('ld-right-title').textContent = side === 'attack' ? 'DEFENDING' : 'ATTACKING';
    $('ld-left-title').style.color = side === 'attack' ? 'var(--red)' : 'var(--teal2)'; $('ld-right-title').style.color = side === 'attack' ? 'var(--teal2)' : 'var(--red)';
    document.querySelector('.ld-team.left').style.setProperty('--side', side === 'attack' ? 'var(--red)' : 'var(--teal2)');
    $('ld-team-left').innerHTML = team.map(([a, n], i) => `<div class="ld-card" style="border-left-color:${side === 'attack' ? 'var(--red)' : 'var(--teal2)'}">${portraitHTML(a, n)}${bannerHTML(i, a)}</div>`).join('');
    $('ld-team-right').innerHTML = enemy.map(([a, n], i) => `<div class="ld-card" style="border-right-color:${side === 'attack' ? 'var(--teal2)' : 'var(--red)'}">${portraitHTML(a, n)}${bannerHTML(i, a)}</div>`).join('');
  }
  return { show, renderLoading, dress };
})();
