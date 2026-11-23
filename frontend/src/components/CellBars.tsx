import { formatVolts } from '../lib/format';

// LiFePO4 cell range used only to scale the bars. This is not a state-of-charge
// estimate; the repo has no per-device chemistry configuration.
const CELL_MIN_MV = 2_500;
const CELL_MAX_MV = 3_650;

export function CellBars({
  cellsMv,
  compact = false,
}: {
  cellsMv?: number[] | null;
  compact?: boolean;
}) {
  const cells = Array.isArray(cellsMv) ? cellsMv : [];

  if (cells.length === 0) {
    return <p className="text-sm text-slate-500">No cell voltages reported.</p>;
  }

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {cells.map((mv, index) => {
        const pct = Math.max(
          0,
          Math.min(100, ((mv - CELL_MIN_MV) / (CELL_MAX_MV - CELL_MIN_MV)) * 100),
        );
        return (
          <div
            key={index}
            className="rounded-lg border border-slate-800 bg-slate-950/60 p-2"
            title={`Cell ${index + 1}: ${formatVolts(mv)} (bar scale ${CELL_MIN_MV}–${CELL_MAX_MV} mV)`}
          >
            <div
              className={`relative w-full overflow-hidden rounded bg-slate-800/80 ${
                compact ? 'h-14' : 'h-24'
              }`}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded bg-gradient-to-t from-emerald-600/80 to-emerald-400/80"
                style={{ height: `${pct}%` }}
              />
            </div>
            <div
              className={`mt-2 text-xs ${
                compact ? 'space-y-0.5' : 'flex items-baseline justify-between gap-1'
              }`}
            >
              <span className="text-slate-400">C{index + 1}</span>
              <span className="whitespace-nowrap font-medium tabular-nums text-slate-100">
                {formatVolts(mv, 3)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
