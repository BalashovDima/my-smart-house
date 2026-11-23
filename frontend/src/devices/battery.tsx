import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CellBars } from '../components/CellBars';
import {
  HistoryChart,
  type ChartData,
  type ChartSeries,
} from '../components/HistoryChart';
import { RangePicker } from '../components/RangePicker';
import { Dot, StatusPill, type Tone } from '../components/StatusPill';
import {
  formatMv,
  formatRelative,
  formatRssi,
  formatUptime,
  formatVolts,
} from '../lib/format';
import { rangeSpec } from '../lib/ranges';
import { MAX_CELLS, toBatteryPoints } from '../lib/series';
import type { Device } from '../types';
import type { DetailProps } from './types';

// Pack balance heuristics for LiFePO4 cells. These are display thresholds, not
// a charger or balancer policy.
export const SPREAD_GOOD_MV = 30;
export const SPREAD_WARN_MV = 80;

const CELL_COLORS = [
  '#34d399',
  '#60a5fa',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#fb923c',
  '#a3e635',
];

const TONE_TEXT: Record<Tone, string> = {
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  slate: 'text-slate-300',
  sky: 'text-sky-300',
};

function spreadTone(spread: number | null | undefined): Tone {
  if (typeof spread !== 'number') return 'slate';
  if (spread <= SPREAD_GOOD_MV) return 'green';
  if (spread <= SPREAD_WARN_MV) return 'amber';
  return 'rose';
}

function Stat({
  label,
  value,
  hint,
  className = '',
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
      <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${className}`}>{value}</p>
      {hint ? <p className="text-[0.7rem] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function BatterySummaryCard({ device }: { device: Device }) {
  const latest = device.latest ?? {};
  const cells = Array.isArray(latest.cellsMv) ? latest.cellsMv : [];
  const spread = typeof latest.spreadMv === 'number' ? latest.spreadMv : null;
  const pack = typeof latest.packMv === 'number' ? latest.packMv : null;

  return (
    <Link
      to={`/devices/${encodeURIComponent(device.id)}`}
      className="group flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-sky-700/70 hover:bg-slate-900/80 focus-visible:border-sky-500 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-100">
            {device.name || device.id}
          </h2>
          <p className="truncate text-xs text-slate-500">
            {cells.length > 0 ? `${cells.length}S pack` : 'battery monitor'}
            {device.fw ? ` · fw ${device.fw}` : ''}
          </p>
        </div>
        <StatusPill tone={device.online ? 'green' : 'slate'}>
          <Dot tone={device.online ? 'green' : 'slate'} />
          {device.online ? 'Online' : 'Offline'}
        </StatusPill>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">Pack</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-50">
            {formatVolts(pack)}
          </p>
        </div>
        <div className="space-y-0.5 text-right text-xs text-slate-400">
          <p>
            Spread{' '}
            <span className={`font-medium tabular-nums ${TONE_TEXT[spreadTone(spread)]}`}>
              {formatMv(spread)}
            </span>
          </p>
          <p>{device.lastSeen ? `Seen ${formatRelative(device.lastSeen)}` : 'No samples yet'}</p>
        </div>
      </div>

      <CellBars cellsMv={cells} compact />

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>RSSI {formatRssi(latest.rssi)}</span>
        <span className="text-sky-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  );
}

export function BatteryDetail({
  device,
  samples,
  range,
  onRangeChange,
  historyError,
}: DetailProps) {
  const latest = device.latest ?? {};
  const latestCells = Array.isArray(latest.cellsMv) ? latest.cellsMv : [];
  const spread = typeof latest.spreadMv === 'number' ? latest.spreadMv : null;
  const [hiddenCells, setHiddenCells] = useState<ReadonlySet<number>>(() => new Set());

  const points = useMemo(() => toBatteryPoints(samples ?? []), [samples]);
  const chartCells = Math.min(MAX_CELLS, Math.max(points.cellCount, latestCells.length));
  const hasHistory = points.times.length >= 2;

  const voltageSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: 'Pack',
        color: '#38bdf8',
        width: 2.25,
        toggleable: false,
        valueFormat: (value) => `${value.toFixed(3)} V`,
      },
      ...Array.from({ length: chartCells }, (_, index) => ({
        label: `Cell ${index + 1}`,
        color: CELL_COLORS[index % CELL_COLORS.length],
        hidden: hiddenCells.has(index),
        scale: 'cells',
        valueFormat: (value: number) => `${value.toFixed(3)} V`,
      })),
    ],
    [chartCells, hiddenCells],
  );

  const voltageData = useMemo<ChartData>(
    () => [points.times, points.packV, ...points.cellsV.slice(0, chartCells)],
    [points, chartCells],
  );

  const spreadSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: 'Spread',
        color: '#f59e0b',
        width: 2,
        fill: 'rgba(245, 158, 11, 0.10)',
        valueFormat: (value) => `${Math.round(value)} mV`,
      },
    ],
    [],
  );

  const spreadData = useMemo<ChartData>(() => [points.times, points.spreadMv], [points]);

  const toggleCell = (seriesIndex: number) => {
    const cellIndex = seriesIndex - 1;
    if (cellIndex < 0) return;
    setHiddenCells((previous) => {
      const next = new Set(previous);
      if (next.has(cellIndex)) next.delete(cellIndex);
      else next.add(cellIndex);
      return next;
    });
  };

  const intervalLabel =
    typeof latest.intervalMs === 'number' && latest.intervalMs > 0
      ? `${Math.round(latest.intervalMs / 1000)} s`
      : '—';

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Latest snapshot</h2>
          <div className="flex flex-wrap items-center gap-2">
            {typeof latest.calibrated === 'boolean' ? (
              <StatusPill tone={latest.calibrated ? 'green' : 'amber'}>
                {latest.calibrated ? 'Calibrated' : 'Uncalibrated'}
              </StatusPill>
            ) : null}
            <StatusPill>Interval {intervalLabel}</StatusPill>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Pack" value={formatVolts(latest.packMv)} hint={`${latestCells.length || '—'} cells`} />
          <Stat label="Min cell" value={formatVolts(latest.minCellMv)} />
          <Stat label="Max cell" value={formatVolts(latest.maxCellMv)} />
          <Stat
            label="Spread"
            value={formatMv(spread)}
            hint={`good ≤ ${SPREAD_GOOD_MV} mV`}
            className={TONE_TEXT[spreadTone(spread)]}
          />
          <Stat label="RSSI" value={formatRssi(latest.rssi)} />
          <Stat label="Uptime" value={formatUptime(latest.uptimeMs)} />
          <Stat label="Sequence" value={typeof latest.seq === 'number' ? String(latest.seq) : '—'} />
          <Stat label="Last sample" value={formatRelative(device.lastSeen)} />
        </div>

        <div className="mt-4">
          <CellBars cellsMv={latestCells} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">History</h2>
            <p className="text-xs text-slate-500">
              One point per {rangeSpec(range).stepSec >= 60
                ? `${Math.round(rangeSpec(range).stepSec / 60)} min`
                : `${rangeSpec(range).stepSec} s`}{' '}
              bucket. Hover to inspect values; click a cell chip to hide it.
            </p>
          </div>
          <RangePicker value={range} onChange={onRangeChange} />
        </div>

        {historyError ? (
          <p className="py-8 text-center text-sm text-rose-300">
            Could not load history: {historyError}
          </p>
        ) : samples === null ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading history…</p>
        ) : !hasHistory ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No samples in this range yet. The device publishes every {intervalLabel}.
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Pack and cells (V)
              </h3>
              <HistoryChart
                data={voltageData}
                series={voltageSeries}
                syncKey="battery"
                yAxisFormat={(value) => value.toFixed(2)}
                onToggle={toggleCell}
              />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Cell spread (mV)
              </h3>
              <HistoryChart
                data={spreadData}
                series={spreadSeries}
                height={170}
                syncKey="battery"
                yAxisFormat={(value) => String(Math.round(value))}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
