#include "mqtt_publisher.h"

#include <ArduinoJson.h>
#include <mqtt_client.h>

#include <atomic>

#include "adc.h"
#include "calibration.h"
#include "config.h"
#include "settings.h"
#include "wifi_manager.h"

namespace {

MqttSettings s_cfg;
esp_mqtt_client_handle_t s_client = nullptr;
String s_deviceId;
String s_uri;
String s_user;
String s_clientId;
String s_lwtTopic;
String s_stateTopic;
String s_sampleTopic;
String s_onlineTopic;
String s_lastError;

bool s_reload = false;
bool s_publishNow = false;
uint32_t s_lastPublishMs = 0;
uint32_t s_lastAttemptMs = 0;

// The esp-mqtt event handler runs in its own task. It only touches these
// atomics; everything that builds Strings stays in the main loop.
std::atomic<bool> s_connected{false};
std::atomic<bool> s_onlinePending{false};
std::atomic<int> s_errorType{0};
std::atomic<int> s_transportErr{0};
std::atomic<int> s_tlsStackErr{0};
std::atomic<int> s_certFlags{0};

void stopClient() {
  if (s_client != nullptr) {
    esp_mqtt_client_stop(s_client);
    esp_mqtt_client_destroy(s_client);
    s_client = nullptr;
  }
  s_connected = false;
  s_onlinePending = false;
}

// Device id and topics are also reported before the first connection, so the
// UI can prefill the username and show the topic.
void refreshIdentity() {
  s_deviceId = wifi_manager::hostname();
  if (s_deviceId.isEmpty()) {
    s_deviceId = String(DEVICE_HOSTNAME);
  }
  s_stateTopic = s_cfg.prefix + "/" + s_deviceId + "/state";
  s_sampleTopic = s_cfg.prefix + "/" + s_deviceId + "/sample";
  s_onlineTopic = s_cfg.prefix + "/" + s_deviceId + "/availability";
  s_lwtTopic = s_onlineTopic;
}

void eventHandler(void *, esp_event_base_t, int32_t eventId, void *eventData) {
  switch (static_cast<esp_mqtt_event_id_t>(eventId)) {
    case MQTT_EVENT_CONNECTED:
      s_errorType = 0;
      s_transportErr = 0;
      s_tlsStackErr = 0;
      s_certFlags = 0;
      s_onlinePending = true;
      s_connected = true;
      Serial.println("mqtt: connected");
      break;

    case MQTT_EVENT_DISCONNECTED:
      s_connected = false;
      Serial.println("mqtt: disconnected");
      break;

    case MQTT_EVENT_ERROR: {
      s_connected = false;
      auto *event = static_cast<esp_mqtt_event_handle_t>(eventData);
      if (event != nullptr && event->error_handle != nullptr) {
        s_errorType = event->error_handle->error_type;
        s_transportErr = event->error_handle->esp_tls_last_esp_err;
        s_tlsStackErr = event->error_handle->esp_tls_stack_err;
        s_certFlags = event->error_handle->esp_tls_cert_verify_flags;
      } else {
        s_errorType = 0;
        s_transportErr = 0;
        s_tlsStackErr = 0;
        s_certFlags = 0;
      }
      Serial.printf("mqtt: error type %d tls 0x%x stack %d cert 0x%x\n",
                    s_errorType.load(), s_transportErr.load(),
                    s_tlsStackErr.load(), s_certFlags.load());
      break;
    }

    default:
      break;
  }
}

bool buildClient() {
  refreshIdentity();
  s_clientId = s_deviceId;
  s_user = s_cfg.username.isEmpty() ? s_deviceId : s_cfg.username;
  s_uri = String(s_cfg.tls ? "mqtts://" : "mqtt://") + s_cfg.host + ":" +
          String(s_cfg.port);

  if (s_cfg.tls && s_cfg.caPem.isEmpty()) {
    s_lastError = "CA certificate required for TLS";
    return false;
  }

  esp_mqtt_client_config_t config = {};
  config.uri = s_uri.c_str();
  config.client_id = s_clientId.c_str();
  config.username = s_user.c_str();
  if (!s_cfg.password.isEmpty()) {
    config.password = s_cfg.password.c_str();
  }
  config.keepalive = 30;
  config.reconnect_timeout_ms = 5000;
  config.network_timeout_ms = 10000;
  config.buffer_size = 2048;
  config.disable_auto_reconnect = false;
  config.lwt_topic = s_lwtTopic.c_str();
  config.lwt_msg = "offline";
  config.lwt_msg_len = 7;
  config.lwt_qos = 1;
  config.lwt_retain = 1;
  if (s_cfg.tls) {
    config.cert_pem = s_cfg.caPem.c_str();
    config.skip_cert_common_name_check = false;
  }

  s_client = esp_mqtt_client_init(&config);
  if (s_client == nullptr) {
    s_lastError = "failed to initialize MQTT client";
    return false;
  }

  esp_mqtt_client_register_event(s_client, MQTT_EVENT_ANY, eventHandler,
                                 nullptr);
  const esp_err_t startErr = esp_mqtt_client_start(s_client);
  if (startErr != ESP_OK) {
    s_lastError = String("failed to start MQTT client (") +
                  esp_err_to_name(startErr) + ")";
    stopClient();
    return false;
  }

  Serial.printf("mqtt: %s as %s, topic %s\n", s_uri.c_str(), s_user.c_str(),
                s_stateTopic.c_str());
  return true;
}

bool publishAvailability(const char *text) {
  if (s_client == nullptr) {
    return false;
  }
  const int len = static_cast<int>(strlen(text));
  return esp_mqtt_client_publish(s_client, s_onlineTopic.c_str(), text, len, 1,
                                 1) >= 0;
}

bool publishState() {
  if (s_client == nullptr || !s_connected.load()) {
    return false;
  }

  AdcSnapshot snapshot;
  if (!adcGetSnapshot(snapshot)) {
    return false;
  }

  const Calibration cal = settings::loadCalibration();

  JsonDocument doc;
  doc["v"] = 1;
  doc["id"] = s_deviceId;
  doc["type"] = "battery-monitor";
  doc["fw"] = FW_VERSION;
  doc["seq"] = snapshot.seq;
  doc["uptimeMs"] = millis();
  doc["intervalMs"] = static_cast<uint32_t>(s_cfg.intervalSec) * 1000U;
  doc["rssi"] = wifi_manager::rssi();
  doc["calibrated"] = cal.calibrated;

  JsonArray cells = doc["cellsMv"].to<JsonArray>();
  int32_t packMv = 0;
  int32_t minMv = 0;
  int32_t maxMv = 0;
  for (int i = 0; i < ADC_CHANNEL_COUNT; i++) {
    const int32_t cellMv = calibrationToCellMv(cal.ch[i], snapshot.pinMv[i]);
    cells.add(cellMv);
    packMv += cellMv;
    if (i == 0 || cellMv < minMv) minMv = cellMv;
    if (i == 0 || cellMv > maxMv) maxMv = cellMv;
  }

  doc["packMv"] = packMv;
  doc["minCellMv"] = minMv;
  doc["maxCellMv"] = maxMv;
  doc["spreadMv"] = maxMv - minMv;

  String payload;
  serializeJson(doc, payload);

  // state is retained for late joiners; sample is the non-retained history
  // stream. Two publishes keep the server able to tell a retained replay from
  // a live sample (MQTT 3.1.1 keeps the retain flag on live retained
  // deliveries).
  const int stateId = esp_mqtt_client_publish(
      s_client, s_stateTopic.c_str(), payload.c_str(),
      static_cast<int>(payload.length()), 1, 1);
  const int sampleId = esp_mqtt_client_publish(
      s_client, s_sampleTopic.c_str(), payload.c_str(),
      static_cast<int>(payload.length()), 1, 0);
  return stateId >= 0 && sampleId >= 0;
}

String errorText() {
  if (s_certFlags.load() != 0) {
    return String("TLS certificate verification failed (flags 0x") +
           String(s_certFlags.load(), HEX) + ")";
  }
  if (s_transportErr.load() != 0) {
    return String("TLS/TCP error 0x") + String(s_transportErr.load(), HEX);
  }
  if (s_errorType.load() != 0) {
    return String("MQTT error type ") + String(s_errorType.load());
  }
  return s_lastError;
}

}  // namespace

namespace mqtt {

void begin() {
  s_cfg = settings::loadMqtt();
  refreshIdentity();
  s_publishNow = true;
  if (s_cfg.host.isEmpty()) {
    Serial.println("mqtt: not configured");
  }
}

void loop() {
  if (s_reload) {
    s_reload = false;
    stopClient();
    s_cfg = settings::loadMqtt();
    refreshIdentity();
    s_lastError = "";
    s_lastPublishMs = 0;
    s_lastAttemptMs = 0;
    s_publishNow = true;
  }

  if (s_cfg.host.isEmpty()) {
    if (s_client != nullptr) {
      stopClient();
    }
    return;
  }

  if (!wifi_manager::staConnected()) {
    if (s_client == nullptr) {
      s_lastError = "Wi-Fi is not connected";
    }
    return;
  }

  if (s_cfg.tls && !wifi_manager::timeSynced()) {
    if (s_client == nullptr) {
      s_lastError = "waiting for NTP time sync";
    }
    return;
  }

  if (s_client == nullptr) {
    if (!buildClient()) {
      return;
    }
  }

  if (s_onlinePending) {
    s_onlinePending = false;
    if (!publishAvailability("online")) {
      s_onlinePending = true;
      s_lastError = "availability publish failed";
    }
  }

  if (!s_connected.load()) {
    return;
  }

  const uint32_t now = millis();
  const uint32_t intervalMs = static_cast<uint32_t>(s_cfg.intervalSec) * 1000U;
  const bool due = s_publishNow || (now - s_lastAttemptMs >= intervalMs);
  if (!due) {
    return;
  }

  s_lastAttemptMs = now;
  if (publishState()) {
    s_lastPublishMs = now;
    s_publishNow = false;
    s_lastError = "";
  } else {
    s_publishNow = true;
    s_lastError = "state publish failed";
  }
}

void requestReload() { s_reload = true; }

void requestPublish() { s_publishNow = true; }

Status status() {
  Status st;
  st.enabled = !s_cfg.host.isEmpty();
  st.connected = s_connected.load();
  st.host = s_cfg.host;
  st.port = s_cfg.port;
  st.tls = s_cfg.tls;
  st.username = s_cfg.username.isEmpty() ? s_deviceId : s_cfg.username;
  st.prefix = s_cfg.prefix;
  st.deviceId = s_deviceId;
  st.stateTopic = s_stateTopic;
  st.sampleTopic = s_sampleTopic;
  st.availabilityTopic = s_onlineTopic;
  st.intervalSec = s_cfg.intervalSec;
  st.passwordConfigured = !s_cfg.password.isEmpty();
  st.caConfigured = !s_cfg.caPem.isEmpty();
  st.lastPublishAgeMs =
      s_lastPublishMs == 0 ? -1 : static_cast<int64_t>(millis() - s_lastPublishMs);
  st.lastError = errorText();
  return st;
}

}  // namespace mqtt
