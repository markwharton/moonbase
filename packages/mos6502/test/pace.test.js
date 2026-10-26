// A machine paced against the clock (pace.js): the frames it runs follow the clock whatever the animation rate, a
// hitch is caught up two frames at a time, and a pause (a hidden tab) is dropped, the machine coming back at speed.
//
//   node --test test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pace, HITCH } from '@moonbase-machines/mos6502/pace.js';

// the page's clock and animation frames stood in for: ticks at the display's rate, each at a time of the test's
function page(rate) {
  // (the time exact: the display's ticks counted, a jump added, so that a second is 1000 and not 999.99)
  const p = { base: 0, count: 0, ticks: [], frames: [], run: n => p.frames.push(n), tick: null, next: f => { p.tick = f; } };
  p.now = () => p.base + p.count * 1000 / rate;
  Object.defineProperty(p, 't', { get: p.now });
  p.go = (n, ms = null) => { for (let i = 0; i < n; i++) { if (ms === null) p.count++; else p.base += ms; p.tick(); } };
  pace(p.run, 50, { after: n => p.ticks.push(n), now: p.now, next: p.next });
  return p;
}

test('a 64 at 50 frames a second on a 60 Hz display: a frame most ticks, none on some, the count following the clock', () => {
  const p = page(60);
  p.go(60);
  assert.equal(p.frames.length, 50, 'a second: fifty frames');
  assert.ok(p.ticks.every((n, i) => i === 0 || n - p.ticks[i - 1] <= 1), 'never two at once on a smooth display');
});

test('on a 120 Hz display the same fifty a second; on a 30 Hz one, two a tick', () => {
  const fast = page(120); fast.go(120); assert.equal(fast.frames.length, 50);
  const slow = page(30); slow.go(30); assert.equal(slow.frames.length, 50);
  assert.ok(slow.ticks.slice(1).every((n, i) => n - slow.ticks[i] <= 2), 'two at most a tick');
});

test('a hitch is caught up, two frames a tick, until the machine is back on the clock', () => {
  const p = page(60);
  p.go(30);
  p.go(1, 100);   // one tick a tenth of a second late: five frames owed
  const at = p.frames.length;
  p.go(6);
  assert.equal(p.frames.length, Math.floor(p.t / 20), 'back on the clock within a few ticks');
  assert.ok(p.ticks.slice(-7).some((n, i, a) => i && n - a[i - 1] === 2), 'two in a tick while behind');
  assert.ok(at < p.frames.length);
});

test('a pause, the tab hidden, is dropped: the machine comes back at speed from where it stopped', () => {
  const p = page(60);
  p.go(30);
  const before = p.frames.length;
  p.go(1, 60_000);   // a minute away, then the first tick back
  assert.ok(p.frames.length - before <= 2, 'at most two frames on coming back, not a minute of them');
  p.go(60);
  assert.ok(p.frames.length - before <= 52 + 2, 'a second later, a second of frames, not a minute of them');
  assert.ok(p.ticks.slice(-60).every((n, i, a) => !i || n - a[i - 1] <= 1), 'no catching up after');
});

test('a pause of a hitch or less is caught up, one longer is dropped', () => {
  const p = page(60);
  p.go(10);
  p.go(1, HITCH * 20); p.go(10);
  assert.equal(p.frames.length, Math.floor(p.t / 20), 'ten frames owed: caught up');
  const q = page(60);
  q.go(10);
  q.go(1, (HITCH + 1) * 20); q.go(10);
  assert.ok(q.frames.length < Math.floor(q.t / 20) - 5, 'eleven frames owed: dropped');
});
