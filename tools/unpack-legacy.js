#!/usr/bin/env node
/*
 * tools/unpack-legacy.js
 * ---------------------------------------------------------------------------
 * The upstream repo shipped the whole game as one 13 MB "PLAY VALORANT.html":
 * a concatenated bundle with a `/* ---- js/<path> ---- *\/` marker in front of
 * every original source file, an inline <style> block, the markup and two
 * giant base64 payloads (GLB character rigs + agent portrait art).
 *
 * This script unpacks that blob back into a real, deployable project layout:
 *
 *   src/index.html              shell page (proper doctype/head/body)
 *   src/css/game.css            the inline <style> block
 *   src/js/**                   every marked JS module, verbatim
 *   src/js/data/assets.js       tiny manifest: key -> public asset URL
 *   src/assets/models/*.glb     binary rigs (was base64 inside the HTML)
 *   src/assets/ui/*             menu art + minimap
 *   src/assets/agents/*.webp    Riot agent portraits
 *
 * Base64 -> binary costs ~25 % of the transfer weight and lets Vercel's CDN
 * cache each asset individually instead of re-fetching 13 MB of HTML.
 *
 * Run from the repo root:  node tools/unpack-legacy.js [--force]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEGACY = path.join(ROOT, 'VALORANT', 'PLAY VALORANT.html');
const SRC = path.join(ROOT, 'src');
const FORCE = process.argv.includes('--force');

const MIME_EXT = {
  'model/gltf-binary': 'glb',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const stats = { files: 0, bytes: 0, extracted: [] };

function writeOut(rel, content) {
  const abs = path.join(SRC, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && !FORCE) {
    throw new Error(`refusing to overwrite ${rel} (pass --force)`);
  }
  fs.writeFileSync(abs, content);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  stats.files++;
  stats.bytes += buf.length;
  return buf.length;
}

/* ------------------------------------------------------------------ helpers */

/** Find every `key: "data:<mime>;base64,<payload>"` occurrence in a string. */
function findDataURIs(text, from = 0, to = text.length) {
  const found = [];
  let p = from;
  while (true) {
    p = text.indexOf('"data:', p);
    if (p === -1 || p >= to) break;
    const end = text.indexOf('"', p + 6);
    if (end === -1) break;
    const uri = text.slice(p + 1, end);
    const m = uri.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i);
    const keyMatch = text.slice(Math.max(0, p - 120), p).match(/([A-Za-z0-9_$]+)\s*:\s*$/);
    if (m) {
      found.push({
        key: keyMatch ? keyMatch[1] : null,
        mime: m[1],
        b64: uri.slice(m[0].length),
        start: p,
        end,
      });
    }
    p = end;
  }
  return found;
}

/** Nearest preceding `"<name>":` token - used to name extracted images. */
function precedingKey(text, pos, n = 240) {
  const win = text.slice(Math.max(0, pos - n), pos);
  const all = win.match(/"([A-Za-z0-9_]+)"\s*:\s*$/);
  return all ? all[1] : null;
}

/* --------------------------------------------------------------------- main */

function main() {
  if (!fs.existsSync(LEGACY)) {
    console.error(`legacy bundle not found at ${path.relative(ROOT, LEGACY)}`);
    process.exit(1);
  }
  const html = fs.readFileSync(LEGACY, 'utf8');
  const log = [];

  /* ---- CSS ---------------------------------------------------------- */
  const styleOpen = html.indexOf('>', html.indexOf('<style>')) + 1;
  const styleClose = html.indexOf('</style>');
  const css = html.slice(styleOpen, styleClose).replace(/^\r?\n/, '');
  log.push(['css/game.css', writeOut('css/game.css', css)]);

  /* ---- body markup --------------------------------------------------- */
  const bodyOpen = styleClose + '</style>'.length;
  const bodyClose = html.indexOf('<script>', bodyOpen);
  const body = html.slice(bodyOpen, bodyClose).trim();

  /* ---- inline <script> blocks, in document order --------------------- */
  const blocks = [];
  const markerRe = /\/\* ---- (js\/[A-Za-z0-9_./-]+) ---- \*\/\r?\n/g;
  let m;
  while ((m = markerRe.exec(html))) {
    const open = html.lastIndexOf('<script>', m.index);
    const close = html.indexOf('</script>', m.index);
    blocks.push({
      rel: m[1],
      body: html.slice(m.index + m[0].length, close).replace(/\r?\n$/, ''),
      range: [open, close + '</script>'.length],
    });
  }
  const scriptTagEnd = html.lastIndexOf('</script>');

  /* ---- payload manifest: __VAL_ASSETS -------------------------------- */
  const assetsIdx = html.indexOf('window.__VAL_ASSETS');
  const assetsLineEnd = html.indexOf('\n', assetsIdx);
  const assetsLine = html.slice(assetsIdx, assetsLineEnd);
  const uris = findDataURIs(assetsLine);
  const manifest = {};
  for (const u of uris) {
    if (!u.key) throw new Error('unnamed asset key in __VAL_ASSETS');
    const ext = MIME_EXT[u.mime] || 'bin';
    const rel = u.key === 'menuBg' || u.key === 'minimap'
      ? `assets/ui/${u.key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}.${ext}`
      : `assets/models/${u.key}.${ext}`;
    const buf = Buffer.from(u.b64, 'base64');
    writeOut(rel, buf);
    manifest[u.key] = rel;
    log.push([rel, buf.length, `(${u.mime}, base64 ${u.b64.length} chars)`]);
  }

  /* ---- agent portraits, extracted out of ui/agent_art.js ------------- */
  const artBlock = blocks.find((b) => b.rel.endsWith('agent_art.js'));
  let agentArt = artBlock ? artBlock.body : null;
  if (agentArt) {
    const art = findDataURIs(agentArt);
    // the only `"word": {` tokens in that literal are agent ids, so the nearest
    // preceding one is the owner of the portrait
    const idRe = /"([a-z_0-9]+)":\s*\{/g;
    const ids = [];
    let im;
    while ((im = idRe.exec(agentArt))) ids.push({ at: im.index, id: im[1] });
    const seen = {};
    // plan every swap against the pristine offsets first...
    const plan = art.map((u) => {
      const field = precedingKey(agentArt, u.start) || 'art';
      const owner = ids.filter((x) => x.at < u.start).pop();
      if (!owner) throw new Error(`agent art with no owner at ${u.start}`);
      const ext = MIME_EXT[u.mime] || 'webp';
      let name = `${owner.id}_${field}`;
      if (seen[name]) name = `${name}_${++seen[name]}`; else seen[name] = 1;
      return { u, rel: `assets/agents/${name}.${ext}` };
    });
    // ...then apply them back-to-front, because replacing a multi-megabyte
    // literal with a short URL invalidates every offset after it, never before
    for (const { u, rel } of [...plan].reverse()) {
      const buf = Buffer.from(u.b64, 'base64');
      const bytes = writeOut(rel, buf);
      log.push([rel, bytes]);
      agentArt =
        agentArt.slice(0, u.start) + `"${rel}"` + agentArt.slice(u.end + 1);
    }
  }

  /* ---- write every JS module ---------------------------------------- */
  for (const b of blocks) {
    if (b.rel.endsWith('agent_art.js') && agentArt) {
      log.push([b.rel, writeOut(b.rel, agentArt)]);
    } else {
      log.push([b.rel, writeOut(b.rel, b.body)]);
    }
  }

  /* ---- generated manifest module ------------------------------------ */
  const manifestJs =
    '/* GENERATED by tools/unpack-legacy.js - do not edit by hand.\n' +
    ' * Asset URLs instead of the 11 MB of base64 the single-file build carried\n' +
    ' * inline: the CDN caches them forever and gzip stops mattering. */\n' +
    'window.VAL = window.VAL || {};\n' +
    'window.__VAL_ASSETS = ' +
    JSON.stringify(
      {
        models: Object.fromEntries(
          Object.entries(manifest)
            .filter(([k]) => k === 'male' || k === 'female' || k === 'anims')
            .map(([k, v]) => [k, v])
        ),
        menuBg: manifest.menuBg || null,
        minimap: manifest.minimap || null,
      },
      null,
      2
    ) +
    ';\n';
  log.push(['js/data/assets.js', writeOut('js/data/assets.js', manifestJs)]);

  /* ---- index.html ---------------------------------------------------- */
  const scripts = ['js/lib/three.min.js', 'js/lib/GLTFLoader.js', 'js/lib/SkeletonUtils.js',
    'js/data/assets.js', 'js/core/util.js', 'js/core/input.js', 'js/core/textures.js', 'js/map/instances.js',
    'js/core/audio.js', 'js/weapons/data.js', 'js/weapons/models.js', 'js/map/scenery.js',
    'js/map/scenery_props.js', 'js/map/ascent_data.js', 'js/map/dressing.js',
    'js/map/ascent.js', 'js/map/nav.js', 'js/entities/character4.js', 'js/entities/player.js',
    'js/entities/bot.js', 'js/game/combat.js', 'js/game/brain.js', 'js/game/abilities.js',
    'js/game/match.js', 'js/ui/hud.js', 'js/ui/buymenu.js', 'js/ui/agent_art.js',
    'js/ui/lobby.js', 'js/main.js'].filter((rel) =>
      blocks.some((b) => b.rel === rel) || rel === 'js/data/assets.js'
    );
  const extra = blocks.map((b) => b.rel).filter((r) => !scripts.includes(r) && !r.includes('lib/'));
  const order = [...scripts, ...extra];

  const head =
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#0f1923">\n' +
    '<meta name="description" content="VALORANT Ascent - a browser 5v5 tactical shooter fan recreation. Free to play, no install.">\n' +
    '<title>VALORANT Ascent - play in your browser</title>\n' +
    '<link rel="icon" href="assets/ui/favicon.svg" type="image/svg+xml">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@500;600;700;800&family=Anton&display=swap">\n' +
    '<link rel="stylesheet" href="css/game.css">\n' +
    '</head>\n<body>\n';
  const tail =
    '\n' +
    order.map((rel) => `<script src="${rel}"></script>`).join('\n') +
    '\n</body>\n</html>\n';
  log.push(['index.html', writeOut('index.html', head + body + tail)]);

  console.log(`wrote ${stats.files} files, ${(stats.bytes / 1048576).toFixed(2)} MB into src/\n`);
  for (const [rel, bytes, note] of log) {
    console.log(`${String((bytes / 1024).toFixed(1)).padStart(9)} KB  src/${rel}${note ? ' ' + note : ''}`);
  }
}

main();
