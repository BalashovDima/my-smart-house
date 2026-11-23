import { describe, expect, it } from 'vitest';
import {
  formatMv,
  formatRelative,
  formatRssi,
  formatScalar,
  formatUptime,
  formatVolts,
} from './format';

describe('formatVolts', () => {
  it('converts millivolts to a three-decimal voltage', () => {
    expect(formatVolts(3301)).toBe('3.301 V');
    expect(formatVolts(0)).toBe('0.000 V');
  });

  it('renders a dash for missing or invalid values', () => {
    expect(formatVolts(undefined)).toBe('—');
    expect(formatVolts(null)).toBe('—');
    expect(formatVolts(Number.NaN)).toBe('—');
  });
});

describe('formatMv and formatRssi', () => {
  it('rounds to whole units', () => {
    expect(formatMv(7.6)).toBe('8 mV');
    expect(formatRssi(-61.4)).toBe('-61 dBm');
  });

  it('handles missing values', () => {
    expect(formatMv(undefined)).toBe('—');
    expect(formatRssi(null)).toBe('—');
  });
});

describe('formatUptime', () => {
  it('switches units as the duration grows', () => {
    expect(formatUptime(42_000)).toBe('42 s');
    expect(formatUptime(125_000)).toBe('2 min 5 s');
    expect(formatUptime(3_725_000)).toBe('1 h 2 min');
    expect(formatUptime(90_061_000)).toBe('1 d 1 h');
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');

  it('describes recent and older timestamps', () => {
    expect(formatRelative('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-11-22T11:58:30Z', now)).toBe('1 min ago');
    expect(formatRelative('2026-11-22T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-11-22T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-11-20T12:00:00Z', now)).toBe('2 d ago');
  });

  it('tolerates missing and future timestamps', () => {
    expect(formatRelative(undefined, now)).toBe('never');
    expect(formatRelative('not-a-date', now)).toBe('—');
    expect(formatRelative('2026-11-22T12:05:00Z', now)).toBe('just now');
  });
});

describe('formatScalar', () => {
  it('formats common payload value types', () => {
    expect(formatScalar(42)).toBe('42');
    expect(formatScalar(3.14159)).toBe('3.142');
    expect(formatScalar(true)).toBe('yes');
    expect(formatScalar('online')).toBe('online');
    expect(formatScalar('')).toBe('—');
    expect(formatScalar(null)).toBe('—');
  });
});
