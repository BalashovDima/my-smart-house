#include "web_server.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <WiFi.h>

#include <cmath>

#include "adc.h"
#include "calibration.h"
#include "config.h"
#include "mqtt_publisher.h"
#include "settings.h"
#include "wifi_manager.h"

namespace {

WebServer s_server(80);

const char *contentTypeFor(const String &path) {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

void sendJson(int status, const JsonDocument &doc) {
  String payload;
  serializeJson(doc, payload);
  s_server.send(status, "application/json", payload);
}

void sendError(int status, const char *message) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = message;
  sendJson(status, doc);
}

void handleStatus() {
  AdcSnapshot snapshot;
  const bool haveSample = adcGetSnapshot(snapshot);
  const Calibration cal = settings::loadCalibration();
  const uint32_t now = millis();

  JsonDocument doc;
  doc["version"] = FW_VERSION;
  doc["uptimeMs"] = now;
  doc["calibrated"] = cal.calibrated;
  doc["sampleIntervalMs"] = SAMPLE_INTERVAL_MS;
  doc["adcCalSource"] = adcCalibrationSource();

  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["mode"] = wifi_manager::modeLabel();
  wifi["staConnected"] = wifi_manager::staConnected();
  wifi["ssid"] = wifi_manager::staConnected() ? WiFi.SSID() : String();
  wifi["ip"] = wifi_manager::ipAddress();
  wifi["rssi"] = wifi_manager::rssi();
  wifi["apSsid"] = wifi_manager::apSsid();
  wifi["apIp"] = wifi_manager::apIpAddress();
  wifi["hostname"] = wifi_manager::hostname();
  wifi["ntpServer"] = wifi_manager::ntpServer();
  wifi["timeSynced"] = wifi_manager::timeSynced();

  const mqtt::Status mqttStatus = mqtt::status();
  JsonObject mqtt = doc["mqtt"].to<JsonObject>();
  mqtt["enabled"] = mqttStatus.enabled;
  mqtt["connected"] = mqttStatus.connected;
  mqtt["host"] = mqttStatus.host;
  mqtt["port"] = mqttStatus.port;
  mqtt["tls"] = mqttStatus.tls;
  mqtt["username"] = mqttStatus.username;
  mqtt["prefix"] = mqttStatus.prefix;
  mqtt["deviceId"] = mqttStatus.deviceId;
  mqtt["stateTopic"] = mqttStatus.stateTopic;
  mqtt["sampleTopic"] = mqttStatus.sampleTopic;
  mqtt["availabilityTopic"] = mqttStatus.availabilityTopic;
  mqtt["intervalSec"] = mqttStatus.intervalSec;
  mqtt["passwordConfigured"] = mqttStatus.passwordConfigured;
  mqtt["caConfigured"] = mqttStatus.caConfigured;
  mqtt["lastPublishAgeMs"] = mqttStatus.lastPublishAgeMs;
  if (!mqttStatus.lastError.isEmpty()) {
    mqtt["lastError"] = mqttStatus.lastError;
  }

  JsonArray channels = doc["channels"].to<JsonArray>();
  int32_t packMv = 0;
  int32_t minMv = 0;
  int32_t maxMv = 0;

  for (int i = 0; i < ADC_CHANNEL_COUNT; i++) {
    const uint32_t pinMv = haveSample ? snapshot.pinMv[i] : 0;
    const int32_t cellMv =
        haveSample ? calibrationToCellMv(cal.ch[i], pinMv) : 0;

    JsonObject ch = channels.add<JsonObject>();
    ch["index"] = i;
    ch["gpio"] = ADC_PINS[i];
    ch["raw"] = haveSample ? snapshot.raw[i] : 0;
    ch["pinMv"] = pinMv;
    ch["cellMv"] = cellMv;

    JsonObject chCal = ch["calibration"].to<JsonObject>();
    chCal["scale"] = cal.ch[i].scale;
    chCal["offsetMv"] = cal.ch[i].offsetMv;

    JsonObject chFit = chCal["fit"].to<JsonObject>();
    chFit["points"] = cal.fit[i].points;
    chFit["rmsMv"] = cal.fit[i].rmsMv;
    chFit["maxResidualMv"] = cal.fit[i].maxResidualMv;

    if (haveSample) {
      packMv += cellMv;
      if (i == 0 || cellMv < minMv) minMv = cellMv;
      if (i == 0 || cellMv > maxMv) maxMv = cellMv;
    }
  }

  doc["packMv"] = haveSample ? packMv : 0;
  doc["minCellMv"] = haveSample ? minMv : 0;
  doc["maxCellMv"] = haveSample ? maxMv : 0;
  doc["spreadMv"] = haveSample ? (maxMv - minMv) : 0;
  doc["lastSampleAgeMs"] =
      haveSample ? static_cast<int64_t>(now - snapshot.takenAtMs) : -1;
  doc["lastSampleSeq"] = haveSample ? snapshot.seq : 0;

  sendJson(200, doc);
}

void handleCalibration() {
  if (!s_server.hasArg("plain")) {
    sendError(400, "missing JSON body");
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, s_server.arg("plain"));
  if (err) {
    sendError(400, "invalid JSON");
    return;
  }

  JsonArray channels = doc["channels"];
  if (channels.isNull() ||
      channels.size() != static_cast<size_t>(ADC_CHANNEL_COUNT)) {
    sendError(400, "expected one calibration entry per channel");
    return;
  }

  Calibration next;
  for (int i = 0; i < ADC_CHANNEL_COUNT; i++) {
    const float scale = channels[i]["scale"] | NAN;
    const float offsetMv = channels[i]["offsetMv"] | NAN;
    ChannelCalibration candidate{scale, offsetMv};
    if (!calibrationChannelIsValid(candidate)) {
      sendError(400, "calibration value out of range");
      return;
    }
    next.ch[i] = candidate;

    // Optional: the UI reports how the affine pair was fitted.
    JsonVariant fitVar = channels[i]["fit"];
    if (!fitVar.isNull()) {
      if (!fitVar.is<JsonObject>()) {
        sendError(400, "fit must be an object");
        return;
      }
      JsonObject fitObj = fitVar.as<JsonObject>();
      const uint16_t points = fitObj["points"] | 0;
      const ChannelFit fit{points, fitObj["rmsMv"] | 0.0f,
                           fitObj["maxResidualMv"] | 0.0f};
      if (!calibrationFitIsValid(fit)) {
        sendError(400, "calibration fit out of range");
        return;
      }
      next.fit[i] = fit;
    }
  }
  next.calibrated = true;

  settings::saveCalibration(next);
  mqtt::requestPublish();

  JsonDocument res;
  res["ok"] = true;
  res["calibrated"] = true;
  sendJson(200, res);
}

void handleScan() {
  const int16_t found = WiFi.scanNetworks(false, true);
  JsonDocument doc;
  JsonArray networks = doc["networks"].to<JsonArray>();
  for (int i = 0; i < found; i++) {
    JsonObject net = networks.add<JsonObject>();
    net["ssid"] = WiFi.SSID(i);
    net["rssi"] = WiFi.RSSI(i);
    net["channel"] = WiFi.channel(i);
    net["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  WiFi.scanDelete();
  doc["ok"] = true;
  sendJson(200, doc);
}

void handleWifi() {
  if (!s_server.hasArg("plain")) {
    sendError(400, "missing JSON body");
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, s_server.arg("plain"));
  if (err) {
    sendError(400, "invalid JSON");
    return;
  }

  const String ssid = doc["ssid"] | "";
  String password = doc["password"] | "";

  if (ssid.isEmpty() || ssid.length() > 32) {
    sendError(400, "SSID must be 1-32 characters");
    return;
  }
  if (password.length() > 64 ||
      (password.length() > 0 && password.length() < 8)) {
    sendError(400, "password must be empty or 8-64 characters");
    return;
  }

  // Blank password with an unchanged SSID means "keep the stored password";
  // it avoids wiping working credentials when only re-saving the form.
  String storedSsid;
  String storedPassword;
  if (password.isEmpty() && settings::loadWifi(storedSsid, storedPassword) &&
      ssid == storedSsid) {
    password = storedPassword;
  }

  settings::saveWifi(ssid, password);

  JsonDocument res;
  res["ok"] = true;
  res["rebooting"] = true;
  sendJson(200, res);
  wifi_manager::requestReboot(800);
}

void handleFactoryReset() {
  settings::factoryReset();

  JsonDocument res;
  res["ok"] = true;
  res["rebooting"] = true;
  sendJson(200, res);
  wifi_manager::requestReboot(800);
}

bool isSafeHost(const String &value) {
  if (value.isEmpty() || value.length() > 128) return false;
  for (size_t i = 0; i < value.length(); i++) {
    const char c = value[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '.' || c == '-' ||
                    c == '_';
    if (!ok) return false;
  }
  return true;
}

bool isSafeUsername(const String &value) {
  if (value.length() > 128) return false;
  for (size_t i = 0; i < value.length(); i++) {
    const unsigned char c = static_cast<unsigned char>(value[i]);
    if (c < 0x20 || c == 0x7f) return false;
  }
  return true;
}

// Prefix must stay one MQTT path segment so the bundled ACL patterns
// (smarthouse/%u/state) keep working.
bool isSafePrefix(const String &value) {
  if (value.isEmpty() || value.length() > 64) return false;
  for (size_t i = 0; i < value.length(); i++) {
    const char c = value[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '.' || c == '_' ||
                    c == '-';
    if (!ok) return false;
  }
  return true;
}

bool looksLikePemCertificate(const String &value) {
  return value.indexOf("-----BEGIN CERTIFICATE-----") >= 0 &&
         value.indexOf("-----END CERTIFICATE-----") >= 0;
}

void handleMqtt() {
  if (!s_server.hasArg("plain")) {
    sendError(400, "missing JSON body");
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, s_server.arg("plain"));
  if (err) {
    sendError(400, "invalid JSON");
    return;
  }

  MqttSettings next = settings::loadMqtt();

  String host = doc["host"] | next.host;
  host.trim();
  if (!host.isEmpty() && !isSafeHost(host)) {
    sendError(400, "host must be a hostname or IPv4 address");
    return;
  }

  const int32_t port = doc["port"] | static_cast<int32_t>(next.port);
  if (port < 1 || port > 65535) {
    sendError(400, "port must be 1-65535");
    return;
  }

  const int32_t intervalSec =
      doc["intervalSec"] | static_cast<int32_t>(next.intervalSec);
  if (intervalSec < 5 || intervalSec > 3600) {
    sendError(400, "interval must be 5-3600 seconds");
    return;
  }

  String prefix = doc["prefix"] | next.prefix;
  prefix.trim();
  if (!isSafePrefix(prefix)) {
    sendError(400, "prefix must be 1-64 letters, digits, '.', '_' or '-'");
    return;
  }

  String username = doc["username"] | next.username;
  username.trim();
  if (!isSafeUsername(username)) {
    sendError(400, "invalid username");
    return;
  }

  next.host = host;
  next.port = static_cast<uint16_t>(port);
  next.tls = doc["tls"] | next.tls;
  next.prefix = prefix;
  next.intervalSec = static_cast<uint16_t>(intervalSec);
  next.username = username;

  if (doc["clearPassword"] | false) {
    next.password = "";
  } else {
    JsonVariant passwordVar = doc["password"];
    if (!passwordVar.isNull()) {
      String password = passwordVar | "";
      if (!password.isEmpty()) {
        if (!isSafeUsername(password)) {
          sendError(400, "invalid password");
          return;
        }
        next.password = password;
      }
    }
  }

  if (doc["clearCa"] | false) {
    next.caPem = "";
  } else {
    JsonVariant caVar = doc["caPem"];
    if (!caVar.isNull()) {
      String caPem = caVar | "";
      caPem.trim();
      if (!caPem.isEmpty()) {
        if (caPem.length() < 100 || caPem.length() > 3500 ||
            !looksLikePemCertificate(caPem)) {
          sendError(400, "CA must be a PEM certificate under 3500 bytes");
          return;
        }
        next.caPem = caPem;
      }
    }
  }

  if (!next.host.isEmpty() && next.tls && next.caPem.isEmpty()) {
    sendError(400, "TLS requires a CA certificate");
    return;
  }

  JsonVariant ntpVar = doc["ntpServer"];
  if (!ntpVar.isNull()) {
    String ntpServer = ntpVar | "";
    ntpServer.trim();
    if (ntpServer.isEmpty()) {
      ntpServer = "pool.ntp.org";
    }
    if (!isSafeHost(ntpServer)) {
      sendError(400, "invalid NTP server");
      return;
    }
    settings::saveNtpServer(ntpServer);
    wifi_manager::applyNtpServer();
  }

  settings::saveMqtt(next);
  mqtt::requestReload();
  mqtt::requestPublish();

  JsonDocument res;
  res["ok"] = true;
  sendJson(200, res);
}

void handleStatic() {
  if (s_server.method() != HTTP_GET) {
    sendError(404, "not found");
    return;
  }

  String path = s_server.uri();
  if (path.startsWith("/api/")) {
    sendError(404, "not found");
    return;
  }
  if (path.endsWith("/")) {
    path += "index.html";
  }
  if (path.indexOf("..") >= 0) {
    sendError(404, "not found");
    return;
  }

  if (!LittleFS.exists(path)) {
    sendError(404, "not found");
    return;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    sendError(500, "failed to open file");
    return;
  }

  // Assets are hashed by Vite, but no-cache avoids stale UI after a reflash.
  s_server.sendHeader("Cache-Control", "no-cache");
  s_server.streamFile(file, contentTypeFor(path));
  file.close();
}

}  // namespace

void webBegin() {
  s_server.on("/api/status", HTTP_GET, handleStatus);
  s_server.on("/api/calibration", HTTP_POST, handleCalibration);
  s_server.on("/api/wifi/scan", HTTP_GET, handleScan);
  s_server.on("/api/wifi", HTTP_POST, handleWifi);
  s_server.on("/api/mqtt", HTTP_POST, handleMqtt);
  s_server.on("/api/factory-reset", HTTP_POST, handleFactoryReset);
  s_server.onNotFound(handleStatic);
  s_server.begin();
}

void webLoop() { s_server.handleClient(); }
