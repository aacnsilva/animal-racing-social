import { envInt } from '../../lib/config.ts';
import { Router, serve } from '../../lib/http.ts';
import { bootstrap } from '../../lib/runtime.ts';
import { adminRoutes } from './admin.ts';
import { authRoutes } from './auth.ts';
import { bettingRoutes } from './betting.ts';
import { catalogRoutes } from './catalog.ts';
import { authenticate, rateLimit, type Deps } from './context.ts';
import { meRoutes } from './me.ts';
import { raceRoutes } from './races.ts';

export function buildRouter(deps: Deps): Router {
  const router = new Router();
  router.use(async (ctx) => authenticate(ctx));
  router.use(async (ctx) => {
    if (ctx.method === 'GET' && ctx.url.pathname !== '/healthz') await rateLimit(ctx, deps, 'read');
  });
  router.get('/healthz', async () => {
    await deps.pool.query('SELECT 1');
    return { ok: true };
  });
  authRoutes(router, deps);
  raceRoutes(router, deps);
  bettingRoutes(router, deps);
  meRoutes(router, deps);
  catalogRoutes(router, deps);
  adminRoutes(router, deps);
  return router;
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('api', { outbox: ['betting', 'admin'], health: false });
  const server = serve(buildRouter({ pool: runtime.pool, redis: runtime.redis, producer: runtime.producer }), envInt('PORT', 3000));
  runtime.onStop(() => void server.close());
}
