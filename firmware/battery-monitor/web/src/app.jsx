import { useEffect, useRef, useState } from 'preact/hooks';

const CHANNEL_COUNT = 4;

function emptyCalibration() {
  return Array.from({ length: CHANNEL_COUNT }, () => ({ scale: 1, offsetMv: 0 }));
}

function emptyPoints() {
  return Array.from({ length: CHANNEL_COUNT }, () => ({
    aRaw: '',
    aCell: '',
    bRaw: '',
    bCell: '',
  }));
}

async function request(path, options) {
  const response = await fetch(path, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page.
  }
  if (!response.ok) {
    throw new Error(body?.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

function postJson(path, payload) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const formatVolts = (mv) => (Number(mv) / 1000).toFixed(3);

function formatUptime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function Pill({ children, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-700 bg-slate-800/70 text-slate-300',
    green: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-600/50 bg-amber-500/10 text-amber-200',
    rose: 'border-rose-600/50 bg-rose-500/10 text-rose-300',
  };
  return (
    <span class={`rounded-full border px-2.5 py-1 font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function PointRow({ label, raw, cell, onRaw, onCell, onUseLive }) {
  return (
    <div class="grid grid-cols-[1.5rem_1fr_1fr] items-end gap-2">
      <span class="pb-2 font-semibold text-slate-400">{label}</span>
      <label class="block">
        <span class="mb-1 block text-slate-400">ADC pin mV</span>
        <div class="flex gap-1">
          <input
            type="number"
            step="any"
            value={raw}
            onInput={(event) => onRaw(event.currentTarget.value)}
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onUseLive}
            title="Use the current live ADC reading"
            class="rounded border border-slate-700 px-2 text-slate-300 hover:border-sky-500 hover:text-sky-300"
          >
            live
          </button>
        </div>
      </label>
      <label class="block">
        <span class="mb-1 block text-slate-400">Actual cell mV</span>
        <input
          type="number"
          step="any"
          value={cell}
          onInput={(event) => onCell(event.currentTarget.value)}
          placeholder="from multimeter"
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus:border-sky-500 focus:outline-none"
        />
      </label>
    </div>
  );
}

function CellCard({ index, channel, cal, points, error, onCal, onPoint, onUseLive, onApply }) {
  const scale = numberOr(cal.scale, NaN);
  const offsetMv = numberOr(cal.offsetMv, NaN);
  const previewValid = Number.isFinite(scale) && Number.isFinite(offsetMv);
  const previewMv = previewValid ? scale * channel.pinMv + offsetMv : null;

  return (
    <section class="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex items-baseline justify-between">
        <h2 class="font-medium">Cell {index + 1}</h2>
        <span class="text-xs text-slate-400">GPIO {channel.gpio}</span>
      </div>

      <div class="tabular-nums">
        <span class={`text-3xl font-semibold ${previewValid ? '' : 'text-rose-400'}`}>
          {previewValid ? formatVolts(previewMv) : '—'}
        </span>
        <span class="ml-1 text-base text-slate-400">V</span>
        <span class="ml-2 text-xs text-slate-500">preview</span>
      </div>

      <dl class="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt class="text-slate-400">Pin</dt>
          <dd class="tabular-nums">{channel.pinMv} mV</dd>
        </div>
        <div>
          <dt class="text-slate-400">Raw</dt>
          <dd class="tabular-nums">{channel.raw}</dd>
        </div>
        <div>
          <dt class="text-slate-400">Saved</dt>
          <dd class="tabular-nums">{formatVolts(channel.cellMv)} V</dd>
        </div>
      </dl>

      <div class="grid grid-cols-2 gap-2 text-xs">
        <label class="block">
          <span class="mb-1 block text-slate-400">Scale</span>
          <input
            type="number"
            step="any"
            value={cal.scale}
            onInput={(event) => onCal({ scale: event.currentTarget.value })}
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-slate-400">Offset mV</span>
          <input
            type="number"
            step="any"
            value={cal.offsetMv}
            onInput={(event) => onCal({ offsetMv: event.currentTarget.value })}
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </label>
      </div>

      <details class="rounded-lg bg-slate-950/70 p-3 text-xs">
        <summary class="cursor-pointer text-slate-300">Two-point calibration</summary>
        <p class="mt-2 text-slate-500">
          Apply two known cell voltages with a bench supply or calibrator. Raw
          values are the ADC pin mV readings at each point.
        </p>
        <div class="mt-3 space-y-2">
          <PointRow
            label="A"
            raw={points.aRaw}
            cell={points.aCell}
            onRaw={(value) => onPoint({ aRaw: value })}
            onCell={(value) => onPoint({ aCell: value })}
            onUseLive={() => onUseLive('aRaw')}
          />
          <PointRow
            label="B"
            raw={points.bRaw}
            cell={points.bCell}
            onRaw={(value) => onPoint({ bRaw: value })}
            onCell={(value) => onPoint({ bCell: value })}
            onUseLive={() => onUseLive('bRaw')}
          />
        </div>
        <button
          type="button"
          onClick={onApply}
          class="mt-3 rounded border border-sky-600/60 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20"
        >
          Compute scale &amp; offset
        </button>
        {error ? <p class="mt-2 text-rose-400">{error}</p> : null}
      </details>
    </section>
  );
}

export function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cal, setCal] = useState(emptyCalibration);
  const [points, setPoints] = useState(emptyPoints);
  const [calErrors, setCalErrors] = useState(() => Array(CHANNEL_COUNT).fill(''));
  const [savingCal, setSavingCal] = useState(false);
  const [wifiForm, setWifiForm] = useState({ ssid: '', password: '' });
  const [networks, setNetworks] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (rebooting) return undefined;

    let cancelled = false;
    const tick = async () => {
      try {
        const data = await request('/api/status');
        if (!cancelled) {
          setStatus(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };

    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rebooting]);

  useEffect(() => {
    if (!status || hydrated.current) return;
    hydrated.current = true;
    setCal(
      status.channels.map((channel) => ({
        scale: channel.calibration.scale,
        offsetMv: channel.calibration.offsetMv,
      })),
    );
    if (status.wifi.staConnected) {
      setWifiForm((form) => ({ ...form, ssid: status.wifi.ssid }));
    }
  }, [status]);

  const refreshStatus = async () => {
    try {
      setStatus(await request('/api/status'));
    } catch (err) {
      setError(err.message);
    }
  };

  const updateCal = (index, patch) => {
    setCal((prev) => prev.map((value, i) => (i === index ? { ...value, ...patch } : value)));
  };

  const updatePoint = (index, patch) => {
    setPoints((prev) => prev.map((value, i) => (i === index ? { ...value, ...patch } : value)));
  };

  const setCalError = (index, message) => {
    setCalErrors((prev) => prev.map((value, i) => (i === index ? message : value)));
  };

  const useLiveReading = (index, field) => {
    const mv = status?.channels?.[index]?.pinMv;
    if (mv === undefined) return;
    updatePoint(index, { [field]: String(mv) });
  };

  const applyPoints = (index) => {
    const p = points[index];
    if (p.aRaw === '' || p.aCell === '' || p.bRaw === '' || p.bCell === '') {
      setCalError(index, 'Fill all four fields.');
      return;
    }
    const aRaw = Number(p.aRaw);
    const aCell = Number(p.aCell);
    const bRaw = Number(p.bRaw);
    const bCell = Number(p.bCell);
    if (![aRaw, aCell, bRaw, bCell].every(Number.isFinite)) {
      setCalError(index, 'Values must be numbers.');
      return;
    }
    const rawDelta = bRaw - aRaw;
    if (Math.abs(rawDelta) < 1) {
      setCalError(index, 'Point A and B raw readings are too close.');
      return;
    }
    const scale = (bCell - aCell) / rawDelta;
    const offsetMv = aCell - scale * aRaw;
    if (!(scale > 0)) {
      setCalError(index, 'Computed scale must be positive.');
      return;
    }
    if (Math.abs(offsetMv) > 20000) {
      setCalError(index, 'Computed offset is out of range.');
      return;
    }
    updateCal(index, {
      scale: Number(scale.toFixed(6)),
      offsetMv: Number(offsetMv.toFixed(2)),
    });
    setCalError(index, '');
  };

  const savedCalibration = status
    ? status.channels.map((channel) => ({
        scale: Number(channel.calibration.scale),
        offsetMv: Number(channel.calibration.offsetMv),
      }))
    : null;
  const calibrationDirty =
    savedCalibration !== null &&
    JSON.stringify(savedCalibration) !==
      JSON.stringify(
        cal.map((c) => ({ scale: numberOr(c.scale), offsetMv: numberOr(c.offsetMv) })),
      );

  const saveCalibration = async () => {
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const scale = numberOr(cal[i].scale, NaN);
      const offsetMv = numberOr(cal[i].offsetMv, NaN);
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offsetMv)) {
        setCalError(i, 'Scale must be greater than 0 and offset must be a number.');
        return;
      }
    }

    setSavingCal(true);
    setError('');
    setNotice('');
    try {
      await postJson('/api/calibration', {
        channels: cal.map((c) => ({
          scale: numberOr(c.scale),
          offsetMv: numberOr(c.offsetMv),
        })),
      });
      setNotice('Calibration saved to NVS.');
      await refreshStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCal(false);
    }
  };

  const scanNetworks = async () => {
    setScanning(true);
    setError('');
    try {
      const data = await request('/api/wifi/scan');
      setNetworks(data.networks || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const saveWifi = async (event) => {
    event.preventDefault();
    const ssid = wifiForm.ssid.trim();
    const password = wifiForm.password;
    if (!ssid) {
      setError('SSID is required.');
      return;
    }
    if (password.length > 0 && password.length < 8) {
      setError('Password must be empty (open network) or at least 8 characters.');
      return;
    }

    setConnecting(true);
    setError('');
    try {
      await postJson('/api/wifi', { ssid, password });
      setRebooting(true);
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  };

  const factoryReset = async () => {
    if (!window.confirm('Erase Wi-Fi credentials and calibration, then reboot?')) {
      return;
    }
    setError('');
    try {
      await request('/api/factory-reset', { method: 'POST' });
      setRebooting(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (rebooting) {
    return (
      <main class="grid min-h-screen place-items-center p-6">
        <div class="max-w-md space-y-3 text-center">
          <h1 class="text-xl font-semibold">Rebooting…</h1>
          <p class="text-sm text-slate-400">
            The device is applying the new configuration. Reconnect to your
            network and open{' '}
            <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
              {status?.wifi?.hostname || 'battmon-XXXX'}.local
            </code>
            . If the network is unreachable it falls back to the{' '}
            <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
              {status?.wifi?.apSsid || 'BattMon-XXXX'}
            </code>{' '}
            access point.
          </p>
        </div>
      </main>
    );
  }

  const wifi = status?.wifi;
  const stale = status && status.lastSampleAgeMs > 5000;

  return (
    <div class="min-h-screen">
      <header class="border-b border-slate-800 bg-slate-900/60">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5">
          <div>
            <h1 class="text-xl font-semibold">Battery Monitor</h1>
            <p class="text-sm text-slate-400">LiFePO4 cell voltages · ESP32</p>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            {wifi ? (
              <>
                <Pill tone={wifi.staConnected ? 'green' : 'amber'}>{wifi.mode}</Pill>
                <Pill>{wifi.ip}</Pill>
                {wifi.staConnected ? <Pill>{wifi.rssi} dBm</Pill> : null}
              </>
            ) : (
              <Pill tone="rose">offline</Pill>
            )}
            {status ? (
              <>
                <Pill>v{status.version}</Pill>
                <Pill>up {formatUptime(status.uptimeMs)}</Pill>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {error ? (
          <div class="rounded-lg border border-rose-600/50 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {status && !status.calibrated ? (
          <div class="rounded-lg border border-amber-600/50 bg-amber-500/10 p-4 text-sm text-amber-200">
            Readings are uncalibrated: scale 1.0 / offset 0 mV. Run the two-point
            calibration below and save.
          </div>
        ) : null}

        {stale ? (
          <div class="rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-sm text-amber-200">
            Sampling is stale (last update {Math.round(status.lastSampleAgeMs / 1000)} s
            ago).
          </div>
        ) : null}

        <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p class="text-xs uppercase tracking-wide text-slate-400">Pack</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">
              {status ? formatVolts(status.packMv) : '—'}
              <span class="ml-1 text-sm text-slate-400">V</span>
            </p>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p class="text-xs uppercase tracking-wide text-slate-400">Min / max</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">
              {status ? formatVolts(status.minCellMv) : '—'}
              <span class="mx-1 text-sm text-slate-500">/</span>
              {status ? formatVolts(status.maxCellMv) : '—'}
              <span class="ml-1 text-sm text-slate-400">V</span>
            </p>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p class="text-xs uppercase tracking-wide text-slate-400">Spread</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">
              {status ? status.spreadMv : '—'}
              <span class="ml-1 text-sm text-slate-400">mV</span>
            </p>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p class="text-xs uppercase tracking-wide text-slate-400">Sample</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">
              {status && status.lastSampleAgeMs >= 0
                ? `${(status.lastSampleAgeMs / 1000).toFixed(1)} s ago`
                : '—'}
            </p>
          </div>
        </section>

        <section class="space-y-3">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">Cells</h2>
              <p class="text-sm text-slate-400">
                Preview uses the unsaved scale/offset. “Saved” is what the
                firmware currently applies.
              </p>
            </div>
            <div class="flex items-center gap-3">
              {calibrationDirty ? (
                <span class="text-xs text-amber-300">Unsaved changes</span>
              ) : null}
              {notice ? <span class="text-xs text-emerald-300">{notice}</span> : null}
              <button
                type="button"
                onClick={saveCalibration}
                disabled={savingCal || !calibrationDirty}
                class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {savingCal ? 'Saving…' : 'Save calibration'}
              </button>
            </div>
          </div>

          {status ? (
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {status.channels.map((channel, index) => (
                <CellCard
                  key={channel.index}
                  index={index}
                  channel={channel}
                  cal={cal[index]}
                  points={points[index]}
                  error={calErrors[index]}
                  onCal={(patch) => updateCal(index, patch)}
                  onPoint={(patch) => updatePoint(index, patch)}
                  onUseLive={(field) => useLiveReading(index, field)}
                  onApply={() => applyPoints(index)}
                />
              ))}
            </div>
          ) : (
            <p class="text-sm text-slate-400">Waiting for the first sample…</p>
          )}
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">Wi-Fi</h2>
              <p class="text-sm text-slate-400">
                Saving reboots the device. Leave the password blank to keep the
                current one; a blank password with a new SSID joins an open
                network. The config AP stays available as a fallback when the
                network cannot be reached.
              </p>
            </div>
            {wifi ? (
              <div class="text-right text-xs text-slate-400">
                <p>
                  host{' '}
                  <span class="text-slate-200">{wifi.hostname}.local</span>
                </p>
                {wifi.apSsid ? (
                  <p>
                    AP <span class="text-slate-200">{wifi.apSsid}</span> ·{' '}
                    {wifi.apIp}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <button
                type="button"
                onClick={scanNetworks}
                disabled={scanning}
                class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
              >
                {scanning ? 'Scanning…' : 'Scan networks'}
              </button>
              {networks === null ? (
                <p class="text-xs text-slate-500">
                  Scan briefly interrupts the AP fallback and takes a few seconds.
                </p>
              ) : networks.length === 0 ? (
                <p class="text-xs text-slate-500">No networks found.</p>
              ) : (
                <ul class="max-h-64 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
                  {networks.map((network) => (
                    <li key={`${network.ssid}-${network.channel}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setWifiForm((form) => ({ ...form, ssid: network.ssid }))
                        }
                        class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-800/60"
                      >
                        <span>
                          {network.ssid || '(hidden)'}
                          {network.secure ? (
                            <span class="ml-2 text-xs text-slate-500">secured</span>
                          ) : null}
                        </span>
                        <span class="text-xs tabular-nums text-slate-400">
                          {network.rssi} dBm · ch {network.channel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form class="space-y-3" onSubmit={saveWifi}>
              <label class="block text-sm">
                <span class="mb-1 block text-slate-400">SSID</span>
                <input
                  value={wifiForm.ssid}
                  onInput={(event) =>
                    setWifiForm((form) => ({ ...form, ssid: event.currentTarget.value }))
                  }
                  autocomplete="off"
                  class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block text-slate-400">Password</span>
                <input
                  type="password"
                  value={wifiForm.password}
                  onInput={(event) =>
                    setWifiForm((form) => ({
                      ...form,
                      password: event.currentTarget.value,
                    }))
                  }
                  autocomplete="new-password"
                  placeholder="blank = keep current / open network"
                  class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
                />
              </label>
              <div class="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={connecting}
                  class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {connecting ? 'Saving…' : 'Save & reboot'}
                </button>
                <button
                  type="button"
                  onClick={factoryReset}
                  class="rounded-lg border border-rose-700/60 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/10"
                >
                  Factory reset
                </button>
              </div>
            </form>
          </div>
        </section>

        <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4 text-xs text-slate-500">
          <span>
            REST: <code>GET /api/status</code>, <code>POST /api/calibration</code>,{' '}
            <code>GET /api/wifi/scan</code>, <code>POST /api/wifi</code>,{' '}
            <code>POST /api/factory-reset</code>
          </span>
          <span>ADC {status ? status.channels.map((c) => c.gpio).join('/') : '32/33/34/35'}</span>
        </footer>
      </main>
    </div>
  );
}
