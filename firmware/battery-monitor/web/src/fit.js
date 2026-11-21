// Least-squares fit for the calibration contract:
//   cellMv = scale * pinMv + offsetMv
// The firmware only stores the affine pair, so fitting happens here in the UI.

export const FIT_LIMITS = {
  minPoints: 2,
  // Below this the slope is dominated by measurement noise.
  minPinSpanMv: 60,
  // Same bounds as calibrationChannelIsValid() in the firmware.
  minScale: 0.01,
  maxScale: 100,
  maxAbsOffsetMv: 20000,
};

// points: [{ x: pinMv, y: cellMv }, ...]
// Returns { scale, offsetMv, rmsMv, maxResidualMv, n, pinSpanMv } or { error }.
export function fitLinear(points) {
  if (!Array.isArray(points) || points.length < FIT_LIMITS.minPoints) {
    return { error: `At least ${FIT_LIMITS.minPoints} points are required.` };
  }

  const xs = [];
  const ys = [];
  for (const point of points) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { error: 'All point values must be numbers.' };
    }
    xs.push(x);
    ys.push(y);
  }

  const n = xs.length;
  const pinSpanMv = Math.max(...xs) - Math.min(...xs);
  if (pinSpanMv < FIT_LIMITS.minPinSpanMv) {
    return {
      error: `Pin readings span only ${pinSpanMv.toFixed(0)} mV; need at least ${FIT_LIMITS.minPinSpanMv} mV.`,
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i] - meanY);
  }
  if (!(sxx > 0)) {
    return { error: 'Pin readings are identical.' };
  }

  const scale = sxy / sxx;
  const offsetMv = meanY - scale * meanX;
  if (
    !Number.isFinite(scale) ||
    scale < FIT_LIMITS.minScale ||
    scale > FIT_LIMITS.maxScale
  ) {
    return { error: 'Computed scale is out of range.' };
  }
  if (!Number.isFinite(offsetMv) || Math.abs(offsetMv) > FIT_LIMITS.maxAbsOffsetMv) {
    return { error: 'Computed offset is out of range.' };
  }

  let sumSquares = 0;
  let maxResidualMv = 0;
  for (let i = 0; i < n; i++) {
    const residual = ys[i] - (scale * xs[i] + offsetMv);
    sumSquares += residual * residual;
    maxResidualMv = Math.max(maxResidualMv, Math.abs(residual));
  }

  return {
    scale,
    offsetMv,
    rmsMv: Math.sqrt(sumSquares / n),
    maxResidualMv,
    n,
    pinSpanMv,
  };
}

// Rough interpretation for the UI: rms/max above these means the front end is
// not behaving like a straight line, or one captured point is wrong.
export const FIT_QUALITY = {
  goodMv: 5,
  warnMv: 10,
};

export function fitTone(fit) {
  if (!fit || fit.error) return 'rose';
  if (fit.maxResidualMv > FIT_QUALITY.warnMv) return 'rose';
  if (fit.maxResidualMv > FIT_QUALITY.goodMv) return 'amber';
  return 'green';
}
