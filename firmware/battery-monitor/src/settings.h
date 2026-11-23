#pragma once

#include <Arduino.h>

#include "calibration.h"

// MQTT lives outside config.h: broker address, credentials, and the CA
// certificate are provisioned from the device UI and stored in NVS.
struct MqttSettings {
  String host;
  uint16_t port = 8883;
  bool tls = true;
  String username;
  String password;
  String prefix = "smarthouse";
  uint16_t intervalSec = 30;
  String caPem;
};

namespace settings {

void begin();

Calibration loadCalibration();
void saveCalibration(const Calibration &cal);

bool loadWifi(String &ssid, String &password);
void saveWifi(const String &ssid, const String &password);
bool hasWifi();

MqttSettings loadMqtt();
void saveMqtt(const MqttSettings &mqtt);

String loadNtpServer();
void saveNtpServer(const String &server);

void factoryReset();

}  // namespace settings
