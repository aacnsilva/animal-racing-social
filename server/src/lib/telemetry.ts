import { hostname } from 'node:os';
import {
  context, metrics, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace,
  type Attributes, type Context, type Counter, type Histogram, type Link, type Span,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { detectResources, envDetector, resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export { SpanKind, SpanStatusCode, type Span };

let tracerProvider: NodeTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;

export function telemetryEnabled(): boolean {
  return process.env.OTEL_SDK_DISABLED !== 'true' && Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

export function initTelemetry(service: string): void {
  if (tracerProvider) return;
  const resource = resourceFromAttributes({ 'service.name': service, 'service.instance.id': hostname() })
    .merge(detectResources({ detectors: [envDetector] }));
  const enabled = telemetryEnabled();
  tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: enabled ? [new BatchSpanProcessor(new OTLPTraceExporter(), { maxQueueSize: 4096, scheduledDelayMillis: 1000 })] : [],
  });
  tracerProvider.register({ propagator: new W3CTraceContextPropagator() });
  if (enabled) {
    meterProvider = new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 15_000) })],
    });
    metrics.setGlobalMeterProvider(meterProvider);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, 3000).unref());
  const flush = Promise.allSettled([tracerProvider?.shutdown(), meterProvider?.shutdown()]).then(() => undefined);
  await Promise.race([flush, deadline]);
}

const tracer = () => trace.getTracer('ars');

export type SpanOptions = {
  kind?: SpanKind;
  attributes?: Attributes;
  parent?: Context;
  root?: boolean;
  links?: Link[];
};

export async function withSpan<T>(name: string, options: SpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  const parent = options.root ? ROOT_CONTEXT : options.parent ?? context.active();
  return tracer().startActiveSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes, links: options.links }, parent, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      failSpan(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function startSpan(name: string, options: SpanOptions = {}): Span {
  const parent = options.root ? ROOT_CONTEXT : options.parent ?? context.active();
  return tracer().startSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes, links: options.links }, parent);
}

export function failSpan(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
}

export function activeSpan(): Span | undefined {
  const span = trace.getActiveSpan();
  return span && span.spanContext().traceFlags !== undefined && trace.isSpanContextValid(span.spanContext()) ? span : undefined;
}

export function tracing(): boolean {
  return activeSpan()?.isRecording() ?? false;
}

export function traceIds(): { trace_id?: string; span_id?: string } {
  const span = activeSpan();
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

export function spanContext(span: Span): Context {
  return trace.setSpan(ROOT_CONTEXT, span);
}

export function injectHeaders(from: Context = context.active()): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(from, carrier);
  return carrier;
}

type HeaderValue = string | Buffer | (string | Buffer)[] | undefined;

export function extractContext(headers: Record<string, HeaderValue> | undefined | null): Context {
  const carrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) carrier[key.toLowerCase()] = first.toString();
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
}

export function hasRemoteParent(ctx: Context): boolean {
  const span = trace.getSpan(ctx);
  return Boolean(span && trace.isSpanContextValid(span.spanContext()));
}

export function setIdAttributes(span: Span, value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const [field, attribute] of [['raceId', 'ars.race_id'], ['betId', 'ars.bet_id'], ['marketId', 'ars.market_id'], ['userId', 'ars.user_id'], ['seasonId', 'ars.season_id']] as const) {
    const id = record[field];
    if (typeof id === 'string' && id !== '' && id !== '0') span.setAttribute(attribute, id);
  }
}

const meter = () => metrics.getMeter('ars');
const instruments = new Map<string, unknown>();

function lazy<T>(key: string, create: () => T): T {
  let instrument = instruments.get(key) as T | undefined;
  if (!instrument) {
    instrument = create();
    instruments.set(key, instrument);
  }
  return instrument;
}

export function histogram(name: string, unit: string, description: string, buckets: number[]): Histogram {
  return lazy(name, () => meter().createHistogram(name, { unit, description, advice: { explicitBucketBoundaries: buckets } }));
}

export function counter(name: string, description: string): Counter {
  return lazy(name, () => meter().createCounter(name, { description }));
}

export function gauge(name: string, description: string, unit: string, read: () => Promise<{ value: number; attributes?: Attributes }[]>): void {
  lazy(name, () => {
    const instrument = meter().createObservableGauge(name, { description, unit });
    instrument.addCallback(async (result) => {
      try {
        for (const point of await read()) result.observe(point.value, point.attributes);
      } catch {
        return;
      }
    });
    return instrument;
  });
}

export const BUCKETS = {
  http: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 0.8, 1, 2.5, 5, 10],
  messaging: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  acceptance: [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 30],
  settlement: [1, 2, 5, 10, 15, 30, 60, 120, 300, 600],
  fast: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
};
