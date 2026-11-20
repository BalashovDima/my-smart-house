#include "adc.h"

#include <algorithm>
#include <driver/adc.h>
#include <esp_adc_cal.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

namespace {

static_assert(ADC_SAMPLES_PER_READ % ADC_BLOCK_SIZE == 0,
              "ADC_SAMPLES_PER_READ must be a multiple of ADC_BLOCK_SIZE");
static_assert(ADC_BLOCK_SIZE > 0, "ADC_BLOCK_SIZE must be positive");

constexpr int ADC_BLOCK_COUNT = ADC_SAMPLES_PER_READ / ADC_BLOCK_SIZE;

SemaphoreHandle_t s_mutex = nullptr;
AdcSnapshot s_snapshot = {};
uint32_t s_seq = 0;

// The Arduino core hard-codes the same nominal reference when the eFuse has no
// calibration data (cores/esp32/esp32-hal-adc.c).
constexpr uint32_t ADC_DEFAULT_VREF_MV = 1100;

// Built once at boot from eFuse two-point / eFuse Vref, or the default fallback.
esp_adc_cal_characteristics_t s_chars = {};
esp_adc_cal_value_t s_calType = ESP_ADC_CAL_VAL_DEFAULT_VREF;
bool s_calReady = false;

// Median of the per-block means: keeps the spike rejection of a median while
// averaging away per-sample noise. Returns ADC counts.
uint16_t readRobustCount(uint8_t pin) {
  uint32_t blockSums[ADC_BLOCK_COUNT];
  for (int b = 0; b < ADC_BLOCK_COUNT; b++) {
    uint32_t sum = 0;
    for (int i = 0; i < ADC_BLOCK_SIZE; i++) {
      sum += analogRead(pin);
    }
    blockSums[b] = sum;
  }

  std::sort(blockSums, blockSums + ADC_BLOCK_COUNT);

  // Middle block sum; with an even block count, add the other middle block and
  // divide by twice the block size, so no sub-count precision is lost.
  uint32_t middle = blockSums[ADC_BLOCK_COUNT / 2];
  uint32_t divisor = ADC_BLOCK_SIZE;
  if (ADC_BLOCK_COUNT % 2 == 0) {
    middle += blockSums[ADC_BLOCK_COUNT / 2 - 1];
    divisor *= 2;
  }
  return static_cast<uint16_t>((middle + divisor / 2) / divisor);
}

void sampleTask(void *) {
  for (;;) {
    AdcSnapshot snapshot = {};
    digitalWrite(PIN_OPAMP_POWER, OPAMP_POWER_ON_LEVEL);
    vTaskDelay(pdMS_TO_TICKS(OPAMP_SETTLE_MS));

    for (int ch = 0; ch < ADC_CHANNEL_COUNT; ch++) {
      const uint16_t raw = readRobustCount(ADC_PINS[ch]);
      snapshot.raw[ch] = raw;
      snapshot.pinMv[ch] = esp_adc_cal_raw_to_voltage(raw, &s_chars);
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

  // One characterization covers every channel: esp_adc_cal picks eFuse
  // two-point, then eFuse Vref, then the nominal default reference. Doing it
  // once also avoids the table walk inside analogReadMilliVolts() per sample.
  // ADC_ATTEN_DB_12 is the same enum value (3) that Arduino's ADC_11db maps to.
  s_calType = esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_12,
                                       ADC_WIDTH_BIT_12, ADC_DEFAULT_VREF_MV,
                                       &s_chars);
  s_calReady = true;
  Serial.printf("adc: calibration source %s, vref %umV\n",
                adcCalibrationSource(), static_cast<unsigned>(s_chars.vref));

  s_mutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(sampleTask, "adc-sample", 4096, nullptr, 1, nullptr, 0);
}

const char *adcCalibrationSource() {
  if (!s_calReady) {
    return "unknown";
  }
  switch (s_calType) {
    case ESP_ADC_CAL_VAL_EFUSE_TP:
      return "efuse-tp";
    case ESP_ADC_CAL_VAL_EFUSE_VREF:
      return "efuse-vref";
    default:
      return "default-vref";
  }
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
