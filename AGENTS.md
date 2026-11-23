# my-smart-house

Home telemetry: backup power (pack + per-cell voltages), room/outdoor
temperature, humidity, pressure, mains voltage and power consumption.

## Layout

- `firmware/battery-monitor/` — ESP32 PlatformIO project (first device)
- `firmware/` — future ESP32/ESP8266 projects, one PlatformIO project each
- `server/` — Go backend: mosquitto subscriber + SQLite + HTTP/JSON API
- `frontend/` — React + Vite dashboard for the server API
- `docs/mqtt.md` — shared MQTT topics, payload schema, and TLS/ACL contract
- `firmware/battery-monitor/web/` — Preact UI compiled into LittleFS, **not** the
  `frontend/` dashboard

Each component is independent; there is no root workspace tooling.

## Battery monitor

Commands, from `firmware/battery-monitor/`:

- Build UI: `cd web && npm ci && npm run build` → writes `../data/` (gitignored)
- Fit unit tests: `cd web && npm test` (node --test, no device needed)
- Compile: `pio run`
- Flash app / filesystem: `pio run -t upload`, `pio run -t uploadfs`
- Filesystem image only: `pio run -t buildfs`
- Serial: `pio device monitor` (115200)

`pio run -t uploadfs` does not build the UI and does not erase existing files.
Rebuild the UI first whenever anything under `web/` changes.

Local board config: `src/config.h` is gitignored; copy `src/config.example.h`.
Pins, settle time, sample interval, and AP name live there. Wi-Fi credentials
and calibration live in NVS (namespace `battmon`), not in `config.h`.

Constraints:

- Platform is pinned to `espressif32@6.9.0` (Arduino core 2.0.17). Core 3.x
  renames ADC attenuation symbols (Arduino's `ADC_11db` is `ADC_ATTEN_DB_12`
  here) and changes `analogReadMilliVolts()`. Don't bump without revalidating
  the ADC code.
- ADC inputs are GPIO32–35 (ADC1 only; ADC2 dies when Wi-Fi is on). GPIO25
  switches op-amp power: settle (`OPAMP_SETTLE_MS`), 48-sample burst reported as
  the median of 8-sample block means, then off. Raw counts are converted with
  one boot-time `esp_adc_cal` characterization (eFuse TP → eFuse Vref →
  default Vref), so `adc.cpp` needs `driver/adc.h` + `esp_adc_cal.h`.
- `board_build.partitions = huge_app.csv`: 3 MB app, ~0.9 MB LittleFS, no OTA.
  The default 1.2 MB app slot is too small for Wi-Fi + `WebServer`.
- The device uses the synchronous `WebServer`, not ESPAsyncWebServer. Keep HTTP
  handlers short; POST JSON is read from `arg("plain")`.
- Calibration contract: `cellMv = scale * pinMv + offsetMv` per channel. The
  fit (N-point least squares) lives in `web/src/fit.js`; the firmware only
  stores the affine pair plus fit provenance (`ChannelFit`: points, rms, max
  residual) and must keep `calibrationChannelIsValid()` bounds in sync with
  `FIT_LIMITS` there. Changing the formula requires changing `web/src/app.jsx`
  too.
- `.gitattributes` enforces LF; don't add CRLF files.
- MQTT telemetry follows `docs/mqtt.md`; firmware and server must change in the
  same commit. Topics are `<prefix>/<id>/state` (retained latest),
  `<prefix>/<id>/sample` (non-retained history), and
  `<prefix>/<id>/availability`; all QoS 1, availability LWT `offline`.
- MQTT settings (broker, TLS, credentials, CA PEM, prefix, interval) live in
  NVS and are edited from the device UI at `POST /api/mqtt`; the device id is
  the mDNS host name (`battmon-XXXX`). TLS is the default and the device must
  have SNTP time before connecting; the server cert SAN must match the host or
  IP entered in the UI.
- The device UI is plain HTTP, so MQTT credentials are exposed on the LAN
  during provisioning even though the broker link is TLS.
- TLS is the default. Plain MQTT (TLS unchecked) is a dev-only path with no
  encryption, certificate checks, or broker authentication; the dev compose
  override is `docker-compose.dev.yml`. Re-enable TLS before deployment.

## Server

Commands, from `server/`:

- `go test ./...`
- `go run ./cmd/server` (needs `MQTT_URL`/`MQTT_CA_FILE`/`MQTT_PASS`)
- `docker compose up -d --build` (mosquitto + server)
- `MQTT_PASS=dev docker compose -f docker-compose.yml -f docker-compose.dev.yml
  up -d --build` (plain dev broker, no TLS)
- `./deploy/gen-certs.sh --host <name> --ip <addr>` and
  `./deploy/gen-passwd.sh --device <id>` generate gitignored secrets

SQLite is the store; raw history defaults to 180 days. The broker is TLS-only
on 8883 and uses the ACL in `server/deploy/mosquitto/acl` (device username =
device id). See `server/README.md` for the full runbook.

Safety: never route a cell or mains voltage directly into an ADC; the op-amp
stages are assumed to provide attenuation/isolation.

## Frontend

Commands, from `frontend/`:

- `npm ci`
- `npm run dev` — Vite on `:5173`, proxies `/api` to `http://localhost:8080`
  (`VITE_API_PROXY` overrides the target)
- `npm test` — Vitest unit tests for ranges, formatting, and payload mapping
- `npm run typecheck`, `npm run build` (static `dist/`)

Stack: React 19 + TypeScript, Vite, Tailwind v4, uPlot. It is a read-only
dashboard over the server API, not the device UI.

Constraints:

- No authentication: keep it (and port 8080) on the trusted LAN.
- Device types are registered in `src/devices/index.tsx`. `battery-monitor` has
  the detailed card/charts; unknown types get the generic card and raw history
  list. Add a renderer there for new charted device types.
- History ranges map to fixed server-side bucket sizes in `src/lib/ranges.ts`;
  keep the point count well under the API's 10000-sample limit.
- Cell-bar scale (2.5–3.65 V) and spread thresholds (30/80 mV) are display
  heuristics in `CellBars.tsx` / `battery.tsx`, not state-of-charge estimates.
- The Go server does not serve `dist/`; use `npm run dev` or `vite preview`.

## Still to decide

- Shared ESP8266/ESP32 code: guard chip-specific APIs with `#ifdef ESP32` /
  `#ifdef ESP8266`. ESP8266 has a single ADC (`A0`, 0–1.0 V raw).
