#!/usr/bin/env node
/**
 * Assembles `public/` for static hosting (Vercel, Netlify, GitHub Pages, nginx).
 *
 * `src/` is already a complete site - index.html, css/, js/, assets/ - loaded by
 * plain <script> tags, so there is nothing to bundle. This step only
 *  - copies the tree,
 *  - minifies the hand-written JS and CSS when esbuild is installed (it is a
 *    devDependency; without it the build still succeeds and just copies),
 *  - and fails loudly if index.html points at a file that is not there, which is
 *    the one way a static deploy of this project can come up blank.
 *
 * Usage:  node tools/build.js [--out public] [--no-minify] [--quiet]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
};

const SRC = path.join(ROOT, 'src');
const OUT = path.resolve(ROOT, String(arg('out', 'public')));
const QUIET = !!arg('quiet', false);

// Vendored libraries are already minified and re-minifying them is slow for no gain.
const ALREADY_MIN = new Set([
  path.join('js', 'lib', 'three.min.js'),
  path.join('js', 'lib', 'GLTFLoader.js'),
  path.join('js', 'lib', 'SkeletonUtils.js'),
]);

let esbuild = null;
if (!arg('no-minify', false)) {
  try { esbuild = require('esbuild'); } catch (e) { /* optional */ }
}

const fmt = (n) => n.toLocaleString('en-US');
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

function walk(dir, rel, into) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(abs, r, into);
    else if (ent.isFile()) into.push(r);
  }
  return into;
}

function transform(rel, code) {
  if (!esbuild) return code;
  const ext = path.extname(rel);
  if (ext !== '.js' && ext !== '.css') return code;
  if (ALREADY_MIN.has(rel)) return code;
  try {
    return esbuild.transformSync(code, {
      loader: ext === '.css' ? 'css' : 'js',
      minify: true,
      legalComments: 'none',
      target: ['es2019'],
    }).code;
  } catch (e) {
    throw new Error(`minifying ${rel}: ${e.message}`);
  }
}

/** Every local href/src in index.html must exist in the output. */
function checkReferences(htmlRel) {
  const html = fs.readFileSync(path.join(OUT, htmlRel), 'utf8');
  const missing = [];
  const re = /(?:src|href)=["']([^"'#?]+)["']/g;
  let m;
  while ((m = re.exec(html))) {
    const ref = m[1];
    if (/^(https?:|data:|mailto:|\/\/)/.test(ref)) continue;
    const target = path.join(OUT, path.normalize(ref.replace(/^\//, '')));
    if (!fs.existsSync(target)) missing.push(ref);
  }
  return missing;
}

function main() {
  if (!fs.existsSync(SRC)) throw new Error(`no src/ directory at ${SRC}`);
  const files = walk(SRC, '', []);

  // Refuse to wipe a directory we did not create.
  if (fs.existsSync(OUT)) {
    const mine = fs.existsSync(path.join(OUT, '.buildstamp'));
    const empty = fs.readdirSync(OUT).length === 0;
    if (!mine && !empty) {
      throw new Error(`${path.relative(ROOT, OUT)} exists and was not produced by this script - delete it by hand if that is what you want`);
    }
    fs.rmSync(OUT, { recursive: true, force: true });
  }

  let bytesIn = 0, bytesOut = 0, minified = 0;
  for (const rel of files) {
    const from = path.join(SRC, rel);
    const to = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const raw = fs.readFileSync(from);
    bytesIn += raw.length;
    let out = raw;
    if (esbuild && (rel.endsWith('.js') || rel.endsWith('.css')) && !ALREADY_MIN.has(rel)) {
      const code = transform(rel, raw.toString('utf8'));
      out = Buffer.from(code, 'utf8');
      if (out.length < raw.length) minified++;
    }
    fs.writeFileSync(to, out);
    bytesOut += out.length;
  }

  const missing = checkReferences('index.html');
  if (missing.length) {
    throw new Error('index.html references files that are not in the build:\n  ' + missing.join('\n  '));
  }

  fs.writeFileSync(path.join(OUT, '.buildstamp'), JSON.stringify({
    built: new Date().toISOString(),
    files: files.length,
    bytes: bytesOut,
    minified: !!esbuild,
  }, null, 2) + '\n');

  if (!QUIET) {
    console.log(`build: ${files.length} files, ${mb(bytesIn)} -> ${mb(bytesOut)}${esbuild ? ` (${minified} minified${bytesIn ? ', ' + Math.round((1 - bytesOut / bytesIn) * 100) + '% smaller' : ''})` : ' (copy only - esbuild not installed)'}`);
    console.log(`output: ${path.relative(ROOT, OUT)}/`);
  }
}

try {
  main();
} catch (e) {
  console.error('build failed: ' + e.message);
  process.exit(1);
}
