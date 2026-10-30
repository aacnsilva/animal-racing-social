import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiSession, BASE_URL, uniqueSubject } from './support.ts';

const VICTORIA_METRICS = process.env.VICTORIA_METRICS_URL ?? 'http://127.0.0.1:8428';
const VICTORIA_LOGS = process.env.VICTORIA_LOGS_URL ?? 'http://127.0.0.1:9428';
const JAEGER = process.env.JAEGER_URL ?? 'http://127.0.0.1:16686';
const DISCORD_SINK = process.env.DISCORD_SINK_URL ?? 'http://localhost:9000/webhooks/discord';
const GRAFANA = `${BASE_URL}/grafana`;
const GRAFANA_AUTH = `Basic ${Buffer.from(`admin:${process.env.GRAFANA_ADMIN_PASSWORD ?? 'admin'}`).toString('base64')}`;
const APP_SERVICES = [
  'api', 'sse', 'wallet', 'scheduler', 'stable', 'market-manager', 'bet-worker', 'settlement', 'combo-aggregator', 'season', 'notification',
  'race-engine', 'race-broadcaster', 'odds-engine',
];

type Span = { spanID: string; operationName: string; processID: string; tags: { key: string; value: unknown }[]; references: { spanID: string }[] };
type Trace = { traceID: string; spans: Span[]; processes: Record<string, { serviceName: string }> };

let http: APIRequestContext;

test.beforeAll(async () => {
  http = await request.newContext();
});

test.afterAll(async () => {
  await http.dispose();
});

async function promql(query: string): Promise<{ metric: Record<string, string>; value: [number, string] }[]> {
  const response = await http.get(`${VICTORIA_METRICS}/api/v1/query`, { params: { query } });
  expect(response.ok(), `${query}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data.result;
}

async function logs(query: string, limit = 1000): Promise<Record<string, string>[]> {
  const response = await http.post(`${VICTORIA_LOGS}/select/logsql/query`, { form: { query, limit: String(limit) } });
  expect(response.ok(), `${query}: ${await response.text()}`).toBeTruthy();
  return (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function trace(traceId: string): Promise<Trace | null> {
  const response = await http.get(`${JAEGER}/api/traces/${traceId}`);
  if (!response.ok()) return null;
  return ((await response.json()).data?.[0] as Trace | undefined) ?? null;
}

const serviceOf = (found: Trace, span: Span) => found.processes[span.processID]!.serviceName;

async function grafana<T = any>(method: string, path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const response = await http.fetch(`${GRAFANA}${path}`, { method, data, headers: { authorization: GRAFANA_AUTH } });
  const text = await response.text();
  return { status: response.status(), body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T };
}

async function openWinMarket(api: APIRequestContext): Promise<{ id: string; priceVersion: number; selections: { entrantId: string; price: number }[] }> {
  const races = (await (await api.get('/v1/races?status=OPEN&limit=20')).json()).items as { id: string }[];
  for (const race of races) {
    const markets = await (await api.get(`/v1/races/${race.id}/markets`)).json();
    const market = markets.find((candidate: { type: string; status: string }) => candidate.type === 'FINISH_POSITION' && candidate.status === 'OPEN');
    if (market) return market;
  }
  throw new Error('No open win market');
}

test('a bet is one trace from the edge through Kafka to the wallet, with correlated logs', async () => {
  const { api, token } = await apiSession(uniqueSubject('trace'));
  const market = await openWinMarket(api);
  const selection = market.selections[0]!;
  const placed = await api.post(`/v1/markets/${market.id}/bets`, {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    data: { selection: { entrantId: selection.entrantId }, stake: 10, acceptedPrice: selection.price, priceVersion: market.priceVersion, acceptPriceChanges: 'ANY' },
  });
  expect(placed.status(), await placed.text()).toBeLessThan(300);
  const betId = (await placed.json()).id as string;
  const traceId = placed.headers()['x-trace-id']!;
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  await api.dispose();

  let found: Trace | null = null;
  await expect.poll(async () => {
    found = await trace(traceId);
    return found ? [...new Set(found.spans.map((span) => serviceOf(found!, span)))] : [];
  }, { timeout: 60_000, intervals: [2000] }).toEqual(expect.arrayContaining(['caddy', 'api', 'bet-worker', 'wallet']));

  const spans = found!.spans;
  const byId = new Map(spans.map((span) => [span.spanID, span]));
  const consumer = spans.find((span) => serviceOf(found!, span) === 'bet-worker' && span.operationName.startsWith('process bet.commands'));
  expect(consumer, spans.map((span) => span.operationName).join(', ')).toBeTruthy();
  const producer = byId.get(consumer!.references[0]!.spanID);
  expect(producer?.operationName).toMatch(/^publish bet\.commands/);
  expect(spans.some((span) => serviceOf(found!, span) === 'wallet' && span.tags.some((tag) => tag.key === 'span.kind' && tag.value === 'server'))).toBeTruthy();
  expect(spans.some((span) => span.tags.some((tag) => tag.key === 'ars.bet_id' && tag.value === betId))).toBeTruthy();
  for (const span of spans) {
    for (const tag of span.tags) expect(tag.key).not.toMatch(/authorization|cookie|idempotency|email|display_name/i);
  }

  await expect.poll(async () => [...new Set((await logs(`trace_id:=${traceId}`)).map((line) => line.job))], { timeout: 60_000, intervals: [2000] })
    .toEqual(expect.arrayContaining(['api', 'bet-worker']));
});

test('metrics from every layer reach VictoriaMetrics', async () => {
  const present = [
    'ars_bets_placed_total',
    'ars_bet_acceptance_duration_seconds_count',
    'ars_bet_settlement_lag_seconds_count',
    'ars_broadcaster_tick_drift_seconds_count',
    'ars_broadcaster_start_delay_seconds_count',
    'ars_engine_seal_duration_seconds_count',
    'ars_odds_mc_duration_seconds_count',
    'ars_market_transitions_total',
    'ars_races',
    'ars_outbox_pending',
    'ars_stable_pool',
    'http_server_request_duration_seconds_count{job="api"}',
    'http_server_request_duration_seconds_count{job="race-engine"}',
    'http_client_request_duration_seconds_count',
    'messaging_process_duration_seconds_count{job="bet-worker"}',
    'messaging_process_duration_seconds_count{job="odds-engine"}',
    'kafka_consumergroup_uncommitted_offsets_sum',
    'pg_up == 1',
    'redis_up == 1',
    'caddy_http_requests_total',
    'container_memory_working_set_bytes{name=~"ars-.*"}',
    'node_memory_MemTotal_bytes',
  ];
  for (const query of present) {
    await expect.poll(async () => (await promql(query)).length, { message: query, timeout: 60_000, intervals: [3000] }).toBeGreaterThan(0);
  }
  const probes = await promql('min by (probe) (probe_success)');
  expect(probes.map((probe) => probe.metric.probe).sort()).toEqual([...APP_SERVICES, 'web'].sort());
  for (const probe of probes) expect(probe.value[1], probe.metric.probe).toBe('1');
  expect((await promql('max(ars_ledger_mismatched_wallets)'))[0]?.value[1]).toBe('0');
  expect((await promql('max(abs(ars_ledger_open_stake_drift))'))[0]?.value[1]).toBe('0');
  expect((await promql('max(ars_season_active)'))[0]?.value[1]).toBe('1');
});

test('every service ships JSON logs, and no telemetry leaks sealed race scripts', async () => {
  const jobs = (await logs('_time:1h | stats by (job) count() lines')).map((row) => row.job);
  expect(jobs).toEqual(expect.arrayContaining(APP_SERVICES));
  const withTraces = (await logs('_time:1h AND trace_id:* | stats by (job) count() lines')).map((row) => row.job);
  expect(withTraces).toEqual(expect.arrayContaining(['api', 'bet-worker', 'wallet', 'scheduler', 'race-engine', 'race-broadcaster']));

  const engineJobs = 'job:in(race-engine, race-broadcaster, odds-engine)';
  const leaks = await logs(`_time:1h AND ${engineJobs} AND (seed:* OR finish_tick:* OR finishTick:* OR script_size:* OR scriptSize:* OR finish_order:* OR i("finish tick") OR i("script size"))`);
  expect(leaks.map((line) => line._msg)).toEqual([]);

  const traces = await http.get(`${JAEGER}/api/traces`, { params: { service: 'race-engine', lookback: '2h', limit: '50' } });
  expect(traces.ok()).toBeTruthy();
  const keys = new Set<string>();
  for (const found of (await traces.json()).data as Trace[]) for (const span of found.spans) for (const tag of span.tags) keys.add(tag.key);
  expect(keys.size).toBeGreaterThan(0);
  expect([...keys].filter((key) => /seed|finish|order|leader|script_size|position/i.test(key))).toEqual([]);
});

test('Grafana is provisioned and its alerts reach Discord', async () => {
  expect((await grafana('GET', '/api/health')).status).toBe(200);
  for (const uid of ['vm', 'jaeger']) {
    const health = await grafana('GET', `/api/datasources/uid/${uid}/health`);
    expect(health.body.status, `${uid}: ${JSON.stringify(health.body)}`).toBe('OK');
  }
  const plugin = await grafana('GET', '/api/plugins/victoriametrics-logs-datasource/settings');
  if (plugin.status === 200 || process.env.CI) {
    const health = await grafana('GET', '/api/datasources/uid/vlogs/health');
    expect(health.body.status, JSON.stringify(health.body)).toBe('OK');
  } else {
    test.info().annotations.push({ type: 'skipped-check', description: 'VictoriaLogs plugin not installed in this local build' });
  }

  const dashboards = await grafana<{ title: string }[]>('GET', '/api/search?type=dash-db&folderUIDs=ars');
  expect(dashboards.body.map((dashboard) => dashboard.title).sort()).toEqual(
    ['ARS · Betting & wallet', 'ARS · Event pipeline', 'ARS · Overview', 'ARS · Platform', 'ARS · Race day'],
  );

  await expect.poll(async () => {
    const rules = await grafana('GET', '/api/prometheus/grafana/api/v1/rules');
    const all = rules.body.data.groups.flatMap((group: { rules: { name: string; health: string; lastError?: string }[] }) => group.rules);
    return { count: all.length, broken: all.filter((rule: { health: string }) => rule.health === 'error').map((rule: { name: string; lastError?: string }) => `${rule.name}: ${rule.lastError}`) };
  }, { timeout: 90_000, intervals: [5000] }).toEqual({ count: 33, broken: [] });

  const startedAt = new Date().toISOString();
  const receivers = await grafana('GET', '/apis/notifications.alerting.grafana.app/v1beta1/namespaces/default/receivers');
  const discord = receivers.body.items.find((item: { spec: { title: string } }) => item.spec.title === 'discord');
  expect(discord).toBeTruthy();
  const tested = await grafana('POST', `/apis/notifications.alerting.grafana.app/v1beta1/namespaces/default/receivers/${discord.metadata.name}/test`, {
    integration: { uid: 'discord', type: 'discord', version: 'v1', settings: {}, secureFields: { url: true } },
  });
  expect(tested.body.status, JSON.stringify(tested.body)).toBe('success');
  await expect.poll(async () => {
    const received = (await (await http.get(DISCORD_SINK)).json()) as { receivedAt: string; body: { content?: string } }[];
    return received.filter((entry) => entry.receivedAt >= startedAt).map((entry) => entry.body.content ?? '').join('\n');
  }, { timeout: 30_000 }).toContain('TestAlert');
});
