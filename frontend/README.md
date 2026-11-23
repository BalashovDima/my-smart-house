# smarthouse dashboard

React + TypeScript + Vite dashboard for the read-only HTTP API in
[`../server`](../server). It shows the latest telemetry for every device and,
for battery monitors, per-cell voltages and history charts.

## Run

The API must be reachable. Start it from `../server` first (`go run ./cmd/server`
or `docker compose up -d`), then:

```sh
cd frontend
npm ci
npm run dev            # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:8080`, so the browser makes
same-origin requests and the API's CORS configuration is not involved. Point
the proxy elsewhere when needed:

```sh
VITE_API_PROXY=http://192.168.1.20:8080 npm run dev
```

For a static build, set `VITE_API_BASE` to the API's public URL if it is not
served under the same origin:

```sh
VITE_API_BASE=https://house.example/api npm run build
```

The Go server does not serve `dist/` yet; `npm run dev` or `vite preview` is the
current serving path. The API and dashboard have no authentication, so keep
both on the trusted LAN.

## What it shows

- **Overview** (`/`) — one card per device. Battery monitors get pack voltage,
  cell bars, spread, RSSI, and online state; other device types get a generic
  key/value summary from the raw payload.
- **Device detail** (`/devices/:id`) — latest snapshot tiles, cell bars, and
  battery history: pack voltage with cells on a right-hand axis, plus cell
  spread. Clicking a cell chip hides that series. The raw latest payload is in
  a collapsible panel.
- **Health** — the header reports broker/database state from `/api/health`; a
  banner appears when the API or MQTT link is down.

Polling is paused while the tab is hidden. Devices refresh every 10 s, health
every 30 s, and history every 30 s; in-flight requests are aborted when the
device or range changes.

## History ranges

| Range | API step | Target points |
|---|---|---|
| 1 h | 30 s | 120 |
| 6 h | 120 s | 180 |
| 24 h | 300 s | 288 |
| 7 d | 1800 s | 336 |
| 30 d | 7200 s | 360 |

The server returns the newest sample per bucket (`step`), so the dashboard never
approaches the API's 10000-sample limit.

## Code map

- `src/api.ts` — typed API client and errors
- `src/types.ts` — API and telemetry payload shapes
- `src/hooks/usePolling.ts` — visibility-aware polling with abort
- `src/lib/` — formatting, range presets, payload → chart columns
- `src/components/HistoryChart.tsx` — uPlot wrapper (timestamps in seconds,
  ResizeObserver sizing, synced cursor, custom legend)
- `src/devices/` — device-type registry; `battery.tsx` is the detailed renderer
  and `generic.tsx` the fallback for future types

Display heuristics live next to the battery renderer: cell bars use a
2.5–3.65 V LiFePO4 scale, and spread is green at ≤30 mV, amber to 80 mV, rose
above. Neither is a state-of-charge estimate.

## Test and build

```sh
npm test          # Vitest: ranges, formatting, payload mapping
npm run typecheck
npm run build     # static dist/
```
