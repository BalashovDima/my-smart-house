# smarthouse server

Go backend for the MQTT telemetry contract in [`../docs/mqtt.md`](../docs/mqtt.md):
subscribes to mosquitto over TLS, stores the latest state and history in SQLite,
and exposes a small HTTP/JSON API for the dashboard.

## Architecture

- `cmd/server` — process setup, HTTP server, retention loop
- `internal/config` — environment configuration
- `internal/model` — topic and payload validation
- `internal/ingest` — paho MQTT subscriber
- `internal/store` — SQLite schema, upserts, history queries
- `internal/api` — HTTP endpoints and CORS

SQLite runs in WAL mode with a single connection (one writer, cheap reads).
Device rows keep the latest payload; `samples` keeps JSON history so new sensor
types need no migration. Retention defaults to 180 days.

## Build and test

```sh
cd server
go test ./...
go run ./cmd/server          # with MQTT_* pointing at a broker
```

## Broker setup

Generate the CA, server certificate, and password file:

```sh
cd server
./deploy/gen-certs.sh --host mqtt.home.arpa --ip 192.168.1.10
./deploy/gen-passwd.sh --device battmon-A1B2
cp .env.example .env
# set MQTT_PASS in .env to the smarthouse-server password
```

`gen-certs.sh` always includes `localhost`, `127.0.0.1`, and `mosquitto` in the
SAN, plus the `--host`/`--ip` you provide. Use exactly that name or IP in the
device MQTT panel, otherwise certificate verification fails.

The mosquitto container runs as UID 1883, so it must be able to read the mounted
files:

```sh
sudo chown 1883:1883 deploy/certs/server.key deploy/mosquitto/passwd \
  deploy/mosquitto/acl
sudo chmod 600 deploy/certs/server.key deploy/mosquitto/passwd \
  deploy/mosquitto/acl
```

(mosquitto 2.1 already warns that a world-readable ACL will be refused in a
future release.)

Start the stack:

```sh
docker compose up -d --build
docker compose logs -f server
```

Ports: `8883` (MQTT over TLS), `8080` (HTTP API); both host ports can be
changed with `MQTT_PORT`/`HTTP_PORT` in `.env`. The broker has no plain
listener. `deploy/certs/`, `deploy/mosquitto/passwd`, `.env`, and the SQLite
volume are gitignored.

## Device setup

In the battery monitor UI's MQTT panel:

| Field | Value |
|---|---|
| Broker host | the certificate name/IP, e.g. `mqtt.home.arpa` |
| Port | `8883` |
| TLS | on |
| Username | device id, e.g. `battmon-A1B2` |
| Password | from `gen-passwd.sh` |
| Prefix | `smarthouse` |
| Interval | `30` seconds |
| CA certificate | paste `deploy/certs/ca.crt` |
| NTP server | `pool.ntp.org`, or a local NTP server |

TLS needs a valid clock. The firmware starts SNTP after Wi-Fi connects and waits
for the time before opening MQTT; the device UI reports `waiting for NTP time
sync` until then. If the LAN has no internet access, point the NTP field at a
local server.

The device UI itself is plain HTTP: provision on a trusted LAN and change the
broker password if it may have been captured.

## HTTP API

- `GET /api/devices` — all devices with `online`, `lastSeen`, and `latest`
- `GET /api/devices/{id}` — one device
- `GET /api/devices/{id}/samples?from=&to=&limit=&step=` — history in ascending
  order; `from`/`to` accept RFC3339 or Unix milliseconds; `step` is bucket
  seconds and returns the newest sample per bucket
- `GET /api/health` — broker connection, last message time, SQLite ping

The API is read-only and has no authentication; keep port 8080 on the trusted
LAN, or put a reverse proxy in front of it if it is exposed.

Examples:

```sh
curl -s localhost:8080/api/devices | jq
curl -s 'localhost:8080/api/devices/battmon-A1B2/samples?step=300&limit=500' | jq
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HTTP_ADDR` | `:8080` | API listen address |
| `MQTT_URL` | `ssl://localhost:8883` | broker URL (`ssl://` for TLS) |
| `MQTT_CLIENT_ID` | `smarthouse-server` | MQTT client id |
| `MQTT_USER` | `smarthouse-server` | broker username |
| `MQTT_PASS` | empty | broker password |
| `MQTT_TOPIC_PREFIX` | `smarthouse` | one topic segment, must match devices |
| `MQTT_CA_FILE` | empty | CA PEM for broker verification |
| `MQTT_TLS_SERVER_NAME` | URL host | override the TLS SNI/verification name |
| `DB_PATH` | `./data/smarthouse.db` | SQLite file |
| `RETENTION_DAYS` | `180` | history retention; `0` keeps everything |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated dashboard origins |

Changing `MQTT_TOPIC_PREFIX` (or the prefix in a device's MQTT panel) also
requires updating `deploy/mosquitto/acl`; the ACL patterns are not templated.

For local Go development against the compose broker:

```sh
export MQTT_URL=ssl://localhost:8883
export MQTT_CA_FILE=$PWD/deploy/certs/ca.crt
export MQTT_TLS_SERVER_NAME=localhost
export MQTT_PASS='the server password'
export DB_PATH=$PWD/data/dev.db
go run ./cmd/server
```

## Verification

Watch the contract directly:

```sh
mosquitto_sub -h mqtt.home.arpa -p 8883 \
  --cafile deploy/certs/ca.crt \
  -u smarthouse-server -P "$MQTT_PASS" \
  -t 'smarthouse/#' -v
```

Publish a synthetic snapshot. `state` is retained (latest value only); `sample`
is not retained and is what creates history:

```sh
payload='{"v":1,"id":"battmon-A1B2","type":"battery-monitor","fw":"test","seq":1,"uptimeMs":1000,"intervalMs":30000,"rssi":-60,"calibrated":true,"packMv":13200,"minCellMv":3290,"maxCellMv":3310,"spreadMv":20,"cellsMv":[3290,3300,3300,3310]}'

mosquitto_pub -h mqtt.home.arpa -p 8883 \
  --cafile deploy/certs/ca.crt \
  -u battmon-A1B2 -P "$DEVICE_PASS" \
  -t smarthouse/battmon-A1B2/state -q 1 -r -m "$payload"

mosquitto_pub -h mqtt.home.arpa -p 8883 \
  --cafile deploy/certs/ca.crt \
  -u battmon-A1B2 -P "$DEVICE_PASS" \
  -t smarthouse/battmon-A1B2/sample -q 1 -m "$payload"

curl -s localhost:8080/api/devices | jq
```

Publishing only to `state` updates `latest` but must not create a history row.
