#include "wifi_manager.h"

#include <ESPmDNS.h>
#include <WiFi.h>

#include "config.h"
#include "settings.h"

namespace {

enum State : uint8_t {
  STATE_AP_ONLY,
  STATE_STA_CONNECTING,
  STATE_STA_CONNECTED,
  STATE_AP_STA_RETRY,
};

constexpr uint32_t CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t RETRY_INTERVAL_MS = 20000;

State s_state = STATE_AP_ONLY;
String s_ssid;
String s_pass;
String s_apSsid;
String s_hostname;
uint32_t s_deadline = 0;
uint32_t s_nextRetry = 0;
uint32_t s_rebootAt = 0;
bool s_mdnsStarted = false;

String chipSuffix() {
  char buf[5];
  snprintf(buf, sizeof(buf), "%04X",
           static_cast<uint16_t>(ESP.getEfuseMac() & 0xFFFF));
  return String(buf);
}

void startMdns() {
  if (s_mdnsStarted) {
    return;
  }
  if (MDNS.begin(s_hostname.c_str())) {
    MDNS.addService("http", "tcp", 80);
    s_mdnsStarted = true;
  } else {
    Serial.println("wifi: mDNS start failed");
  }
}

void restartMdns() {
  if (s_mdnsStarted) {
    MDNS.end();
    s_mdnsStarted = false;
  }
  startMdns();
}

void startSoftAp() {
  if (AP_PASSWORD[0] != '\0') {
    WiFi.softAP(s_apSsid.c_str(), AP_PASSWORD);
  } else {
    WiFi.softAP(s_apSsid.c_str());
  }
}

void onStaConnected() {
  // Leave the mode as AP_STA to avoid a mode switch that would drop the fresh
  // STA link; just stop the fallback AP. enterApStaRetry() brings it back.
  if (s_state == STATE_AP_STA_RETRY) {
    WiFi.softAPdisconnect(true);
  }
  s_state = STATE_STA_CONNECTED;
  restartMdns();
  Serial.printf("wifi: connected to %s, ip %s\n", s_ssid.c_str(),
                WiFi.localIP().toString().c_str());
}

void enterApStaRetry() {
  WiFi.mode(WIFI_AP_STA);
  startSoftAp();
  WiFi.begin(s_ssid.c_str(), s_pass.c_str());
  s_state = STATE_AP_STA_RETRY;
  s_nextRetry = millis() + RETRY_INTERVAL_MS;
  restartMdns();
  Serial.printf("wifi: AP fallback %s, retrying STA\n", s_apSsid.c_str());
}

}  // namespace

namespace wifi_manager {

void begin() {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);

  s_hostname = String(DEVICE_HOSTNAME) + "-" + chipSuffix();
  s_apSsid = String(AP_SSID_PREFIX) + "-" + chipSuffix();

  const bool hasCreds = settings::loadWifi(s_ssid, s_pass);
  if (!hasCreds) {
    WiFi.mode(WIFI_AP);
    WiFi.setHostname(s_hostname.c_str());
    startSoftAp();
    s_state = STATE_AP_ONLY;
    startMdns();
    Serial.printf("wifi: no credentials, AP %s at %s\n", s_apSsid.c_str(),
                  WiFi.softAPIP().toString().c_str());
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(s_hostname.c_str());
  WiFi.begin(s_ssid.c_str(), s_pass.c_str());
  s_state = STATE_STA_CONNECTING;
  s_deadline = millis() + CONNECT_TIMEOUT_MS;
  Serial.printf("wifi: connecting to %s\n", s_ssid.c_str());
}

void loop() {
  if (s_rebootAt != 0 && static_cast<int32_t>(millis() - s_rebootAt) >= 0) {
    ESP.restart();
  }

  switch (s_state) {
    case STATE_STA_CONNECTING:
      if (WiFi.status() == WL_CONNECTED) {
        onStaConnected();
      } else if (static_cast<int32_t>(millis() - s_deadline) >= 0) {
        enterApStaRetry();
      }
      break;

    case STATE_STA_CONNECTED:
      if (WiFi.status() != WL_CONNECTED) {
        enterApStaRetry();
      }
      break;

    case STATE_AP_STA_RETRY:
      if (WiFi.status() == WL_CONNECTED) {
        onStaConnected();
      } else if (static_cast<int32_t>(millis() - s_nextRetry) >= 0) {
        s_nextRetry = millis() + RETRY_INTERVAL_MS;
        WiFi.disconnect();
        WiFi.begin(s_ssid.c_str(), s_pass.c_str());
      }
      break;

    case STATE_AP_ONLY:
      break;
  }
}

bool staConnected() { return WiFi.status() == WL_CONNECTED; }

bool apActive() {
  return s_state == STATE_AP_ONLY || s_state == STATE_AP_STA_RETRY;
}

String modeLabel() {
  if (staConnected() && apActive()) {
    return "ap+sta";
  }
  if (staConnected()) {
    return "sta";
  }
  return "ap";
}

String ipAddress() {
  if (staConnected()) {
    return WiFi.localIP().toString();
  }
  if (apActive()) {
    return WiFi.softAPIP().toString();
  }
  return "0.0.0.0";
}

String apIpAddress() { return apActive() ? WiFi.softAPIP().toString() : String(); }

String apSsid() { return apActive() ? s_apSsid : String(); }

int32_t rssi() { return staConnected() ? WiFi.RSSI() : 0; }

String hostname() { return s_hostname; }

void requestReboot(uint32_t delayMs) { s_rebootAt = millis() + delayMs; }

}  // namespace wifi_manager
