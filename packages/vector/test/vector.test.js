// The engine's formats read and its drawing done, from bytes the tests build, nothing of a title's: pictures
// and their shapes, a filled shape and a line drawn, objects packed both ways and put down, a picture's window
// colour found in code, the shapes as SVG. (PART0's own drawing against draw.js runs where the games' disks are.)
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pictures, windows } from '@moonbase-machines/vector/pictures.js';
import { draw, inside, screen } from '@moonbase-machines/vector/draw.js';
import { decode, put } from '@moonbase-machines/vector/objects.js';
import { document } from '@moonbase-machines/vector/svg.js';

const name14 = s => [...s.padEnd(14)].map(c => c.charCodeAt(0));
const picture = (name, shapes) => { const body = shapes.flatMap((s, i) => [...(i ? [0xfe] : []), s.fill, s.line, ...s.points.flat()]).concat([0xfe, 0xff]); const length = 16 + body.length; return [...name14(name), length & 0xff, length >> 8, ...body]; };

test('a list of pictures read: each name, and its shapes with their colours and points', () => {
  const box = { fill: 5, line: 15, points: [[10, 10], [30, 10], [30, 30], [10, 30]] }, wire = { fill: 0, line: 6, points: [[1, 1], [40, 40]] };
  const list = pictures(Uint8Array.from([...picture('HOUSE', [box]), ...picture('WIRE', [wire])]));
  assert.deepEqual(list.map(p => p.name), ['HOUSE', 'WIRE']);
  assert.deepEqual(list[0].shapes, [box]);
  assert.deepEqual(list[1].shapes, [wire]);
});

test('a shape filled and outlined as the engine draws it; a shape of two points a line, not filled', () => {
  const box = { fill: 5, line: 15, points: [[10, 10], [30, 10], [30, 30], [10, 30]] };
  const scr = draw([box, { fill: 3, line: 6, points: [[50, 50], [60, 50]] }], screen(0));
  assert.equal(scr[20][20], 5, 'inside: the fill');
  assert.equal(scr[10][20], 15, 'its edge: the outline');
  assert.equal(scr[40][40], 0, 'outside: the ground');
  assert.equal(scr[50][55], 6, 'the line in its line colour');
  assert.ok(inside(box, 20, 20), 'the point test: inside'); assert.ok(!inside(box, 40, 40), 'and outside');
});

test('an object packed as nibbles, with its escape run, and one packed as bytes with a run', () => {
  // nibbles: flags $43 (bit 6, clear colour 3), 2 bytes a row, 4 dots, 2 rows; escape $EE; row 2 a run of $56 twice
  const n = decode(Uint8Array.from([0x43, 2, 4, 2, 0xee, 0x12, 0x34, 0xee, 2, 0x56]), 0);
  assert.equal(n.packed, 'nibbles'); assert.equal(n.clear, 3);
  assert.deepEqual(n.rows, [[1, 2, 3, 4], [5, 6, 5, 6]]);
  // bytes: flags $80 (put down whole), a byte a row, 1 dot, 2 rows: $0F (colour 15), then a run of 0 once
  const b = decode(Uint8Array.from([0x80, 1, 1, 2, 0x0f, 0x80, 1]), 0);
  assert.equal(b.packed, 'bytes'); assert.equal(b.clear, undefined);
  assert.deepEqual(b.rows, [[15], [0]]);
});

test('an object put down: its clear colour lets the ground show, unless it is put down whole', () => {
  const object = decode(Uint8Array.from([0x43, 2, 4, 1, 0xee, 0x12, 0x34]), 0);
  const scr = screen(9);
  put(scr, object, 10, 20);
  assert.deepEqual(scr[20].slice(10, 14), [1, 2, 9, 4], 'its colour 3 not put down');
  put(scr, object, 10, 20, true);
  assert.deepEqual(scr[20].slice(10, 14), [1, 2, 3, 4], 'whole, every dot');
});

test('a picture\'s window colour, from the box call before the picture call, a trailing digit falling back', () => {
  const BOX = 0x65d2, PICTURE = 0x7afe;
  const code = Uint8Array.from([0xa9, 7, 0xa2, 1, 0xa0, 2, 0x20, BOX & 0xff, BOX >> 8, 0x20, PICTURE & 0xff, PICTURE >> 8, 0x83, ...'hut'.split('').map(c => c.charCodeAt(0)), 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea]);
  const colour = windows([code], { box: BOX, picture: PICTURE });
  assert.equal(colour('HUT'), 7); assert.equal(colour('HUT 2'), 7); assert.equal(colour('BARN'), undefined);
});

test('the shapes as SVG, each in its colour', () => {
  const svg = document([{ fill: 5, line: 15, points: [[10, 10], [30, 10], [30, 30], [10, 30]] }]);
  assert.match(svg, /^<svg/);
  assert.match(svg, /fill="rgb\(156,156,156\)" stroke="rgb\(255,255,255\)"/, 'colour 5, gray, filled; 15, white, its outline');
});
