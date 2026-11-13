import { signJwt } from '../../lib/crypto.ts';
import { one } from '../../lib/db.ts';
import { ApiError, type Router } from '../../lib/http.ts';
import { jwtSecret, rateLimit, requireUser, type Deps } from './context.ts';

const TICKET_TTL = 60;

export function arcadeRoutes(router: Router, deps: Deps): void {
  router.post('/v1/arcade/ticket', async (ctx) => {
    const { userId } = requireUser(ctx);
    await rateLimit(ctx, deps, 'bet');
    const row = await one(deps.pool, 'SELECT display_name, banned_at FROM identity.users WHERE user_id = $1', [userId]);
    if (!row) throw new ApiError(401, 'UNAUTHORIZED', 'Unknown user');
    if (row.banned_at) throw new ApiError(403, 'BANNED', 'This account is banned');
    return {
      ticket: signJwt({ sub: userId, name: row.display_name, aud: 'arcade' }, jwtSecret(), TICKET_TTL),
      expiresIn: TICKET_TTL,
    };
  });
}
