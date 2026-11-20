# my-smart-house

Home telemetry: backup power (pack voltage + per-cell voltages), room/outdoor
temperature, humidity, pressure, mains voltage and power consumption.

This first device is `firmware/battery-monitor/`: a classic ESP32 that measures
four LiFePO4 cell voltages through op-amp subtract/stretch stages and serves a
local configuration + calibration UI from LittleFS.

## Layout

- `firmware/battery-monitor/` — PlatformIO project (ESP32)
- `server/` — Go backend (not started yet)
- `frontend/` — React + Vite dashboard (not started yet)

The device UI is intentionally separate from `frontend/`: it is a Preact app
compiled into the firmware's LittleFS image (see `web/`).

## Battery monitor

### Wiring

| Signal | ESP32 pin | Notes |
|---|---|---|
| Cell 1..4 op-amp outputs | GPIO32, 33, 34, 35 | ADC1 only; ADC2 is unusable with Wi-Fi on |
| Op-amp power switch | GPIO25 | Drives a transistor/MOSFET, not the op-amp rail directly |
| Op-amp analog ground | GND | Keep the ADC input within 0–3.1 V |

Firmware asserts GPIO25, waits `OPAMP_SETTLE_MS` (100 ms), samples each channel
48 times (median of 8-sample block means), then powers the op-amps down until
the next burst (1 s). Raw counts are converted to millivolts with the ESP32
eFuse ADC calibration (`esp_adc_cal`), selected once at boot; the result is
reported as `adcCalSource` by `GET /api/status`.

### Configure and build

`src/config.h` is gitignored; the tracked template is `src/config.example.h`.

```sh
cd firmware/battery-monitor
cp src/config.example.h src/config.h   # adjust pins / AP settings
```

The UI is bundled into `data/`, which PlatformIO flashes as LittleFS:

```sh
cd firmware/battery-monitor/web
npm ci
npm run build          # writes ../data/
cd ..
pio run                # compile
pio run -t upload      # flash firmware
pio run -t uploadfs    # flash data/ (run after npm run build)
pio device monitor
```

`pio run -t uploadfs` does not build the web UI and does not erase files already
in LittleFS.

For UI development against a real device:

```sh
VITE_DEVICE_URL=http://192.168.1.50 npm run dev
```

### Provisioning

- No stored credentials → open AP `BattMon-XXXX` at `192.168.4.1`.
- Stored credentials → STA mode, mDNS `battmon-XXXX.local`; after 15 s the AP
  comes back as a fallback while STA reconnects every 20 s.
- Wi-Fi and calibration live in NVS (namespace `battmon`), not in `config.h`.

### Calibration

Readings are stored per channel as `cellMv = scale * pinMv + offsetMv`. Until
calibration is saved, the UI shows an uncalibrated banner.

Two-point procedure (per cell, ideally with a bench supply):

1. Apply a known voltage near the bottom of the cell range; record the "ADC pin
   mV" and the actual cell voltage in mV. Use the `live` button to fill the raw
   value.
2. Repeat near the top of the range.
3. Press **Compute scale & offset**, check the preview, then **Save
   calibration**.

Pick both points close to the cell's real operating voltage (for LiFePO4, e.g.
3.2 V and 3.45 V), not spread across 0–4 V: the fit is an affine line and is
only exact at the two points.

The pack/min/max/spread values are sums/differences of calibrated cell values,
so they inherit any calibration error.

### HTTP API

- `GET /api/status` — Wi-Fi state, per-channel raw/pin/cell mV, pack/min/max/
  spread, calibration, sample age, ADC calibration source
- `POST /api/calibration` — `{ "channels": [{ "scale": 1.02, "offsetMv": -12.5 }, ...] }`, persists to NVS
- `GET /api/wifi/scan` — network list (scan briefly interrupts the AP)
- `POST /api/wifi` — `{ "ssid": "...", "password": "..." }`, persists and reboots
- `POST /api/factory-reset` — clears NVS and reboots

No authentication: keep the device on a trusted LAN. Calibration has no
unauthenticated read-back of anything sensitive, but a factory reset is one POST.

### Safety

The op-amp stages must provide isolation/attenuation for the pack; never connect
a LiFePO4 cell or mains voltage directly to an ESP32 ADC. Verify the divider
network and common ground before powering the board.

### Troubleshooting

- UI files missing → run `npm run build` and reflash with `pio run -t uploadfs`.
- Corrupt LittleFS → erase flash (`pio run -t erase`) and reflash both app and FS.
- Wrong/stale UI → static responses are `Cache-Control: no-cache`; hard-refresh
  the browser after reflashing.
