# MQTT contract

Shared by the ESP32 firmware and the Go server. Change this document, the
firmware, and the server in the same commit.

## Topics

Default prefix: `smarthouse`. Device id: the mDNS host name, `battmon-XXXX`
(low 16 bits of the MAC, uppercase hex), for example `battmon-A1B2`.

| Topic | Direction | QoS | Retain | Payload |
|---|---|---|---|---|
| `<prefix>/<id>/state` | device → server | 1 | yes | telemetry JSON, latest snapshot |
| `<prefix>/<id>/sample` | device → server | 1 | no | telemetry JSON, history |
| `<prefix>/<id>/availability` | device → server | 1 | yes | `online` or `offline` |
| `<prefix>/<id>/cmd` | server → device | 1 | no | reserved |

The device publishes the same payload to both `state` (retained) and `sample`
(non-retained) every interval. Keeping them separate matters: MQTT 3.1.1
forwards a live retained publish with the retain flag still set, so a server
cannot tell it apart from a replayed retained message. `state` only refreshes
the cached latest value; `sample` is the only source of history rows.

The device connects with a Last Will and Testament on
`<prefix>/<id>/availability` set to `offline`, retained. It publishes `online`
retained after every successful connect, so the broker can also report a
device that lost power or Wi-Fi.

The server subscribes to `<prefix>/+/state`, `<prefix>/+/sample`, and
`<prefix>/+/availability`.

## State payload

```json
{
  "v": 1,
  "id": "battmon-A1B2",
  "type": "battery-monitor",
  "fw": "0.2.0",
  "seq": 4211,
  "uptimeMs": 3600000,
  "intervalMs": 30000,
  "rssi": -61,
  "calibrated": true,
  "packMv": 13205,
  "minCellMv": 3298,
  "maxCellMv": 3305,
  "spreadMv": 7,
  "cellsMv": [3298, 3300, 3302, 3305]
}
```

| Field | Meaning |
|---|---|
| `v` | schema version, currently `1` |
| `id` | device id, must match the topic |
| `type` | device class, `battery-monitor` today |
| `fw` | firmware version string |
| `seq` | device sample counter; monotonic per boot |
| `uptimeMs` | `millis()` at publish time |
| `intervalMs` | publish interval, used for staleness detection |
| `rssi` | Wi-Fi RSSI in dBm |
| `calibrated` | whether the device applies a saved calibration |
| `packMv` | sum of the calibrated cell voltages |
| `minCellMv`, `maxCellMv`, `spreadMv` | calibrated cell statistics |
| `cellsMv` | calibrated cell voltages, channel order |

Unknown fields are ignored by the server. New device types add fields and set
their own `type`; they do not need a new topic or server migration.

## Semantics

- The device has no battery-backed clock. The server timestamps samples on
  receipt; there is no device wall-clock field.
- `state` and `availability` are retained, so a restarted server immediately
  sees the latest values. `sample` is not retained.
- A `state` message (retained, or a live publication that also carries the
  retain flag) only refreshes the cached device state. It never creates a
  history row or bumps `last_seen`; otherwise a replayed retained message would
  look like a fresh sample.
- A `sample` message is inserted into history and updates `last_seen`. The
  server ignores a `sample` that arrives with the retain flag set; the firmware
  never retains that topic.
- The server rejects a state/sample message when `v` is unknown, `id` is
  missing or differs from the topic, `cellsMv` is empty or unreasonably long, or
  numeric values are out of range.
- A device is shown offline when availability says `offline`, or when no
  `sample` has arrived for three `intervalMs` periods.

## Security

- MQTT runs TLS-only (port 8883). The device pins the local CA certificate
  (`ca.crt`) provisioned through its web UI; server certificate host name
  verification is not skipped.
- Authentication uses username/password. The bundled mosquitto ACL expects a
  device username equal to its device id, and restricts it to its own topic
  subtree. The server uses a separate `smarthouse-server` account.
- Certificates, keys, and the mosquitto password file are generated locally and
  are gitignored.
- The device configuration UI is plain HTTP on the LAN. MQTT credentials are
  visible to the LAN while they are being provisioned, even though MQTT itself
  is encrypted. Provision devices on a trusted network.

## Local development

TLS is the default and the production deployment keeps it. For local
development, the device's TLS checkbox can be turned off: it then uses
`mqtt://`, sends no CA, and performs no certificate checks. The server and
`server/docker-compose.dev.yml` provide a plain anonymous listener for that
case.

Plain MQTT has no encryption and no authentication. Use it only on a trusted
development network and turn TLS back on before deployment. The pinned ESP-IDF
esp-tls build cannot skip certificate verification while keeping TLS, so
"insecure TLS" is not an option; plain MQTT is the development path.
