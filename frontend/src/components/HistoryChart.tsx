import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export type ChartData = (number | null)[][];

export interface ChartSeries {
  label: string;
  color: string;
  width?: number;
  dash?: number[];
  fill?: string;
  hidden?: boolean;
  /** Defaults to true when the chart has an onToggle handler. */
  toggleable?: boolean;
  /** Scale key; "cells" puts the series on a right-hand axis. */
  scale?: string;
  /** Formats a cursor value for the legend, e.g. "3.301 V". */
  valueFormat: (value: number) => string;
}

interface HistoryChartProps {
  /** Columns: [unix seconds, ...series values]. Length must be series.length + 1. */
  data: ChartData;
  series: ChartSeries[];
  height?: number;
  syncKey?: string;
  yAxisFormat?: (value: number) => string;
  onToggle?: (index: number) => void;
}

const AXIS_COLOR = '#94a3b8';
const GRID_COLOR = 'rgba(148, 163, 184, 0.14)';
const FONT = '11px ui-sans-serif, system-ui, sans-serif';

function valueAt(column: (number | null)[] | undefined, index: number): number | null {
  if (!column || index < 0 || index >= column.length) return null;
  const value = column[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function HistoryChart({
  data,
  series,
  height = 240,
  syncKey,
  yAxisFormat,
  onToggle,
}: HistoryChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const axisFormatRef = useRef(yAxisFormat);
  axisFormatRef.current = yAxisFormat;
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);

  // Recreate the plot when the series shape or visible set changes; data-only
  // updates go through setData() below.
  const seriesKey = series
    .map((item, index) => `${index}:${item.label}:${item.color}:${item.hidden ? '0' : '1'}`)
    .join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let lastIndex: number | null = null;
    const width = Math.max(280, Math.floor(host.clientWidth || 640));
    const hasCellsAxis = series.some((item) => item.scale === 'cells');
    const axisValues = (_self: uPlot, splits: number[]) =>
      splits.map((value) =>
        axisFormatRef.current ? axisFormatRef.current(value) : String(value),
      );

    const options: uPlot.Options = {
      width,
      height,
      padding: [12, 12, 0, 4],
      legend: { show: false },
      scales: { x: { time: true } },
      series: [
        {},
        ...series.map((item) => ({
          label: item.label,
          stroke: item.color,
          width: item.width ?? 1.5,
          dash: item.dash,
          fill: item.fill,
          show: !item.hidden,
          spanGaps: true,
          points: { show: false },
          ...(item.scale ? { scale: item.scale } : {}),
          value: (_self: uPlot, rawValue: number) =>
            rawValue == null ? '—' : item.valueFormat(rawValue),
        })),
      ],
      axes: [
        {
          stroke: AXIS_COLOR,
          grid: { stroke: GRID_COLOR, width: 1 },
          ticks: { stroke: GRID_COLOR, width: 1 },
          font: FONT,
          size: 28,
        },
        {
          stroke: AXIS_COLOR,
          grid: { stroke: GRID_COLOR, width: 1 },
          ticks: { stroke: GRID_COLOR, width: 1 },
          font: FONT,
          size: 56,
          values: axisValues,
        },
        ...(hasCellsAxis
          ? [
              {
                scale: 'cells',
                side: 1 as const,
                stroke: AXIS_COLOR,
                grid: { show: false },
                ticks: { stroke: GRID_COLOR, width: 1 },
                font: FONT,
                size: 56,
                values: axisValues,
              },
            ]
          : []),
      ],
      cursor: {
        y: false,
        points: { show: false },
        drag: { x: false, y: false },
        ...(syncKey ? { sync: { key: syncKey, setSeries: false } } : {}),
      },
      hooks: {
        setCursor: [
          (self: uPlot) => {
            const index = self.cursor.idx ?? null;
            if (index === lastIndex) return;
            lastIndex = index;
            setCursorIndex(index);
          },
        ],
      },
    };

    const plot = new uPlot(options, data as uPlot.AlignedData, host);
    plotRef.current = plot;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (nextWidth > 0) {
        plot.setSize({ width: nextWidth, height });
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // `data` is intentionally excluded: recreating on every poll would reset
    // the cursor. The effect below pushes new data into the existing plot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, height, syncKey]);

  useEffect(() => {
    plotRef.current?.setData(data as uPlot.AlignedData);
  }, [data]);

  const lastIndex = Math.max(0, (data[0]?.length ?? 0) - 1);
  const index = cursorIndex != null && cursorIndex >= 0 ? cursorIndex : lastIndex;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {series.map((item, seriesIndex) => {
          const value = valueAt(data[seriesIndex + 1], index);
          const label = `${item.label}: ${value == null ? '—' : item.valueFormat(value)}`;
          const canToggle = Boolean(onToggle) && item.toggleable !== false;
          const chipClass = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            item.hidden
              ? 'border-slate-800 text-slate-500'
              : 'border-slate-700 text-slate-200'
          } ${canToggle ? 'hover:border-slate-500' : ''}`;

          if (!canToggle) {
            return (
              <span key={item.label} className={chipClass} aria-label={label}>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: item.hidden ? '#475569' : item.color }}
                />
                {item.label}
                <span className="tabular-nums text-slate-400">
                  {value == null ? '—' : item.valueFormat(value)}
                </span>
              </span>
            );
          }

          return (
            <button
              key={item.label}
              type="button"
              className={chipClass}
              aria-pressed={!item.hidden}
              title={item.hidden ? `Show ${item.label}` : `Hide ${item.label}`}
              onClick={() => onToggle?.(seriesIndex)}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: item.hidden ? '#475569' : item.color }}
              />
              {item.label}
              <span className="tabular-nums text-slate-400">
                {value == null ? '—' : item.valueFormat(value)}
              </span>
            </button>
          );
        })}
      </div>
      <div
        ref={hostRef}
        className="w-full"
        style={{ minHeight: height }}
        role="img"
        aria-label={`History chart: ${series.map((item) => item.label).join(', ')}`}
      />
    </div>
  );
}
