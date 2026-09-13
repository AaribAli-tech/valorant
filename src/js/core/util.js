// Small shared helpers
window.VAL = window.VAL || {};
VAL.U = {
  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  damp: (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)),
  rand: (a, b) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  shuffle: arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
  gauss: () => { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
  dist2: (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz),
  dist: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz),
  angleWrap: a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; },
  // yaw convention: yaw 0 faces -Z; forward = (-sin(yaw), 0, -cos(yaw))
  yawTo: (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz)),
  fwd: yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) }),
  fmtTime: s => { s = Math.max(0, Math.ceil(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); },
  fmtCreds: n => '¤' + n.toLocaleString('en-US'),
  ease: { outCubic: t => 1 - Math.pow(1 - t, 3), inOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, outBack: t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2) },
  // 2D segment intersection helpers
  segSeg: (ax, az, bx, bz, cx, cz, dx, dz) => {
    const r_x = bx - ax, r_z = bz - az, s_x = dx - cx, s_z = dz - cz;
    const den = r_x * s_z - r_z * s_x; if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * s_z - (cz - az) * s_x) / den, u = ((cx - ax) * r_z - (cz - az) * r_x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t; return null;
  },
  pointInPoly: (x, z, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside; } return inside; },
  el: id => document.getElementById(id),
  html: (id, s) => { const e = document.getElementById(id); if (e) e.innerHTML = s; },
  text: (id, s) => { const e = document.getElementById(id); if (e && e.textContent !== String(s)) e.textContent = s; },
  show: (id, v) => { const e = document.getElementById(id); if (e) e.classList.toggle('hidden', !v); },
  now: () => performance.now() / 1000
};
