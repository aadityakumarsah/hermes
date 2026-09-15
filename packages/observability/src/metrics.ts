import { randomUUID } from 'node:crypto';
import type { Metrics, Tracer, TracingSpan } from '@hermes/core';

/**
 * No-op tracer + metrics used before OTel/Prometheus exporters are configured.
 * Keeps the boot path dependency-light while preserving the stable contract.
 */

export class NoopSpan implements TracingSpan {
  setAttribute(): void {}
  addEvent(): void {}
  end(): void {}
}

export class NoopTracer implements Tracer {
  startSpan(): TracingSpan {
    return new NoopSpan();
  }
}

interface Counter { value: number; labels: Record<string, string> }
interface Gauge { value: number; labels: Record<string, string> }
interface Histogram { buckets: number[]; sum: number; labels: Record<string, string> }

export class InMemoryMetrics implements Metrics {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  increment(name: string, value = 1, attributes: Record<string, string> = {}): void {
    const key = metricKey(name, attributes);
    const current = this.counters.get(key);
    this.counters.set(key, { value: (current?.value ?? 0) + value, labels: attributes });
  }

  gauge(name: string, value: number, attributes: Record<string, string> = {}): void {
    this.gauges.set(metricKey(name, attributes), { value, labels: attributes });
  }

  histogram(name: string, value: number, attributes: Record<string, string> = {}): void {
    const key = metricKey(name, attributes);
    const current = this.histograms.get(key);
    const buckets = current ? [...current.buckets, value] : [value];
    this.histograms.set(key, { buckets, sum: (current?.sum ?? 0) + value, labels: attributes });
  }

  async observeDuration(name: string, fn: () => Promise<void>, attributes: Record<string, string> = {}): Promise<void> {
    const start = Date.now();
    try {
      await fn();
    } finally {
      this.histogram(name, Date.now() - start, attributes);
    }
  }

  /** Export counters/gauges/histograms as Prometheus text format. */
  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [key, entry] of this.counters) {
      lines.push(formatLine('counter', key, entry.labels, entry.value));
    }
    for (const [key, entry] of this.gauges) {
      lines.push(formatLine('gauge', key, entry.labels, entry.value));
    }
    for (const [key, entry] of this.histograms) {
      lines.push(formatLine('histogram', key, entry.labels, entry.sum, entry.buckets.length));
    }
    return lines.join('\n');
  }

  snapshot(): Map<string, { value: number; labels: Record<string, string> }> {
    const out = new Map<string, { value: number; labels: Record<string, string> }>();
    for (const [key, counter] of this.counters) out.set(key, { value: counter.value, labels: counter.labels });
    for (const [key, gauge] of this.gauges) out.set(key, { value: gauge.value, labels: gauge.labels });
    return out;
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

function metricKey(name: string, attrs: Record<string, string>): string {
  const label = Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return label ? `${name}{${label}}` : name;
}

function formatLine(type: string, key: string, labels: Record<string, string>, value: number, extra?: number): string {
  const name = key.split('{')[0] ?? key;
  return [`# TYPE ${name} ${type}`, `${key} ${value}${extra !== undefined ? ` ${extra}` : ''}`].join('\n');
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}