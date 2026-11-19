#include "settings.h"

#include <Preferences.h>

#include "config.h"

namespace {

Preferences s_prefs;
constexpr uint8_t CAL_VERSION = 1;

}  // namespace

namespace settings {

void begin() {
  if (!s_prefs.begin(NVS_NAMESPACE, false)) {
    Serial.println("settings: failed to open NVS namespace");
  }
}

Calibration loadCalibration() {
  Calibration cal;
  cal.calibrated = s_prefs.getBool("cal_ok", false);

  for (int i = 0; i < ADC_CHANNEL_COUNT; i++) {
    char scaleKey[16];
    char offsetKey[16];
    snprintf(scaleKey, sizeof(scaleKey), "cal_s%d", i);
    snprintf(offsetKey, sizeof(offsetKey), "cal_o%d", i);

    cal.ch[i].scale = s_prefs.getFloat(scaleKey, 1.0f);
    cal.ch[i].offsetMv = s_prefs.getFloat(offsetKey, 0.0f);
    if (!calibrationChannelIsValid(cal.ch[i])) {
      cal.ch[i] = ChannelCalibration{};
    }
  }
  return cal;
}

void saveCalibration(const Calibration &cal) {
  s_prefs.putUChar("cal_ver", CAL_VERSION);
  s_prefs.putBool("cal_ok", cal.calibrated);
  for (int i = 0; i < ADC_CHANNEL_COUNT; i++) {
    char scaleKey[16];
    char offsetKey[16];
    snprintf(scaleKey, sizeof(scaleKey), "cal_s%d", i);
    snprintf(offsetKey, sizeof(offsetKey), "cal_o%d", i);
    s_prefs.putFloat(scaleKey, cal.ch[i].scale);
    s_prefs.putFloat(offsetKey, cal.ch[i].offsetMv);
  }
}

bool loadWifi(String &ssid, String &password) {
  ssid = s_prefs.getString("wifi_ssid", "");
  password = s_prefs.getString("wifi_pass", "");
  return ssid.length() > 0;
}

void saveWifi(const String &ssid, const String &password) {
  s_prefs.putString("wifi_ssid", ssid);
  s_prefs.putString("wifi_pass", password);
}

bool hasWifi() {
  return s_prefs.getString("wifi_ssid", "").length() > 0;
}

void factoryReset() {
  s_prefs.clear();
}

}  // namespace settings
