#!/usr/bin/env bash
# Generate a local CA and a mosquitto server certificate.
#
# The SAN must contain every name/IP the devices and the Go server use to reach
# the broker. "localhost", 127.0.0.1, and "mosquitto" (the compose service name)
# are always included.
#
#   ./gen-certs.sh --host mqtt.home.arpa --ip 192.168.1.10
#
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out_dir="$script_dir/certs"
host="localhost"
ip=""
server_days=825
ca_days=3650

usage() {
  cat <<'EOF'
Usage: gen-certs.sh [--host NAME] [--ip ADDRESS] [--out DIR]

  --host NAME   DNS name devices use for the broker (default: localhost)
  --ip ADDRESS  IP address devices use for the broker (optional)
  --out DIR     output directory (default: deploy/certs)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="${2:?--host needs a value}"; shift 2 ;;
    --ip) ip="${2:?--ip needs a value}"; shift 2 ;;
    --out) out_dir="${2:?--out needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$out_dir"

san="DNS:localhost,IP:127.0.0.1,DNS:mosquitto"
san="$san,DNS:$host"
if [[ -n "$ip" ]]; then
  san="$san,IP:$ip"
fi

if [[ ! -f "$out_dir/ca.key" || ! -f "$out_dir/ca.crt" ]]; then
  echo "creating CA in $out_dir"
  openssl genrsa -out "$out_dir/ca.key" 4096 2>/dev/null
  openssl req -x509 -new -nodes -key "$out_dir/ca.key" -sha256 -days "$ca_days" \
    -subj "/CN=smarthouse-mqtt-ca" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$out_dir/ca.crt"
else
  echo "reusing existing CA in $out_dir"
fi

echo "creating server certificate for SAN $san"
openssl genrsa -out "$out_dir/server.key" 2048 2>/dev/null
openssl req -new -key "$out_dir/server.key" -sha256 \
  -subj "/CN=$host" -out "$out_dir/server.csr"

cat >"$out_dir/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF

openssl x509 -req -in "$out_dir/server.csr" -CA "$out_dir/ca.crt" \
  -CAkey "$out_dir/ca.key" -CAcreateserial -out "$out_dir/server.crt" \
  -days "$server_days" -sha256 -extfile "$out_dir/server.ext"
rm -f "$out_dir/server.csr" "$out_dir/server.ext"

chmod 600 "$out_dir/ca.key" "$out_dir/server.key"
chmod 644 "$out_dir/ca.crt" "$out_dir/server.crt"

cat <<EOF
done.

Device setup:
  CA certificate  -> $out_dir/ca.crt (paste into the device MQTT panel)
  broker host     -> $host${ip:+ or $ip}
  broker port     -> 8883
  TLS             -> on

The mosquitto container reads the same files. If it cannot read server.key,
run: sudo chown 1883:1883 $out_dir/server.key && sudo chmod 600 $out_dir/server.key
Regenerating certificates resets ownership; re-apply the chown from
server/README.md after running this script again.
EOF
