#!/usr/bin/env bash
# Create the mosquitto password file for the server and each device.
#
# Device usernames must equal their MQTT topic id (for example battmon-A1B2),
# because the ACL grants each user write access to smarthouse/<username>/...
#
#   ./gen-passwd.sh --device battmon-A1B2 --device battmon-C3D4
#
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out_file="$script_dir/mosquitto/passwd"
devices=()

usage() {
  cat <<'EOF'
Usage: gen-passwd.sh [--device ID]... [--out FILE]

Prompts for the server password and one password per device.
The server user is always smarthouse-server.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) devices+=("${2:?--device needs a value}"); shift 2 ;;
    --out) out_file="${2:?--out needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v mosquitto_passwd >/dev/null || {
  echo "mosquitto_passwd is required (install mosquitto or run this in the mosquitto image)" >&2
  exit 1
}

mkdir -p "$(dirname "$out_file")"

read -r -s -p "Password for smarthouse-server: " server_pass
echo
mosquitto_passwd -b -c "$out_file" smarthouse-server "$server_pass"

for device in "${devices[@]}"; do
  read -r -s -p "Password for $device: " device_pass
  echo
  mosquitto_passwd -b "$out_file" "$device" "$device_pass"
done

chmod 640 "$out_file"
echo "wrote $out_file"

cat <<EOF
Set the server password in server/.env:
  MQTT_PASS=...
Use each device password in its MQTT panel (username = device id).

If the mosquitto container cannot read the file:
  sudo chown 1883:1883 "$out_file" && sudo chmod 640 "$out_file"
EOF
