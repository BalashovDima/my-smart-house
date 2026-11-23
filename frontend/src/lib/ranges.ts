export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d';

export interface RangeSpec {
  key: RangeKey;
  label: string;
  seconds: number;
  /** Bucket size sent to the API; the server keeps the newest sample per bucket. */
  stepSec: number;
  limit: number;
}

// Step sizes target a few hundred points per range so charts stay readable and
// the response stays far below the API's 10000-sample ceiling.
export const RANGES: RangeSpec[] = [
  { key: '1h', label: '1 h', seconds: 3_600, stepSec: 30, limit: 2_000 },
  { key: '6h', label: '6 h', seconds: 21_600, stepSec: 120, limit: 2_000 },
  { key: '24h', label: '24 h', seconds: 86_400, stepSec: 300, limit: 2_000 },
  { key: '7d', label: '7 d', seconds: 604_800, stepSec: 1_800, limit: 2_000 },
  { key: '30d', label: '30 d', seconds: 2_592_000, stepSec: 7_200, limit: 2_000 },
];

export const DEFAULT_RANGE: RangeKey = '24h';

export function rangeSpec(key: RangeKey): RangeSpec {
  return RANGES.find((spec) => spec.key === key) ?? RANGES[2];
}

export interface RangeWindow {
  from: number;
  to: number;
  step: number;
  limit: number;
}

/** Window is computed at request time so polling always ends at "now". */
export function rangeWindow(key: RangeKey, now = Date.now()): RangeWindow {
  const spec = rangeSpec(key);
  return {
    from: now - spec.seconds * 1000,
    to: now,
    step: spec.stepSec,
    limit: spec.limit,
  };
}
