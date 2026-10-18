#!/usr/bin/env node
// A title played on this machine: its page at http://127.0.0.1:8002/, its Remake where it has one, and an Original for
// each game's data beside it (/?way=original, or with more than one /?game=<name>), on the browser's own player's
// disk; each file sent with `Cache-Control: no-cache` so that a refresh asks for every module again. The folder holds
// the title's folder, title/ (title.js, its scenes, compiled/), if it is remade, and its games' data, <name>.json
// each, or for a title of its own engine data/; the @moonbase-machines packages are served from node_modules at
// /packages/, where the page's import map finds them. A folder with an index.html of its own is served as it is.
//
//   moonbase-play [folder] [port] [host]     the folder (play/ unless given)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [folder = 'play', port = 8002, host = '127.0.0.1'] = process.argv.slice(2);
const root = resolve(folder) + sep, packages = resolve('node_modules/@moonbase-machines') + sep;
// (what a browser shows rather than downloads; anything else, a disk image among them, as bytes)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.scene': 'text/plain; charset=utf-8' };
const PACKAGES = ['mos6502', 'charset', 'c64', 'apple2e', 'vector', 'player'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// the page: the title's name, its ways, the player
async function page() {
  const remade = existsSync(join(root, 'title', 'title.js'));
  const title = remade ? (await import(pathToFileURL(join(root, 'title', 'title.js')).href)).default : null;
  // (its games: each <name>.json beside the title, its data, and the title's own first)
  const games = await Promise.all(readdirSync(root).filter(f => f.endsWith('.json') && f !== 'package.json').sort((a, b) => (b === title?.slug + '.json') - (a === title?.slug + '.json') || a.slice(0, -5).localeCompare(b.slice(0, -5)))
    .map(async f => ({ name: f.slice(0, -5), data: f, game: JSON.parse(await readFile(join(root, f), 'utf8')) })));
  const slug = title?.slug ?? games[0]?.name, name = title?.name ?? games[0]?.game.title ?? slug;
  // (the ways: the remake, its data the title's own or, for a title of its own engine, data/; an original for each game)
  const ways = [...(title ? [{ label: 'Remake', search: '', module: 'remake/main.js', data: existsSync(join(root, slug + '.json')) ? slug + '.json' : 'data/' }] : []),
    ...games.map((g, i) => ({ label: games.length > 1 ? g.game.title : 'Original', search: !title && !i ? '' : games.length > 1 ? `?game=${g.name}` : '?way=original', module: 'original.js', data: g.data }))];
  const map = { imports: Object.fromEntries(PACKAGES.map(p => [`@moonbase-machines/${p}/`, `/packages/${p}/`])) };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<link rel="stylesheet" href="/packages/player/player.css">
<style>body { margin: 0; font: 17px/1.6 system-ui, sans-serif; color: #1b2233; background: #fbf9f4; } main { max-width: 1000px; margin: 0 auto; padding: 16px; } h1 { font-size: 28px; margin: 0 0 8px; } nav a { margin-right: 14px; } nav a[aria-current] { font-weight: 600; color: inherit; text-decoration: none; }</style>
<script type="importmap">${JSON.stringify(map)}</script>
</head>
<body>
<main>
<h1>${esc(name)}</h1>
${ways.length > 1 ? `<nav>${ways.map(w => `<a href="/${w.search}">${esc(w.label)}</a>`).join('')}</nav>` : ''}
<section id="player"></section>
</main>
<script type="module">
const ways = ${JSON.stringify(ways)};
const way = ways.find(w => w.search === location.search) ?? ways[0];
for (const a of document.querySelectorAll('nav a')) if (a.search === way.search) a.setAttribute('aria-current', 'page');
const [{ play }, { openDisk, titleDisk }] = await Promise.all([import('@moonbase-machines/player/' + way.module), import('@moonbase-machines/player/disk/disk.js')]);
const at = path => new URL(path, location.origin + '/').href;
await play({ title: at('title/'), data: at(way.data), root: document.getElementById('player'), disk: await openDisk(titleDisk(${JSON.stringify(slug)})),
  words: { printer: { line: 'What the printer has printed.', print: 'Print', tear: 'Tear off' } } });
</script>
</body>
</html>
`;
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    if ((path === sep || path === sep + 'index.html') && !existsSync(join(root, 'index.html'))) {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }).end(await page());
      return;
    }
    let file = path.startsWith(sep + 'packages' + sep) ? join(packages, path.slice(10)) : join(root, path);
    if (![root, packages].some(r => file.startsWith(r))) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: ' + path + (err.code === 'ENOENT' ? '' : '\n' + err.message)); }
}).listen(+port, host, () => console.log(`http://${host}:${port}/`));
