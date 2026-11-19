# my-smart-house

Home telemetry: backup power (pack + per-cell voltages), room/outdoor
temperature, humidity, pressure, mains voltage and power consumption.

## Layout

- `firmware/battery-monitor/` — ESP32 PlatformIO project (first device)
- `firmware/` — future ESP32/ESP8266 projects, one PlatformIO project each
- `server/` — Go backend: MQTT subscriber + HTTP/JSON API (not started)
- `frontend/` — React + Vite dashboard (not started)
- `firmware/battery-monitor/web/` — Preact UI compiled into LittleFS, **not** the
  `frontend/` dashboard

Each component is independent; there is no root workspace tooling.

## Battery monitor

Commands, from `firmware/battery-monitor/`:

- Build UI: `cd web && npm ci && npm run build` → writes `../data/` (gitignored)
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
  renames ADC attenuation symbols and changes `analogReadMilliVolts()`. Don't
  bump without revalidating the ADC code.
- ADC inputs are GPIO32–35 (ADC1 only; ADC2 dies when Wi-Fi is on). GPIO25
  switches op-amp power: 100 ms settle, 15-sample median burst, then off.
- `board_build.partitions = huge_app.csv`: 3 MB app, ~0.9 MB LittleFS, no OTA.
  The default 1.2 MB app slot is too small for Wi-Fi + `WebServer`.
- The device uses the synchronous `WebServer`, not ESPAsyncWebServer. Keep HTTP
  handlers short; POST JSON is read from `arg("plain")`.
- Calibration contract: `cellMv = scale * pinMv + offsetMv` per channel, fit
  from two points. Changing the formula requires changing `web/src/app.jsx` too.
- `.gitattributes` enforces LF; don't add CRLF files.

Safety: never route a cell or mains voltage directly into an ADC; the op-amp
stages are assumed to provide attenuation/isolation.

## Still to decide

- MQTT topic/payload schema shared by firmware and the future server; change
  both in the same commit.
- Shared ESP8266/ESP32 code: guard chip-specific APIs with `#ifdef ESP32` /
  `#ifdef ESP8266`. ESP8266 has a single ADC (`A0`, 0–1.0 V raw).
