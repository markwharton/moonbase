// A title loaded from its folder, as a page gives the player its address: its title.js, the modules it names, its
// view's drawing, its scenes compiled as they are read or their text, its game's data; a program the driver says is on
// the disk, made from it, and with `fixed` the title's fixes made first; a title whose engine is its own, its module
// loaded and no scripts; a vector title's code files at the addresses its map gives. From files the tests write.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadTitle } from '@moonbase-machines/player/remake/load.js';
import { codeFiles } from '@moonbase-machines/player/remake/vector.js';
import { make } from '@moonbase-machines/c64/d64.js';
import { crunch } from '@moonbase-machines/c64/basic-lang.js';

// a title's folder and its data, written: each file a name and its text
function folder(files) {
  const at = mkdtempSync(join(tmpdir(), 'title-'));
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(at, name, '..'), { recursive: true }); writeFileSync(join(at, name), text); }
  return pathToFileURL(at + '/');
}

test('a title from its folder: its title.js, its modules, its view, its scenes compiled as they are read, and its data', async () => {
  const at = folder({
    'title/title.js': "export default { slug: 'one', engine: 'card', scripts: ['start'], start: 'start', modules: ['problems'], view: true, map: { routines: { 0x800: 'char' } } };",
    'title/problems.js': 'export default { 1: "the first" };',
    'title/view.js': 'export default { char() {} };',
    'title/start.scene': '0800  a = 1\n0802  x = a\n',
    'one.json': JSON.stringify({ kind: 'dos33', saves: { volume: 'DISK', dos: 'dos33' }, volumes: { DISK: {} } }),
  });
  const { title, scripts, disk } = await loadTitle(new URL('title/', at), { data: new URL('one.json', at) });
  assert.equal(title.slug, 'one');
  assert.deepEqual(title.map.routines, { 0x800: 'char' }, 'its map, its own');
  assert.deepEqual(title.problems, { 1: 'the first' });
  assert.equal(typeof title.viewSteps.char, 'function', 'its view\'s drawing');
  assert.equal(scripts.start.steps.length, 2, 'the scene compiled: its steps');
  assert.equal(typeof scripts.start.run[0], 'function', 'and its blocks, functions');
  assert.deepEqual(disk.saves, { volume: 'DISK', dos: 'dos33' }, 'its data, its saves with it');
  const raw = await loadTitle(new URL('title/', at), { data: new URL('one.json', at), interpret: true });
  assert.deepEqual(raw.scripts, { start: '0800  a = 1\n0802  x = a\n' }, 'or the scenes\' text, to run line by line');
});

// a BASIC program as a file on a disk: its lines crunched to BASIC's bytes at $0801, the load address first
function basicFile(lines) {
  const out = [0x01, 0x08];
  let at = 0x0801;
  for (const [n, text] of lines) { const bytes = crunch(Uint8Array.from(text, c => c.charCodeAt(0))), next = at + 4 + bytes.length; out.push(next & 0xff, next >> 8, n & 0xff, n >> 8, ...bytes); at = next; }
  out.push(0, 0);
  return Uint8Array.from(out);
}

test('a program the driver says is on the disk: made from it as it is read, and with `fixed` the title\'s fixes made first', async () => {
  const image = make({ name: 'TWO', files: [{ name: 'BOOT', data: basicFile([[10, 'PRINT "HELLO"'], [20, 'GOTO 10']]) }] });
  const at = folder({
    'title/title.js': "export default { slug: 'two', engine: 'card', io: [0xd000, 0xffff], scripts: ['boot'], start: 'boot', basic: { boot: { program: { file: 'BOOT', at: 0x0801 } } }, fixed: { boot: 'boot-fixed' }, fixes: 'fixes', map: { c64: true, routines: {} } };",
    'title/fixes.js': "export function fixed(statements, render) { return statements.map(s => s.k === 'goto' ? { ...s, to: { missing: 30 } } : s); }",
    'two.json': JSON.stringify({ kind: 'c64', image: Buffer.from(image).toString('base64'), saves: {} }),
  });
  const { scripts } = await loadTitle(new URL('title/', at), { data: new URL('two.json', at) });
  assert.deepEqual(Object.keys(scripts), ['boot']);
  assert.ok(scripts.boot.steps.length >= 2, 'the program\'s statements');
  assert.ok(scripts.boot.steps.some(s => /hello/i.test(s[2])), 'read from the disk');
  assert.equal(typeof scripts.boot.run[0], 'function');
  const fixed = await loadTitle(new URL('title/', at), { data: new URL('two.json', at), fixed: true });
  assert.notDeepEqual(fixed.scripts.boot.steps, scripts.boot.steps, 'the fixes made first');
});

test('a title whose engine is its own: its module loaded, to play it, no scripts and no data read', async () => {
  const at = folder({
    'title/title.js': "export default { slug: 'three', engine: 'game', style: 'three.css' };",
    'title/game.js': 'export async function play(game) { game.played = true; }',
  });
  const { title, scripts, disk } = await loadTitle(new URL('title/', at), { data: new URL('data/', at) });
  assert.equal(typeof title.own.play, 'function');
  assert.deepEqual([scripts, disk], [{}, null]);
});

test('a vector title\'s code files at the addresses its map gives, else its catalog\'s', () => {
  const volume = { PART0: { aux: 0x4000, data: btoa('\x01') }, PART1: { aux: 0x9000, data: btoa('\x02') }, PROB1: { aux: 0, data: btoa('\x03') }, PICS1: { aux: 0, data: '' } };
  assert.deepEqual(codeFiles({ loads: { PART0: 0x4000, PART: 0x8000, PROB: 0x0800 } }, volume).map(f => [f.name, f.origin]), [['PART0', 0x4000], ['PART1', 0x8000], ['PROB1', 0x0800]]);
  assert.deepEqual(codeFiles(undefined, volume).map(f => f.origin), [0x4000, 0x9000, 0]);
});
