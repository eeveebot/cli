'use strict';

/**
 * Lightweight Prometheus histogram parser for the monitor.
 * Ported from admin's metricsParser.mts — pure functions, no deps.
 */

/** Histogram bucket entry parsed from Prometheus metrics text */
interface HistogramBucket {
  le: number;      // bucket boundary (+Inf = Infinity)
  count: number;   // cumulative count
}

/** Parsed histogram data for a single metric */
interface HistogramData {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

/**
 * Calculate a percentile from Prometheus histogram buckets using linear interpolation.
 * Standard approach used by Prometheus histogram_quantile().
 */
export function calculatePercentileFromBuckets(
  buckets: HistogramBucket[],
  count: number,
  percentile: number,
): number | null {
  if (buckets.length < 2 || count === 0) return null;

  const target = percentile * count;

  let lowerBucket: HistogramBucket | null = null;
  let upperBucket: HistogramBucket | null = null;

  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].count >= target) {
      upperBucket = buckets[i];
      lowerBucket = i > 0 ? buckets[i - 1] : { le: 0, count: 0 };
      break;
    }
  }

  if (!upperBucket || !lowerBucket) return null;

  if (upperBucket.count === lowerBucket.count) {
    return upperBucket.le;
  }

  const fraction =
    (target - lowerBucket.count) / (upperBucket.count - lowerBucket.count);
  return lowerBucket.le + fraction * (upperBucket.le - lowerBucket.le);
}

/**
 * Parse histogram buckets, sum, and count from Prometheus metrics text.
 * Returns a map of metric name (without _bucket/_sum/_count suffix) to HistogramData.
 */
export function parseHistograms(metricsText: string): Map<string, HistogramData> {
  const histograms = new Map<string, HistogramData>();
  const lines = metricsText.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;

    // Bucket line: metric_name_bucket{labels,le="0.001"} 5
    const bucketMatch = line.match(
      /^([a-zA-Z0-9_]+)_bucket\{([^}]*)\}\s+([\d.]+)/,
    );
    if (bucketMatch) {
      const metricName = bucketMatch[1];
      const labelsStr = bucketMatch[2];
      const value = parseFloat(bucketMatch[3]);
      if (isNaN(value)) continue;

      const leMatch = labelsStr.match(/le="([^"]+)"/);
      if (!leMatch) continue;

      const le = leMatch[1] === '+Inf' ? Infinity : parseFloat(leMatch[1]);
      if (leMatch[1] !== '+Inf' && isNaN(le)) continue;

      if (!histograms.has(metricName)) {
        histograms.set(metricName, { buckets: [], sum: 0, count: 0 });
      }
      histograms.get(metricName)!.buckets.push({ le, count: value });
      continue;
    }

    // Sum line: metric_name_sum{labels} 0.156
    const sumMatch = line.match(
      /^([a-zA-Z0-9_]+)_sum\{[^}]*\}\s+([\d.eE+-]+)/,
    );
    if (sumMatch) {
      const metricName = sumMatch[1];
      const value = parseFloat(sumMatch[2]);
      if (isNaN(value)) continue;

      if (!histograms.has(metricName)) {
        histograms.set(metricName, { buckets: [], sum: 0, count: 0 });
      }
      histograms.get(metricName)!.sum = value;
      continue;
    }

    // Count line: metric_name_count{labels} 25
    const countMatch = line.match(
      /^([a-zA-Z0-9_]+)_count\{[^}]*\}\s+([\d.]+)/,
    );
    if (countMatch) {
      const metricName = countMatch[1];
      const value = parseInt(countMatch[2], 10);
      if (isNaN(value)) continue;

      if (!histograms.has(metricName)) {
        histograms.set(metricName, { buckets: [], sum: 0, count: 0 });
      }
      histograms.get(metricName)!.count = value;
      continue;
    }
  }

  // Sort buckets by le within each histogram
  for (const hist of histograms.values()) {
    hist.buckets.sort((a, b) => {
      if (a.le === Infinity) return 1;
      if (b.le === Infinity) return -1;
      return a.le - b.le;
    });
  }

  return histograms;
}
