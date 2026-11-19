#include <Arduino.h>
#include <LittleFS.h>

#include "adc.h"
#include "config.h"
#include "settings.h"
#include "web_server.h"
#include "wifi_manager.h"

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\nmy-smart-house battery monitor %s\n", FW_VERSION);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed (web UI unavailable)");
  }

  settings::begin();
  adcBegin();
  wifi_manager::begin();
  webBegin();
}

void loop() {
  wifi_manager::loop();
  webLoop();
  delay(2);
}
