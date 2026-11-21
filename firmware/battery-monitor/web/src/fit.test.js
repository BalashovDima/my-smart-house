import assert from 'node:assert/strict';
import test from 'node:test';

import { fitLinear } from './fit.js';

test('fits an exact two-point line', () => {
  const fit = fitLinear([
    { x: 1000, y: 3000 },
    { x: 1400, y: 3800 },
  ]);
  assert.ok(!fit.error, fit.error);
  assert.equal(fit.n, 2);
  assert.ok(Math.abs(fit.scale - 2) < 1e-12);
  assert.ok(Math.abs(fit.offsetMv - 1000) < 1e-9);
  assert.equal(fit.rmsMv, 0);
  assert.equal(fit.maxResidualMv, 0);
  assert.equal(fit.pinSpanMv, 400);
});

test('fits three collinear points', () => {
  const fit = fitLinear([
    { x: 800, y: 2450 },
    { x: 1000, y: 2850 },
    { x: 1200, y: 3250 },
  ]);
  assert.ok(!fit.error, fit.error);
  assert.ok(Math.abs(fit.scale - 2) < 1e-9);
  assert.ok(Math.abs(fit.offsetMv - 850) < 1e-6);
  assert.ok(fit.maxResidualMv < 1e-9);
});

test('recovers a known line from noisy points', () => {
  const noise = [0.8, -1.3, 0.4, 1.1, -0.9, 0.2, -0.3, 0.6];
  const points = noise.map((n, i) => {
    const x = 900 + i * 60;
    return { x, y: 2.05 * x + 870 + n };
  });
  const fit = fitLinear(points);
  assert.ok(!fit.error, fit.error);
  assert.equal(fit.n, 8);
  assert.ok(Math.abs(fit.scale - 2.05) < 0.01, `scale ${fit.scale}`);
  assert.ok(Math.abs(fit.offsetMv - 870) < 15, `offset ${fit.offsetMv}`);
  assert.ok(fit.rmsMv < 2);
  assert.ok(fit.maxResidualMv < 2);
});

test('rejects fewer than two points', () => {
  assert.match(fitLinear([]).error, /2 points/i);
  assert.match(fitLinear([{ x: 1000, y: 3000 }]).error, /2 points/i);
});

test('rejects identical pin readings', () => {
  const fit = fitLinear([
    { x: 1000, y: 3000 },
    { x: 1000, y: 3005 },
  ]);
  assert.match(fit.error, /span/i);
});

test('rejects a pin span that is too small', () => {
  const fit = fitLinear([
    { x: 1000, y: 3000 },
    { x: 1030, y: 3060 },
  ]);
  assert.match(fit.error, /span/i);
});

test('rejects non-numeric values', () => {
  assert.match(fitLinear([{ x: 'abc', y: 3000 }, { x: 1400, y: 3800 }]).error, /numbers/i);
  assert.match(fitLinear([{ x: 1000, y: NaN }, { x: 1400, y: 3800 }]).error, /numbers/i);
});

test('rejects a negative scale', () => {
  const fit = fitLinear([
    { x: 1000, y: 3400 },
    { x: 1400, y: 2600 },
  ]);
  assert.match(fit.error, /scale/i);
});

test('rejects an out-of-range offset', () => {
  const fit = fitLinear([
    { x: 1000, y: 28000 },
    { x: 1400, y: 28800 },
  ]);
  assert.match(fit.error, /offset/i);
});
