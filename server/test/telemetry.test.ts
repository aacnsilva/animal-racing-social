import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { summarizeSql } from '../src/lib/db.ts';
import { log } from '../src/lib/log.ts';
import {
  extractContext, hasRemoteParent, initTelemetry, injectHeaders, shutdownTelemetry, spanContext, startSpan, telemetryEnabled, traceIds, withSpan,
} from '../src/lib/telemetry.ts';

before(() => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  initTelemetry('telemetry-test');
});

function captureStdout(fn: () => void): string {
  const original = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return output;
}

describe('telemetry without a collector', () => {
  it('is disabled and still creates valid, propagatable spans', async () => {
    assert.equal(telemetryEnabled(), false);
    await withSpan('unit', {}, async (span) => {
      assert.match(span.spanContext().traceId, /^[0-9a-f]{32}$/);
      assert.equal(traceIds().trace_id, span.spanContext().traceId);
    });
    await shutdownTelemetry();
  });
});

describe('W3C propagation', () => {
  it('round-trips through HTTP-style headers', async () => {
    await withSpan('producer', {}, async (span) => {
      const headers = injectHeaders();
      assert.match(headers.traceparent ?? '', new RegExp(`^00-${span.spanContext().traceId}-${span.spanContext().spanId}-01$`));
      const parent = extractContext(headers);
      assert.equal(hasRemoteParent(parent), true);
      await withSpan('consumer', { parent }, async (child) => {
        assert.equal(child.spanContext().traceId, span.spanContext().traceId);
      });
    });
  });

  it('extracts Kafka Buffer headers and ignores missing context', () => {
    const span = startSpan('kafka');
    const headers = injectHeaders(spanContext(span));
    const kafkaHeaders = { traceparent: Buffer.from(headers.traceparent!), other: Buffer.from('x') };
    assert.equal(hasRemoteParent(extractContext(kafkaHeaders)), true);
    assert.equal(hasRemoteParent(extractContext({})), false);
    assert.equal(hasRemoteParent(extractContext(null)), false);
    span.end();
  });

  it('starts a fresh trace for root spans even inside another span', async () => {
    await withSpan('outer', {}, async (outer) => {
      await withSpan('root', { root: true }, async (root) => {
        assert.notEqual(root.spanContext().traceId, outer.spanContext().traceId);
      });
    });
  });
});

describe('log correlation', () => {
  it('adds trace and span ids to log lines inside a span only', async () => {
    const outside = JSON.parse(captureStdout(() => log.info('outside')));
    assert.equal(outside.trace_id, undefined);
    await withSpan('logged', {}, async (span) => {
      const inside = JSON.parse(captureStdout(() => log.info('inside', { betId: '42' })));
      assert.deepEqual(Object.keys(inside).slice(0, 4), ['t', 'level', 'service', 'msg']);
      assert.equal(inside.trace_id, span.spanContext().traceId);
      assert.equal(inside.span_id, span.spanContext().spanId);
      assert.equal(inside.betId, '42');
    });
  });
});

describe('SQL span names', () => {
  it('summarizes operation and table without parameters', () => {
    assert.deepEqual(summarizeSql('SELECT * FROM betting.bets WHERE user_id = $1'), { operation: 'SELECT', table: 'betting.bets' });
    assert.deepEqual(summarizeSql('INSERT INTO wallet.ledger_entries (a) VALUES ($1)'), { operation: 'INSERT', table: 'wallet.ledger_entries' });
    assert.deepEqual(summarizeSql(`UPDATE market.markets\n  SET status = 'OPEN'`), { operation: 'UPDATE', table: 'market.markets' });
    assert.deepEqual(summarizeSql('WITH x AS (SELECT 1) SELECT * FROM racing.races'), { operation: 'SELECT', table: 'racing.races' });
  });
});
