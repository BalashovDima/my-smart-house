import { describe, expect, it } from 'vitest';
import { MAX_CELLS, toBatteryPoints } from './series';
import type { Sample } from '../types';

function sample(ts: string, data: Sample['data']): Sample {
  return { ts, data };
}

describe('toBatteryPoints', () => {
  it('maps a payload into seconds and volts', () => {
    const points = toBatteryPoints([
      sample('2026-11-22T12:00:00.000Z', {
        packMv: 13_205,
        spreadMv: 7,
        cellsMv: [3298, 3300, 3302, 3305],
      }),
    ]);

    expect(points.times).toEqual([Date.parse('2026-11-22T12:00:00.000Z') / 1000]);
    expect(points.packV).toEqual([13.205]);
    expect(points.spreadMv).toEqual([7]);
    expect(points.cellCount).toBe(4);
    expect(points.cellsV).toHaveLength(MAX_CELLS);
    expect(points.cellsV[0]).toEqual([3.298]);
    expect(points.cellsV[3]).toEqual([3.305]);
  });

  it('pads missing cells with nulls instead of dropping columns', () => {
    const points = toBatteryPoints([
      sample('2026-11-22T12:00:00Z', { cellsMv: [3300] }),
      sample('2026-11-22T12:00:30Z', { cellsMv: [3301, 3302] }),
    ]);

    expect(points.cellCount).toBe(2);
    expect(points.cellsV[1]).toEqual([null, 3.302]);
    expect(points.cellsV[2]).toEqual([null, null]);
  });

  it('keeps malformed values as nulls', () => {
    const points = toBatteryPoints([
      sample('2026-11-22T12:00:00Z', { packMv: Number.NaN }),
      sample('not-a-date', { packMv: 12_000 }),
    ]);

    expect(points.times).toHaveLength(1);
    expect(points.packV).toEqual([null]);
    expect(points.cellCount).toBe(0);
  });

  it('caps cells at MAX_CELLS', () => {
    const cells = Array.from({ length: MAX_CELLS + 4 }, (_, index) => 3000 + index);
    const points = toBatteryPoints([sample('2026-11-22T12:00:00Z', { cellsMv: cells })]);
    expect(points.cellCount).toBe(MAX_CELLS);
  });

  it('returns empty columns for no samples', () => {
    const points = toBatteryPoints([]);
    expect(points.times).toEqual([]);
    expect(points.cellCount).toBe(0);
    expect(points.cellsV.every((column) => column.length === 0)).toBe(true);
  });
});
