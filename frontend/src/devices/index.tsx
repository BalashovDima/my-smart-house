import type { Device } from '../types';
import { BatteryDetail, BatterySummaryCard } from './battery';
import { GenericDetail, GenericSummaryCard } from './generic';
import type { Renderer } from './types';

const battery: Renderer = {
  matches: (device) => (device.latest?.type ?? device.type) === 'battery-monitor',
  SummaryCard: BatterySummaryCard,
  Detail: BatteryDetail,
};

const generic: Renderer = {
  matches: () => true,
  SummaryCard: GenericSummaryCard,
  Detail: GenericDetail,
};

const renderers: Renderer[] = [battery];

export function rendererFor(device: Device): Renderer {
  return renderers.find((renderer) => renderer.matches(device)) ?? generic;
}
