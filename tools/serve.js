#!/usr/bin/env node
/**
 * Dependency-free static server for local play and for containers that want a
 * `start` script (Vercel itself serves `public/` directly and never runs this).
 *
 *   node tools/serve.js --root public            # the built site
 *   node tools/serve.js --root src --dev         # serve sources, no build step
 *
 * Binds 0.0.0.0 and answers any Host header, so it also works behind a proxy.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const ROOT_DEFAULT = 'public';
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const root = path.resolve(__dirname, '..', String(arg('root', ROOT_DEFAULT)));
let port = Number(arg('port', process.env.PORT || 3000));
const dev = !!arg('dev', false);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Long-lived for immutable content, revalidate for everything else.
const IMMUTABLE = /^\/(assets|js\/lib)\//;

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname);
  } catch (e) {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname.indexOf('\0') >= 0) { res.writeHead(400).end('bad request'); return; }

  let file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
      err = fs.existsSync(file) ? null : new Error('missing');
    }
    if (err) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset=utf-8><title>404</title>
<body style="background:#0f1923;color:#e7edf3;font:16px/1.6 system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:28px;letter-spacing:.12em">404</h1>
<p style="opacity:.7">${path.basename(pathname)} is not in ${path.relative(process.cwd(), root)}/.<br>
Run <code>npm run build</code> first, or use <code>npm run dev</code>.</p></div>`);
      return;
    }
    fs.readFile(file, (e2, buf) => {
      if (e2) { res.writeHead(500).end('read error'); return; }
      const ext = path.extname(file).toLowerCase();
      const cache = dev ? 'no-store'
        : IMMUTABLE.test(pathname) ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate';
      res.writeHead(200, {
        'content-type': TYPES[ext] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': cache,
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
});

if (!fs.existsSync(root)) {
  console.error(`serve: ${root} does not exist - run "npm run build" (or use --root src)`);
  process.exit(1);
}

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE' || tries >= 8) {
    console.error(`serve: ${e.code === 'EADDRINUSE' ? `port ${port} is busy` : e.message}`);
    process.exit(1);
  }
  tries++;                       // another dev server is up: move along, do not fail
  port = port + 1;
  server.listen(port, '0.0.0.0');
});

let tries = 0;
server.listen(port, '0.0.0.0', () => {
  console.log(`serving ${path.relative(process.cwd(), root) || '.'} on http://0.0.0.0:${port} (${dev ? 'dev, no caching' : 'prod caching'})`);
});
