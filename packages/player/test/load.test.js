// A title loaded from its folder, as a page gives the player its address: its title.js, the modules it names, its
// view's drawing, its compiled scripts or its scenes, its game's data; a title whose engine is its own, its module
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

// a title's folder and its data, written: each file a name and its text
function folder(files) {
  const at = mkdtempSync(join(tmpdir(), 'title-'));
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(at, name, '..'), { recursive: true }); writeFileSync(join(at, name), text); }
  return pathToFileURL(at + '/');
}

test('a title from its folder: its title.js, its modules, its view, its compiled scripts and its data', async () => {
  const at = folder({
    'title/title.js': "export default { slug: 'one', engine: 'card', scripts: ['start'], start: 'start', modules: ['problems'], view: true, map: { routines: { 0x800: 'char' } } };",
    'title/problems.js': 'export default { 1: "the first" };',
    'title/view.js': 'export default { char() {} };',
    'title/compiled/start.js': 'export default "compiled";',
    'title/start.scene': 'the scene',
    'one.json': JSON.stringify({ kind: 'dos33', saves: { volume: 'DISK', dos: 'dos33' }, volumes: { DISK: {} } }),
  });
  const { title, scripts, disk } = await loadTitle(new URL('title/', at), { data: new URL('one.json', at) });
  assert.equal(title.slug, 'one');
  assert.deepEqual(title.map.routines, { 0x800: 'char' }, 'its map, its own');
  assert.deepEqual(title.problems, { 1: 'the first' });
  assert.equal(typeof title.viewSteps.char, 'function', 'its view\'s drawing');
  assert.deepEqual(scripts, { start: 'compiled' });
  assert.deepEqual(disk.saves, { volume: 'DISK', dos: 'dos33' }, 'its data, its saves with it');
  const raw = await loadTitle(new URL('title/', at), { data: new URL('one.json', at), scenes: true });
  assert.deepEqual(raw.scripts, { start: 'the scene' }, 'or its scenes themselves');
});

test('a title whose engine is its own: its module loaded, to play it, no scripts and no data read', async () => {
  const at = folder({
    'title/title.js': "export default { slug: 'two', engine: 'game', style: 'two.css' };",
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
