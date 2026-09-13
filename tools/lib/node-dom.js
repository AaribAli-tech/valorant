/*
 * tools/lib/node-dom.js - just enough DOM for the map builders to run in Node.
 *
 * The game only needs canvas 2D (every texture in VAL.Textures is painted
 * procedurally) plus a few element stubs, so we fake those instead of pulling
 * in jsdom: keeps the dev dependency list empty and the harness fast.
 */
'use strict';

function make2DContext(canvas) {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const imageData = (w, h) => ({
    width: Math.max(1, w | 0),
    height: Math.max(1, h | 0),
    data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4),
  });
  const ctx = {
    canvas,
    // state
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', shadowBlur: 0,
    shadowColor: 'transparent', lineCap: 'butt', lineJoin: 'miter',
    filter: 'none', imageSmoothingEnabled: true, miterLimit: 10,
    // measurement-ish state that some code reads back
    getImageData: (x, y, w, h) => imageData(w, h),
    createImageData: (w, h) => imageData(w, h),
    putImageData: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({ setTransform: noop }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop,
    fill: noop, stroke: noop, clip: noop,
    moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, ellipse: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, rect: noop, roundRect: noop,
    translate: noop, rotate: noop, scale: noop, transform: noop, setTransform: noop,
    resetTransform: noop, drawImage: noop, fillText: noop, strokeText: noop,
    setLineDash: noop, getLineDash: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  };
  return ctx;
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    style: {},
    dataset: {},
    children: [],
    width: 1,
    height: 1,
    innerHTML: '',
    textContent: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { return c; },
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    blur: () => {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720, left: 0, top: 0 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext(kind) { return kind === '2d' ? make2DContext(this) : null; },
    toDataURL: () => 'data:image/png;base64,',
    toBlob: (cb) => cb({ size: 0 }),
    cloneNode() { return makeElement(tag); },
  };
  return el;
}

/** Install window/document/navigator stubs and return the global scope. */
function install(target = globalThis) {
  const doc = {
    createElement: makeElement,
    createElementNS: (ns, tag) => makeElement(tag),
    documentElement: makeElement('html'),
    head: makeElement('head'),
    body: makeElement('body'),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
  };
  target.document = doc;
  target.window = target;
  target.self = target;
  // Node >= 21 exposes `navigator` as a getter-only global, so plain
  // assignment throws - go through defineProperty for everything host-y.
  const define = (key, value) => {
    if (key in target && Object.getOwnPropertyDescriptor(target, key)?.get) return;
    try { Object.defineProperty(target, key, { value, writable: true, configurable: true }); } catch (e) { /* keep node's */ }
  };
  define('navigator', { userAgent: 'node', language: 'en-US', maxTouchPoints: 0 });
  define('location', { href: 'http://localhost/', search: '', hostname: 'localhost' });
  define('devicePixelRatio', 1);
  define('innerWidth', 1280);
  define('innerHeight', 720);
  define('matchMedia', () => ({ matches: false, addListener() {}, addEventListener() {} }));
  define('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 0));
  define('cancelAnimationFrame', () => {});
  target.addEventListener = () => {};
  target.removeEventListener = () => {};
  target.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  return target;
}

module.exports = { install, makeElement };
