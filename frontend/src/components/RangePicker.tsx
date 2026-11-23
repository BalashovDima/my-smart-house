import { RANGES, type RangeKey } from '../lib/ranges';

export function RangePicker({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (range: RangeKey) => void;
}) {
  return (
    <div
      role="group"
      aria-label="History range"
      className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-1"
    >
      {RANGES.map((range) => {
        const active = range.key === value;
        return (
          <button
            key={range.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(range.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-sky-500/20 text-sky-200'
                : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
            }`}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
