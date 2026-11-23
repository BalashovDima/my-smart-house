import type { Device, Health, SamplesResponse } from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(`Cannot reach the server at ${API_BASE}`);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page (reverse proxy, wrong port, ...).
  }

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message);
  }

  return body as T;
}

export function fetchDevices(signal?: AbortSignal): Promise<Device[]> {
  return getJson<Device[]>('/devices', signal);
}

export function fetchDevice(id: string, signal?: AbortSignal): Promise<Device> {
  return getJson<Device>(`/devices/${encodeURIComponent(id)}`, signal);
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>('/health', signal);
}

export interface SampleQuery {
  from: number;
  to: number;
  step: number;
  limit: number;
}

export function fetchSamples(
  id: string,
  query: SampleQuery,
  signal?: AbortSignal,
): Promise<SamplesResponse> {
  const params = new URLSearchParams({
    from: String(query.from),
    to: String(query.to),
    step: String(query.step),
    limit: String(query.limit),
  });
  return getJson<SamplesResponse>(
    `/devices/${encodeURIComponent(id)}/samples?${params.toString()}`,
    signal,
  );
}
