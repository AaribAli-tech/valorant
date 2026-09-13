// App bootstrap: renderer, scene, screens flow (gate -> lobby -> play -> queue -> loading -> match -> end).
window.VAL = window.VAL || {};
VAL.App = (function () {
  const U = VAL.U; const $ = id => document.getElementById(id);
  const app = { state: 'gate', mode: 'unrated', renderer: null, scene: null, camera: null, map: null, player: null, match: null, sky: null, time: 0, lastT: 0 };
  let cine = { angle: 0.6 };

  const MENU_BG = { 'screen-lobby': window.__VAL_ASSETS.menuBg, 'screen-play': window.__VAL_ASSETS.menuBg };
  function setScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    // the HUD is not a .screen, so hide it explicitly whenever a menu screen takes over
    if (id !== 'none') {
      if (VAL.HUD && VAL.HUD.hide) VAL.HUD.hide(); else { const h = $('hud'); if (h) h.classList.add('hidden'); }
      const sc = $('scope'); if (sc) sc.classList.add('hidden');
      const av = $('ads-vignette'); if (av) av.style.boxShadow = 'inset 0 0 26vmin rgba(0,0,0,0)';
      if (VAL.BuyMenu && VAL.BuyMenu.isOpen && VAL.BuyMenu.isOpen()) VAL.BuyMenu.close();
    }
    const bg = $('ui-bg'); if (!bg) return;
    const art = MENU_BG[id];
    if (art) { const im = bg.querySelector('.bg-img'); const url = `url("${art}")`; if (im.style.backgroundImage !== url) im.style.backgroundImage = url; bg.classList.add('on'); }
    else bg.classList.remove('on');
  }
  function progress(p, msg) { $('gate-fill').style.width = Math.round(p * 100) + '%'; if (msg) U.text('gate-msg', msg); }

  async function init() {
    const q = new URLSearchParams(location.search);
    const canvas = $('gl');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    app.renderer = renderer;
    if (VAL.Stats) VAL.Stats.attach(renderer, scene);   // F3 / ?stats=1 - no-op otherwise
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc9b8d8); app.scene = scene;
    buildEnvironment(renderer, scene);
    const camera = new THREE.PerspectiveCamera(71, innerWidth / innerHeight, 0.05, 700); scene.add(camera); app.camera = camera;
    VAL.Input.init(canvas);
    progress(0.1, 'Loading Ascent…'); await tick();
    // lights
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4); sun.position.set(-70, 110, 70); sun.castShadow = true; sun.shadow.mapSize.set(3072, 3072);
    const sc = sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 400; sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.02;
    sun.target.position.set(14, 0, -45); scene.add(sun); scene.add(sun.target); app.sun = sun;
    // ?shadowfit=35 trades distant shadows for a quarter of the shadow pass; see
    // js/core/shadowfollow.js for the measured numbers and why it stays opt-in.
    const shadowFit = Number(q.get('shadowfit')) || 0;
    if (shadowFit > 0 && VAL.ShadowFollow) {
      app.shadowFollow = VAL.ShadowFollow.create(sun, camera, { fit: shadowFit, lead: Number(q.get('shadowlead')) });
      if (app.shadowFollow) console.info('[VAL.ShadowFollow] ±' + app.shadowFollow.fit + ' m volume, ' + app.shadowFollow.texel.toFixed(3) + ' m texel');
    }
    sun.layers.enable(1);
    const hemi = new THREE.HemisphereLight(0xd6dcff, 0x8d7d68, 0.95); hemi.layers.enable(1); scene.add(hemi);
    progress(0.25, 'Building geometry…'); await tick();
    // Kick the character rigs off the wire now: unpacking the map costs about a
    // second of CPU and the GLBs about a second of network, and preload() memoises
    // its promise, so awaiting it below just picks up whatever already arrived.
    const modelsReady = VAL.Characters && VAL.Characters.preload ? VAL.Characters.preload(window.__VAL_ASSETS.models) : null;
    app.map = VAL.AscentMap.build(scene);
    VAL.Nav.init(app.map);
    app.map.dress();
    if (VAL.Nav.blockObstacles) app.navBlocked = VAL.Nav.blockObstacles(app.map);
    progress(0.55, 'Painting the sky…'); await tick();
    try { if (VAL.Scenery) { app.sky = VAL.Scenery.buildSky(scene, renderer); if (VAL.Scenery.buildSurroundings) VAL.Scenery.buildSurroundings(scene, app.map.data.bounds); } } catch (e) { console.warn('scenery', e); }
    // ---- static batching -------------------------------------------------
    // Ascent is ~17k boxes of facade, skyline and props, authored as thousands
    // of little meshes. Folded into GPU instances the map goes from ~1000 draw
    // calls and ~50 MB of vertex buffers to a few hundred calls and ~10 MB,
    // which is the difference between 40 fps and a locked frame rate on a laptop
    // iGPU. ?noinstance=1 replays the unbatched build for an A/B comparison.
    const batchingOn = !/[?&]noinstance=1/.test(location.search);
    if (VAL.Instancing && batchingOn) {
      VAL.Instancing.configure({ vsmShadows: renderer.shadowMap.type === THREE.VSMShadowMap });
      progress(0.6, 'Batching static geometry…'); await tick();
      const tb = performance.now();
      const groups = [app.map.group, app.map.dressGroup, scene.getObjectByName('surroundings')].filter(Boolean);
      const sum = {};
      for (const g of groups) {
        g.userData.batchable = true;
        const st = VAL.Instancing.optimize(g);
        for (const k in st) if (typeof st[k] === 'number') sum[k] = (sum[k] || 0) + st[k];
      }
      app.batching = sum;
      if (VAL.Stats) VAL.Stats.setInfo({ batches: sum.batches, instances: sum.instances });
      console.info('[VAL.Instancing] map meshes ' + sum.meshesBefore + ' -> ' + sum.meshesAfter +
        ', ' + sum.instances + ' boxes instanced, ' + sum.merged + ' merged in ' +
        (performance.now() - tb).toFixed(0) + ' ms');
    }
    if (VAL.Stats) {
      VAL.Stats.setInfo({ batching: batchingOn });
      VAL.Stats.note(batchingOn ? 'F3 toggles  ·  ?noinstance=1 to compare' : 'instancing OFF (?noinstance=1)');
    }
    progress(0.7, 'Loading agent model…'); await tick();
    if (VAL.Characters && VAL.Characters.preload) {
      try { await (modelsReady || VAL.Characters.preload(window.__VAL_ASSETS.models)); if (VAL.AgentArt && VAL.Characters.AGENTS) for (const id in VAL.AgentArt) if (VAL.Characters.AGENTS[id]) VAL.Characters.AGENTS[id].icon = VAL.AgentArt[id].icon; }
      catch (e) { console.error('agent model failed to load', e); }
    }
    progress(0.75, 'Preparing agents…'); await tick();
    app.player = new VAL.Player(scene, camera, app.map);
    progress(0.9, 'Loading weapons…'); await tick();
    try { if (VAL.WeaponModels && VAL.WeaponModels.iconDataURL) { for (const w of VAL.WEAPONS) VAL.WeaponModels.iconDataURL(w.id, 256, 96); } } catch (e) { }
    progress(1, 'Ready');
    $('gate-btn').classList.remove('hidden'); $('gate-btn').onclick = start;
    $('gate-btn').focus();
    window.addEventListener('resize', onResize); onResize();
    bindUI();
    app.lastT = performance.now(); requestAnimationFrame(loop);
    if (q.get('quick')) { app.mode = q.get('mode') || 'unrated'; app.startSide = q.get('side') || (Math.random() < 0.5 ? 'attack' : 'defend'); if (VAL.Audio) { VAL.Audio.init(); VAL.Audio.setVolume({ master: 0.8, sfx: 1, music: 0.5 }); } startMatch(); }
    setInterval(() => { if (performance.now() - app.lastT > 250) loop(performance.now(), true); }, 100); // keep sim alive when tab hidden
  }
  function tick() { return new Promise(r => setTimeout(r, 30)); }
  // Image-based ambient light. Without it every metalness>0 material renders black
  // (a metal with nothing to reflect has no diffuse term), which is why the shipping
  // containers and railings were solid black boxes.
  function buildEnvironment(renderer, scene) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0.00, '#5a5f96'); grd.addColorStop(0.38, '#b7b2d4');
    grd.addColorStop(0.50, '#efe6da'); grd.addColorStop(0.62, '#c3b7a4'); grd.addColorStop(1.00, '#6d6558');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
    const sg = g.createRadialGradient(186, 40, 2, 186, 40, 54);
    sg.addColorStop(0, 'rgba(255,244,222,0.95)'); sg.addColorStop(1, 'rgba(255,244,222,0)');
    g.fillStyle = sg; g.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
    const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose();
    scene.environment = env; app.envMap = env;
  }

  function onResize() {
    app.camera.aspect = innerWidth / innerHeight; app.camera.updateProjectionMatrix(); app.renderer.setSize(innerWidth, innerHeight);
    // UI is authored 1080 design-units tall; its WIDTH follows the real aspect ratio so panels
    // anchor to the true screen edges instead of sitting inside a letterboxed 16:9 box.
    const s = Math.min(innerHeight / 1080, innerWidth / 1280); app.uiScale = s;
    const w = Math.round(innerWidth / s), h = Math.round(innerHeight / s);
    app.uiW = w; app.uiH = h;
    const ui = $('ui'); ui.style.width = w + 'px'; ui.style.height = h + 'px';
    ui.style.transform = `scale(${s})`;
    document.documentElement.style.setProperty('--uiw', w + 'px');
    document.documentElement.style.setProperty('--uih', h + 'px');
    // the home screen's centre composition (logo, agent art, featured cards) is authored for a
    // 1160-unit-wide centre column; on squarer screens it scales down instead of overlapping
    const lf = Math.min(1, Math.max(0.62, (w - 760) / 1160));
    document.documentElement.style.setProperty('--lf', lf.toFixed(3));
    ui.classList.toggle('narrow', w < 1500);
  }

  function start() {
    if (VAL.Audio) { VAL.Audio.init(); VAL.Audio.setVolume({ master: 0.8, sfx: 1, music: 0.5 }); VAL.Audio.play('ui_click'); }
    toLobby();
  }
  function toLobby() {
    app.state = 'lobby'; setScreen('screen-lobby'); VAL.Input.unlock(); document.exitPointerLock && document.exitPointerLock();
    if (VAL.Lobby) VAL.Lobby.show();
    if (VAL.Audio) VAL.Audio.music('lobby');
    app.camera.fov = 60; app.camera.updateProjectionMatrix();
  }
  function bindUI() {
    $('btn-play').onclick = () => { if (VAL.Audio) VAL.Audio.play('ui_click'); app.state = 'play'; setScreen('screen-play'); };
    $('play-back').onclick = () => { if (VAL.Audio) VAL.Audio.play('ui_back'); toLobby(); };
    document.querySelectorAll('.mode-card').forEach(c => c.onclick = () => { document.querySelectorAll('.mode-card').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); app.mode = c.dataset.mode; if (VAL.Audio) VAL.Audio.play('ui_hover'); });
    document.querySelectorAll('.mode-row').forEach(c => c.onclick = () => { app.mode = c.dataset.mode; app.state = 'play'; setScreen('screen-play'); document.querySelectorAll('.mode-card').forEach(x => x.classList.toggle('sel', x.dataset.mode === app.mode)); });
    $('btn-start').onclick = startQueue;
    $('q-cancel').onclick = () => { app.queue = null; $('queue').classList.add('hidden'); if (VAL.Audio) VAL.Audio.play('ui_back'); };
    $('esc-resume').onclick = () => toggleEsc(false);
    $('esc-leave').onclick = () => { toggleEsc(false); endMatch(true); };
    $('opt-sens').oninput = e => { VAL.Input.setSensitivity(parseFloat(e.target.value)); U.text('opt-sens-v', parseFloat(e.target.value).toFixed(2)); localStorage.setItem('val_sens', e.target.value); };
    $('opt-vol').oninput = e => { const v = parseFloat(e.target.value); U.text('opt-vol-v', Math.round(v * 100) + '%'); if (VAL.Audio) VAL.Audio.setVolume({ master: v }); };
    $('opt-music').oninput = e => { const v = parseFloat(e.target.value); U.text('opt-music-v', Math.round(v * 100) + '%'); if (VAL.Audio) VAL.Audio.setVolume({ music: v }); };
    $('opt-ch').onchange = e => { VAL.HUD.setCrosshairColor(e.target.value); localStorage.setItem('val_ch', e.target.value); };
    const ss = localStorage.getItem('val_sens'); if (ss) { $('opt-sens').value = ss; VAL.Input.setSensitivity(parseFloat(ss)); U.text('opt-sens-v', parseFloat(ss).toFixed(2)); }
    $('end-continue').onclick = () => { setScreen('screen-lobby'); toLobby(); };
    VAL.Input.on('key', (code, down) => {
      if (!down) return;
      if (app.state === 'match') {
        if (code === 'Escape') { if (VAL.BuyMenu.isOpen) VAL.BuyMenu.close(); else toggleEsc(); }
        else if (code === 'KeyB' && !app.escOpen) VAL.BuyMenu.toggle();
      }
    });
    VAL.Input.on('lockchange', locked => { if (app.state === 'match' && !locked && !app.escOpen && !VAL.BuyMenu.isOpen && !app.match.matchOver) { /* user pressed esc natively */ app.match.uiOpen = true; setTimeout(() => { if (!document.pointerLockElement && app.state === 'match' && !VAL.BuyMenu.isOpen) toggleEsc(true); }, 50); } });
    $('gl').addEventListener('mousedown', () => { if (app.state === 'match' && !app.escOpen && !VAL.BuyMenu.isOpen) VAL.Input.lock(); });
  }
  function toggleEsc(force) {
    const want = force == null ? !app.escOpen : force; app.escOpen = want;
    $('menu-esc').classList.toggle('hidden', !want);
    if (app.match) app.match.uiOpen = want || VAL.BuyMenu.isOpen;
    if (want) VAL.Input.unlock(); else if (app.state === 'match') VAL.Input.lock();
  }
  // ----- queue -> loading -> match -----
  function startQueue() {
    if (VAL.Audio) VAL.Audio.play('queue_start');
    app.queue = { t: 0, dur: 2.5 + Math.random() * 3 }; $('queue').classList.remove('hidden'); U.text('q-mode', app.mode.toUpperCase() + ' · ASCENT');
  }
  function matchFound() {
    app.queue = null; $('queue').classList.add('hidden'); $('match-found').classList.remove('hidden');
    if (VAL.Audio) { VAL.Audio.play('match_found'); }
    setTimeout(() => { $('match-found').classList.add('hidden'); showLoading(); }, 2200);
  }
  function showLoading() {
    app.state = 'loading'; setScreen('screen-loading');
    if (VAL.Audio) VAL.Audio.music(null);
    app.startSide = Math.random() < 0.5 ? 'attack' : 'defend';
    if (VAL.Lobby && VAL.Lobby.renderLoading) VAL.Lobby.renderLoading(app.mode, app.startSide);
    app.loadT = 0;
  }
  function startMatch() {
    app.state = 'match'; setScreen('none');
    app.escOpen = false; $('menu-esc').classList.add('hidden');
    app.camera.fov = 71; app.camera.updateProjectionMatrix();
    app.match = new VAL.Match(app);
    app.onMatchEnd = (winner) => { setTimeout(() => showEnd(winner), 1500); };
    app.match.start({ startSide: app.startSide });
    VAL.HUD.init(app, app.match); VAL.BuyMenu.init(app, app.match);
    VAL.Input.lock();
  }
  function showEnd(winner) {
    const m = app.match; if (!m) return; app.state = 'end'; VAL.Input.unlock();
    setScreen('screen-end'); VAL.HUD.hide();
    const won = winner === m.player.team; const t = $('end-title'); t.textContent = won ? 'VICTORY' : 'DEFEAT'; t.className = 'end-title ' + (won ? 'win' : 'lose');
    U.text('end-left', m.score[m.player.team]); U.text('end-right', m.score[m.player.team === 'blue' ? 'red' : 'blue']);
    const p = m.player; $('end-stats').innerHTML = `<div>KILLS<b>${p.kills}</b></div><div>DEATHS<b>${p.deaths}</b></div><div>ASSISTS<b>${p.assists}</b></div><div>DAMAGE<b>${Math.round(m.playerStats.dmg)}</b></div><div>ROUNDS<b>${m.roundNumber}</b></div>`;
    if (VAL.Audio) { VAL.Audio.play(won ? 'round_win' : 'round_lose'); VAL.Audio.music('lobby'); }
    cleanupMatch();
  }
  function endMatch(toLobbyNow) { cleanupMatch(); VAL.HUD.hide(); if (toLobbyNow) toLobby(); }
  function cleanupMatch() {
    const m = app.match; if (!m) return;
    for (const b of m.bots) { if (b.char) { app.scene.remove(b.char.group); b.char.dispose && b.char.dispose(); } }
    for (const pk of m.pickups) app.scene.remove(pk.mesh); app.scene.remove(m.spike.mesh);
    app.player.alive = false; app.player.vm.visible = false; app.match = null; app.escOpen = false; $('menu-esc').classList.add('hidden'); if (VAL.BuyMenu.isOpen) VAL.BuyMenu.close();
  }
  // ----- main loop -----
  // Viewmodel pass: layer 1 is drawn after the world with a narrower FOV so the arms and
  // weapon read at the size shooters actually use, and never clip into geometry.
  const VM_LAYER = 1;
  let vmCam = null;
  function renderAll() {
    const r = app.renderer, cam = app.camera;
    cam.layers.disable(VM_LAYER);
    r.render(app.scene, cam);
    if (!vmCam) { vmCam = new THREE.PerspectiveCamera(50, cam.aspect, 0.01, 12); vmCam.layers.set(VM_LAYER); }
    const p = app.player;
    if (p && p.vm && p.vm.visible && app.state === 'match') {
      vmCam.aspect = cam.aspect;
      vmCam.fov = ((p.vmDef && p.vmDef.fov) || 50) / U.lerp(1, (p.weapon && p.weapon.def.ads && p.weapon.def.ads.zoom) || 1, p.ads * 0.35);
      vmCam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      vmCam.position.setFromMatrixPosition(cam.matrixWorld);
      vmCam.quaternion.setFromRotationMatrix(cam.matrixWorld);
      const bg = app.scene.background;
      app.scene.background = null;
      r.autoClear = false; r.clearDepth();
      r.render(app.scene, vmCam);
      r.autoClear = true;
      app.scene.background = bg;
    }
  }
  // everything under the viewmodel root draws in that second pass
  function toVMLayer(root) { root.traverse(o => o.layers.set(VM_LAYER)); }

  function loop(now, forced) {
    if (!forced) requestAnimationFrame(loop);
    let dt = (now - app.lastT) / 1000; app.lastT = now; if (dt > 0.1) dt = 0.1; if (dt <= 0) return; app.time += dt;
    if (VAL.Stats) VAL.Stats.frame(dt);
    if (app.queue) { app.queue.t += dt; U.text('q-time', U.fmtTime(app.queue.t)); if (app.queue.t >= app.queue.dur) matchFound(); }
    if (app.state === 'loading') { app.loadT += dt; const p = Math.min(1, app.loadT / 4.5); $('ld-fill').style.width = (p * 100) + '%'; if (p >= 1) startMatch(); }
    VAL.Input.setFallbackActive(app.state === 'match' && !app.escOpen && !VAL.BuyMenu.isOpen);
    if (app.state === 'match' && app.match) {
      app.match.update(dt);
      VAL.HUD.update(dt); VAL.BuyMenu.update(dt);
      if (app.match.shake > 0) { app.match.shake -= dt; app.camera.position.x += (Math.random() - 0.5) * 0.05 * app.match.shake; app.camera.position.y += (Math.random() - 0.5) * 0.05 * app.match.shake; }
    } else if (app.state === 'lobby' || app.state === 'play' || app.state === 'loading' || app.state === 'end' || app.state === 'gate') {
      cinematic(dt);
    }
    if (app.sky && app.sky.update) app.sky.update(dt, app.sun ? app.sun.position : null);
    VAL.Input.endFrame();
    if (app.shadowFollow) app.shadowFollow.update();
    if (!forced) renderAll();
  }
  function cinematic(dt) {
    cine.angle += dt * 0.03; const cx = 14, cz = -46;
    const r = 105, h = 62;
    app.camera.position.set(cx + Math.cos(cine.angle) * r, h + Math.sin(cine.angle * 0.7) * 6, cz + Math.sin(cine.angle) * r);
    app.camera.lookAt(cx, 6, cz); app.camera.rotation.z = 0;
    if (app.player && app.player.vm) app.player.vm.visible = false;
  }
  // debug: render one frame and POST the canvas to the dev server (tools/serve.py) as shots/<name>.png
  function shot(name, pose) {
    return new Promise((resolve) => {
      if (pose) { app.camera.position.set(pose.x, pose.y, pose.z); app.camera.rotation.order = 'YXZ'; app.camera.rotation.set(pose.pitch || 0, pose.yaw || 0, 0); if (pose.fov) { app.camera.fov = pose.fov; app.camera.updateProjectionMatrix(); } }
      if (app.player && app.player.vm) app.player.vm.visible = !!(app.state === 'match' && app.player.alive && !pose);
      renderAll();
      app.renderer.domElement.toBlob(blob => { fetch('/shot?name=' + encodeURIComponent(name || 'shot'), { method: 'POST', body: blob }).then(r => r.text()).then(t => resolve(t)).catch(e => resolve('fail ' + e)); }, 'image/png');
    });
  }
  // debug: DOM screenshot of the UI layer via html2canvas (cdnjs) -> shots/<name>.png
  function uishot(name, transparent) {
    return new Promise((resolve) => {
      // capture the real viewport (canvas + bg + scaled UI + fx layer) so aspect-ratio bugs show up
      const go = () => { html2canvas(document.body, { backgroundColor: transparent ? null : '#0f1923', scale: 1, logging: false, width: innerWidth, height: innerHeight, windowWidth: innerWidth, windowHeight: innerHeight, x: 0, y: 0, scrollX: 0, scrollY: 0 }).then(c => c.toBlob(blob => fetch('/shot?name=' + encodeURIComponent(name), { method: 'POST', body: blob }).then(r => r.text()).then(resolve), 'image/png')).catch(e => resolve('fail ' + e)); };
      if (window.html2canvas) go(); else { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload = go; s.onerror = () => resolve('no html2canvas'); document.head.appendChild(s); }
    });
  }
  // headless stepping for tests: advance the simulation n frames of dt seconds without rendering
  function step(dt, n) { dt = dt || 1 / 60; n = n || 1; for (let i = 0; i < n; i++) { app.lastT += 0; const now = app.lastT + dt * 1000; loop(now, true); } return app.match ? { phase: app.match.phase, round: app.match.roundNumber, score: app.match.score, time: app.match.time } : null; }
  return { init, app, toLobby, startMatch, step, shot, uishot, setScreen, toVMLayer, get match() { return app.match; } };
})();
window.addEventListener('DOMContentLoaded', () => { VAL.App.init().catch(e => { console.error(e); const m = document.getElementById('gate-msg'); if (m) m.textContent = 'Error: ' + e.message; }); });
