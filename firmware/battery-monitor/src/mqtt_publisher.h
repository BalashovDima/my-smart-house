#pragma once

#include <Arduino.h>

#include "settings.h"

// MQTT publisher for the shared telemetry contract in docs/mqtt.md.
// Credentials, broker address, and the CA certificate live in NVS.
namespace mqtt {

void begin();
void loop();

// Applies saved settings on the next loop (used by POST /api/mqtt).
void requestReload();

// Publishes the current sample on the next loop (used after calibration).
void requestPublish();

struct Status {
  bool enabled = false;
  bool connected = false;
  String host;
  uint16_t port = 8883;
  bool tls = true;
  String username;
  String prefix;
  String deviceId;
  String stateTopic;
  String sampleTopic;
  String availabilityTopic;
  uint16_t intervalSec = 30;
  bool passwordConfigured = false;
  bool caConfigured = false;
  int64_t lastPublishAgeMs = -1;
  String lastError;
};

Status status();

}  // namespace mqtt
