#include "adc.h"

#include <algorithm>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

namespace {

SemaphoreHandle_t s_mutex = nullptr;
AdcSnapshot s_snapshot = {};
uint32_t s_seq = 0;

uint32_t medianU32(uint32_t *values, int count) {
  std::sort(values, values + count);
  return values[count / 2];
}

uint16_t medianU16(uint16_t *values, int count) {
  std::sort(values, values + count);
  return values[count / 2];
}

void sampleTask(void *) {
  for (;;) {
    AdcSnapshot snapshot = {};
    digitalWrite(PIN_OPAMP_POWER, OPAMP_POWER_ON_LEVEL);
    vTaskDelay(pdMS_TO_TICKS(OPAMP_SETTLE_MS));

    for (int ch = 0; ch < ADC_CHANNEL_COUNT; ch++) {
      uint32_t mvSamples[ADC_SAMPLES_PER_READ];
      uint16_t rawSamples[ADC_SAMPLES_PER_READ];
      for (int i = 0; i < ADC_SAMPLES_PER_READ; i++) {
        mvSamples[i] = analogReadMilliVolts(ADC_PINS[ch]);
        rawSamples[i] = analogRead(ADC_PINS[ch]);
      }
      snapshot.pinMv[ch] = medianU32(mvSamples, ADC_SAMPLES_PER_READ);
      snapshot.raw[ch] = medianU16(rawSamples, ADC_SAMPLES_PER_READ);
    }

    digitalWrite(PIN_OPAMP_POWER, OPAMP_POWER_OFF_LEVEL);

    snapshot.seq = ++s_seq;
    snapshot.takenAtMs = millis();
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_snapshot = snapshot;
    xSemaphoreGive(s_mutex);

    vTaskDelay(pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
  }
}

}  // namespace

void adcBegin() {
  pinMode(PIN_OPAMP_POWER, OUTPUT);
  digitalWrite(PIN_OPAMP_POWER, OPAMP_POWER_OFF_LEVEL);

  // ADC1 only (GPIO32-39): ADC2 is unavailable while Wi-Fi is active.
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  for (int ch = 0; ch < ADC_CHANNEL_COUNT; ch++) {
    analogSetPinAttenuation(ADC_PINS[ch], ADC_11db);
  }

  s_mutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(sampleTask, "adc-sample", 4096, nullptr, 1, nullptr, 0);
}

bool adcGetSnapshot(AdcSnapshot &out) {
  if (s_mutex == nullptr) {
    return false;
  }
  xSemaphoreTake(s_mutex, portMAX_DELAY);
  out = s_snapshot;
  xSemaphoreGive(s_mutex);
  return out.seq > 0;
}
