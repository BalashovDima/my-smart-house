import type { Sample } from '../types';

export const MAX_CELLS = 8;

export interface BatteryPoints {
  /** uPlot wants seconds on the time scale, not milliseconds. */
  times: number[];
  packV: (number | null)[];
  spreadMv: (number | null)[];
  /** Always MAX_CELLS columns; use cellCount to know how many are real. */
  cellsV: (number | null)[][];
  cellCount: number;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mvToV(value: unknown): number | null {
  const mv = finite(value);
  return mv === null ? null : mv / 1000;
}

/**
 * Converts raw sample payloads into chart columns. Malformed entries become
 * nulls rather than breaking the whole chart, which matters because history
 * can contain payloads from older firmware.
 */
export function toBatteryPoints(samples: Sample[]): BatteryPoints {
  const times: number[] = [];
  const packV: (number | null)[] = [];
  const spreadMv: (number | null)[] = [];
  const cellsV: (number | null)[][] = Array.from({ length: MAX_CELLS }, () => []);
  let cellCount = 0;

  for (const sample of samples) {
    const timestamp = Date.parse(sample.ts);
    if (Number.isNaN(timestamp)) continue;

    times.push(timestamp / 1000);
    const data = sample.data ?? {};
    packV.push(mvToV(data.packMv));
    spreadMv.push(finite(data.spreadMv));

    const cells = Array.isArray(data.cellsMv) ? data.cellsMv : [];
    cellCount = Math.max(cellCount, Math.min(cells.length, MAX_CELLS));
    for (let index = 0; index < MAX_CELLS; index += 1) {
      cellsV[index].push(mvToV(cells[index]));
    }
  }

  return { times, packV, spreadMv, cellsV, cellCount };
}
