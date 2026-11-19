#pragma once

#include <Arduino.h>

#include "config.h"

// cellMv = scale * pinMv + offsetMv, per channel.
struct ChannelCalibration {
  float scale;
  float offsetMv;

  ChannelCalibration(float scale = 1.0f, float offsetMv = 0.0f)
      : scale(scale), offsetMv(offsetMv) {}
};

struct Calibration {
  bool calibrated = false;
  ChannelCalibration ch[ADC_CHANNEL_COUNT];
};

// Two-point fit for cellMv = scale * pinMv + offsetMv.
// Returns false when the points cannot produce a usable line.
bool calibrationFromTwoPoints(float rawAMv, float cellAMv, float rawBMv,
                              float cellBMv, ChannelCalibration &out);

bool calibrationChannelIsValid(const ChannelCalibration &ch);

// Applies calibration and clamps to a non-negative integer mV value.
int32_t calibrationToCellMv(const ChannelCalibration &ch, uint32_t pinMv);
