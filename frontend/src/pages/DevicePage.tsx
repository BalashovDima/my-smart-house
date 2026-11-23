import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchDevice, fetchSamples } from '../api';
import { Dot, StatusPill } from '../components/StatusPill';
import { rendererFor } from '../devices';
import { usePolling } from '../hooks/usePolling';
import { formatRelative } from '../lib/format';
import { DEFAULT_RANGE, rangeWindow, type RangeKey } from '../lib/ranges';

export function DevicePage() {
  const { id = '' } = useParams<{ id: string }>();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);

  const deviceQuery = usePolling((signal) => fetchDevice(id, signal), 10_000, [id]);
  const samplesQuery = usePolling(
    (signal) => fetchSamples(id, rangeWindow(range), signal),
    30_000,
    [id, range],
  );

  // The previous device's data survives in the poller between route changes;
  // ignore it until the response matches the id in the URL.
  const device = deviceQuery.data?.id === id ? deviceQuery.data : null;
  const samples =
    samplesQuery.data?.device === id ? samplesQuery.data.samples : null;

  useEffect(() => {
    document.title = device ? `${device.name || device.id} · Smart house` : 'Smart house';
  }, [device]);

  if (!device) {
    if (deviceQuery.error) {
      return (
        <div className="space-y-4">
          <Link to="/" className="text-xs text-slate-400 hover:text-sky-300">
            ← All devices
          </Link>
          <div className="rounded-xl border border-rose-800/60 bg-rose-500/5 p-6">
            <h1 className="text-lg font-semibold text-rose-200">Device unavailable</h1>
            <p className="mt-1 text-sm text-rose-200/70">{deviceQuery.error}</p>
            <button
              type="button"
              onClick={deviceQuery.refresh}
              className="mt-4 rounded-lg border border-rose-700/60 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800" />
        <div className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40" />
      </div>
    );
  }

  const Detail = rendererFor(device).Detail;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link to="/" className="text-xs text-slate-400 hover:text-sky-300">
          ← All devices
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {device.name || device.id}
            </h1>
            <p className="text-sm text-slate-400">
              {device.id} · {device.type || 'unknown type'}
              {device.fw ? ` · fw ${device.fw}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={device.online ? 'green' : 'slate'}>
              <Dot tone={device.online ? 'green' : 'slate'} />
              {device.online ? 'Online' : 'Offline'}
            </StatusPill>
            <StatusPill>Last sample {formatRelative(device.lastSeen)}</StatusPill>
          </div>
        </div>
      </div>

      <Detail
        device={device}
        samples={samples}
        range={range}
        onRangeChange={setRange}
        historyError={samplesQuery.error}
      />

      <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">
          Latest payload
        </summary>
        {device.latest ? (
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
            {JSON.stringify(device.latest, null, 2)}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No payload stored yet.</p>
        )}
      </details>
    </div>
  );
}
