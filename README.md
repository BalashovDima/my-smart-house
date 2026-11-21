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
calibration is saved, the UI shows an uncalibrated banner. `pinMv` already
includes the ESP32 eFuse ADC calibration, so the per-channel fit corrects the
op-amp front end: its offset and its gain.

The UI keeps a table of calibration points, one row per pack state, and fits
each channel independently with least squares. Rows live in browser
`localStorage`, so a multi-hour discharge can be captured across reloads.

1. With the pack at rest (no charger, no load, BMS not balancing), measure each
   cell with a multimeter **across adjacent pins of the board's sense
   connector** and type the value into the row. That is the voltage the front
   end actually sees.
2. Press **Capture all live** to snapshot the four `pinMv` values at once.
   Repeat the read a few times if you want to confirm they are stable; they
   update a few seconds apart.
3. Put a load on the pack until each cell has dropped by at least 200 mV
   (300–450 mV is better), remove the load, wait for rest, and capture another
   row.
4. Add more rows if you can. Three or more give a residual, which is the only
   way to notice a nonlinear front end.
5. Press **Fit all channels**, check the preview and the reported rms/max
   residual, then **Save calibration**.

Guidelines:

- At least 60 mV of `pinMv` span is required; aim for several hundred.
- rms and max residual under ~5 mV means the front end is linear over the
  captured range. Above ~10 mV, one point is probably wrong or the stage is
  compressing near a rail.
- The four channels should end up with similar scales (within ~1%) and
  independent offsets. An outlier points at the measurement, not at the ADC.
- Verify on a voltage you did not fit with: calibrated cell values should agree
  with the multimeter within ~10 mV, and their sum with the pack voltage within
  ~20–30 mV at rest.

`POST /api/calibration` accepts an optional per-channel `fit` object
(`points`, `rmsMv`, `maxResidualMv`). The firmware stores it in NVS and returns
it from `/api/status` so the quality survives a reload; it never fits anything
itself.

#### Bench cross-check with a single supply (optional)

The pack discharge above is enough for a usable fit. This check only exists to
catch a front-end problem when the pack-derived numbers look suspicious.

Only channel 1 can be driven directly: its lower input is at board ground, while
channels 2–4 sit on a stacked common mode that one earthed supply cannot
reproduce.

1. Disconnect the pack's sense harness from the board; no cell is connected.
2. Power the board over USB. Set the supply to 3.00 V, current limit ~10 mA,
   output off; connect + to the cell 1 sense tap and − to board GND.
3. Enable the output, read `pinMv`; set 3.40 V, read again, and fit those two
   points.
4. Compare with the pack-derived channel 1 result: scale within ~1%, offset
   within ~20 mV.
5. Output off, disconnect the supply, and only then reconnect the pack.

Never connect the supply in parallel with a connected cell.

The pack/min/max/spread values are sums/differences of calibrated cell values,
so they inherit any calibration error.

### HTTP API

- `GET /api/status` — Wi-Fi state, per-channel raw/pin/cell mV, pack/min/max/
  spread, calibration, sample age, ADC calibration source
- `POST /api/calibration` — `{ "channels": [{ "scale": 1.02, "offsetMv": -12.5, "fit": { "points": 4, "rmsMv": 1.1, "maxResidualMv": 2.3 } }, ...] }`, persists to NVS; `fit` is optional
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
