/* js/core/audio.js — VAL.Audio
 * Fully synthesized WebAudio SFX + lobby music for the VALORANT replica. No audio files.
 * Classic script, attaches to window.VAL. Does not depend on THREE (positions are read as {x,y,z}).
 *
 *   VAL.Audio.init()                                  create/resume the AudioContext (call on a user gesture; idempotent)
 *   VAL.Audio.setListener(pos, forward)               listener pose (Vector3-like)
 *   VAL.Audio.play(name, {pos, vol, pitch, loop, occluded}) -> handle {stop(fade?), setPos(pos), setVolume(x)}
 *   VAL.Audio.music('lobby' | 'agent_select' | null)  looping ambient track; null fades out over 1 s
 *   VAL.Audio.setVolume({master, sfx, music})         0..1
 *   VAL.Audio.NAMES                                   every sound name
 *
 * Synthesis rules used everywhere: gains start at 0 (setValueAtTime) with a 1-6 ms linear attack, decay with
 * setTargetAtTime (never exponentialRamp to 0), and every source is stopped only after its envelope has decayed
 * (>= 8 time constants) so nothing clicks. Per-name voice cap (6, oldest stolen) + a master compressor.
 */
(function () {
  'use strict';
  window.VAL = window.VAL || {};

  var AC = window.AudioContext || window.webkitAudioContext;
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  var MAX_PER_NAME = 6;      // simultaneous voices per sound name (oldest is stolen)
  var MAX_VOICES = 64;       // global safety cap
  var CONFIG = {
    panningModel: 'HRTF',    // 'HRTF' | 'equalpower'
    refDistance: 2,
    farDistance: 25          // beyond this, gunshots get the distant treatment (lowpass + slap echo)
  };

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function db(x) { return Math.pow(10, x / 20); }
  function noop() {}
  var warned = {};
  function warnOnce(key, msg) { if (!warned[key]) { warned[key] = true; if (window.console) console.warn('[VAL.Audio] ' + msg); } }

  var DUMMY = { name: null, dummy: true, stop: noop, setPos: noop, setVolume: noop, playing: false };

  function setParamPos(node, pos, t, immediate) {
    if (node.positionX) {
      if (immediate) { node.positionX.setValueAtTime(pos.x, t); node.positionY.setValueAtTime(pos.y, t); node.positionZ.setValueAtTime(pos.z, t); }
      else { node.positionX.setTargetAtTime(pos.x, t, 0.015); node.positionY.setTargetAtTime(pos.y, t, 0.015); node.positionZ.setTargetAtTime(pos.z, t, 0.015); }
    } else if (node.setPosition) node.setPosition(pos.x, pos.y, pos.z);
  }

  // ------------------------------------------------------------------------------------------------
  // Voice: one play() call. Owns its nodes; helper methods build click-safe sources and envelopes.
  // ------------------------------------------------------------------------------------------------
  function Voice(eng, name, def, p) {
    this.eng = eng; this.ctx = eng.ctx; this.name = name; this.def = def; this.p = p;
    this.pitch = (p.pitch > 0) ? clamp(p.pitch, 0.25, 4) : 1;
    this.nodes = []; this.sources = []; this.gens = [];
    this.t = this.ctx.currentTime + 0.012;      // scheduling origin (small offset so nothing lands in the past)
    this.end = this.t;                          // latest scheduled source stop
    this.baseGain = def.vol * (p.vol == null ? 1 : clamp(+p.vol, 0, 4));
    this.out = this.ctx.createGain(); this.out.gain.value = this.baseGain; this.nodes.push(this.out);
    this.tail = this.out;                       // end of the chain (what feeds the bus), set by play()
    this.pan = null; this.far = false; this.dead = false; this.timer = null; this.loopTimer = null;
  }
  Voice.prototype.reg = function (n) { this.nodes.push(n); return n; };
  Voice.prototype.gain = function (val, dst) {
    var g = this.ctx.createGain(); g.gain.value = (val == null) ? 1 : val; g.connect(dst || this.out); return this.reg(g);
  };
  Voice.prototype.filter = function (type, f, q, dst) {
    var b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = clamp(f * this.pitch, 10, 20000);
    b.Q.value = (q == null) ? 1 : q; b.connect(dst || this.out); return this.reg(b);
  };
  Voice.prototype.osc = function (type, f, t0, t1, dst) {
    var o = this.ctx.createOscillator(); o.type = type; o.frequency.value = clamp(f * this.pitch, 1, 20000);
    o.connect(dst || this.out); o.start(t0); o.stop(t1); this.sources.push(o); this.reg(o);
    if (t1 > this.end) this.end = t1; return o;
  };
  Voice.prototype.noise = function (t0, t1, dst) {
    var s = this.ctx.createBufferSource(); s.buffer = this.eng.noiseBuf; s.loop = true;
    s.connect(dst || this.out); s.start(t0, rnd(0, 1.5)); s.stop(t1); this.sources.push(s); this.reg(s);
    if (t1 > this.end) this.end = t1; return s;
  };
  // Envelope: 0 -> peak (linear, a seconds), hold, then decay towards 0 with time constant tau. Returns a safe stop time.
  Voice.prototype.env = function (param, t0, peak, a, tau, hold) {
    a = a || 0.002; hold = hold || 0;
    param.setValueAtTime(0, t0); param.linearRampToValueAtTime(peak, t0 + a); param.setTargetAtTime(0, t0 + a + hold, tau);
    return t0 + a + hold + tau * 8 + 0.005;
  };
  Voice.prototype.sweep = function (param, t0, v0, t1, v1) {   // exponential glide (frequencies), pitch-scaled
    var k = this.pitch; param.setValueAtTime(Math.max(v0 * k, 0.01), t0); param.exponentialRampToValueAtTime(Math.max(v1 * k, 0.01), Math.max(t1, t0 + 0.001));
  };
  Voice.prototype.reverb = function (amount) {                  // post-chain send into the shared reverb
    if (!(amount > 0) || !this.eng.reverbIn) return;
    var g = this.ctx.createGain(); g.gain.value = amount * (this.far ? 1.4 : 1); this.tail.connect(g); g.connect(this.eng.sfxSend); this.reg(g);
  };
  Voice.prototype.beginGeneration = function () {               // (retrigger loops) park the previous generation's nodes
    if (this.nodes.length > 1) this.gens.push({ nodes: this.nodes.slice(1), sources: this.sources, end: this.end });
    this.nodes = [this.out]; this.sources = [];
    var now = this.ctx.currentTime, keep = [];
    for (var i = 0; i < this.gens.length; i++) { if (this.gens[i].end < now - 0.05) disposeList(this.gens[i].nodes); else keep.push(this.gens[i]); }
    this.gens = keep;
  };
  Voice.prototype.dispose = function () {
    for (var i = 0; i < this.gens.length; i++) disposeList(this.gens[i].nodes);
    this.gens = []; disposeList(this.nodes); this.nodes = []; this.sources = [];
  };
  function disposeList(list) { for (var i = 0; i < list.length; i++) { try { list[i].disconnect(); } catch (e) {} } }

  // ------------------------------------------------------------------------------------------------
  // Engine: buses, compressor, shared FDN reverb, listener, voice management. One per AudioContext.
  // ------------------------------------------------------------------------------------------------
  function Engine(ctx, offline) {
    this.ctx = ctx; this.offline = !!offline;
    this.vol = { master: 1, sfx: 1, music: 0.6 };
    this.listenerPos = { x: 0, y: 0, z: 0 }; this.listenerFwd = { x: 0, y: 0, z: -1 };
    this.active = {}; this.all = []; this.musicState = null;

    // shared 2 s white-noise buffer
    var len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // buses: sfx/music -> sum -> compressor -> master -> destination
    var sum = ctx.createGain(), comp = ctx.createDynamicsCompressor(), master = ctx.createGain(), sfx = ctx.createGain(), mus = ctx.createGain();
    comp.threshold.value = -9; comp.knee.value = 9; comp.ratio.value = 10; comp.attack.value = 0.0015; comp.release.value = 0.1;
    sfx.connect(sum); mus.connect(sum); sum.connect(comp); comp.connect(master); master.connect(ctx.destination);
    master.gain.value = this.vol.master; sfx.gain.value = this.vol.sfx; mus.gain.value = this.vol.music;
    this.nodes = { sum: sum, comp: comp, master: master, sfxBus: sfx, musicBus: mus };

    this.buildReverb(sum);
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = this.vol.sfx; this.sfxSend.connect(this.reverbIn);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = this.vol.music; this.musicSend.connect(this.reverbIn);
    this.updateListener();
  }

  // Small feedback-delay-network reverb (~1 s): 4 damped delay lines with self + ring cross-feedback.
  Engine.prototype.buildReverb = function (dst) {
    var ctx = this.ctx, inp = ctx.createGain(), pre = ctx.createDelay(0.1), out = ctx.createGain();
    pre.delayTime.value = 0.014; inp.connect(pre);
    var times = [0.0311, 0.0413, 0.0497, 0.0617], lines = [], i;
    for (i = 0; i < times.length; i++) {
      var dl = ctx.createDelay(0.2), lp = ctx.createBiquadFilter(), gs = ctx.createGain(), gc = ctx.createGain();
      dl.delayTime.value = times[i]; lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.4; gs.gain.value = 0.5; gc.gain.value = 0.27;
      pre.connect(dl); dl.connect(lp); lp.connect(gs); gs.connect(dl); lp.connect(gc); dl.connect(out); lines.push({ dl: dl, gc: gc });
    }
    for (i = 0; i < lines.length; i++) lines[i].gc.connect(lines[(i + 1) % lines.length].dl);
    var hp = ctx.createBiquadFilter(), lpo = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 170; hp.Q.value = 0.5; lpo.type = 'lowpass'; lpo.frequency.value = 5200; lpo.Q.value = 0.5;
    out.gain.value = 0.32; out.connect(hp); hp.connect(lpo); lpo.connect(dst);
    this.reverbIn = inp; this.nodes.reverbOut = out;
  };

  Engine.prototype.setListener = function (pos, fwd) {
    if (pos) { this.listenerPos.x = +pos.x || 0; this.listenerPos.y = +pos.y || 0; this.listenerPos.z = +pos.z || 0; }
    if (fwd) {
      var x = +fwd.x || 0, y = +fwd.y || 0, z = +fwd.z || 0, l = Math.sqrt(x * x + y * y + z * z);
      if (l > 1e-4 && Math.sqrt(x * x + z * z) / l > 0.05) { this.listenerFwd.x = x / l; this.listenerFwd.y = y / l; this.listenerFwd.z = z / l; }
    }
    this.updateListener();
  };
  Engine.prototype.updateListener = function () {
    var L = this.ctx.listener, p = this.listenerPos, f = this.listenerFwd, t = this.ctx.currentTime;
    if (!L) return;
    if (L.positionX) {
      var tc = this.offline ? 0 : 0.02;
      if (tc) {
        L.positionX.setTargetAtTime(p.x, t, tc); L.positionY.setTargetAtTime(p.y, t, tc); L.positionZ.setTargetAtTime(p.z, t, tc);
        L.forwardX.setTargetAtTime(f.x, t, tc); L.forwardY.setTargetAtTime(f.y, t, tc); L.forwardZ.setTargetAtTime(f.z, t, tc);
      } else {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      }
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else if (L.setPosition) { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  };

  Engine.prototype.play = function (name, opts) {
    var ctx = this.ctx, def = SOUNDS[name];
    if (!def) { warnOnce('s:' + name, 'unknown sound "' + name + '"'); return DUMMY; }
    if (!this.offline && ctx.state !== 'running') return DUMMY;
    var p = opts || {}, v = new Voice(this, name, def, p), extra = 1, dist = 0, last = v.out;

    if (p.pos && typeof p.pos.x === 'number') {
      var lp = this.listenerPos, dx = p.pos.x - lp.x, dy = p.pos.y - lp.y, dz = p.pos.z - lp.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var maxD = def.maxDist || 120;
      if (dist > maxD) return DUMMY;
      var edge = maxD * 0.7; if (dist > edge) extra *= 1 - (dist - edge) / (maxD - edge);
      if (def.far && dist > CONFIG.farDistance) {
        v.far = true;
        var cut = clamp(9000 * Math.pow(CONFIG.farDistance / dist, 1.3), 700, 9000);
        var lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = cut; lpf.Q.value = 0.4;
        last.connect(lpf); v.reg(lpf); last = lpf;
        // slap echo (delay grows with distance)
        var dly = ctx.createDelay(0.5), fb = ctx.createGain(), efl = ctx.createBiquadFilter(), wet = ctx.createGain();
        dly.delayTime.value = 0.045 + Math.min(dist, 150) * 0.0011; fb.gain.value = 0.33;
        efl.type = 'lowpass'; efl.frequency.value = 1100; efl.Q.value = 0.4; wet.gain.value = clamp(0.25 + dist / 300, 0.25, 0.6);
        last.connect(dly); dly.connect(efl); efl.connect(fb); fb.connect(dly); efl.connect(wet);
        v.reg(dly); v.reg(fb); v.reg(efl); v.reg(wet); v.echoOut = wet; v.echoTail = 1.2;
      }
      var pan = ctx.createPanner();
      pan.panningModel = CONFIG.panningModel; pan.distanceModel = 'inverse'; pan.refDistance = def.ref || CONFIG.refDistance;
      pan.maxDistance = 10000; pan.rolloffFactor = def.rolloff || 1;
      setParamPos(pan, p.pos, ctx.currentTime, true);
      last.connect(pan); if (v.echoOut) v.echoOut.connect(pan); v.reg(pan); v.pan = pan; last = pan;
    }
    if (p.occluded) {
      var oc = ctx.createBiquadFilter(); oc.type = 'lowpass'; oc.frequency.value = 600; oc.Q.value = 0.5;
      last.connect(oc); v.reg(oc); last = oc; extra *= db(-8);
    }
    last.connect(this.nodes.sfxBus); v.tail = last;
    if (extra !== 1) { v.baseGain *= extra; v.out.gain.value = v.baseGain; }

    this.admit(v);
    def.gen(v, v.t, p);
    this.finish(v);
    return this.handle(v);
  };

  Engine.prototype.admit = function (v) {
    var list = this.active[v.name] || (this.active[v.name] = []);
    while (list.length >= MAX_PER_NAME) this.kill(list[0], 0.004);
    while (this.all.length >= MAX_VOICES) this.kill(this.all[0], 0.004);
    list.push(v); this.all.push(v);
  };
  Engine.prototype.remove = function (v) {
    var list = this.active[v.name], i;
    if (list) { i = list.indexOf(v); if (i >= 0) list.splice(i, 1); }
    i = this.all.indexOf(v); if (i >= 0) this.all.splice(i, 1);
  };
  Engine.prototype.kill = function (v, fade) {
    if (v.dead) return;
    v.dead = true; this.remove(v);
    if (v.timer) clearTimeout(v.timer); if (v.loopTimer) clearTimeout(v.loopTimer);
    var t = this.ctx.currentTime, g = v.out.gain; fade = (fade == null) ? 0.03 : fade;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, Math.max(fade / 4, 0.001));
    var stopAt = t + fade + 0.02, i;
    for (i = 0; i < v.sources.length; i++) { try { v.sources[i].stop(stopAt); } catch (e) {} }
    for (i = 0; i < v.gens.length; i++) for (var j = 0; j < v.gens[i].sources.length; j++) { try { v.gens[i].sources[j].stop(stopAt); } catch (e2) {} }
    if (this.offline) return;
    setTimeout(function () { v.dispose(); }, (fade + 0.15) * 1000);
  };
  Engine.prototype.finish = function (v) {
    var eng = this, ctx = this.ctx;
    if (v.p.loop && !v.def.sustain) {                 // retrigger loop for one-shot sounds (beeps, heartbeat...)
      var period = v.def.period || v.def.dur || 0.5;
      v.nextT = v.t + period;
      if (this.offline) return;
      var tick = function () {
        if (v.dead) return;
        v.beginGeneration(); v.t = v.nextT; v.def.gen(v, v.t, v.p); v.nextT += period;
        v.loopTimer = setTimeout(tick, Math.max((v.nextT - ctx.currentTime - 0.15) * 1000, 10));
      };
      v.loopTimer = setTimeout(tick, Math.max((v.nextT - ctx.currentTime - 0.15) * 1000, 10));
      return;
    }
    if (this.offline) return;
    var ms = (v.end - ctx.currentTime + (v.echoTail || 0) + 0.08) * 1000;
    v.timer = setTimeout(function () { if (v.dead) return; v.dead = true; eng.remove(v); v.dispose(); }, Math.max(ms, 20));
  };
  Engine.prototype.handle = function (v) {
    var eng = this;
    return {
      name: v.name, dummy: false,
      stop: function (fade) { eng.kill(v, fade == null ? 0.04 : fade); },
      setPos: function (pos) { if (v.pan && pos && typeof pos.x === 'number') setParamPos(v.pan, pos, eng.ctx.currentTime, false); },
      setVolume: function (x) { v.out.gain.setTargetAtTime(v.baseGain * clamp(+x || 0, 0, 4), eng.ctx.currentTime, 0.02); },
      get playing() { return !v.dead; }
    };
  };
  Engine.prototype.setVolume = function (o) {
    if (!o) return;
    var t = this.ctx.currentTime, n = this.nodes;
    if (o.master != null) { this.vol.master = clamp(+o.master || 0, 0, 1); n.master.gain.setTargetAtTime(this.vol.master, t, 0.03); }
    if (o.sfx != null) { this.vol.sfx = clamp(+o.sfx || 0, 0, 1); n.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.03); this.sfxSend.gain.setTargetAtTime(this.vol.sfx, t, 0.03); }
    if (o.music != null) { this.vol.music = clamp(+o.music || 0, 0, 1); n.musicBus.gain.setTargetAtTime(this.vol.music, t, 0.03); this.musicSend.gain.setTargetAtTime(this.vol.music, t, 0.03); }
  };

  // ------------------------------------------------------------------------------------------------
  // Synthesis building blocks (all take the voice and an absolute start time)
  // ------------------------------------------------------------------------------------------------
  // low body / thump: sine gliding f0 -> f1 over sw seconds, amplitude decaying with tau
  function thump(v, t, f0, f1, sw, amt, tau, type) {
    var g = v.gain(0), stop = v.env(g.gain, t, amt, 0.003, tau);
    var o = v.osc(type || 'sine', f0, t, stop, g); v.sweep(o.frequency, t, f0, t + sw, f1); return o;
  }
  // partial / ping: steady tone with attack a and decay tau
  function ping(v, t, f, amt, tau, type, a) {
    var g = v.gain(0), stop = v.env(g.gain, t, amt, a || 0.002, tau);
    return v.osc(type || 'sine', f, t, stop, g);
  }
  // tone glide f0 -> f1 over sw seconds with attack a, hold, decay tau
  function chirp(v, t, f0, f1, sw, amt, a, hold, tau, type) {
    var g = v.gain(0), stop = v.env(g.gain, t, amt, a, tau, hold);
    var o = v.osc(type || 'sine', f0, t, stop, g); v.sweep(o.frequency, t, f0, t + sw, f1); return o;
  }
  // filtered noise burst. o = {type, f, q, f1, sw, a, hold, tau, amt, hp, lp}
  function burst(v, t, o) {
    var g = v.gain(0), stop = v.env(g.gain, t, o.amt, o.a || 0.002, o.tau, o.hold), dst = g;
    if (o.hp) dst = v.filter('highpass', o.hp, 0.7, dst);
    if (o.lp) dst = v.filter('lowpass', o.lp, 0.7, dst);
    var flt = v.filter(o.type || 'bandpass', o.f, o.q, dst);
    if (o.f1) v.sweep(flt.frequency, t, o.f, t + (o.sw || o.tau * 3), o.f1);
    v.noise(t, stop, flt); return flt;
  }
  // very short bright transient
  function click(v, t, amt, f, q, tau) { return burst(v, t, { type: 'bandpass', f: f || 3000, q: q || 1.5, tau: tau || 0.005, amt: amt }); }
  // small inharmonic metallic cluster
  function metal(v, t, base, amt, tau, ratios) {
    ratios = ratios || [1, 1.47, 2.09, 2.83];
    for (var i = 0; i < ratios.length; i++) ping(v, t, base * ratios[i], amt / (1 + i * 0.7), tau / (1 + i * 0.35));
  }

  // ------------------------------------------------------------------------------------------------
  // Gunshots: transient click + filtered noise crack + low body + decaying tail (+ suppressor "thup" / LMG bolt clack)
  // ------------------------------------------------------------------------------------------------
  function gunshot(v, t, c) {
    var b = c.body; thump(v, t, b[0], b[1], b[2], b[3], b[4]);
    var k = c.crack; burst(v, t, { type: k.type || 'bandpass', f: k.f, q: k.q || 0.7, tau: k.tau, amt: k.amt, hp: k.hp });
    if (c.click && !v.far) click(v, t, c.click, 3600, 0.8, 0.004);
    if (c.thup) burst(v, t, { type: 'bandpass', f: c.thup[0], q: 2.5, tau: c.thup[2], amt: c.thup[1] });
    var tl = c.tail;
    if (tl) burst(v, t + 0.008, { type: 'lowpass', f: tl.f, q: 0.5, f1: tl.f * 0.35, sw: tl.tau * 3, a: 0.006, tau: tl.tau, amt: tl.amt * (v.far ? 1.3 : 1), hp: 90 });
    if (c.mech) { click(v, t + c.mech[0], c.mech[1], 2400, 3, 0.012); ping(v, t + c.mech[0], 1900, c.mech[1] * 0.35, 0.03); }
    if (c.reverb) v.reverb(c.reverb);
  }
  //              body:[f0, f1, sweep, amt, tau]          crack:{f, q, tau, amt}                       click  thup:[f, amt, tau]  tail:{f, tau, amt}            reverb dur   (voice gain / max distance)
  var SHOTS = {
    classic:  { body: [175, 50, 0.05, 0.55, 0.045], crack: { f: 2700, q: 0.7, tau: 0.02, amt: 0.6 },   click: 0.5,                        tail: { f: 1700, tau: 0.07, amt: 0.25 },  reverb: 0.15, dur: 0.30, vol: 0.55, maxDist: 100 },
    shorty:   { body: [120, 40, 0.09, 0.7, 0.08],   crack: { type: 'lowpass', f: 3000, q: 0.6, tau: 0.05, amt: 0.65 }, click: 0.45,      tail: { f: 900, tau: 0.16, amt: 0.4 },    reverb: 0.25, dur: 0.55, vol: 0.55, maxDist: 110 },
    frenzy:   { body: [200, 60, 0.04, 0.4, 0.035],  crack: { f: 3000, q: 0.8, tau: 0.015, amt: 0.55 },  click: 0.5,                        tail: { f: 1800, tau: 0.045, amt: 0.15 }, reverb: 0.1,  dur: 0.18, vol: 0.5,  maxDist: 90 },
    ghost:    { body: [140, 55, 0.045, 0.5, 0.045], crack: { type: 'lowpass', f: 1200, q: 0.6, tau: 0.025, amt: 0.45 }, click: 0.12, thup: [350, 0.4, 0.03], tail: { f: 700, tau: 0.07, amt: 0.2 }, reverb: 0.08, dur: 0.22, vol: 0.5, maxDist: 70 },
    sheriff:  { body: [110, 38, 0.12, 0.8, 0.1],    crack: { f: 2000, q: 0.6, tau: 0.035, amt: 0.7 },   click: 0.6,                        tail: { f: 1200, tau: 0.22, amt: 0.45 },  reverb: 0.45, dur: 1, vol: 0.55, maxDist: 150 },
    stinger:  { body: [220, 70, 0.03, 0.35, 0.03],  crack: { f: 3200, q: 0.8, tau: 0.012, amt: 0.55 },  click: 0.5,                        tail: { f: 1900, tau: 0.04, amt: 0.15 },  reverb: 0.08, dur: 0.14, vol: 0.5,  maxDist: 90 },
    spectre:  { body: [170, 60, 0.035, 0.4, 0.035], crack: { type: 'lowpass', f: 1400, q: 0.6, tau: 0.02, amt: 0.45 }, click: 0.15, thup: [400, 0.35, 0.025], tail: { f: 800, tau: 0.05, amt: 0.15 }, reverb: 0.06, dur: 0.15, vol: 0.5, maxDist: 70 },
    bucky:    { body: [100, 35, 0.11, 0.8, 0.1],    crack: { type: 'lowpass', f: 2600, q: 0.6, tau: 0.06, amt: 0.7 }, click: 0.5,       tail: { f: 800, tau: 0.2, amt: 0.45 },    reverb: 0.3,  dur: 0.9, vol: 0.55, maxDist: 120 },
    judge:    { body: [110, 40, 0.09, 0.75, 0.085], crack: { type: 'lowpass', f: 2800, q: 0.6, tau: 0.05, amt: 0.7 }, click: 0.5,       tail: { f: 900, tau: 0.14, amt: 0.4 },    reverb: 0.25, dur: 0.65,  vol: 0.55, maxDist: 120 },
    bulldog:  { body: [170, 55, 0.05, 0.55, 0.05],  crack: { f: 2600, q: 0.6, tau: 0.025, amt: 0.65 },  click: 0.55,                       tail: { f: 1600, tau: 0.1, amt: 0.3 },    reverb: 0.2,  dur: 0.32, vol: 0.55, maxDist: 140 },
    guardian: { body: [140, 45, 0.07, 0.65, 0.07],  crack: { f: 2200, q: 0.6, tau: 0.03, amt: 0.7 },    click: 0.6,                        tail: { f: 1400, tau: 0.15, amt: 0.4 },   reverb: 0.3,  dur: 0.7, vol: 0.55, maxDist: 150 },
    phantom:  { body: [150, 55, 0.045, 0.5, 0.045], crack: { type: 'lowpass', f: 1600, q: 0.6, tau: 0.025, amt: 0.5 }, click: 0.2, thup: [380, 0.35, 0.03], tail: { f: 900, tau: 0.08, amt: 0.25 }, reverb: 0.15, dur: 0.26, vol: 0.55, maxDist: 80 },
    vandal:   { body: [160, 50, 0.055, 0.6, 0.055], crack: { f: 2800, q: 0.6, tau: 0.03, amt: 0.7 },    click: 0.65,                       tail: { f: 1800, tau: 0.13, amt: 0.35 },  reverb: 0.25, dur: 0.6, vol: 0.55, maxDist: 140 },
    marshal:  { body: [120, 40, 0.1, 0.75, 0.1],    crack: { f: 2000, q: 0.6, tau: 0.04, amt: 0.7 },    click: 0.6,                        tail: { f: 1200, tau: 0.25, amt: 0.45 },  reverb: 0.45, dur: 1.15, vol: 0.55, maxDist: 180 },
    outlaw:   { body: [95, 32, 0.15, 0.85, 0.14],   crack: { f: 1800, q: 0.6, tau: 0.045, amt: 0.7 },   click: 0.6,                        tail: { f: 1000, tau: 0.3, amt: 0.5 },    reverb: 0.55, dur: 1.35, vol: 0.5,  maxDist: 200 },
    operator: { body: [85, 28, 0.18, 0.9, 0.17],    crack: { f: 1600, q: 0.6, tau: 0.05, amt: 0.7 },    click: 0.6,                        tail: { f: 900, tau: 0.35, amt: 0.55 },   reverb: 0.6,  dur: 1.6, vol: 0.5,  maxDist: 220 },
    ares:     { body: [130, 45, 0.06, 0.65, 0.06],  crack: { f: 2200, q: 0.6, tau: 0.03, amt: 0.6 },    click: 0.5,  mech: [0.025, 0.4],   tail: { f: 1200, tau: 0.09, amt: 0.3 },   reverb: 0.2,  dur: 0.32, vol: 0.55, maxDist: 150 },
    odin:     { body: [115, 40, 0.07, 0.75, 0.07],  crack: { f: 1900, q: 0.6, tau: 0.035, amt: 0.65 },  click: 0.55, mech: [0.03, 0.5],    tail: { f: 1000, tau: 0.1, amt: 0.35 },   reverb: 0.2,  dur: 0.36, vol: 0.55, maxDist: 160 }
  };

  var SOUNDS = {};
  function def(name, gen, props) {
    var d = { gen: gen, vol: 0.5, rolloff: 1, maxDist: 60, dur: 0.5 };
    if (props) for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) d[k] = props[k];
    SOUNDS[name] = d; return d;
  }
  Object.keys(SHOTS).forEach(function (id) {
    var c = SHOTS[id];
    def('shot_' + id, function (v, t) { gunshot(v, t, c); }, { vol: c.vol, maxDist: c.maxDist, rolloff: (/^(sheriff|marshal|outlaw|operator)$/.test(id) ? 0.5 : 0.7), ref: 4, far: true, dur: c.dur, kind: 'shot' });
  });

  // ------------------------------------------------------------------------------------------------
  // Hits / impacts
  // ------------------------------------------------------------------------------------------------
  def('hit_body', function (v, t) {                                   // dull thud
    thump(v, t, 115, 58, 0.08, 0.6, 0.06);
    burst(v, t, { type: 'lowpass', f: 520, q: 0.7, tau: 0.04, amt: 0.4 });
    click(v, t, 0.15, 1400, 1, 0.006);
  }, { vol: 0.5, rolloff: 1.2, maxDist: 40, dur: 0.25 });

  def('hit_head', function (v, t) {                                   // the metallic "dink"
    var o = ping(v, t, 2200, 0.45, 0.09); v.sweep(o.frequency, t, 2360, t + 0.015, 2200);
    ping(v, t, 3520, 0.2, 0.05); ping(v, t, 5400, 0.1, 0.025); ping(v, t, 900, 0.14, 0.012);
    click(v, t, 0.35, 4500, 1, 0.003);
    v.reverb(0.12);
  }, { vol: 0.5, rolloff: 1.2, maxDist: 40, dur: 0.4 });

  def('hit_armor', function (v, t) {                                  // clank
    metal(v, t, 1400, 0.3, 0.06, [1, 1.55, 2.31]);
    burst(v, t, { type: 'bandpass', f: 1800, q: 3, tau: 0.03, amt: 0.45 });
    thump(v, t, 150, 70, 0.04, 0.4, 0.05);
    click(v, t, 0.3, 3000, 1, 0.004);
  }, { vol: 0.5, rolloff: 1.2, maxDist: 40, dur: 0.35 });

  def('death', function (v, t) {                                      // thump + short groan-like filtered noise
    thump(v, t, 90, 40, 0.12, 0.6, 0.09);
    burst(v, t + 0.02, { type: 'bandpass', f: 520, q: 4, f1: 180, sw: 0.35, a: 0.02, tau: 0.12, amt: 0.45 });
    chirp(v, t + 0.02, 130, 70, 0.35, 0.12, 0.02, 0.05, 0.1, 'sawtooth');
    burst(v, t + 0.12, { type: 'lowpass', f: 800, q: 0.7, tau: 0.05, amt: 0.25 });
    v.reverb(0.2);
  }, { vol: 0.55, rolloff: 1.2, maxDist: 45, dur: 0.7, ref: 3 });

  def('bullet_impact_stone', function (v, t) {
    v.pitch *= rnd(0.92, 1.08);
    burst(v, t, { type: 'bandpass', f: 1800, q: 0.8, tau: 0.02, amt: 0.55 });
    burst(v, t + 0.015, { type: 'lowpass', f: 3000, q: 0.6, tau: 0.06, amt: 0.2 });
    thump(v, t, 200, 80, 0.02, 0.3, 0.02);
  }, { vol: 0.55, rolloff: 1.2, maxDist: 45, dur: 0.2 });

  def('bullet_impact_metal', function (v, t) {
    v.pitch *= rnd(0.9, 1.1);
    metal(v, t, 2600, 0.3, 0.08, [1, 1.5, 0.46, 2.1]);
    click(v, t, 0.5, 3000, 1, 0.008);
    burst(v, t, { type: 'bandpass', f: 2200, q: 4, tau: 0.03, amt: 0.25 });
  }, { vol: 0.45, rolloff: 1.2, maxDist: 45, dur: 0.35 });

  def('bullet_impact_wood', function (v, t) {
    v.pitch *= rnd(0.9, 1.1);
    thump(v, t, 300, 120, 0.02, 0.5, 0.03);
    burst(v, t, { type: 'lowpass', f: 1200, q: 0.7, tau: 0.025, amt: 0.45 });
  }, { vol: 0.45, rolloff: 1.2, maxDist: 45, dur: 0.15 });

  def('bullet_whiz', function (v, t) {                                // fast filtered noise sweep
    burst(v, t, { type: 'bandpass', f: 4500, q: 2, f1: 900, sw: 0.12, a: 0.01, tau: 0.04, amt: 0.45 });
  }, { vol: 0.8, rolloff: 2, maxDist: 12, dur: 0.2 });

  // ------------------------------------------------------------------------------------------------
  // Movement: two-part heel/toe footsteps with random pitch
  // ------------------------------------------------------------------------------------------------
  function footstep(surface) {
    return function (v, t) {
      v.pitch *= rnd(0.9, 1.1);
      var toe = t + rnd(0.055, 0.075), k = 0.6;
      if (surface === 'stone') {
        burst(v, t, { type: 'bandpass', f: 1300, q: 1, tau: 0.02, amt: 0.5 }); thump(v, t, 140, 70, 0.02, 0.3, 0.02);
        burst(v, t, { type: 'highpass', f: 3500, q: 0.7, tau: 0.03, amt: 0.15 });
        burst(v, toe, { type: 'bandpass', f: 1600, q: 1, tau: 0.018, amt: 0.5 * k }); thump(v, toe, 150, 80, 0.02, 0.3 * k, 0.018);
      } else if (surface === 'wood') {
        thump(v, t, 110, 60, 0.03, 0.55, 0.045); burst(v, t, { type: 'lowpass', f: 900, q: 0.7, tau: 0.03, amt: 0.4 });
        burst(v, t, { type: 'bandpass', f: 250, q: 5, tau: 0.05, amt: 0.3 });
        thump(v, toe, 120, 65, 0.03, 0.55 * k, 0.04); burst(v, toe, { type: 'lowpass', f: 1000, q: 0.7, tau: 0.025, amt: 0.4 * k });
      } else if (surface === 'metal') {
        burst(v, t, { type: 'bandpass', f: 2200, q: 2, tau: 0.03, amt: 0.4 }); ping(v, t, 1800, 0.2, 0.05); ping(v, t, 2700, 0.12, 0.03);
        thump(v, t, 150, 80, 0.02, 0.28, 0.025);
        burst(v, toe, { type: 'bandpass', f: 2500, q: 2, tau: 0.025, amt: 0.4 * k }); ping(v, toe, 2050, 0.2 * k, 0.045); thump(v, toe, 150, 80, 0.02, 0.28 * k, 0.02);
      } else {                                                          // grass: soft rustle
        burst(v, t, { type: 'highpass', f: 1500, q: 0.7, lp: 6000, a: 0.008, tau: 0.05, amt: 0.38 }); thump(v, t, 100, 60, 0.02, 0.22, 0.02);
        burst(v, toe, { type: 'highpass', f: 1800, q: 0.7, lp: 6000, a: 0.008, tau: 0.04, amt: 0.38 * k }); thump(v, toe, 100, 60, 0.02, 0.22 * k, 0.018);
      }
    };
  }
  ['stone', 'wood', 'metal', 'grass'].forEach(function (s) { def('footstep_' + s, footstep(s), { vol: 0.55, rolloff: 1.2, maxDist: 22, dur: 0.3 }); });

  def('jump', function (v, t) {
    burst(v, t, { type: 'highpass', f: 1200, q: 0.7, a: 0.015, tau: 0.06, amt: 0.3 });
    chirp(v, t, 180, 120, 0.08, 0.15, 0.01, 0, 0.05);
  }, { vol: 0.5, rolloff: 1.6, maxDist: 20, dur: 0.3 });

  def('land', function (v, t) {
    thump(v, t, 120, 45, 0.05, 0.6, 0.06); burst(v, t, { type: 'lowpass', f: 1500, q: 0.7, tau: 0.04, amt: 0.45 });
    thump(v, t + 0.06, 110, 50, 0.04, 0.3, 0.04); burst(v, t + 0.06, { type: 'lowpass', f: 1200, q: 0.7, tau: 0.03, amt: 0.2 });
  }, { vol: 0.5, rolloff: 1.6, maxDist: 24, dur: 0.4 });

  // ------------------------------------------------------------------------------------------------
  // Weapon handling
  // ------------------------------------------------------------------------------------------------
  var HANDLING = { vol: 0.7, rolloff: 1.6, maxDist: 18, dur: 0.3 };
  def('equip_pistol', function (v, t) {
    click(v, t, 0.4, 2500, 3, 0.008); ping(v, t, 3200, 0.12, 0.02);
    burst(v, t + 0.03, { type: 'bandpass', f: 1500, q: 1, a: 0.01, tau: 0.03, amt: 0.25 });
    click(v, t + 0.07, 0.4, 2700, 3, 0.008); thump(v, t + 0.07, 220, 120, 0.02, 0.2, 0.02);
  }, HANDLING);
  def('equip_rifle', function (v, t) {
    click(v, t, 0.5, 1800, 2, 0.012); thump(v, t, 140, 80, 0.03, 0.25, 0.03);
    burst(v, t + 0.02, { type: 'highpass', f: 1000, q: 0.7, a: 0.02, tau: 0.08, amt: 0.2 });
    click(v, t + 0.12, 0.35, 2200, 2, 0.012); thump(v, t + 0.12, 160, 90, 0.02, 0.2, 0.025);
  }, { vol: 0.6, rolloff: 1.6, maxDist: 18, dur: 0.4 });
  def('equip_knife', function (v, t) {
    chirp(v, t, 3000, 4200, 0.06, 0.25, 0.004, 0, 0.12); ping(v, t + 0.01, 5200, 0.1, 0.08);
    burst(v, t, { type: 'highpass', f: 4000, q: 0.7, a: 0.005, tau: 0.05, amt: 0.3 });
  }, { vol: 0.4, rolloff: 1.6, maxDist: 15, dur: 0.4 });
  def('reload_start', function (v, t) {
    click(v, t, 0.7, 2000, 2, 0.015); thump(v, t, 220, 120, 0.02, 0.25, 0.02); burst(v, t + 0.01, { type: 'bandpass', f: 800, q: 1, a: 0.02, tau: 0.05, amt: 0.3 });
  }, { vol: 0.7, rolloff: 1.5, maxDist: 22, dur: 0.25 });
  def('reload_mag_out', function (v, t) {
    click(v, t, 0.4, 2800, 3, 0.008);
    thump(v, t + 0.04, 200, 110, 0.03, 0.35, 0.04); burst(v, t + 0.04, { type: 'lowpass', f: 900, q: 0.7, tau: 0.04, amt: 0.3 });
  }, { vol: 0.55, rolloff: 1.5, maxDist: 22, dur: 0.3 });
  def('reload_mag_in', function (v, t) {
    burst(v, t, { type: 'bandpass', f: 700, q: 1, a: 0.015, tau: 0.04, amt: 0.3 });
    click(v, t + 0.07, 0.5, 2200, 2, 0.012); thump(v, t + 0.07, 180, 100, 0.02, 0.35, 0.03);
  }, { vol: 0.5, rolloff: 1.5, maxDist: 22, dur: 0.3 });
  def('reload_end', function (v, t) {                                 // bolt/slide rack: cha-chick
    click(v, t, 0.5, 2400, 2, 0.012); ping(v, t, 2900, 0.1, 0.03);
    burst(v, t + 0.02, { type: 'bandpass', f: 1200, q: 1, a: 0.01, tau: 0.05, amt: 0.25 });
    click(v, t + 0.11, 0.45, 2600, 2, 0.012); thump(v, t + 0.11, 200, 110, 0.02, 0.3, 0.03);
  }, { vol: 0.6, rolloff: 1.5, maxDist: 22, dur: 0.35 });
  def('dryfire', function (v, t) { click(v, t, 0.45, 3000, 3, 0.006); ping(v, t, 250, 0.15, 0.01); }, { vol: 0.7, rolloff: 1.6, maxDist: 15, dur: 0.1 });
  def('knife_swing', function (v, t) {
    var f = burst(v, t, { type: 'bandpass', f: 600, q: 1.5, f1: 1800, sw: 0.09, a: 0.04, tau: 0.06, amt: 0.6 });
    f.frequency.exponentialRampToValueAtTime(900 * v.pitch, t + 0.2);
  }, { vol: 0.9, rolloff: 1.5, maxDist: 25, dur: 0.35 });
  def('knife_hit', function (v, t) {
    thump(v, t, 150, 70, 0.03, 0.5, 0.04); burst(v, t, { type: 'lowpass', f: 1800, q: 0.7, tau: 0.03, amt: 0.45 }); ping(v, t, 2600, 0.12, 0.02);
  }, { vol: 0.5, rolloff: 1.5, maxDist: 30, dur: 0.25, ref: 3 });

  // ------------------------------------------------------------------------------------------------
  // Spike
  // ------------------------------------------------------------------------------------------------
  def('spike_pickup', function (v, t) {
    chirp(v, t, 880, 1320, 0.06, 0.22, 0.003, 0.02, 0.05, 'triangle'); click(v, t, 0.3, 2500, 2, 0.008); thump(v, t, 160, 90, 0.03, 0.25, 0.03);
  }, { vol: 0.55, rolloff: 1.4, maxDist: 25, dur: 0.3 });

  def('spike_plant_start', function (v, t) {                          // mechanical whir + servo ticks
    var g = v.gain(0), stop = v.env(g.gain, t, 0.3, 0.04, 0.12, 0.9), lp = v.filter('lowpass', 700, 1.5, g);
    var a = v.osc('sawtooth', 60, t, stop, lp), b = v.osc('sawtooth', 67, t, stop, lp);
    v.sweep(a.frequency, t, 60, t + 0.8, 180); v.sweep(b.frequency, t, 67, t + 0.8, 191);
    burst(v, t, { type: 'highpass', f: 2000, q: 0.7, a: 0.05, hold: 0.85, tau: 0.1, amt: 0.08 });
    for (var i = 1; i <= 3; i++) click(v, t + i * 0.3, 0.2, 3000, 3, 0.006);
  }, { vol: 0.45, rolloff: 1.3, maxDist: 35, dur: 1.7, ref: 3 });

  // Beep tone: sine + a little triangle for edge; holds `len` seconds then decays quickly.
  function beepTone(v, t, f, len) {
    var g = v.gain(0), stop = v.env(g.gain, t, 0.3, 0.003, 0.012, len);
    v.osc('sine', f, t, stop, g); var g2 = v.gain(0); v.env(g2.gain, t, 0.07, 0.003, 0.012, len); v.osc('triangle', f, t, stop, g2);
  }
  def('spike_beep', function (v, t) { beepTone(v, t, 1760, 0.05); beepTone(v, t + 0.09, 1320, 0.05); }, { vol: 0.55, rolloff: 0.5, maxDist: 120, dur: 0.25, period: 1.0, ref: 6 });
  def('spike_beep_fast', function (v, t) { beepTone(v, t, 2093, 0.035); beepTone(v, t + 0.055, 1568, 0.035); }, { vol: 0.55, rolloff: 0.5, maxDist: 120, dur: 0.15, period: 0.45, ref: 6 });

  def('spike_planted', function (v, t) {                              // bass drop + rising tone
    thump(v, t, 160, 35, 0.6, 0.7, 0.35);
    chirp(v, t + 0.05, 440, 880, 0.5, 0.22, 0.03, 0.1, 0.25, 'triangle');
    burst(v, t, { type: 'highpass', f: 3000, q: 0.7, a: 0.1, tau: 0.15, amt: 0.15 });
    v.reverb(0.4);
  }, { vol: 0.55, rolloff: 0.5, maxDist: 300, dur: 2.2, ref: 8 });

  def('spike_defuse_start', function (v, t, p) {                      // electric hum + crackle (sustains while loop:true)
    var hold = p && p.loop ? 30 : 1.3;
    var g = v.gain(0), stop = v.env(g.gain, t, 0.22, 0.03, 0.08, hold), bp = v.filter('bandpass', 300, 1.2, g);
    v.osc('sawtooth', 60, t, stop, bp); v.osc('sawtooth', 120.5, t, stop, bp);
    var amg = v.gain(0.06, g.gain); v.osc('square', 8, t, stop, amg);          // 8 Hz tremolo on the hum
    var cg = v.gain(0), cf = v.filter('highpass', 2500, 0.7, cg); v.noise(t, stop, cf);
    cg.gain.setValueAtTime(0, t);
    for (var tt = t + 0.05; tt < t + hold; tt += rnd(0.04, 0.16)) { cg.gain.setValueAtTime(rnd(0.05, 0.22), tt); cg.gain.setTargetAtTime(0, tt + 0.004, 0.006); }
  }, { vol: 0.5, rolloff: 1.3, maxDist: 40, dur: 2, sustain: true, ref: 3 });

  def('spike_defused', function (v, t) {                              // power-down
    chirp(v, t, 1760, 880, 0.25, 0.14, 0.005, 0, 0.1, 'triangle');
    var g = v.gain(0), stop = v.env(g.gain, t, 0.3, 0.01, 0.15, 0.7), lp = v.filter('lowpass', 1200, 1, g);
    var o = v.osc('sawtooth', 440, t, stop, lp); v.sweep(o.frequency, t + 0.05, 440, t + 0.95, 40); v.sweep(lp.frequency, t, 1200, t + 0.9, 200);
    click(v, t + 0.95, 0.25, 2000, 2, 0.01);
    v.reverb(0.25);
  }, { vol: 0.6, rolloff: 0.5, maxDist: 300, dur: 1.4, ref: 8 });

  def('spike_explode', function (v, t) {                              // huge boom + long rumble + high wash
    thump(v, t, 70, 22, 1.5, 0.9, 0.8);
    ping(v, t + 0.05, 32, 0.5, 1.4, 'sine', 0.05);
    burst(v, t, { type: 'lowpass', f: 3500, q: 0.6, f1: 300, sw: 2, a: 0.008, tau: 0.6, amt: 0.8 });
    burst(v, t, { type: 'highpass', f: 5000, q: 0.7, a: 0.15, tau: 0.9, amt: 0.3 });
    burst(v, t + 0.05, { type: 'lowpass', f: 120, q: 0.8, a: 0.05, tau: 1.6, amt: 0.7 });
    burst(v, t + 0.3, { type: 'bandpass', f: 1500, q: 0.8, a: 0.2, tau: 0.7, amt: 0.15 });
    v.reverb(0.7);
  }, { vol: 0.4, rolloff: 0.25, maxDist: 1000, dur: 5, ref: 20 });

  // ------------------------------------------------------------------------------------------------
  // Round / UI stings (non-positional in practice)
  // ------------------------------------------------------------------------------------------------
  def('round_start', function (v, t) {                                // short rising synth sting
    var g = v.gain(0), stop = v.env(g.gain, t, 0.22, 0.01, 0.25, 0.15), lp = v.filter('lowpass', 2500, 0.8, g);
    var a = v.osc('sawtooth', 440, t, stop, lp), b = v.osc('triangle', 440, t, stop, lp);
    v.sweep(a.frequency, t, 440, t + 0.12, 659.25); v.sweep(b.frequency, t, 440, t + 0.12, 659.25);
    ping(v, t + 0.12, 987.77, 0.1, 0.3, 'triangle', 0.01);
    burst(v, t, { type: 'highpass', f: 4000, q: 0.7, a: 0.1, tau: 0.15, amt: 0.1 });
    v.reverb(0.3);
  }, { vol: 0.5, dur: 1.6 });

  def('round_win', function (v, t) {                                  // bright major chord sting (C major, arpeggiated)
    var notes = [523.25, 659.25, 783.99, 1046.5], i;
    for (i = 0; i < notes.length; i++) {
      var tt = t + i * 0.04;
      ping(v, tt, notes[i], 0.18, 0.5, 'triangle', 0.005);
      var g = v.gain(0), stop = v.env(g.gain, tt, 0.07, 0.005, 0.4), lp = v.filter('lowpass', 3000, 0.7, g); v.osc('sawtooth', notes[i], tt, stop, lp);
    }
    burst(v, t, { type: 'highpass', f: 6000, q: 0.7, a: 0.05, tau: 0.25, amt: 0.08 });
    v.reverb(0.45);
  }, { vol: 0.5, dur: 3 });

  def('round_lose', function (v, t) {                                 // low minor sting (A minor)
    var notes = [110, 130.81, 164.81], i;
    var g = v.gain(0), stop = v.env(g.gain, t, 0.16, 0.02, 0.8), lp = v.filter('lowpass', 600, 1, g);
    for (i = 0; i < notes.length; i++) v.osc('sawtooth', notes[i], t, stop, lp);
    chirp(v, t, 220, 110, 1.2, 0.22, 0.02, 0.2, 0.6);
    thump(v, t, 80, 40, 0.3, 0.35, 0.3);
    v.reverb(0.4);
  }, { vol: 0.5, dur: 4.4 });

  def('buy', function (v, t) {                                        // click-confirm
    click(v, t, 0.3, 3000, 2, 0.006);
    ping(v, t, 1046.5, 0.2, 0.03, 'triangle', 0.003); ping(v, t + 0.06, 1568, 0.2, 0.05, 'triangle', 0.003);
  }, { vol: 0.6, dur: 0.3 });
  def('buy_error', function (v, t) {
    var g = v.gain(0), stop = v.env(g.gain, t, 0.18, 0.005, 0.02, 0.07), lp = v.filter('lowpass', 1000, 0.7, g); v.osc('square', 220, t, stop, lp);
    var g2 = v.gain(0), stop2 = v.env(g2.gain, t + 0.11, 0.18, 0.005, 0.03, 0.08), lp2 = v.filter('lowpass', 1000, 0.7, g2); v.osc('square', 196, t + 0.11, stop2, lp2);
  }, { vol: 0.6, dur: 0.35 });
  def('ui_hover', function (v, t) { click(v, t, 0.15, 4000, 2, 0.006); ping(v, t, 2500, 0.1, 0.008); }, { vol: 0.6, dur: 0.06 });
  def('ui_click', function (v, t) { click(v, t, 0.3, 3000, 2, 0.008); ping(v, t, 1800, 0.15, 0.02); }, { vol: 0.6, dur: 0.1 });
  def('ui_back', function (v, t) { chirp(v, t, 1200, 800, 0.06, 0.2, 0.003, 0, 0.03, 'triangle'); click(v, t, 0.2, 2500, 2, 0.006); }, { vol: 0.6, dur: 0.15 });

  def('queue_start', function (v, t) {
    ping(v, t, 880, 0.2, 0.15, 'triangle', 0.005); ping(v, t + 0.1, 1320, 0.2, 0.2, 'triangle', 0.005);
    var g = v.gain(0), stop = v.env(g.gain, t, 0.1, 0.2, 0.3, 0.1), lp = v.filter('lowpass', 1500, 0.7, g); v.osc('triangle', 440, t, stop, lp);
    v.reverb(0.4);
  }, { vol: 0.6, dur: 1.3 });

  def('match_found', function (v, t) {                                // three ascending notes + swell
    var notes = [523.25, 783.99, 1046.5], i;
    for (i = 0; i < 3; i++) {
      var tt = t + i * 0.16, last = (i === 2), tau = last ? 0.8 : 0.35, hold = last ? 0.2 : 0;
      var g = v.gain(0), stop = v.env(g.gain, tt, 0.16, 0.008, tau, hold), lp = v.filter('lowpass', 3000, 0.8, g);
      v.osc('sawtooth', notes[i], tt, stop, lp);
      var g2 = v.gain(0), stop2 = v.env(g2.gain, tt, 0.12, 0.008, tau, hold); v.osc('triangle', notes[i], tt, stop2, g2);
    }
    thump(v, t + 0.32, 90, 40, 0.15, 0.45, 0.25);
    burst(v, t, { type: 'highpass', f: 2000, q: 0.7, a: 0.4, tau: 0.4, amt: 0.12 });
    var chord = [261.63, 329.63, 392];
    for (i = 0; i < 3; i++) { var pg = v.gain(0), ps = v.env(pg.gain, t + 0.32, 0.08, 0.3, 0.6, 0.4); v.osc('triangle', chord[i], t + 0.32, ps, pg); }
    v.reverb(0.5);
  }, { vol: 0.5, dur: 4.8 });

  // ------------------------------------------------------------------------------------------------
  // Map events
  // ------------------------------------------------------------------------------------------------
  def('barrier_drop', function (v, t) {                               // whoosh + thud
    burst(v, t, { type: 'bandpass', f: 2500, q: 1, f1: 300, sw: 0.35, a: 0.06, tau: 0.1, amt: 0.4 });
    thump(v, t + 0.3, 100, 40, 0.1, 0.6, 0.12); burst(v, t + 0.3, { type: 'lowpass', f: 600, q: 0.7, tau: 0.06, amt: 0.3 }); click(v, t + 0.3, 0.2, 2000, 1, 0.006);
    v.reverb(0.3);
  }, { vol: 0.5, rolloff: 0.7, maxDist: 120, dur: 1.1, ref: 6 });

  def('door_move', function (v, t, p) {                               // motor hum (+ clank at the end unless looping)
    var hold = (p && p.loop) ? 30 : 1.4;
    var g = v.gain(0), stop = v.env(g.gain, t, 0.28, 0.05, 0.1, hold), lp = v.filter('lowpass', 400, 1.2, g);
    v.osc('sawtooth', 48, t, stop, lp); v.osc('sawtooth', 96.5, t, stop, lp);
    burst(v, t, { type: 'lowpass', f: 200, q: 0.8, a: 0.05, hold: hold, tau: 0.1, amt: 0.25 });
    if (!(p && p.loop)) {
      var te = t + hold + 0.05;
      metal(v, te, 1000, 0.3, 0.08, [1, 1.5, 2.29]); burst(v, te, { type: 'bandpass', f: 1500, q: 1, tau: 0.02, amt: 0.4 }); thump(v, te, 90, 45, 0.05, 0.4, 0.08);
    }
    v.reverb(0.15);
  }, { vol: 0.45, rolloff: 1, maxDist: 60, dur: 2.1, sustain: true, ref: 4 });

  def('door_close', function (v, t) {                                 // heavy clank + rattle
    thump(v, t, 90, 40, 0.08, 0.6, 0.1); metal(v, t, 700, 0.28, 0.15, [1, 1.5, 2.29]);
    burst(v, t, { type: 'bandpass', f: 1200, q: 1, tau: 0.03, amt: 0.45 });
    burst(v, t + 0.08, { type: 'bandpass', f: 2000, q: 1.5, tau: 0.02, amt: 0.2 }); burst(v, t + 0.14, { type: 'bandpass', f: 2200, q: 1.5, tau: 0.02, amt: 0.12 });
    v.reverb(0.3);
  }, { vol: 0.5, rolloff: 1, maxDist: 80, dur: 0.9, ref: 4 });

  def('door_break', function (v, t) {                                 // metal crunch
    for (var i = 0; i < 6; i++) burst(v, t + i * 0.05 + rnd(0, 0.02), { type: 'bandpass', f: rnd(800, 2400), q: 2, tau: 0.03, amt: rnd(0.4, 0.6) });
    var g = v.gain(0), stop = v.env(g.gain, t, 0.4, 0.01, 0.2), lp = v.filter('lowpass', 300, 1, g); v.osc('sawtooth', 55, t, stop, lp);
    metal(v, t + 0.02, 1100, 0.15, 0.2, [1, 1.55]); thump(v, t, 80, 35, 0.15, 0.7, 0.15);
    v.reverb(0.4);
  }, { vol: 0.55, rolloff: 1, maxDist: 100, dur: 1.4, ref: 4 });

  // ------------------------------------------------------------------------------------------------
  // Abilities / status
  // ------------------------------------------------------------------------------------------------
  def('ult_ready', function (v, t) {
    chirp(v, t, 1046.5, 2093, 0.3, 0.18, 0.01, 0, 0.4); ping(v, t + 0.05, 1568, 0.12, 0.4, 'triangle', 0.01);
    burst(v, t, { type: 'highpass', f: 6000, q: 0.7, a: 0.15, tau: 0.25, amt: 0.12 }); ping(v, t, 60, 0.3, 0.3, 'sine', 0.01);
    v.reverb(0.5);
  }, { vol: 0.45, dur: 2.1 });

  def('ability_dash', function (v, t) {                               // air whoosh
    var f = burst(v, t, { type: 'bandpass', f: 400, q: 1.2, f1: 3000, sw: 0.12, a: 0.03, tau: 0.12, amt: 0.5 });
    f.frequency.exponentialRampToValueAtTime(1200 * v.pitch, t + 0.35);
    burst(v, t, { type: 'highpass', f: 5000, q: 0.7, a: 0.01, tau: 0.08, amt: 0.2 });
    chirp(v, t, 200, 600, 0.15, 0.1, 0.02, 0, 0.15);
    v.reverb(0.15);
  }, { vol: 0.65, rolloff: 1.2, maxDist: 40, dur: 0.6, ref: 3 });

  def('ability_updraft', function (v, t) {
    burst(v, t, { type: 'bandpass', f: 300, q: 1.5, f1: 2500, sw: 0.45, a: 0.05, tau: 0.15, amt: 0.45 });
    chirp(v, t, 220, 880, 0.4, 0.15, 0.03, 0, 0.2, 'triangle');
    burst(v, t, { type: 'highpass', f: 3000, q: 0.7, a: 0.1, tau: 0.2, amt: 0.15 });
    v.reverb(0.2);
  }, { vol: 0.7, rolloff: 1.2, maxDist: 40, dur: 0.95, ref: 3 });

  def('ability_smoke', function (v, t) {                              // soft puff
    burst(v, t, { type: 'lowpass', f: 800, q: 0.7, a: 0.04, tau: 0.25, amt: 0.4 }); thump(v, t, 70, 45, 0.2, 0.3, 0.2);
    burst(v, t, { type: 'highpass', f: 2500, q: 0.7, a: 0.06, tau: 0.35, amt: 0.08 });
    v.reverb(0.2);
  }, { vol: 0.45, rolloff: 1.2, maxDist: 50, dur: 1.2, ref: 3 });

  def('ability_knives', function (v, t) {                             // metallic shimmer
    var parts = [3200, 4100, 5300, 6700, 8400];
    for (var i = 0; i < parts.length; i++) ping(v, t + i * 0.03, parts[i], 0.08, 0.25, 'sine', 0.004);
    burst(v, t, { type: 'highpass', f: 6000, q: 0.7, a: 0.04, tau: 0.3, amt: 0.15 });
    chirp(v, t, 2500, 5000, 0.15, 0.12, 0.005, 0, 0.2);
    v.reverb(0.5);
  }, { vol: 0.55, rolloff: 1.2, maxDist: 40, dur: 1.4, ref: 3 });

  def('ability_knife_throw', function (v, t) {
    burst(v, t, { type: 'bandpass', f: 2000, q: 2, f1: 6000, sw: 0.1, a: 0.005, tau: 0.05, amt: 0.4 }); ping(v, t, 4500, 0.12, 0.06); click(v, t, 0.2, 3000, 2, 0.004);
  }, { vol: 0.7, rolloff: 1.3, maxDist: 35, dur: 0.3 });

  def('low_health', function (v, t) {                                 // heartbeat: lub-dub (loop:true repeats every 0.95 s)
    thump(v, t, 60, 38, 0.06, 0.6, 0.09); burst(v, t, { type: 'lowpass', f: 300, q: 0.7, tau: 0.05, amt: 0.15 });
    thump(v, t + 0.18, 58, 36, 0.05, 0.45, 0.08); burst(v, t + 0.18, { type: 'lowpass', f: 280, q: 0.7, tau: 0.04, amt: 0.12 });
  }, { vol: 0.5, dur: 0.7, period: 0.95 });

  // ------------------------------------------------------------------------------------------------
  // Music: 'lobby' — Am F C G pad at 80 bpm, soft sub pulse + kick, sparse plucks into a dotted-8th delay.
  // Generated procedurally in 8th-note slots (pattern repeats every 8 bars), so it loops seamlessly forever.
  // ------------------------------------------------------------------------------------------------
  var MUSIC = {
    bpm: 80,
    chords: [ // pad voicing (Hz), sub root, pluck note pool
      { pad: [110, 130.81, 164.81, 220], sub: 55, pool: [440, 523.25, 659.25, 783.99, 880, 1046.5] },          // Am
      { pad: [87.31, 110, 130.81, 174.61], sub: 43.65, pool: [349.23, 440, 523.25, 659.25, 698.46, 880] },     // F
      { pad: [98, 130.81, 164.81, 196], sub: 65.41, pool: [392, 523.25, 587.33, 659.25, 783.99, 1046.5] },     // C
      { pad: [98, 123.47, 146.83, 196], sub: 49, pool: [392, 493.88, 587.33, 783.99, 880, 987.77] }            // G
    ]
  };
  function hash01(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function makePan(ctx, p) {
    if (ctx.createStereoPanner) { var s = ctx.createStereoPanner(); s.pan.value = p; return s; }
    return ctx.createGain();
  }

  Engine.prototype.setMusic = function (name) {
    var track = null;
    if (name) {
      track = (name === 'lobby' || name === 'agent_select') ? 'lobby' : null;
      if (!track) { warnOnce('m:' + name, 'unknown music "' + name + '" (playing lobby)'); track = 'lobby'; }
    }
    this.pendingMusic = null;
    var m = this.musicState;
    if (m && m.track === track) return;
    if (m) this.stopMusic(m, 1.0);
    if (!track) return;
    if (!this.offline && this.ctx.state !== 'running') { this.pendingMusic = track; return; }   // starts on 'running'
    this.musicState = this.startLobby();
  };

  Engine.prototype.startLobby = function () {
    var ctx = this.ctx, eng = this, t0 = ctx.currentTime + 0.05, beat = 60 / MUSIC.bpm, i;
    var out = ctx.createGain(); out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(0.7, t0 + 1.5); out.connect(this.nodes.musicBus);
    var send = ctx.createGain(); send.gain.value = 0.45; out.connect(send); send.connect(this.musicSend);
    var nodes = [out, send], sources = [];
    // pad: 4 detuned saws -> slowly moving lowpass
    var padGain = ctx.createGain(); padGain.gain.value = 0.085; padGain.connect(out);
    var padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 750; padLp.Q.value = 0.9; padLp.connect(padGain);
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    var lfoG = ctx.createGain(); lfoG.gain.value = 320; lfo.connect(lfoG); lfoG.connect(padLp.frequency); lfo.start(t0);
    nodes.push(padGain, padLp, lfoG, lfo); sources.push(lfo);
    var pads = [], det = [-7, 5, -4, 8], c0 = MUSIC.chords[0];
    for (i = 0; i < 4; i++) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = c0.pad[i]; o.detune.value = det[i];
      o.connect(padLp); o.start(t0); pads.push(o); sources.push(o); nodes.push(o);
    }
    // sub pulse
    var sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = c0.sub;
    var subG = ctx.createGain(); subG.gain.value = 0; sub.connect(subG); subG.connect(out); sub.start(t0); sources.push(sub); nodes.push(sub, subG);
    // plucks: bus -> lowpass -> dry (left-ish) + dotted-8th feedback delay (right-ish)
    var pluckBus = ctx.createGain(); pluckBus.gain.value = 0.16;
    var pluckLp = ctx.createBiquadFilter(); pluckLp.type = 'lowpass'; pluckLp.frequency.value = 3200; pluckLp.Q.value = 0.7; pluckBus.connect(pluckLp);
    var dryPan = makePan(ctx, -0.25), wetPan = makePan(ctx, 0.35); pluckLp.connect(dryPan); dryPan.connect(out);
    var dly = ctx.createDelay(1); dly.delayTime.value = beat * 0.75;
    var fb = ctx.createGain(); fb.gain.value = 0.42; var dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200; dlp.Q.value = 0.5;
    var wet = ctx.createGain(); wet.gain.value = 0.55;
    pluckLp.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(wet); wet.connect(wetPan); wetPan.connect(out);
    nodes.push(pluckBus, pluckLp, dryPan, wetPan, dly, fb, dlp, wet);
    // drums
    var drumG = ctx.createGain(); drumG.gain.value = 0.5; drumG.connect(out); nodes.push(drumG);

    var m = { track: 'lobby', out: out, nodes: nodes, sources: sources, pads: pads, sub: sub, subG: subG, pluckBus: pluckBus, drumG: drumG,
      beat: beat, slot: 0, nextT: t0, chord: -1, lastPluck: -9, timer: null };
    if (this.offline) this.scheduleMusic(m, ctx.length / ctx.sampleRate + 1);
    else { this.scheduleMusic(m, ctx.currentTime + 0.6); m.timer = setInterval(function () { eng.scheduleMusic(m, ctx.currentTime + 0.6); }, 120); }
    return m;
  };
  Engine.prototype.scheduleMusic = function (m, until) {
    while (m.nextT < until) { this.musicSlot(m, m.slot, m.nextT); m.slot++; m.nextT += m.beat / 2; }
  };
  Engine.prototype.musicSlot = function (m, slot, t) {
    var bar = Math.floor(slot / 8), ci = bar % 4, ch = MUSIC.chords[ci], inBar = slot % 8, beat = inBar >> 1, off = inBar & 1, i;
    if (inBar === 0 && m.chord !== ci) {
      m.chord = ci;
      for (i = 0; i < 4; i++) m.pads[i].frequency.setTargetAtTime(ch.pad[i], t, 0.06);
      m.sub.frequency.setTargetAtTime(ch.sub, t, 0.05);
    }
    if (!off) {
      m.subG.gain.setTargetAtTime(0.3, t, 0.015); m.subG.gain.setTargetAtTime(0.05, t + 0.06, 0.35);
      if (beat === 0 || beat === 2) this.musicKick(m, t);
      else this.musicHat(m, t, 0.05, 0.03);
    } else this.musicHat(m, t, 0.028, 0.018);
    var s = slot % 64, r = hash01(s);                     // deterministic per position -> repeats every 8 bars
    if (r < 0.34 && m.lastPluck !== slot - 1) {
      var note = ch.pool[Math.floor(hash01(s + 100) * ch.pool.length) % ch.pool.length];
      this.musicPluck(m, t, note, 0.6 + hash01(s + 200) * 0.5); m.lastPluck = slot;
    }
  };
  Engine.prototype.musicKick = function (m, t) {
    var ctx = this.ctx, g = ctx.createGain(), o = ctx.createOscillator();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.09);
    o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    o.connect(g); g.connect(m.drumG); o.start(t); o.stop(t + 0.8);
  };
  Engine.prototype.musicHat = function (m, t, amp, tau) {
    var ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter(), s = ctx.createBufferSource();
    f.type = 'highpass'; f.frequency.value = 7500; f.Q.value = 0.7;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, tau);
    s.buffer = this.noiseBuf; s.loop = true; s.connect(f); f.connect(g); g.connect(m.drumG); s.start(t, rnd(0, 1.5)); s.stop(t + 0.002 + tau * 8 + 0.01);
  };
  Engine.prototype.musicPluck = function (m, t, f, amp) {
    var ctx = this.ctx, g = ctx.createGain(), a = ctx.createOscillator(), b = ctx.createOscillator(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.22);
    a.type = 'triangle'; a.frequency.value = f; b.type = 'sine'; b.frequency.value = f * 2; g2.gain.value = 0.35;
    a.connect(g); b.connect(g2); g2.connect(g); g.connect(m.pluckBus);
    var stop = t + 0.004 + 0.22 * 8 + 0.01; a.start(t); b.start(t); a.stop(stop); b.stop(stop);
  };
  Engine.prototype.stopMusic = function (m, fade) {
    var t = this.ctx.currentTime, i;
    if (m.timer) clearInterval(m.timer); m.timer = null;
    if (this.musicState === m) this.musicState = null;
    m.out.gain.cancelScheduledValues(t); m.out.gain.setValueAtTime(m.out.gain.value, t); m.out.gain.setTargetAtTime(0, t, fade / 3.5);
    var stopAt = t + fade + 0.8;                          // ~ -55 dB by then
    for (i = 0; i < m.sources.length; i++) { try { m.sources[i].stop(stopAt); } catch (e) {} }
    if (this.offline) return;
    setTimeout(function () { disposeList(m.nodes); }, (fade + 1.0) * 1000);
  };

  // ------------------------------------------------------------------------------------------------
  // Public facade
  // ------------------------------------------------------------------------------------------------
  var engine = null, pendingVol = null;
  function makeEngine(ctx) {
    var eng = new Engine(ctx, !!(OAC && ctx instanceof OAC));
    if (!eng.offline && ctx.addEventListener) {
      ctx.addEventListener('statechange', function () {
        if (ctx.state === 'running') { eng.updateListener(); if (eng.pendingMusic) { var tr = eng.pendingMusic; eng.pendingMusic = null; eng.setMusic(tr); } }
      });
    }
    return eng;
  }
  var Audio = {
    NAMES: Object.keys(SOUNDS),
    SOUNDS: SOUNDS,
    config: CONFIG,
    init: function (customCtx) {
      if (engine) { if (!engine.offline && engine.ctx.state !== 'running' && engine.ctx.resume) engine.ctx.resume().catch(noop); return true; }
      var ctx = customCtx;
      if (!ctx) {
        if (!AC) { warnOnce('noAC', 'WebAudio not supported in this browser'); return false; }
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return false; } }
      }
      engine = makeEngine(ctx);
      if (pendingVol) { engine.setVolume(pendingVol); pendingVol = null; }
      if (!engine.offline) {
        if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch(noop);
        var kick = function () { if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(noop); };
        ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, kick, { passive: true }); });
      }
      return true;
    },
    setListener: function (pos, fwd) { if (engine) engine.setListener(pos, fwd); },
    play: function (name, opts) { return engine ? engine.play(name, opts) : DUMMY; },
    music: function (name) { if (engine) engine.setMusic(name || null); },
    setVolume: function (o) {
      if (engine) engine.setVolume(o);
      else { pendingVol = pendingVol || {}; if (o) for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) pendingVol[k] = o[k]; }
    },
    get ready() { return !!engine && (engine.offline || engine.ctx.state === 'running'); },
    get context() { return engine ? engine.ctx : null; },
    get engine() { return engine; },
    activeVoices: function () { return engine ? engine.all.length : 0; },
    createEngine: function (ctx) { return makeEngine(ctx); }   // e.g. bind to an OfflineAudioContext for tests
  };
  window.VAL.Audio = Audio;
})();
