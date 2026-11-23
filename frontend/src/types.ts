// Shapes returned by the read-only Go API. `latest` and each sample `data`
// are the raw telemetry payload, so unknown fields from future device types
// are preserved here and ignored by type-specific renderers.

export interface Telemetry {
  v?: number;
  id?: string;
  type?: string;
  fw?: string;
  seq?: number;
  uptimeMs?: number;
  intervalMs?: number;
  rssi?: number;
  calibrated?: boolean;
  packMv?: number;
  minCellMv?: number;
  maxCellMv?: number;
  spreadMv?: number;
  cellsMv?: number[];
  [key: string]: unknown;
}

export interface Device {
  id: string;
  type: string;
  name?: string;
  fw?: string;
  online: boolean;
  firstSeen?: string;
  lastSeen?: string;
  intervalMs?: number;
  latest?: Telemetry;
}

export interface Sample {
  ts: string;
  data: Telemetry;
}

export interface SamplesResponse {
  device: string;
  from: string;
  to: string;
  stepSec: number;
  count: number;
  samples: Sample[];
}

export interface Health {
  ok: boolean;
  mqtt: {
    connected: boolean;
    lastMessageAt: string | null;
  };
  db: {
    ok: boolean;
  };
}
