import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fetchHealth } from '../api';
import { usePolling, type PollingResult } from '../hooks/usePolling';
import { formatRelative } from '../lib/format';
import type { Health } from '../types';
import { Dot, type Tone } from './StatusPill';

function healthView(health: Pick<PollingResult<Health>, 'data' | 'error'>) {
  if (health.error) return { tone: 'rose' as Tone, label: 'API offline' };
  if (!health.data) return { tone: 'slate' as Tone, label: 'Connecting…' };
  if (!health.data.db.ok) return { tone: 'rose' as Tone, label: 'DB error' };
  if (!health.data.mqtt.connected) return { tone: 'amber' as Tone, label: 'MQTT down' };
  return { tone: 'green' as Tone, label: 'MQTT live' };
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: 'amber' | 'rose';
  title: string;
  children: ReactNode;
}) {
  const styles =
    tone === 'rose'
      ? 'border-rose-700/60 bg-rose-500/10 text-rose-200'
      : 'border-amber-700/60 bg-amber-500/10 text-amber-100';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm ${styles}`}
    >
      <span className="font-semibold">{title}</span>
      <span className="text-xs opacity-80">{children}</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const health = usePolling((signal) => fetchHealth(signal), 30_000, []);
  const status = healthView(health);
  const lastMessage = health.data?.mqtt.lastMessageAt;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
            Smart house
          </Link>
          <div
            className="flex items-center gap-2 text-xs text-slate-400"
            title={
              lastMessage
                ? `Last MQTT message ${formatRelative(lastMessage)} (${new Date(lastMessage).toLocaleString()})`
                : 'No MQTT messages received since the server started'
            }
          >
            <Dot tone={status.tone} />
            <span>{status.label}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
        {health.error ? (
          <Banner tone="rose" title="Server unreachable">
            {health.error}. Retrying every 30 s.
          </Banner>
        ) : null}
        {health.data && !health.data.db.ok ? (
          <Banner tone="rose" title="Database unavailable">
            The API cannot read its SQLite store, so history and devices may be
            missing.
          </Banner>
        ) : null}
        {health.data && health.data.db.ok && !health.data.mqtt.connected ? (
          <Banner tone="amber" title="MQTT broker disconnected">
            {lastMessage
              ? `Telemetry may be stale; the last message arrived ${formatRelative(lastMessage)}.`
              : 'No telemetry received yet. Check the broker address and credentials.'}
          </Banner>
        ) : null}

        {children}
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-slate-600">
        Read-only dashboard · data from the smarthouse server
      </footer>
    </div>
  );
}
