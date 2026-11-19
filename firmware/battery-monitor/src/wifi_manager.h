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

// Reboots from the main loop, after the HTTP response has been sent.
void requestReboot(uint32_t delayMs);

}  // namespace wifi_manager
