#pragma once

#include <Arduino.h>

#include "calibration.h"

namespace settings {

void begin();

Calibration loadCalibration();
void saveCalibration(const Calibration &cal);

bool loadWifi(String &ssid, String &password);
void saveWifi(const String &ssid, const String &password);
bool hasWifi();

void factoryReset();

}  // namespace settings
