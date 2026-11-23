import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGE, RANGES, rangeSpec, rangeWindow } from './ranges';

describe('ranges', () => {
  it('builds a window ending at the supplied time', () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    const window = rangeWindow('1h', now);

    expect(window.to).toBe(now);
    expect(window.from).toBe(now - 3_600_000);
    expect(window.step).toBe(30);
    expect(window.limit).toBe(2_000);
  });

  it('keeps every preset under 1000 buckets', () => {
    for (const range of RANGES) {
      expect(range.seconds / range.stepSec).toBeLessThan(1_000);
      expect(range.limit).toBeLessThanOrEqual(10_000);
    }
  });

  it('has a default preset and a fallback spec', () => {
    expect(RANGES.some((range) => range.key === DEFAULT_RANGE)).toBe(true);
    expect(rangeSpec('24h').seconds).toBe(86_400);
  });

  it('uses integer millisecond windows and second steps', () => {
    const window = rangeWindow('30d', 1_000_000);
    expect(Number.isInteger(window.from)).toBe(true);
    expect(Number.isInteger(window.step)).toBe(true);
    expect(window.step).toBe(7_200);
  });
});
