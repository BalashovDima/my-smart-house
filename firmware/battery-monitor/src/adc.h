#pragma once

#include <Arduino.h>

#include "config.h"

struct AdcSnapshot {
  uint32_t seq;          // burst counter
  uint32_t takenAtMs;    // millis() when the burst completed
  uint16_t raw[ADC_CHANNEL_COUNT];    // ADC count: median of block means
  uint32_t pinMv[ADC_CHANNEL_COUNT];  // eFuse-characterized ADC pin voltage
};

// Configures ADC1 pins and starts the background sampling task.
void adcBegin();

// Which ADC calibration the hardware offers: "efuse-tp", "efuse-vref",
// "default-vref", or "unknown" before adcBegin() has run.
const char *adcCalibrationSource();

// Copies the latest burst. Returns false until the first burst completes.
bool adcGetSnapshot(AdcSnapshot &out);
