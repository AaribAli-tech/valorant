/*
 * js/core/textures.js — VAL.Textures
 * Procedural <canvas> materials for the Ascent (Venice) replica. No external assets.
 * Art direction: clean, slightly painterly, saturated-but-soft flat colours with subtle
 * variation and a little grime near the bottom of walls (Valorant), NOT photoreal grunge.
 *
 * API (synchronous, everything cached, lazy generation on first request):
 *   VAL.Textures.material(name, opts) -> THREE.MeshStandardMaterial
 *        opts: { repeat:[u,v] | number, color, roughness, metalness, side, opacity, transparent }
 *   VAL.Textures.map(name, opts)      -> THREE.CanvasTexture  (colour map, RepeatWrapping, sRGB)
 *   VAL.Textures.normal(name, opts)   -> THREE.CanvasTexture | null (tangent-space normal map, linear)
 *   VAL.Textures.NAMES                -> array of supported names
 *   VAL.Textures.TILE_METERS          -> 2
 *   VAL.Textures.repeatFor(w, h)      -> [w / TILE_METERS, h / TILE_METERS]
 *   VAL.Textures.info(name)           -> { size, roughness, metalness, normal, transparent, faceTexture }
 *   VAL.Textures.preload()            -> ms spent generating every material (call from a loading screen)
 *   VAL.Textures.stats                -> { generated, ms }
 *
 * TEXTURE SCALE CONVENTION
 *   One texture tile (one full repeat of the map, u or v going 0 -> 1) covers
 *   TILE_METERS x TILE_METERS = 2 m x 2 m of surface. A wall W m wide and H m tall therefore
 *   uses repeat = [W / 2, H / 2]; an 8 x 6 m floor uses [4, 3] (see repeatFor()). All pattern
 *   sizes inside the textures (1 m stone blocks, 0.25 x 0.07 m bricks, 0.15 m cobbles, 1 m
 *   pavers, 0.2 m roof tiles, 0.2 m planks, 0.33 m awning stripes ...) are authored against
 *   this 2 m tile so they come out life-sized.
 *   Exceptions: `wood_crate` and `spike_tech` are "face" textures (one tile = one face of the
 *   object) — use repeat [1, 1] per face whatever its size.
 *   Textures keep Three's default flipY = true, so canvas row 0 is the TOP of the tile (v = 1)
 *   and the "bottom of wall" grime sits at v = 0. Put v = 0 at the floor.
 */
window.VAL = window.VAL || {};
(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    console.error('[VAL.Textures] THREE is not loaded; textures unavailable.');
    return;
  }

  var TILE_METERS = 2;
  var NORMAL_SCALE = 0.35;
  var ANISOTROPY = 4;
  var TAU = Math.PI * 2;

  // ------------------------------------------------------------------ utils
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  // mulberry32 — deterministic per texture name so the look never changes between reloads
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(size) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    return cv;
  }
  function ctx2d(cv) { return cv.getContext('2d', { willReadFrequently: true }); }

  // colours as [r,g,b] 0..255
  function hex(h) {
    if (typeof h !== 'string') return h;
    var s = h.charAt(0) === '#' ? h.slice(1) : h;
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function css(c, a) {
    var r = Math.round(c[0]), g = Math.round(c[1]), b = Math.round(c[2]);
    return a == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function shade(c, f) { return [cl(c[0] * f), cl(c[1] * f), cl(c[2] * f)]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function warm(c, amt) { return [cl(c[0] + amt), c[1], cl(c[2] - amt)]; }
  // random lightness (+-amt) and warm/cool (+-hue) variation
  function vary(c, R, amt, hue) {
    var f = 1 + (R() * 2 - 1) * amt, w = (R() * 2 - 1) * (hue || 0) * 255;
    return [cl(c[0] * f + w), cl(c[1] * f), cl(c[2] * f - w)];
  }
  function grey(v) { var g = Math.round(cl(v * 255)); return 'rgb(' + g + ',' + g + ',' + g + ')'; }

  // ------------------------------------------------------------ draw helpers
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  // Calls fn(x, y) for every copy of an element (radius r around x,y) needed so the pattern
  // wraps seamlessly at the tile edges. NOTE: never call the rng inside fn.
  function wrap9(S, x, y, r, fn) {
    var xs = [0], ys = [0];
    if (x - r < 0) xs.push(S);
    if (x + r > S) xs.push(-S);
    if (y - r < 0) ys.push(S);
    if (y + r > S) ys.push(-S);
    for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) fn(x + xs[i], y + ys[j]);
  }
  // one soft radial blob (wrapped)
  function soft(c, S, x, y, r, col, alpha) {
    wrap9(S, x, y, r, function (cx, cy) {
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, css(col, alpha)); g.addColorStop(1, css(col, 0));
      c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
  }
  // Low-frequency content is painted on a small scratch canvas and blitted up with bilinear
  // filtering: far cheaper than shading big radial gradients at full resolution.
  var scratch = {};
  function lowRes(c, S, res, drawFn) {
    var sc = scratch[res] || (scratch[res] = makeCanvas(res));
    var sctx = ctx2d(sc);
    sctx.clearRect(0, 0, res, res);
    drawFn(sctx, res);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(sc, 0, 0, res, res, 0, 0, S, S);
  }
  // low-frequency tonal variation: n soft blobs in the given colours
  function blotches(c, S, R, n, rMin, rMax, cols, alpha) {
    var res = Math.min(S, 128), k = res / S;
    lowRes(c, S, res, function (sc, sz) {
      for (var i = 0; i < n; i++) {
        var x = R() * sz, y = R() * sz, r = (rMin + R() * (rMax - rMin)) * k, col = cols[Math.floor(R() * cols.length)];
        soft(sc, sz, x, y, r, col, alpha);
      }
    });
  }
  function speckles(c, S, R, n, size, cols, alpha, yFrom) {
    yFrom = yFrom || 0;
    for (var k = 0; k < n; k++) {
      var s = 0.5 + R() * size, col = cols[Math.floor(R() * cols.length)], a = alpha * (0.5 + R() * 0.5);
      var x = R() * S, y = yFrom * S + R() * S * (1 - yFrom);
      c.fillStyle = css(col, a); c.fillRect(x, y, s, s);
    }
  }
  // dark gradient at the bottom of the tile (bottom of wall = v 0)
  function bottomGrime(c, S, col, alpha, from) {
    var g = c.createLinearGradient(0, S * from, 0, S);
    g.addColorStop(0, css(col, 0)); g.addColorStop(1, css(col, alpha));
    c.fillStyle = g; c.fillRect(0, S * from, S, S * (1 - from) + 1);
  }
  // very light per-pixel dither so flat tones do not band under lighting
  function grain(c, S, amt, R) {
    var img = c.getImageData(0, 0, S, S), d = img.data, s = (R() * 4294967296) | 0, a2 = amt * 2 / 255;
    for (var i = 0, n = d.length; i < n; i += 4) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      var v = ((s >>> 8) & 255) * a2 - amt;
      d[i] += v; d[i + 1] += v; d[i + 2] += v;
    }
    c.putImageData(img, 0, 0);
  }
  function weave(c, S, alpha, step) {
    c.fillStyle = 'rgba(0,0,0,' + alpha + ')';
    for (var y = 0; y < S; y += step) c.fillRect(0, y, S, 1);
    c.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    for (var x = 0; x < S; x += step) c.fillRect(x, 0, 1, S);
  }
  function hFill(h, v) { if (h) { h.fillStyle = grey(v); h.fillRect(0, 0, h.canvas.width, h.canvas.height); } }
  function hBlotches(h, S, R, n, rMin, rMax, alpha) {
    if (!h) return;
    var res = Math.min(S, 128), k = res / S;
    lowRes(h, S, res, function (sc, sz) {
      for (var i = 0; i < n; i++) {
        var x = R() * sz, y = R() * sz, r = (rMin + R() * (rMax - rMin)) * k, up = R() < 0.5;
        soft(sc, sz, x, y, r, up ? [255, 255, 255] : [0, 0, 0], alpha);
      }
    });
  }
  function wavyV(c, x, amp, per, ph, S) {
    c.beginPath();
    for (var y = 0; y <= S; y += 8) {
      var xx = x + amp * Math.sin(ph + per * TAU * y / S);
      if (y === 0) c.moveTo(xx, y); else c.lineTo(xx, y);
    }
    c.stroke();
  }

  // Sobel over the greyscale height canvas -> tangent-space normal map (OpenGL convention,
  // +Y = +V; canvas row 0 is v = 1 because flipY is true).
  function normalFromHeight(hcv, strength) {
    var S = hcv.width, src = ctx2d(hcv).getImageData(0, 0, S, S).data;
    var H = new Uint8Array(S * S);
    for (var i = 0, n = S * S; i < n; i++) H[i] = src[i << 2];
    var out = makeCanvas(S), oc = ctx2d(out), img = oc.createImageData(S, S), d = img.data;
    var k = strength / 255;
    for (var y = 0; y < S; y++) {
      var yu = (y === 0 ? S - 1 : y - 1) * S, yc = y * S, yd = (y === S - 1 ? 0 : y + 1) * S;
      var o = yc * 4;
      for (var x = 0; x < S; x++, o += 4) {
        var xl = x === 0 ? S - 1 : x - 1, xr = x === S - 1 ? 0 : x + 1;
        var tl = H[yu + xl], tr = H[yu + xr], bl = H[yd + xl], br = H[yd + xr];
        var dx = (tr + 2 * H[yc + xr] + br) - (tl + 2 * H[yc + xl] + bl);
        var dy = (bl + 2 * H[yd + x] + br) - (tl + 2 * H[yu + x] + tr);
        var nx = -dx * k, ny = dy * k;
        var inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        d[o] = (nx * inv * 0.5 + 0.5) * 255;
        d[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
        d[o + 2] = (inv * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }
    oc.putImageData(img, 0, 0);
    return out;
  }

  // -------------------------------------------------------------- generators
  // Every generator receives g = { c: colour ctx, h: height ctx|null, e: emissive ctx|null,
  // S: size, R: rng }. Height canvas starts at mid grey, emissive at black.

  function plasterDraw(base, grimeA) {
    return function (g) {
      var c = g.c, S = g.S, R = g.R, B = hex(base);
      c.fillStyle = css(B); c.fillRect(0, 0, S, S);
      blotches(c, S, R, 16, S * 0.15, S * 0.45,
        [shade(B, 1.05), shade(B, 0.95), warm(B, 7), mix(B, [205, 200, 215], 0.14)], 0.22);
      // a couple of larger, very soft lighter patches (sun-bleached plaster)
      blotches(c, S, R, 3, S * 0.3, S * 0.6, [shade(B, 1.04), mix(B, [255, 250, 240], 0.2)], 0.18);
      bottomGrime(c, S, [70, 56, 42], grimeA, 0.66);
      speckles(c, S, R, 40, 1.2, [[85, 70, 55]], 0.12, 0.72);
      grain(c, S, 2.5, R);
    };
  }

  // blocks / bricks / pavers on a mortar background (running bond optional)
  function masonry(p) {
    return function (g) {
      var c = g.c, h = g.h, S = g.S, R = g.R;
      var B = hex(p.base), cols = p.cols, rows = p.rows, cw = S / cols, rh = S / rows;
      var m = p.mortar, rad = p.radius || 2, bevelA = p.bevelA == null ? 0.1 : p.bevelA;
      c.fillStyle = css(hex(p.mortarColor)); c.fillRect(0, 0, S, S);
      hFill(h, 0.2);
      function block(x, y, w, hh, col, hv, blots) {
        var k, b, gg;
        c.fillStyle = css(col);
        if (rad <= 2) c.fillRect(x, y, w, hh); else { roundRect(c, x, y, w, hh, rad); c.fill(); }
        for (k = 0; k < blots.length; k++) {
          b = blots[k];
          gg = c.createRadialGradient(x + b.u * w, y + b.v * hh, 0, x + b.u * w, y + b.v * hh, b.r);
          gg.addColorStop(0, css(b.col, b.a)); gg.addColorStop(1, css(b.col, 0));
          c.fillStyle = gg; c.fillRect(x, y, w, hh);
        }
        if (h) {
          h.fillStyle = grey(hv);
          if (rad <= 2) h.fillRect(x, y, w, hh); else { roundRect(h, x, y, w, hh, rad); h.fill(); }
          if (p.bevel) {
            h.lineWidth = p.bevel; h.strokeStyle = 'rgba(0,0,0,0.3)';
            h.strokeRect(x + p.bevel / 2, y + p.bevel / 2, w - p.bevel, hh - p.bevel);
          }
          for (k = 0; k < blots.length; k++) {
            b = blots[k];
            var up = b.up ? '255,255,255' : '0,0,0';
            gg = h.createRadialGradient(x + b.u * w, y + b.v * hh, 0, x + b.u * w, y + b.v * hh, b.r);
            gg.addColorStop(0, 'rgba(' + up + ',' + (p.hBlotchA || 0.14) + ')'); gg.addColorStop(1, 'rgba(' + up + ',0)');
            h.fillStyle = gg; h.fillRect(x, y, w, hh);
          }
        }
      }
      for (var r = 0; r < rows; r++) {
        var off = (r % 2) ? cw * (p.bond || 0) : 0;
        for (var i = 0; i < cols; i++) {
          var x0 = i * cw + off, y0 = r * rh;
          var col = vary(B, R, p.vary, p.hue);
          if (p.alt && R() < p.altP) col = vary(hex(p.alt[Math.floor(R() * p.alt.length)]), R, p.vary * 0.5, 0);
          var hv = (p.hBase || 0.8) + (R() * 2 - 1) * (p.hVar || 0.05);
          var blots = [];
          for (var k = 0; k < (p.blotch || 0); k++) {
            blots.push({ u: R(), v: R(), r: Math.max(cw, rh) * (0.2 + R() * 0.35),
              col: R() < 0.5 ? shade(col, 1.09) : shade(col, 0.91), a: 0.3, up: R() < 0.5 });
          }
          var bx = x0 + m / 2, by = y0 + m / 2, bw = cw - m, bh = rh - m;
          block(bx, by, bw, bh, col, hv, blots);
          if (bx + bw > S) block(bx - S, by, bw, bh, col, hv, blots); // wrapped copy
        }
      }
      // one light-top / dark-bottom gradient per course gives every block a soft bevel
      if (bevelA > 0) {
        for (r = 0; r < rows; r++) {
          var gy = r * rh + m / 2, gr = c.createLinearGradient(0, gy, 0, gy + rh - m);
          gr.addColorStop(0, 'rgba(255,255,255,' + bevelA + ')'); gr.addColorStop(0.35, 'rgba(255,255,255,0)');
          gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + bevelA + ')');
          c.fillStyle = gr; c.fillRect(0, gy, S, rh - m);
        }
      }
      if (p.speckle) speckles(c, S, R, p.speckle, 1.5, [shade(B, 0.78), shade(B, 1.15)], 0.3);
      if (p.grime) bottomGrime(c, S, [60, 50, 40], p.grime, 0.7);
      if (p.grain) grain(c, S, p.grain, R);
    };
  }

  function cobbleDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R;
    var N = 13, cell = S / N, B = hex('#a79f92'), G = hex('#6e675b');
    c.fillStyle = css(G); c.fillRect(0, 0, S, S);
    hFill(h, 0.15);
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var cx = (i + 0.5) * cell + (R() * 2 - 1) * cell * 0.07;
        var cy = (j + 0.5) * cell + (R() * 2 - 1) * cell * 0.07;
        var w = cell * (0.74 + R() * 0.14), hh = cell * (0.74 + R() * 0.14);
        var col = vary(B, R, 0.09, 0.02), t = R();
        if (t < 0.14) col = mix(col, [118, 108, 98], 0.35);
        else if (t < 0.24) col = mix(col, [222, 208, 184], 0.35);
        else if (t < 0.32) col = mix(col, [150, 130, 110], 0.3);
        var rad = Math.min(w, hh) * 0.42, rr = Math.max(w, hh) * 0.6;
        (function (cx, cy, w, hh, col, rad, rr) {
          var lo = shade(col, 0.78), hi = shade(col, 1.12);
          wrap9(S, cx, cy, rr, function (x, y) {
            var gr = c.createRadialGradient(x - w * 0.12, y - hh * 0.16, 0, x, y, rr);
            gr.addColorStop(0, css(hi)); gr.addColorStop(0.45, css(col)); gr.addColorStop(1, css(lo));
            c.fillStyle = gr; roundRect(c, x - w / 2, y - hh / 2, w, hh, rad); c.fill();
            if (h) {
              var hg = h.createRadialGradient(x, y, 0, x, y, rr * 0.92);
              hg.addColorStop(0, grey(0.95)); hg.addColorStop(0.65, grey(0.78)); hg.addColorStop(1, grey(0.3));
              h.fillStyle = hg; roundRect(h, x - w / 2, y - hh / 2, w, hh, rad); h.fill();
            }
          });
        })(cx, cy, w, hh, col, rad, rr);
      }
    }
  }

  function roofDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R, B = hex('#b5563d');
    var cols = 10, rows = 6, cw = S / cols, rh = S / rows, i, r;
    for (r = 0; r < rows; r++) {
      for (i = 0; i < cols; i++) {
        var col = vary(B, R, 0.09, 0.03), t = R();
        if (t < 0.12) col = mix(col, [110, 62, 48], 0.4);
        else if (t < 0.22) col = mix(col, [225, 140, 95], 0.3);
        else if (t < 0.3) col = mix(col, [150, 95, 70], 0.3);
        c.fillStyle = css(col); c.fillRect(i * cw, r * rh, cw + 1, rh + 1);
      }
    }
    // barrel shading across each column (half-cylinder)
    for (i = 0; i < cols; i++) {
      var x = i * cw, gr = c.createLinearGradient(x, 0, x + cw, 0);
      gr.addColorStop(0, 'rgba(30,10,5,0.5)'); gr.addColorStop(0.16, 'rgba(30,10,5,0.12)');
      gr.addColorStop(0.42, 'rgba(255,225,200,0.16)'); gr.addColorStop(0.6, 'rgba(255,225,200,0.04)');
      gr.addColorStop(0.85, 'rgba(30,10,5,0.22)'); gr.addColorStop(1, 'rgba(30,10,5,0.5)');
      c.fillStyle = gr; c.fillRect(x, 0, cw, S);
      if (h) {
        var hg = h.createLinearGradient(x, 0, x + cw, 0);
        hg.addColorStop(0, grey(0.25)); hg.addColorStop(0.1, grey(0.55)); hg.addColorStop(0.25, grey(0.8));
        hg.addColorStop(0.5, grey(0.95)); hg.addColorStop(0.75, grey(0.8)); hg.addColorStop(0.9, grey(0.55)); hg.addColorStop(1, grey(0.25));
        h.fillStyle = hg; h.fillRect(x, 0, cw, S);
      }
    }
    // row overlaps: shadow under the lip of the tile above + a light lip line
    for (r = 0; r < rows; r++) {
      var y = r * rh, sh = rh * 0.18;
      var g2 = c.createLinearGradient(0, y, 0, y + sh);
      g2.addColorStop(0, 'rgba(40,12,8,0.5)'); g2.addColorStop(1, 'rgba(40,12,8,0)');
      c.fillStyle = g2; c.fillRect(0, y, S, sh);
      var ly = (y - 2 + S) % S;
      c.fillStyle = 'rgba(255,220,190,0.28)'; c.fillRect(0, ly, S, 2);
      if (h) {
        var hg2 = h.createLinearGradient(0, y, 0, y + rh);
        hg2.addColorStop(0, 'rgba(0,0,0,0.35)'); hg2.addColorStop(0.5, 'rgba(0,0,0,0.12)'); hg2.addColorStop(1, 'rgba(0,0,0,0)');
        h.fillStyle = hg2; h.fillRect(0, y, S, rh);
      }
    }
  }

  function woodDraw(p) {
    return function (g) {
      var c = g.c, h = g.h, S = g.S, R = g.R, B = hex(p.base);
      var n = p.planks, pw = S / n, gap = p.gap || 2;
      c.fillStyle = css(shade(B, 0.55)); c.fillRect(0, 0, S, S);
      hFill(h, 0.4);
      for (var i = 0; i < n; i++) {
        var col = vary(B, R, 0.08, 0.03), x0 = i * pw + gap / 2, w = pw - gap;
        c.fillStyle = css(col); c.fillRect(x0, 0, w, S);
        if (h) { h.fillStyle = grey(0.82 + (R() * 2 - 1) * 0.05); h.fillRect(x0, 0, w, S); }
        var lines = Math.floor(w / 6) + 2;
        for (var k = 0; k < lines; k++) {
          var amp = 0.4 + R() * 1.8, gx = x0 + amp + 1 + R() * (w - 2 * amp - 2);
          var per = 1 + Math.floor(R() * 3), ph = R() * TAU, a = 0.06 + R() * 0.16, dark = R() < 0.72;
          var lw = 0.6 + R() * 1.3;
          c.strokeStyle = css(dark ? shade(col, 0.7) : shade(col, 1.2), a); c.lineWidth = lw;
          wavyV(c, gx, amp, per, ph, S);
          if (h) {
            h.strokeStyle = dark ? 'rgba(0,0,0,' + (a * 0.6) + ')' : 'rgba(255,255,255,' + (a * 0.4) + ')';
            h.lineWidth = lw; wavyV(h, gx, amp, per, ph, S);
          }
        }
        var joints = 1 + (R() < 0.5 ? 1 : 0);
        for (var j = 0; j < joints; j++) {
          var jy = R() * S;
          c.fillStyle = 'rgba(35,20,10,0.75)'; c.fillRect(x0, jy - 1, w, 2);
          c.fillStyle = 'rgba(255,235,210,0.2)'; c.fillRect(x0, jy + 1, w, 1.5);
          if (h) { h.fillStyle = grey(0.45); h.fillRect(x0, jy - 1, w, 2.5); }
        }
        c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(x0, 0, 1.5, S);
        c.fillStyle = 'rgba(0,0,0,0.14)'; c.fillRect(x0 + w - 1.5, 0, 1.5, S);
      }
      for (var q = 0; q < p.knots; q++) {
        var kx = R() * S, ky = R() * S, rx = 2.5 + R() * 4, ry = rx * (1.5 + R() * 0.8), rot = (R() - 0.5) * 0.4;
        (function (kx, ky, rx, ry, rot) {
          wrap9(S, kx, ky, ry * 2.2, function (cx, cy) {
            c.fillStyle = css(shade(B, 0.5), 0.85); c.beginPath(); c.ellipse(cx, cy, rx, ry, rot, 0, TAU); c.fill();
            c.strokeStyle = css(shade(B, 0.65), 0.45); c.lineWidth = 1;
            c.beginPath(); c.ellipse(cx, cy, rx * 1.6, ry * 1.5, rot, 0, TAU); c.stroke();
            c.beginPath(); c.ellipse(cx, cy, rx * 2.2, ry * 2.0, rot, 0, TAU); c.stroke();
            if (h) { h.fillStyle = grey(0.6); h.beginPath(); h.ellipse(cx, cy, rx, ry, rot, 0, TAU); h.fill(); }
          });
        })(kx, ky, rx, ry, rot);
      }
    };
  }

  // a single board with grain, bevelled edges and optional drop shadow (used by the crate)
  function board(g, x, y, w, hh, col, dir, hv, shadow) {
    var c = g.c, h = g.h, R = g.R;
    if (shadow) { c.fillStyle = 'rgba(0,0,0,0.30)'; c.fillRect(x + 2, y + 3, w, hh); }
    c.fillStyle = css(col); c.fillRect(x, y, w, hh);
    c.save(); c.beginPath(); c.rect(x, y, w, hh); c.clip();
    var n = Math.floor((dir === 'h' ? hh : w) / 7) + 2;
    for (var k = 0; k < n; k++) {
      var amp = 0.4 + R() * 1.4, a = 0.07 + R() * 0.15, dark = R() < 0.7;
      c.strokeStyle = css(dark ? shade(col, 0.7) : shade(col, 1.2), a); c.lineWidth = 0.6 + R() * 1.2;
      var ph = R() * TAU, per = 1 + Math.floor(R() * 3), s;
      c.beginPath();
      if (dir === 'h') {
        var gy = y + 1 + R() * (hh - 2);
        for (s = 0; s <= w; s += 8) { var yy = gy + amp * Math.sin(ph + per * TAU * s / w); if (s === 0) c.moveTo(x + s, yy); else c.lineTo(x + s, yy); }
      } else {
        var gx = x + 1 + R() * (w - 2);
        for (s = 0; s <= hh; s += 8) { var xx = gx + amp * Math.sin(ph + per * TAU * s / hh); if (s === 0) c.moveTo(xx, y + s); else c.lineTo(xx, y + s); }
      }
      c.stroke();
    }
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x, y, w, 1.5); c.fillRect(x, y, 1.5, hh);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x, y + hh - 1.5, w, 1.5); c.fillRect(x + w - 1.5, y, 1.5, hh);
    c.restore();
    if (h) {
      h.fillStyle = grey(hv); h.fillRect(x, y, w, hh);
      h.lineWidth = 2; h.strokeStyle = 'rgba(0,0,0,0.3)'; h.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    }
  }

  function crateDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R, B = hex('#a8804f');
    c.fillStyle = css(shade(B, 0.45)); c.fillRect(0, 0, S, S);
    hFill(h, 0.3);
    var nb = 5, bh = S / nb, b;
    for (b = 0; b < nb; b++) board(g, 0, b * bh + 1, S, bh - 2, vary(B, R, 0.07, 0.02), 'h', 0.55, false);
    var fw = S * 0.13;
    board(g, 0, 0, S, fw, vary(shade(B, 0.95), R, 0.04, 0.01), 'h', 0.75, true);
    board(g, 0, S - fw, S, fw, vary(shade(B, 0.95), R, 0.04, 0.01), 'h', 0.75, true);
    board(g, 0, fw, fw, S - 2 * fw, vary(shade(B, 0.92), R, 0.04, 0.01), 'v', 0.75, true);
    board(g, S - fw, fw, fw, S - 2 * fw, vary(shade(B, 0.92), R, 0.04, 0.01), 'v', 0.75, true);
    // diagonal brace
    var inner = S - 2 * fw, len = Math.sqrt(2) * inner, bw = fw * 0.85;
    var ctxs = h ? [c, h] : [c], t;
    for (t = 0; t < ctxs.length; t++) { ctxs[t].save(); ctxs[t].translate(S / 2, S / 2); ctxs[t].rotate(-Math.PI / 4); }
    board(g, -len / 2 + fw * 0.3, -bw / 2, len - fw * 0.6, bw, vary(shade(B, 1.02), R, 0.04, 0.01), 'h', 0.9, true);
    for (t = 0; t < ctxs.length; t++) ctxs[t].restore();
    // metal corner plates with rivets
    var ps = S * 0.16, pt = S * 0.05, M = hex('#3a3e44');
    var corners = [[0, 0, 1, 1], [S, 0, -1, 1], [0, S, 1, -1], [S, S, -1, -1]];
    for (var k = 0; k < 4; k++) {
      var cx = corners[k][0], cy = corners[k][1], sx = corners[k][2], sy = corners[k][3];
      var x = sx > 0 ? cx : cx - ps, y = sy > 0 ? cy : cy - ps;
      var hx = x, hy = sy > 0 ? y : y + ps - pt;          // horizontal arm
      var vx = sx > 0 ? x : x + ps - pt, vy = y;          // vertical arm
      c.fillStyle = css(M); c.fillRect(hx, hy, ps, pt); c.fillRect(vx, vy, pt, ps);
      c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(hx, hy, ps, 1.5); c.fillRect(vx, vy, 1.5, ps);
      if (h) { h.fillStyle = grey(0.95); h.fillRect(hx, hy, ps, pt); h.fillRect(vx, vy, pt, ps); }
      var rv = [[0.5, 0.5], [2.2, 0.5], [0.5, 2.2]];
      for (var q = 0; q < rv.length; q++) {
        var rx = sx > 0 ? x + rv[q][0] * pt : x + ps - rv[q][0] * pt;
        var ry = sy > 0 ? y + rv[q][1] * pt : y + ps - rv[q][1] * pt;
        c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(rx + 0.8, ry + 0.8, pt * 0.2, 0, TAU); c.fill();
        c.fillStyle = '#8b9096'; c.beginPath(); c.arc(rx, ry, pt * 0.2, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(rx - pt * 0.06, ry - pt * 0.06, pt * 0.08, 0, TAU); c.fill();
        if (h) { h.fillStyle = grey(1); h.beginPath(); h.arc(rx, ry, pt * 0.2, 0, TAU); h.fill(); }
      }
    }
  }

  function metalDarkDraw(g) {
    var c = g.c, S = g.S, R = g.R, B = hex('#2b2e33');
    c.fillStyle = css(B); c.fillRect(0, 0, S, S);
    for (var y = 0; y < S; y++) {
      var a = R() * 0.10;
      c.fillStyle = R() < 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
      c.fillRect(0, y, S, 1);
    }
    blotches(c, S, R, 6, S * 0.2, S * 0.5, [shade(B, 1.3), shade(B, 0.8)], 0.2);
    for (var k = 0; k < 20; k++) {
      var yy = R() * S, x = R() * S, len = S * (0.2 + R() * 0.6);
      c.fillStyle = 'rgba(255,255,255,' + (0.04 + R() * 0.05) + ')';
      c.fillRect(x, yy, len, 1); if (x + len > S) c.fillRect(x - S, yy, len, 1);
    }
  }

  function paintedDraw(base) {
    return function (g) {
      var c = g.c, S = g.S, R = g.R, B = hex(base);
      c.fillStyle = css(B); c.fillRect(0, 0, S, S);
      blotches(c, S, R, 12, S * 0.15, S * 0.5, [shade(B, 1.08), shade(B, 0.92), mix(B, [255, 255, 255], 0.08)], 0.22);
      // scratches revealing bare metal
      for (var k = 0; k < 14; k++) {
        var x = R() * S, y = R() * S, len = 8 + R() * 40, ang = R() * Math.PI;
        var dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
        wrap9(S, x, y, len / 2, function (sx, sy) {
          c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(sx - dx, sy - dy + 1); c.lineTo(sx + dx, sy + dy + 1); c.stroke();
          c.strokeStyle = 'rgba(208,211,214,0.6)'; c.lineWidth = 0.8;
          c.beginPath(); c.moveTo(sx - dx, sy - dy); c.lineTo(sx + dx, sy + dy); c.stroke();
        });
      }
      for (var q = 0; q < 10; q++) {
        c.fillStyle = 'rgba(190,193,196,0.7)'; c.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2);
      }
      bottomGrime(c, S, [40, 35, 30], 0.12, 0.7);
      grain(c, S, 2, R);
    };
  }

  function rustDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R;
    c.fillStyle = css(hex('#5b4638')); c.fillRect(0, 0, S, S);
    hFill(h, 0.6);
    blotches(c, S, R, 10, S * 0.1, S * 0.3, [hex('#6f4a2f'), hex('#4a3a33'), hex('#7d5233')], 0.5);
    blotches(c, S, R, 8, S * 0.08, S * 0.25, [hex('#3b3a3d'), hex('#4a4a4f')], 0.35);
    blotches(c, S, R, 14, S * 0.05, S * 0.2, [hex('#a3592b'), hex('#b5652f'), hex('#8a4b2a')], 0.55);
    speckles(c, S, R, 400, 3, [hex('#b86a30'), hex('#3a2a20'), hex('#c87d3c')], 0.5);
    for (var k = 0; k < 10; k++) {
      var x = R() * S, y = R() * S, len = 10 + R() * 50;
      var gr = c.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(120,60,25,0.4)'); gr.addColorStop(1, 'rgba(120,60,25,0)');
      c.fillStyle = gr; c.fillRect(x, y, 2, len);
      if (y + len > S) { c.fillStyle = gr; c.fillRect(x, y - S, 2, len); }
    }
    hBlotches(h, S, R, 14, S * 0.05, S * 0.25, 0.22);
    if (h) {
      for (var q = 0; q < 300; q++) {
        var s = 1 + R() * 2;
        h.fillStyle = R() < 0.5 ? grey(0.9) : grey(0.3); h.fillRect(R() * S, R() * S, s, s);
      }
    }
  }

  // packed sand: warm base, wind ripples, grit, darker damp patches
  function sandDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R, B = hex('#c9ad84');
    c.fillStyle = css(B); c.fillRect(0, 0, S, S);
    hFill(h, 0.6);
    blotches(c, S, R, 16, S * 0.1, S * 0.45, [shade(B, 1.06), shade(B, 0.93), mix(B, [120, 95, 70], 0.16), mix(B, [235, 225, 200], 0.14)], 0.25);
    for (var y = 0; y < S; y += 7 + R() * 5) {
      c.strokeStyle = 'rgba(90,70,50,' + (0.05 + R() * 0.05) + ')'; c.lineWidth = 1.2; c.beginPath();
      for (var x = 0; x <= S; x += 12) { var yy = y + Math.sin((x / S) * Math.PI * 6 + R() * 0.6) * 3; if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy); }
      c.stroke();
    }
    speckles(c, S, R, 260, 1.4, [shade(B, 0.72), shade(B, 1.22)], 0.32);
    speckles(c, S, R, 60, 2.2, [mix(B, [80, 60, 45], 0.5)], 0.25);
    bottomGrime(c, S, [70, 55, 40], 0.05, 0.5);
    hBlotches(h, S, R, 12, S * 0.08, S * 0.35, 0.1);
    if (h) { for (var q = 0; q < 260; q++) { var sz = 1 + R() * 1.5; h.fillStyle = grey(0.42 + R() * 0.16); h.fillRect(R() * S, R() * S, sz, sz); } }
  }

  function concreteDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R, B = hex('#9b9892');
    c.fillStyle = css(B); c.fillRect(0, 0, S, S);
    hFill(h, 0.7);
    blotches(c, S, R, 14, S * 0.12, S * 0.4,
      [shade(B, 1.05), shade(B, 0.95), mix(B, [160, 150, 140], 0.2), mix(B, [180, 178, 190], 0.15)], 0.22);
    speckles(c, S, R, 120, 2, [shade(B, 0.75)], 0.35);
    speckles(c, S, R, 80, 1.5, [shade(B, 1.2)], 0.4);
    bottomGrime(c, S, [60, 55, 50], 0.08, 0.7);
    hBlotches(h, S, R, 10, S * 0.1, S * 0.4, 0.12);
    if (h) {
      for (var q = 0; q < 120; q++) { var s = 1 + R() * 2; h.fillStyle = grey(0.45); h.fillRect(R() * S, R() * S, s, s); }
    }
  }

  function marbleDraw(g) {
    var c = g.c, S = g.S, R = g.R, B = hex('#ece8e0');
    c.fillStyle = css(B); c.fillRect(0, 0, S, S);
    blotches(c, S, R, 12, S * 0.15, S * 0.5,
      [mix(B, [195, 192, 188], 0.6), shade(B, 1.03), mix(B, [225, 214, 195], 0.5)], 0.22);
    function vein(p, w, a, col, copies) {
      for (var i = 0; i < copies.length; i++) {
        c.save(); c.translate(copies[i][0], copies[i][1]); c.lineCap = 'round';
        c.strokeStyle = css(col, a * 0.25); c.lineWidth = w * 4;
        c.beginPath(); c.moveTo(p[0], p[1]); c.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); c.stroke();
        c.strokeStyle = css(col, a); c.lineWidth = w;
        c.beginPath(); c.moveTo(p[0], p[1]); c.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); c.stroke();
        c.restore();
      }
    }
    var H3 = [[0, -S], [0, 0], [0, S]], V3 = [[-S, 0], [0, 0], [S, 0]];
    // veins that cross the whole tile and continue in the next one (periodic)
    for (var k = 0; k < 6; k++) {
      var e = R() * S, d1 = (R() - 0.5) * S * 0.6, d2 = -d1 * (0.4 + R() * 0.6), horiz = R() < 0.6;
      var pts = horiz ? [0, e, S * 0.33, e + d1, S * 0.66, e + d2, S, e] : [e, 0, e + d1, S * 0.33, e + d2, S * 0.66, e, S];
      vein(pts, 0.8 + R() * 1.6, 0.16 + R() * 0.22, R() < 0.6 ? [168, 164, 158] : [186, 176, 166], horiz ? H3 : V3);
    }
    // short hairline branches (wrapped only where they cross an edge)
    for (var q = 0; q < 6; q++) {
      var x = R() * S, y = R() * S;
      var p = [x, y, x + (R() - 0.5) * 120, y + (R() - 0.5) * 120, x + (R() - 0.5) * 160, y + (R() - 0.5) * 160, x + (R() - 0.5) * 220, y + (R() - 0.5) * 220];
      var cps = [[0, 0]];
      var minx = Math.min(p[0], p[2], p[4], p[6]) - 6, maxx = Math.max(p[0], p[2], p[4], p[6]) + 6;
      var miny = Math.min(p[1], p[3], p[5], p[7]) - 6, maxy = Math.max(p[1], p[3], p[5], p[7]) + 6;
      if (minx < 0) cps.push([S, 0]); if (maxx > S) cps.push([-S, 0]);
      if (miny < 0) cps.push([0, S]); if (maxy > S) cps.push([0, -S]);
      vein(p, 0.6 + R() * 0.6, 0.14 + R() * 0.18, [170, 166, 160], cps);
    }
  }

  function grassDraw(g) {
    var c = g.c, S = g.S, R = g.R, B = hex('#5f8a3a');
    c.fillStyle = css(B); c.fillRect(0, 0, S, S);
    blotches(c, S, R, 10, S * 0.15, S * 0.45, [hex('#4f7a30'), hex('#6d9a42'), hex('#7a9a3c'), hex('#557f35')], 0.3);
    var cols = [hex('#4a752c'), hex('#6f9f45'), hex('#83ac4e'), hex('#527c31'), hex('#93b558'), hex('#3f6a26')];
    c.lineCap = 'round';
    for (var k = 0; k < 1100; k++) {
      var x = R() * S, y = R() * S, len = 3 + R() * 6, ang = -Math.PI / 2 + (R() - 0.5) * 0.9;
      var col = cols[Math.floor(R() * cols.length)], lw = 0.8 + R() * 1.2, a = 0.55 + R() * 0.4;
      var dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      c.strokeStyle = css(col, a); c.lineWidth = lw;
      wrap9(S, x, y, len, function (cx, cy) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + dx, cy + dy); c.stroke(); });
    }
  }

  function waterDraw(g) {
    var c = g.c, h = g.h, S = g.S, R = g.R, B = hex('#7cc4e4');
    c.fillStyle = css(B); c.fillRect(0, 0, S, S);
    blotches(c, S, R, 10, S * 0.15, S * 0.5, [hex('#5aaed6'), hex('#9edcf2'), hex('#6bbde0')], 0.35);
    for (var k = 0; k < 55; k++) {
      var x = R() * S, y = R() * S, r = 12 + R() * 40, ry = r * (0.6 + R() * 0.4), rot = R() * Math.PI;
      var start = R() * TAU, len = 1 + R() * 2.5, a = 0.12 + R() * 0.18, lw = 1 + R() * 1.5;
      c.strokeStyle = 'rgba(255,255,255,' + a + ')'; c.lineWidth = lw;
      wrap9(S, x, y, r + 3, function (cx, cy) { c.beginPath(); c.ellipse(cx, cy, r, ry, rot, start, start + len); c.stroke(); });
    }
    if (h) {
      var img = h.createImageData(S, S), d = img.data, i = 0;
      for (var yy = 0; yy < S; yy++) {
        for (var xx = 0; xx < S; xx++) {
          var v = 0.5 + 0.12 * Math.sin(TAU * (3 * xx + 2 * yy) / S + 0.4) + 0.1 * Math.sin(TAU * (-2 * xx + 4 * yy) / S + 2.1)
            + 0.08 * Math.sin(TAU * (5 * xx - 3 * yy) / S + 1.0) + 0.06 * Math.sin(TAU * (7 * xx + 6 * yy) / S + 3.3);
          var gv = cl(v * 255);
          d[i] = gv; d[i + 1] = gv; d[i + 2] = gv; d[i + 3] = 255; i += 4;
        }
      }
      h.putImageData(img, 0, 0);
    }
  }

  function stripedDraw(g) {
    var c = g.c, S = g.S, R = g.R, red = hex('#c8383a'), white = hex('#f2ece0');
    var n = 6, sw = S / n;
    for (var i = 0; i < n; i++) { c.fillStyle = css(i % 2 ? white : red); c.fillRect(i * sw, 0, sw + 0.5, S); }
    weave(c, S, 0.05, 2);
    blotches(c, S, R, 8, S * 0.2, S * 0.5, [[255, 255, 255], [0, 0, 0]], 0.07);
  }

  function fabricDraw(base, creases, grimeA) {
    return function (g) {
      var c = g.c, S = g.S, R = g.R, B = hex(base);
      c.fillStyle = css(B); c.fillRect(0, 0, S, S);
      blotches(c, S, R, 10, S * 0.15, S * 0.5, [shade(B, 1.12), shade(B, 0.88)], 0.22);
      weave(c, S, 0.05, 2);
      if (creases) {
        c.lineCap = 'round';
        for (var k = 0; k < 7; k++) {
          var x = R() * S, y = R() * S, len = S * (0.3 + R() * 0.6), ang = R() * Math.PI, w = 3 + R() * 6, a = 0.08 + R() * 0.08;
          var dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
          wrap9(S, x, y, len / 2, function (cx, cy) {
            c.strokeStyle = 'rgba(0,0,0,' + (a * 0.7) + ')'; c.lineWidth = w;
            c.beginPath(); c.moveTo(cx - dx + 2, cy - dy + 3); c.lineTo(cx + dx + 2, cy + dy + 3); c.stroke();
            c.strokeStyle = 'rgba(255,255,255,' + a + ')'; c.lineWidth = w * 0.6;
            c.beginPath(); c.moveTo(cx - dx, cy - dy); c.lineTo(cx + dx, cy + dy); c.stroke();
          });
        }
      }
      if (grimeA) bottomGrime(c, S, [40, 35, 30], grimeA, 0.7);
    };
  }

  function glassDraw(g) {
    var c = g.c, S = g.S;
    c.fillStyle = '#f2f7fa'; c.fillRect(0, 0, S, S);
    var gr = c.createLinearGradient(0, 0, S, S);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, S, S);
  }

  function spikeDraw(g) {
    var c = g.c, e = g.e, S = g.S, R = g.R, cyan = '#2ff5e5';
    c.fillStyle = '#0b0e12'; c.fillRect(0, 0, S, S);
    var n = 4, ps = S / n;
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = i * ps + 2, y = j * ps + 2, w = ps - 4, hh = ps - 4;
        c.fillStyle = R() < 0.5 ? '#0e1216' : '#101519'; c.fillRect(x, y, w, hh);
        c.strokeStyle = 'rgba(70,80,90,0.55)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
        if (R() < 0.35) {
          var vx = x + w * (0.2 + R() * 0.4), vy = y + hh * (0.2 + R() * 0.4), vw = w * 0.3;
          for (var s = 0; s < 4; s++) {
            c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(vx, vy + s * 5, vw, 2);
            c.fillStyle = 'rgba(120,130,140,0.25)'; c.fillRect(vx, vy + s * 5 + 2, vw, 1);
          }
        }
      }
    }
    function trace(ctx, pts, style, lw) {
      ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var q = 1; q < pts.length; q++) ctx.lineTo(pts[q][0], pts[q][1]);
      ctx.stroke();
    }
    function node(p) {
      c.fillStyle = 'rgba(47,245,229,0.25)'; c.fillRect(p[0] - 6, p[1] - 6, 12, 12);
      c.fillStyle = cyan; c.fillRect(p[0] - 3, p[1] - 3, 6, 6);
      e.fillStyle = 'rgba(255,255,255,0.3)'; e.fillRect(p[0] - 6, p[1] - 6, 12, 12);
      e.fillStyle = '#ffffff'; e.fillRect(p[0] - 3, p[1] - 3, 6, 6);
    }
    for (var k = 0; k < 18; k++) {
      var px = 16 + R() * (S - 32), py = 16 + R() * (S - 32), segs = 3 + Math.floor(R() * 4), horiz = R() < 0.5;
      var pts = [[px, py]];
      for (var s2 = 0; s2 < segs; s2++) {
        var len = 20 + R() * 90; if (R() < 0.5) len = -len;
        if (horiz) px = Math.max(12, Math.min(S - 12, px + len)); else py = Math.max(12, Math.min(S - 12, py + len));
        pts.push([px, py]); horiz = !horiz;
      }
      trace(c, pts, 'rgba(47,245,229,0.22)', 7); trace(c, pts, cyan, 2);
      trace(e, pts, 'rgba(255,255,255,0.35)', 7); trace(e, pts, '#ffffff', 2);
      node(pts[0]); node(pts[pts.length - 1]);
    }
  }

  // ------------------------------------------------------------- definitions
  var NAMES = [], DEFS = {};
  function def(name, o) { o.name = name; DEFS[name] = o; NAMES.push(name); }

  def('plaster_cream',      { size: 256, rough: 0.92, metal: 0, draw: plasterDraw('#e9dcc4', 0.10) });
  def('plaster_white',      { size: 256, rough: 0.92, metal: 0, draw: plasterDraw('#f1ece2', 0.09) });
  def('plaster_terracotta', { size: 256, rough: 0.92, metal: 0, draw: plasterDraw('#d9927a', 0.10) });
  def('plaster_ochre',      { size: 256, rough: 0.92, metal: 0, draw: plasterDraw('#d8b26a', 0.10) });
  def('plaster_rose',       { size: 256, rough: 0.92, metal: 0, draw: plasterDraw('#c98a86', 0.10) });
  def('stone_block', { size: 512, rough: 0.85, metal: 0, normal: true, bump: 2.5, draw: masonry({
    base: '#c2b8a6', mortarColor: '#a59c8b', cols: 2, rows: 4, mortar: 6, bond: 0.5, radius: 3,
    vary: 0.05, hue: 0.015, blotch: 3, bevelA: 0.07, bevel: 3, hBase: 0.82, grime: 0.08 }) });
  def('stone_grey',  { size: 512, rough: 0.9, metal: 0, normal: true, bump: 2.5, draw: masonry({
    base: '#9d9a94', mortarColor: '#77746e', cols: 4, rows: 6, mortar: 5, bond: 0.5, radius: 2.5,
    vary: 0.07, hue: 0.01, blotch: 2, bevelA: 0.08, bevel: 2.5, hBase: 0.8, grime: 0.08 }) });
  def('brick_red',   { size: 512, rough: 0.9, metal: 0, normal: true, bump: 2.2, draw: masonry({
    base: '#a8523e', mortarColor: '#c9b9a4', cols: 8, rows: 28, mortar: 3, bond: 0.5, radius: 1.5,
    vary: 0.09, hue: 0.03, alt: ['#8c4636', '#b8654a', '#9c5a48'], altP: 0.25, bevelA: 0.08, bevel: 1.5, hBase: 0.85 }) });
  def('cobble',      { size: 512, rough: 0.85, metal: 0, normal: true, bump: 3.0, draw: cobbleDraw });
  def('paver_sand',  { size: 512, rough: 0.85, metal: 0, normal: true, bump: 2.5, draw: masonry({
    base: '#d3c3a3', mortarColor: '#b6a586', cols: 2, rows: 2, mortar: 4, bond: 0, radius: 2,
    vary: 0.04, hue: 0.015, blotch: 4, bevelA: 0.05, bevel: 3, hBase: 0.82, speckle: 80 }) });
  def('paver_dark',  { size: 256, rough: 0.55, metal: 0.05, normal: true, bump: 2.5, draw: masonry({
    base: '#4d4f55', mortarColor: '#2b2d31', cols: 4, rows: 4, mortar: 3, bond: 0.5, radius: 1.5,
    vary: 0.08, hue: 0.01, blotch: 2, bevelA: 0.10, bevel: 2, hBase: 0.8 }) });
  def('roof_tile',   { size: 512, rough: 0.8, metal: 0, normal: true, bump: 2.5, draw: roofDraw });
  def('wood_plank',  { size: 512, rough: 0.7, metal: 0, normal: true, bump: 2.0, draw: woodDraw({ base: '#a67c52', planks: 10, knots: 5 }) });
  def('wood_dark',   { size: 256, rough: 0.65, metal: 0, normal: true, bump: 2.0, draw: woodDraw({ base: '#5a3d2a', planks: 6, knots: 2 }) });
  def('wood_crate',  { size: 512, rough: 0.8, metal: 0, normal: true, bump: 2.5, faceTexture: true, draw: crateDraw });
  def('metal_dark',  { size: 256, rough: 0.45, metal: 0.55, draw: metalDarkDraw });
  def('metal_painted_green', { size: 256, rough: 0.5, metal: 0.3, draw: paintedDraw('#2f7d73') });
  def('metal_painted_red',   { size: 256, rough: 0.5, metal: 0.3, draw: paintedDraw('#9a2b2b') });
  def('metal_rust',  { size: 512, rough: 0.85, metal: 0.4, normal: true, bump: 2.0, draw: rustDraw });
  def('concrete',    { size: 512, rough: 0.92, metal: 0, normal: true, bump: 1.5, draw: concreteDraw });
  def('sand',        { size: 512, rough: 0.96, metal: 0, normal: true, bump: 1.2, draw: sandDraw });
  def('marble_white',{ size: 512, rough: 0.3, metal: 0, draw: marbleDraw });
  def('grass',       { size: 256, rough: 0.95, metal: 0, draw: grassDraw });
  def('water',       { size: 256, rough: 0.12, metal: 0, normal: true, bump: 1.2, transparent: true, opacity: 0.72, draw: waterDraw });
  def('canvas_striped', { size: 256, rough: 0.9, metal: 0, draw: stripedDraw });
  def('tarp_blue',   { size: 256, rough: 0.65, metal: 0, draw: fabricDraw('#2e5f9e', true, 0.08) });
  def('fabric_red',  { size: 256, rough: 0.9, metal: 0, draw: fabricDraw('#8f2a2e', false, 0) });
  def('glass',       { size: 64, rough: 0.05, metal: 0.1, transparent: true, opacity: 0.25, draw: glassDraw });
  def('spike_tech',  { size: 512, rough: 0.5, metal: 0.5, emissive: '#2ff5e5', emissiveIntensity: 1.2, faceTexture: true, draw: spikeDraw });

  // ------------------------------------------------------------- generation
  var generated = {};           // name -> { map, normal, emissive, canvases }
  var stats = { generated: 0, ms: 0, normalMs: 0, perName: {} };

  function makeTexture(cv, srgb) {
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISOTROPY;
    t.needsUpdate = true;
    return t;
  }

  function generate(name) {
    var g = generated[name];
    if (g) return g;
    var d = DEFS[name];
    if (!d) return null;
    var t0 = performance.now();
    var S = d.size, R = makeRng(hashStr(name));
    var cv = makeCanvas(S), c = ctx2d(cv), hv = null, h = null, ev = null, e = null;
    if (d.normal) { hv = makeCanvas(S); h = ctx2d(hv); h.fillStyle = '#808080'; h.fillRect(0, 0, S, S); }
    if (d.emissive) { ev = makeCanvas(S); e = ctx2d(ev); e.fillStyle = '#000'; e.fillRect(0, 0, S, S); }
    d.draw({ c: c, h: h, e: e, S: S, R: R, def: d });
    var t1 = performance.now();
    var nv = hv ? normalFromHeight(hv, d.bump || 2.5) : null;
    var t2 = performance.now();
    g = {
      map: makeTexture(cv, true),
      normal: nv ? makeTexture(nv, false) : null,
      emissive: ev ? makeTexture(ev, true) : null,
      canvases: { color: cv, height: hv, normal: nv, emissive: ev }
    };
    generated[name] = g;
    stats.generated++;
    stats.ms += t2 - t0;
    stats.normalMs += t2 - t1;
    stats.perName[name] = { draw: +(t1 - t0).toFixed(2), normal: +(t2 - t1).toFixed(2) };
    return g;
  }

  // textures with a repeat are separate (cloned) texture objects, cached per repeat
  var repeatCache = {};
  function normRepeat(rep) {
    if (rep == null) return null;
    if (typeof rep === 'number') return [rep, rep];
    if (rep.length >= 2) return [+rep[0] || 1, +rep[1] || 1];
    return null;
  }
  function withRepeat(tex, name, kind, rep) {
    if (!tex || !rep || (rep[0] === 1 && rep[1] === 1)) return tex;
    var key = name + '|' + kind + '|' + rep[0] + ',' + rep[1];
    var t = repeatCache[key];
    if (!t) {
      t = tex.clone();
      t.repeat.set(rep[0], rep[1]);
      t.needsUpdate = true;
      repeatCache[key] = t;
    }
    return t;
  }

  // -------------------------------------------------------------- public API
  var matCache = {};

  function material(name, opts) {
    opts = opts || {};
    var key = name + '|' + JSON.stringify(opts);
    var m = matCache[key];
    if (m) return m;
    var d = DEFS[name];
    if (!d) {
      console.warn('[VAL.Textures] unknown material "' + name + '" — using flat fallback');
      m = new THREE.MeshStandardMaterial({ color: opts.color != null ? opts.color : 0x9a9a9a, roughness: 0.9, metalness: 0 });
      m.name = 'VAL.' + name;
      matCache[key] = m;
      return m;
    }
    var g = generate(name), rep = normRepeat(opts.repeat);
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: d.rough, metalness: d.metal });
    m.map = withRepeat(g.map, name, 'map', rep);
    if (g.normal) {
      m.normalMap = withRepeat(g.normal, name, 'normal', rep);
      m.normalScale = new THREE.Vector2(NORMAL_SCALE, NORMAL_SCALE);
    }
    if (g.emissive) {
      m.emissive = new THREE.Color(d.emissive);
      m.emissiveMap = withRepeat(g.emissive, name, 'emissive', rep);
      m.emissiveIntensity = d.emissiveIntensity || 1;
    }
    if (d.transparent) { m.transparent = true; m.opacity = d.opacity; }
    if (d.side != null) m.side = d.side;
    if (opts.color != null) m.color.set(opts.color);
    if (opts.roughness != null) m.roughness = opts.roughness;
    if (opts.metalness != null) m.metalness = opts.metalness;
    if (opts.side != null) m.side = opts.side;
    if (opts.transparent != null) m.transparent = !!opts.transparent;
    if (opts.opacity != null) { m.opacity = opts.opacity; if (opts.opacity < 1) m.transparent = true; }
    m.name = 'VAL.' + name;
    m.userData.texture = name;
    matCache[key] = m;
    return m;
  }

  function map(name, opts) {
    var g = generate(name);
    if (!g) return null;
    return withRepeat(g.map, name, 'map', normRepeat(opts && opts.repeat));
  }

  function normal(name, opts) {
    var g = generate(name);
    if (!g || !g.normal) return null;
    return withRepeat(g.normal, name, 'normal', normRepeat(opts && opts.repeat));
  }

  function info(name) {
    var d = DEFS[name];
    if (!d) return null;
    return { name: name, size: d.size, roughness: d.rough, metalness: d.metal, normal: !!d.normal,
      transparent: !!d.transparent, emissive: !!d.emissive, faceTexture: !!d.faceTexture, tileMeters: TILE_METERS };
  }

  function preload() {
    var t0 = performance.now();
    for (var i = 0; i < NAMES.length; i++) material(NAMES[i]);
    return performance.now() - t0;
  }

  function repeatFor(w, h) { return [w / TILE_METERS, (h == null ? w : h) / TILE_METERS]; }

  VAL.Textures = {
    material: material,
    map: map,
    normal: normal,
    NAMES: NAMES,
    TILE_METERS: TILE_METERS,
    NORMAL_SCALE: NORMAL_SCALE,
    repeatFor: repeatFor,
    info: info,
    preload: preload,
    stats: stats,
    // debugging / test page: raw canvases { color, height, normal, emissive }
    canvases: function (name) { var g = generate(name); return g ? g.canvases : null; }
  };
})();
