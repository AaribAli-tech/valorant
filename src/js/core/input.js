// Input: keyboard + mouse with pointer lock. Valorant default binds.
window.VAL = window.VAL || {};
VAL.Input = (function () {
  const keys = {};
  const pressed = {};      // edge-triggered (cleared each frame)
  const released = {};
  const mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0, locked: false, x: 0, y: 0 };
  const listeners = { key: [], mouse: [], lockchange: [] };
  let sensitivity = 0.4;   // Valorant sens 0.4 @ 800 dpi ~ typical
  let enabled = true;
  let canvas = null;

  const BIND = {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    walk: 'ShiftLeft', crouch: 'ControlLeft', jump: 'Space',
    reload: 'KeyR', use: 'KeyF', spike: 'Digit4', drop: 'KeyG',
    primary: 'Digit1', secondary: 'Digit2', melee: 'Digit3',
    buy: 'KeyB', scoreboard: 'Tab', ability1: 'KeyC', ability2: 'KeyQ', ability3: 'KeyE', ult: 'KeyX',
    inspect: 'KeyY', map: 'KeyM', menu: 'Escape'
  };

  function onKeyDown(e) {
    if (!enabled) return;
    if (e.code === 'Tab' || e.code === 'Space' || (e.code.startsWith('Digit') && mouse.locked) || e.code === 'KeyM' || e.code === 'KeyF') {
      // keep browser from stealing focus/scroll while in game
      if (mouse.locked || e.code === 'Tab') e.preventDefault();
    }
    if (!keys[e.code]) pressed[e.code] = true;
    keys[e.code] = true;
    listeners.key.forEach(fn => fn(e.code, true, e));
  }
  function onKeyUp(e) {
    keys[e.code] = false; released[e.code] = true;
    listeners.key.forEach(fn => fn(e.code, false, e));
  }
  function onMouseMove(e) {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!mouse.locked && !(mouse.fallback && fallbackActive)) return;
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  }
  let fallbackActive = false;
  function setFallbackActive(v) { fallbackActive = v; }
  function onMouseDown(e) {
    mouse.buttons |= (1 << e.button);
    if (!mouse.locked && !(mouse.fallback && fallbackActive)) return;
    e.preventDefault();
    listeners.mouse.forEach(fn => fn(e.button, true));
  }
  function onMouseUp(e) {
    mouse.buttons &= ~(1 << e.button);
    listeners.mouse.forEach(fn => fn(e.button, false));
  }
  function onWheel(e) { if (mouse.locked) { mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); } }

  function init(cv) {
    canvas = cv;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', e => { if (mouse.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      mouse.locked = (document.pointerLockElement === canvas);
      listeners.lockchange.forEach(fn => fn(mouse.locked));
    });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.buttons = 0; });
  }
  let lockFailed = false, lastLockTry = 0;
  function lock() {
    if (!canvas || document.pointerLockElement === canvas) return;
    const now = performance.now(); if (now - lastLockTry < 400) return; lastLockTry = now;
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => { lockFailed = true; mouse.fallback = true; }); } catch (e) { lockFailed = true; mouse.fallback = true; } });
    } catch (e) { lockFailed = true; mouse.fallback = true; }
  }
  function unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  function down(action) { return !!keys[BIND[action] || action]; }
  function justPressed(action) { return !!pressed[BIND[action] || action]; }
  function justReleased(action) { return !!released[BIND[action] || action]; }
  function consumeMouse() { const d = { dx: mouse.dx * sensitivity * 0.0022, dy: mouse.dy * sensitivity * 0.0022, wheel: mouse.wheel }; mouse.dx = 0; mouse.dy = 0; mouse.wheel = 0; return d; }
  function endFrame() { for (const k in pressed) pressed[k] = false; for (const k in released) released[k] = false; }
  function mouseDown(btn) { return !!(mouse.buttons & (1 << btn)); }
  function on(type, fn) { listeners[type].push(fn); }
  function setEnabled(v) { enabled = v; }
  function setSensitivity(v) { sensitivity = v; }
  function isLocked() { return mouse.locked || (mouse.fallback && fallbackActive); }
  return { init, lock, unlock, down, justPressed, justReleased, consumeMouse, endFrame, mouseDown, on, keys, mouse, BIND, setEnabled, setSensitivity, setFallbackActive, isLocked, get sensitivity() { return sensitivity; }, get lockFailed() { return lockFailed; } };
})();
