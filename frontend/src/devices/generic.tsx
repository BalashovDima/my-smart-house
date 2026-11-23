import { Link } from 'react-router-dom';
import { RangePicker } from '../components/RangePicker';
import { Dot, StatusPill } from '../components/StatusPill';
import { formatDateTime, formatRelative, formatScalar } from '../lib/format';
import type { Device, Telemetry } from '../types';
import type { DetailProps } from './types';

function scalarEntries(latest?: Telemetry): [string, unknown][] {
  if (!latest) return [];
  return Object.entries(latest).filter(
    ([key, value]) =>
      !['v', 'id', 'type', 'fw'].includes(key) &&
      (typeof value === 'number' ||
        typeof value === 'string' ||
        typeof value === 'boolean'),
  );
}

export function GenericSummaryCard({ device }: { device: Device }) {
  const entries = scalarEntries(device.latest).slice(0, 6);

  return (
    <Link
      to={`/devices/${encodeURIComponent(device.id)}`}
      className="group flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-sky-700/70 hover:bg-slate-900/80 focus-visible:border-sky-500 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-100">
            {device.name || device.id}
          </h2>
          <p className="truncate text-xs text-slate-500">{device.type || 'unknown type'}</p>
        </div>
        <StatusPill tone={device.online ? 'green' : 'slate'}>
          <Dot tone={device.online ? 'green' : 'slate'} />
          {device.online ? 'Online' : 'Offline'}
        </StatusPill>
      </div>

      {entries.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {entries.map(([key, value]) => (
            <div key={key} className="flex min-w-0 justify-between gap-2">
              <dt className="truncate text-slate-500">{key}</dt>
              <dd className="truncate font-medium tabular-nums text-slate-200">
                {formatScalar(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-slate-500">No telemetry received yet.</p>
      )}

      <div className="mt-auto flex items-center justify-between text-xs text-slate-500">
        <span>{device.lastSeen ? `Seen ${formatRelative(device.lastSeen)}` : 'No samples yet'}</span>
        <span className="text-sky-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  );
}

export function GenericDetail({
  device,
  samples,
  range,
  onRangeChange,
  historyError,
}: DetailProps) {
  const entries = scalarEntries(device.latest);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Latest values</h2>
        {entries.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {entries.map(([key, value]) => (
              <div key={key} className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                <dt className="truncate text-[0.7rem] uppercase tracking-wide text-slate-500">
                  {key}
                </dt>
                <dd className="truncate font-medium tabular-nums text-slate-100">
                  {formatScalar(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No telemetry received yet.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">History</h2>
            <p className="text-xs text-slate-500">
              {device.type} has no chart renderer yet; recent raw samples are shown
              below.
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
        ) : samples.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No samples in this range yet.
          </p>
        ) : (
          <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                    Received
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Payload
                  </th>
                </tr>
              </thead>
              <tbody>
                {samples
                  .slice(-50)
                  .reverse()
                  .map((sample) => (
                    <tr key={sample.ts} className="border-t border-slate-800/70">
                      <td className="whitespace-nowrap px-3 py-1.5 align-top text-slate-400">
                        {formatDateTime(sample.ts)}
                      </td>
                      <td className="break-all px-3 py-1.5 font-mono text-[0.7rem] text-slate-300">
                        {JSON.stringify(sample.data)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
