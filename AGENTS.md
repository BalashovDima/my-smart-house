# my-smart-house

Home telemetry: backup power (pack voltage + per-cell voltages), room/outdoor
temperature, humidity, pressure, mains voltage and power consumption.

## Status

Greenfield: only `.gitattributes` is committed. The layout and commands below
are the agreed plan. When real code lands, trust code/config over this file and
update it.

## Layout

- `firmware/` — PlatformIO projects, ESP32 + ESP8266 (one project/env per board)
- `server/` — Go backend: MQTT subscriber + HTTP/JSON API
- `frontend/` — React + Vite (TypeScript) dashboard

Each directory is independent; no root workspace tooling. `cd` in before running
commands.

## Commands

Firmware (from `firmware/<project>/`):

- Build one env: `pio run -e <env>`
- Upload / monitor: `pio run -e <env> -t upload`, `pio device monitor -e <env>`

Server (from `server/`):

- `go test ./...`
- One test: `go test ./internal/<pkg> -run TestName`
- Run: `go run ./cmd/<app>`

Frontend (from `frontend/`): `npm ci`, `npm run dev`, `npm run build`, `npm run lint`

No CI or pre-commit hooks exist yet; run the relevant command yourself before
reporting work as done.

## Constraints agents get wrong

- ESP8266 has one ADC (`A0`, 0–1.0 V raw; DevKit boards divide down to ~3.3 V).
  ESP32 ADC2 pins stop working while Wi-Fi is active — use ADC1 (GPIO32–39) for
  always-on sensors.
- Never route mains voltage into an ADC; require an isolated/transformer stage
  and keep that assumption in pin docs and comments.
- ESP8266 and ESP32 are not source-compatible: guard chip-specific code with
  `#ifdef ESP32` / `#ifdef ESP8266` rather than copying drivers.
- Don't commit Wi-Fi/MQTT credentials; firmware secrets go in gitignored config.
- Firmware and server must agree on MQTT topic scheme and payload schema; change
  both in the same commit.
- Prefer integer units (mV, deci-°C) over floats on ESP8266.
- `.gitattributes` enforces LF; don't add CRLF files.
