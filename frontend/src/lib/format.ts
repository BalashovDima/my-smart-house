const DASH = '—';

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatVolts(mv: unknown, digits = 3): string {
  const value = finite(mv);
  return value === null ? DASH : `${(value / 1000).toFixed(digits)} V`;
}

export function formatMv(mv: unknown): string {
  const value = finite(mv);
  return value === null ? DASH : `${Math.round(value)} mV`;
}

export function formatRssi(rssi: unknown): string {
  const value = finite(rssi);
  return value === null ? DASH : `${Math.round(value)} dBm`;
}

export function formatUptime(ms: unknown): string {
  const value = finite(ms);
  if (value === null) return DASH;

  const total = Math.max(0, Math.floor(value / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

/** Compact "2 min ago" label for polling dashboards. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return DASH;

  const diff = Math.max(0, now - timestamp);
  if (diff < 45_000) return 'just now';
  if (diff < 120_000) return '1 min ago';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 7_200_000) return '1 h ago';
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return DASH;
  return new Date(timestamp).toLocaleString();
}

export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value || DASH;
  return JSON.stringify(value);
}
