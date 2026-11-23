import type { ComponentType } from 'react';
import type { RangeKey } from '../lib/ranges';
import type { Device, Sample } from '../types';

export interface DetailProps {
  device: Device;
  samples: Sample[] | null;
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  historyError: string | null;
}

export interface Renderer {
  matches: (device: Device) => boolean;
  SummaryCard: ComponentType<{ device: Device }>;
  Detail: ComponentType<DetailProps>;
}
