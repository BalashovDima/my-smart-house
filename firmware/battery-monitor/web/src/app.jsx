import { useEffect, useRef, useState } from 'preact/hooks';

import { fitLinear, fitTone } from './fit.js';

const CHANNEL_COUNT = 4;
const POINTS_KEY = 'battmon.calPoints.v1';
const MAX_POINTS = 50;

function emptyCalibration() {
  return Array.from({ length: CHANNEL_COUNT }, () => ({ scale: 1, offsetMv: 0 }));
}

function emptyFits() {
  return Array(CHANNEL_COUNT).fill(null);
}

function makeId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function emptyPoint() {
  return {
    id: makeId(),
    label: '',
    capturedAt: '',
    cells: Array.from({ length: CHANNEL_COUNT }, () => ({ cell: '', pin: '' })),
  };
}

function normalizePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    label: typeof raw.label === 'string' ? raw.label : '',
    capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : '',
    cells: Array.from({ length: CHANNEL_COUNT }, (_, index) => {
      const cell = raw.cells?.[index] ?? {};
      return {
        cell: typeof cell.cell === 'string' ? cell.cell : '',
        pin: typeof cell.pin === 'string' ? cell.pin : '',
      };
    }),
  };
}

function loadPoints() {
  try {
    const raw = window.localStorage.getItem(POINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_POINTS).map(normalizePoint).filter(Boolean);
  } catch {
    return [];
  }
}

function storePoints(points) {
  try {
    window.localStorage.setItem(POINTS_KEY, JSON.stringify(points.slice(0, MAX_POINTS)));
  } catch {
    // Private mode or quota: points simply do not survive a reload.
  }
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

const textOr = (value) => (typeof value === 'string' ? value.trim() : '');

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

function fitSummary(fit) {
  return `${fit.n} pts · rms ${fit.rmsMv.toFixed(1)} mV · max ${fit.maxResidualMv.toFixed(1)} mV`;
}

function fitTextTone(fit) {
  const tone = fitTone(fit);
  if (tone === 'green') return 'text-emerald-300';
  if (tone === 'amber') return 'text-amber-300';
  return 'text-rose-400';
}

const inputClass =
  'w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus:border-sky-500 focus:outline-none';

function PointCell({ channel, value, onChange, onUseLive }) {
  return (
    <div class="flex flex-col gap-1">
      <input
        type="number"
        step="any"
        value={value.cell}
        placeholder="cell mV"
        onInput={(event) => onChange({ cell: event.currentTarget.value })}
        class={inputClass}
        aria-label={`Cell ${channel + 1} multimeter mV`}
      />
      <div class="flex gap-1">
        <input
          type="number"
          step="any"
          value={value.pin}
          placeholder="pin mV"
          onInput={(event) => onChange({ pin: event.currentTarget.value })}
          class={inputClass}
          aria-label={`Cell ${channel + 1} ADC pin mV`}
        />
        <button
          type="button"
          onClick={onUseLive}
          title="Use the current live ADC reading"
          class="shrink-0 rounded border border-slate-700 px-2 text-slate-300 hover:border-sky-500 hover:text-sky-300"
        >
          live
        </button>
      </div>
    </div>
  );
}

function CalibrationPanel({
  livePins,
  points,
  stale,
  hasSample,
  adcCalSource,
  fitErrors,
  onAddRow,
  onCaptureAll,
  onClear,
  onRowChange,
  onCellChange,
  onUseLive,
  onDeleteRow,
  onFit,
}) {
  const canCapture = !stale && hasSample && livePins.length === CHANNEL_COUNT;

  return (
    <section class="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Calibration points</h2>
          <p class="text-sm text-slate-400">
            One row per pack state. Measure the cell voltage with a multimeter
            across the board's sense pins (pack at rest, charger and load off),
            capture the matching ADC pin mV, and repeat after the pack has
            discharged by at least 200 mV per cell. Three or more rows give a
            residual you can judge.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          {adcCalSource ? (
            <Pill tone={adcCalSource === 'default-vref' ? 'amber' : 'green'}>
              ADC {adcCalSource}
            </Pill>
          ) : null}
          <Pill>{points.length} row{points.length === 1 ? '' : 's'}</Pill>
        </div>
      </div>

      {adcCalSource === 'default-vref' ? (
        <p class="text-xs text-amber-300">
          The ESP32 has no eFuse ADC calibration data, so pin mV uses a nominal
          reference. The fit still corrects the front end, but expect a few mV
          more error.
        </p>
      ) : null}

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCaptureAll}
          disabled={!canCapture}
          class="rounded-lg border border-sky-600/60 bg-sky-500/10 px-3 py-1.5 text-sm font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Capture all live
        </button>
        <button
          type="button"
          onClick={onAddRow}
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:border-sky-500 hover:text-sky-300"
        >
          Add empty row
        </button>
        <button
          type="button"
          onClick={onFit}
          disabled={points.length === 0}
          class="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          Fit all channels
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={points.length === 0}
          class="rounded-lg border border-rose-700/60 px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear points
        </button>
        {stale ? (
          <span class="text-xs text-amber-300">
            Sample is stale; live capture is disabled.
          </span>
        ) : null}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[44rem] border-collapse text-xs">
          <thead>
            <tr class="text-left text-slate-400">
              <th class="w-40 pb-2 font-medium">State</th>
              {Array.from({ length: CHANNEL_COUNT }, (_, index) => (
                <th key={index} class="pb-2 pl-2 font-medium">
                  Cell {index + 1}
                  <span class="ml-1 font-normal text-slate-500 tabular-nums">
                    live {hasSample ? (livePins[index] ?? '—') : '—'} mV
                  </span>
                </th>
              ))}
              <th class="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {points.length === 0 ? (
              <tr>
                <td colspan={CHANNEL_COUNT + 2} class="py-3 text-slate-500">
                  No points yet. Capture the current pack state, or add a row and
                  type the values in.
                </td>
              </tr>
            ) : null}
            {points.map((point, rowIndex) => (
              <tr key={point.id} class="border-t border-slate-800 align-top">
                <td class="py-2 pr-2">
                  <input
                    value={point.label}
                    placeholder={`point ${rowIndex + 1}`}
                    onInput={(event) => onRowChange(point.id, { label: event.currentTarget.value })}
                    class={inputClass}
                  />
                  {point.capturedAt && !Number.isNaN(new Date(point.capturedAt).getTime()) ? (
                    <span class="mt-1 block text-[0.65rem] text-slate-500">
                      {new Date(point.capturedAt).toLocaleString()}
                    </span>
                  ) : null}
                </td>
                {point.cells.map((value, channelIndex) => (
                  <td key={channelIndex} class="py-2 pl-2">
                    <PointCell
                      channel={channelIndex}
                      value={value}
                      onChange={(patch) => onCellChange(point.id, channelIndex, patch)}
                      onUseLive={() => onUseLive(point.id, channelIndex)}
                    />
                  </td>
                ))}
                <td class="py-2 pl-2 align-middle">
                  <button
                    type="button"
                    title="Delete this point"
                    onClick={() => onDeleteRow(point.id)}
                    class="rounded border border-slate-800 px-2 py-1 text-slate-500 hover:border-rose-600/60 hover:text-rose-300"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fitErrors.some(Boolean) ? (
        <div class="space-y-1 text-xs text-rose-300">
          {fitErrors.map((message, index) =>
            message ? (
              <p key={index}>
                Cell {index + 1}: {message}
              </p>
            ) : null,
          )}
        </div>
      ) : null}
    </section>
  );
}

function CellCard({ index, channel, cal, fit, error, onCal }) {
  const scale = numberOr(cal.scale, NaN);
  const offsetMv = numberOr(cal.offsetMv, NaN);
  const previewValid = Number.isFinite(scale) && Number.isFinite(offsetMv);
  const previewMv = previewValid ? scale * channel.pinMv + offsetMv : null;
  const savedFit = channel.calibration?.fit;
  const hasSavedFit = savedFit && savedFit.points > 0;

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

      <div class="space-y-1 text-xs">
        {fit && !fit.error ? (
          <p class={fitTextTone(fit)}>
            Fit: {fitSummary(fit)}
            <span class="ml-1 text-slate-500">
              (span {Math.round(fit.pinSpanMv)} mV
              {fit.ignoredRows > 0
                ? `, ${fit.ignoredRows} incomplete row${fit.ignoredRows === 1 ? '' : 's'} ignored`
                : ''}
              )
            </span>
          </p>
        ) : null}
        {hasSavedFit ? (
          <p class="text-slate-500">
            Saved: {savedFit.points} pts · rms {Number(savedFit.rmsMv).toFixed(1)} mV
            · max {Number(savedFit.maxResidualMv).toFixed(1)} mV
          </p>
        ) : (
          <p class="text-slate-500">No fit recorded for this channel.</p>
        )}
        {error ? <p class="text-rose-400">{error}</p> : null}
      </div>
    </section>
  );
}

export function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cal, setCal] = useState(emptyCalibration);
  const [points, setPoints] = useState(loadPoints);
  const [fits, setFits] = useState(emptyFits);
  const [fitErrors, setFitErrors] = useState(() => Array(CHANNEL_COUNT).fill(''));
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

  useEffect(() => {
    storePoints(points);
    setFits(emptyFits());
    setFitErrors(Array(CHANNEL_COUNT).fill(''));
  }, [points]);

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

  const setCalError = (index, message) => {
    setFitErrors((prev) => prev.map((value, i) => (i === index ? message : value)));
  };

  const updateRow = (id, patch) => {
    setPoints((prev) =>
      prev.map((point) => (point.id === id ? { ...point, ...patch } : point)),
    );
  };

  const deleteRow = (id) => {
    setPoints((prev) => prev.filter((point) => point.id !== id));
  };

  const updateCell = (id, index, patch) => {
    setPoints((prev) =>
      prev.map((point) =>
        point.id === id
          ? {
              ...point,
              cells: point.cells.map((cell, i) => (i === index ? { ...cell, ...patch } : cell)),
            }
          : point,
      ),
    );
  };

  const useLiveReading = (id, index) => {
    const mv = status?.channels?.[index]?.pinMv;
    if (mv === undefined) return;
    updateCell(id, index, { pin: String(mv) });
  };

  const captureAllLive = () => {
    if (!status?.channels) return;
    if (status.lastSampleSeq === 0) {
      setError('No sample yet; wait for the first burst.');
      return;
    }
    if (status.lastSampleAgeMs > 5000) {
      setError('The last sample is stale; wait for a fresh reading before capturing.');
      return;
    }
    const row = emptyPoint();
    row.capturedAt = new Date().toISOString();
    row.cells = status.channels.map((channel) => ({ cell: '', pin: String(channel.pinMv) }));
    setPoints((prev) => [...prev, row].slice(0, MAX_POINTS));
    setNotice('Captured live pin mV for all cells. Add the multimeter values.');
  };

  const addEmptyRow = () => {
    setPoints((prev) => [...prev, emptyPoint()].slice(0, MAX_POINTS));
  };

  const clearPoints = () => {
    if (points.length === 0) return;
    if (!window.confirm('Delete all captured calibration points?')) return;
    setPoints([]);
  };

  const fitAll = () => {
    const nextCal = [...cal];
    const nextFits = emptyFits();
    const nextErrors = Array(CHANNEL_COUNT).fill('');

    for (let index = 0; index < CHANNEL_COUNT; index++) {
      const series = [];
      let partial = 0;
      for (const row of points) {
        const pin = textOr(row.cells[index]?.pin);
        const cell = textOr(row.cells[index]?.cell);
        if (pin === '' && cell === '') continue;
        if (pin === '' || cell === '') {
          partial += 1;
          continue;
        }
        series.push({ x: Number(pin), y: Number(cell) });
      }

      const fit = fitLinear(series);
      if (fit.error) {
        nextErrors[index] = fit.error;
        continue;
      }

      const appliedScale = Number(fit.scale.toFixed(6));
      const appliedOffset = Number(fit.offsetMv.toFixed(2));
      nextCal[index] = { scale: appliedScale, offsetMv: appliedOffset };
      nextFits[index] = { ...fit, appliedScale, appliedOffset, ignoredRows: partial };
    }

    setCal(nextCal);
    setFits(nextFits);
    setFitErrors(nextErrors);
    if (nextFits.some(Boolean)) {
      setNotice('Fit applied. Review the preview, then save the calibration.');
      setError('');
    }
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
        channels: cal.map((c, index) => {
          const entry = {
            scale: numberOr(c.scale),
            offsetMv: numberOr(c.offsetMv),
          };
          const fit = fits[index];
          if (
            fit &&
            !fit.error &&
            entry.scale === fit.appliedScale &&
            entry.offsetMv === fit.appliedOffset
          ) {
            entry.fit = {
              points: fit.n,
              rmsMv: Number(fit.rmsMv.toFixed(3)),
              maxResidualMv: Number(fit.maxResidualMv.toFixed(3)),
            };
          }
          return entry;
        }),
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
  const stale = status ? status.lastSampleAgeMs > 5000 : false;
  const hasSample = Boolean(status && status.lastSampleSeq > 0);
  const livePins = status?.channels?.map((channel) => channel.pinMv) ?? [];

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
            Readings are uncalibrated: scale 1.0 / offset 0 mV. Capture
            calibration points below, fit, and save.
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

        <CalibrationPanel
          livePins={livePins}
          points={points}
          stale={stale}
          hasSample={hasSample}
          adcCalSource={status?.adcCalSource}
          fitErrors={fitErrors}
          onAddRow={addEmptyRow}
          onCaptureAll={captureAllLive}
          onClear={clearPoints}
          onRowChange={updateRow}
          onCellChange={updateCell}
          onUseLive={useLiveReading}
          onDeleteRow={deleteRow}
          onFit={fitAll}
        />

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
                  fit={fits[index]}
                  error={fitErrors[index]}
                  onCal={(patch) => updateCal(index, patch)}
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
