#include "settings.h"

#include <Preferences.h>

#include "config.h"

namespace {

Preferences s_prefs;
// v2 added per-channel fit provenance (cal_pts/rms/mx). Older records still
// load: the fit fields default to zero, meaning "not recorded".
constexpr uint8_t CAL_VERSION = 2;

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
    char pointsKey[16];
    char rmsKey[16];
    char maxKey[16];
    snprintf(scaleKey, sizeof(scaleKey), "cal_s%d", i);
    snprintf(offsetKey, sizeof(offsetKey), "cal_o%d", i);
    snprintf(pointsKey, sizeof(pointsKey), "cal_pts%d", i);
    snprintf(rmsKey, sizeof(rmsKey), "cal_rms%d", i);
    snprintf(maxKey, sizeof(maxKey), "cal_mx%d", i);

    cal.ch[i].scale = s_prefs.getFloat(scaleKey, 1.0f);
    cal.ch[i].offsetMv = s_prefs.getFloat(offsetKey, 0.0f);
    if (!calibrationChannelIsValid(cal.ch[i])) {
      cal.ch[i] = ChannelCalibration{};
    }

    cal.fit[i] = ChannelFit{s_prefs.getUShort(pointsKey, 0),
                            s_prefs.getFloat(rmsKey, 0.0f),
                            s_prefs.getFloat(maxKey, 0.0f)};
    if (!calibrationFitIsValid(cal.fit[i])) {
      cal.fit[i] = ChannelFit{};
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
    char pointsKey[16];
    char rmsKey[16];
    char maxKey[16];
    snprintf(scaleKey, sizeof(scaleKey), "cal_s%d", i);
    snprintf(offsetKey, sizeof(offsetKey), "cal_o%d", i);
    snprintf(pointsKey, sizeof(pointsKey), "cal_pts%d", i);
    snprintf(rmsKey, sizeof(rmsKey), "cal_rms%d", i);
    snprintf(maxKey, sizeof(maxKey), "cal_mx%d", i);
    s_prefs.putFloat(scaleKey, cal.ch[i].scale);
    s_prefs.putFloat(offsetKey, cal.ch[i].offsetMv);
    s_prefs.putUShort(pointsKey, cal.fit[i].points);
    s_prefs.putFloat(rmsKey, cal.fit[i].rmsMv);
    s_prefs.putFloat(maxKey, cal.fit[i].maxResidualMv);
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

MqttSettings loadMqtt() {
  MqttSettings mqtt;
  mqtt.host = s_prefs.getString("mqtt_host", "");
  mqtt.port = s_prefs.getUShort("mqtt_port", 8883);
  mqtt.tls = s_prefs.getBool("mqtt_tls", true);
  mqtt.username = s_prefs.getString("mqtt_user", "");
  mqtt.password = s_prefs.getString("mqtt_pass", "");
  mqtt.prefix = s_prefs.getString("mqtt_prefix", "smarthouse");
  mqtt.intervalSec = s_prefs.getUShort("mqtt_int", 30);
  mqtt.caPem = s_prefs.getString("mqtt_ca", "");

  // Older or partially cleared records still need to produce a usable topic.
  if (mqtt.port == 0) mqtt.port = 8883;
  if (mqtt.prefix.isEmpty()) mqtt.prefix = "smarthouse";
  if (mqtt.intervalSec < 5 || mqtt.intervalSec > 3600) mqtt.intervalSec = 30;
  return mqtt;
}

void saveMqtt(const MqttSettings &mqtt) {
  s_prefs.putString("mqtt_host", mqtt.host);
  s_prefs.putUShort("mqtt_port", mqtt.port);
  s_prefs.putBool("mqtt_tls", mqtt.tls);
  s_prefs.putString("mqtt_user", mqtt.username);
  s_prefs.putString("mqtt_pass", mqtt.password);
  s_prefs.putString("mqtt_prefix", mqtt.prefix);
  s_prefs.putUShort("mqtt_int", mqtt.intervalSec);
  s_prefs.putString("mqtt_ca", mqtt.caPem);
}

String loadNtpServer() {
  const String server = s_prefs.getString("ntp_srv", "");
  return server.isEmpty() ? String("pool.ntp.org") : server;
}

void saveNtpServer(const String &server) {
  s_prefs.putString("ntp_srv", server);
}

void factoryReset() {
  s_prefs.clear();
}

}  // namespace settings
