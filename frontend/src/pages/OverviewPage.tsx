import { useEffect } from 'react';
import { fetchDevices } from '../api';
import { rendererFor } from '../devices';
import { usePolling } from '../hooks/usePolling';

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-4 h-4 w-1/2 rounded bg-slate-800" />
      <div className="mb-2 h-8 w-1/3 rounded bg-slate-800" />
      <div className="h-14 rounded bg-slate-800/80" />
    </div>
  );
}

export function OverviewPage() {
  const { data, error, loading, refresh } = usePolling(
    (signal) => fetchDevices(signal),
    10_000,
    [],
  );
  const devices = data ?? [];

  useEffect(() => {
    document.title = 'Smart house';
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="text-sm text-slate-400">
            {data
              ? `${devices.length} device${devices.length === 1 ? '' : 's'}`
              : 'Loading devices…'}
            {data && error ? ' · showing last known data' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-300"
        >
          Refresh
        </button>
      </div>

      {error && !data ? (
        <div className="rounded-xl border border-rose-800/60 bg-rose-500/5 p-6">
          <h2 className="text-sm font-semibold text-rose-200">Could not load devices</h2>
          <p className="mt-1 text-sm text-rose-200/70">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 rounded-lg border border-rose-700/60 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {data && devices.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <h2 className="text-sm font-semibold text-slate-200">No devices yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Configure a device's MQTT panel with the broker, topic prefix, and
            publish interval. It appears here after the first sample reaches the
            server.
          </p>
        </div>
      ) : null}

      {devices.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => {
            const SummaryCard = rendererFor(device).SummaryCard;
            return <SummaryCard key={device.id} device={device} />;
          })}
        </div>
      ) : null}
    </div>
  );
}
