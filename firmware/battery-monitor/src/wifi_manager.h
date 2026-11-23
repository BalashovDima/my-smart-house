#pragma once

#include <Arduino.h>

namespace wifi_manager {

void begin();
void loop();

bool staConnected();
bool apActive();
String modeLabel();
String ipAddress();
String apIpAddress();
String apSsid();
int32_t rssi();
String hostname();

// SNTP starts when the STA link comes up. TLS certificate validation needs a
// sane wall clock, so MQTT waits for this before connecting.
bool timeSynced();
String ntpServer();
void applyNtpServer();

// Reboots from the main loop, after the HTTP response has been sent.
void requestReboot(uint32_t delayMs);

}  // namespace wifi_manager
