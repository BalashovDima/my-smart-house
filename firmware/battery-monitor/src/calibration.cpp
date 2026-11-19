#include "calibration.h"

#include <cmath>

bool calibrationFromTwoPoints(float rawAMv, float cellAMv, float rawBMv,
                              float cellBMv, ChannelCalibration &out) {
  const float rawDelta = rawBMv - rawAMv;
  if (fabsf(rawDelta) < 1.0f) {
    return false;
  }

  const float scale = (cellBMv - cellAMv) / rawDelta;
  if (!std::isfinite(scale) || scale <= 0.0f) {
    return false;
  }

  const float offset = cellAMv - scale * rawAMv;
  if (!std::isfinite(offset)) {
    return false;
  }

  ChannelCalibration candidate{scale, offset};
  if (!calibrationChannelIsValid(candidate)) {
    return false;
  }

  out = candidate;
  return true;
}

bool calibrationChannelIsValid(const ChannelCalibration &ch) {
  if (!std::isfinite(ch.scale) || !std::isfinite(ch.offsetMv)) {
    return false;
  }
  if (ch.scale < 0.01f || ch.scale > 100.0f) {
    return false;
  }
  if (ch.offsetMv < -20000.0f || ch.offsetMv > 20000.0f) {
    return false;
  }
  return true;
}

int32_t calibrationToCellMv(const ChannelCalibration &ch, uint32_t pinMv) {
  const float cellMv = ch.scale * static_cast<float>(pinMv) + ch.offsetMv;
  if (!std::isfinite(cellMv) || cellMv < 0.0f) {
    return 0;
  }
  if (cellMv > 100000.0f) {
    return 100000;
  }
  return static_cast<int32_t>(std::lroundf(cellMv));
}
