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

// Provenance of the last fit, reported by the UI. The device does not fit:
// it stores what the UI computed so the quality survives a reload.
struct ChannelFit {
  uint16_t points;
  float rmsMv;
  float maxResidualMv;

  ChannelFit(uint16_t points = 0, float rmsMv = 0.0f, float maxResidualMv = 0.0f)
      : points(points), rmsMv(rmsMv), maxResidualMv(maxResidualMv) {}
};

struct Calibration {
  bool calibrated = false;
  ChannelCalibration ch[ADC_CHANNEL_COUNT];
  ChannelFit fit[ADC_CHANNEL_COUNT];
};

// Two-point fit for cellMv = scale * pinMv + offsetMv.
// Returns false when the points cannot produce a usable line.
bool calibrationFromTwoPoints(float rawAMv, float cellAMv, float rawBMv,
                              float cellBMv, ChannelCalibration &out);

bool calibrationChannelIsValid(const ChannelCalibration &ch);

bool calibrationFitIsValid(const ChannelFit &fit);

// Applies calibration and clamps to a non-negative integer mV value.
int32_t calibrationToCellMv(const ChannelCalibration &ch, uint32_t pinMv);
