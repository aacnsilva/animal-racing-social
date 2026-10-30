import { errorFields, log } from './lib/log.ts';

const services: Record<string, () => Promise<{ start: () => Promise<void> }>> = {
  migrate: () => import('./services/migrate.ts'),
  api: () => import('./services/api/main.ts'),
  sse: () => import('./services/sse/main.ts'),
  scheduler: () => import('./services/scheduler/main.ts'),
  stable: () => import('./services/stable/main.ts'),
  'market-manager': () => import('./services/market-manager/main.ts'),
  'bet-worker': () => import('./services/bet-worker/main.ts'),
  settlement: () => import('./services/settlement/main.ts'),
  'combo-aggregator': () => import('./services/combo-aggregator/main.ts'),
  wallet: () => import('./services/wallet/main.ts'),
  season: () => import('./services/season/main.ts'),
  notification: () => import('./services/notification/main.ts'),
};

const name = process.argv[2] ?? '';
const load = services[name];
if (!load) {
  process.stderr.write(`Usage: node src/main.ts <${Object.keys(services).join('|')}>\n`);
  process.exit(2);
}
process.env.SERVICE_NAME ??= name;
load()
  .then((module) => module.start())
  .catch((error) => {
    log.error('fatal', errorFields(error));
    process.exit(1);
  });
