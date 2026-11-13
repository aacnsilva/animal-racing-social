import { WebSocketServer, type WebSocket } from 'ws';
import { env, envInt } from '../../lib/config.ts';
import { Router, serve } from '../../lib/http.ts';
import { errorFields, log } from '../../lib/log.ts';
import { gauge, shutdownTelemetry } from '../../lib/telemetry.ts';
import { Hub, type Socket } from './hub.ts';

const WS_PATH = '/v1/arcade/ws';
const MAX_CONNECTIONS = 3000;
const BROADCAST_MS = 80;
const HELLO_TIMEOUT_MS = 10_000;
const MAX_BUFFERED_BYTES = 256_000;

function wrap(ws: WebSocket): Socket {
  return {
    send: (text) => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) ws.terminate();
      else ws.send(text);
    },
    close: (code, reason) => ws.close(code, reason),
  };
}

export async function start(): Promise<void> {
  const hub = new Hub(env('JWT_SECRET', 'dev-only-jwt-secret-change-me'));
  const router = new Router().get('/healthz', async () => ({ ok: true, ...hub.stats() }));
  const server = serve(router, envInt('PORT', 3003));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const alive = new WeakSet<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== WS_PATH || wss.clients.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const handle = wrap(ws);
    hub.open(handle, Date.now());
    alive.add(ws);
    const helloTimer = setTimeout(() => {
      if (!hub.authed(handle)) ws.close(4408, 'HELLO_TIMEOUT');
    }, HELLO_TIMEOUT_MS);
    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data, isBinary) => {
      if (isBinary || !Buffer.isBuffer(data)) return;
      try {
        hub.handle(handle, data.toString('utf8'), Date.now());
      } catch (error) {
        log.error('arcade message failed', errorFields(error));
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      hub.drop(handle, Date.now());
    });
    ws.on('error', () => ws.terminate());
  });

  const broadcast = setInterval(() => {
    try {
      hub.tick(Date.now());
    } catch (error) {
      log.error('arcade tick failed', errorFields(error));
    }
  }, BROADCAST_MS);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 20_000);

  gauge('ars.arcade.rooms', 'Open multiplayer race rooms', '', async () => [{ value: hub.stats().rooms }]);
  gauge('ars.arcade.connections', 'Open arcade WebSocket connections', '', async () => [
    { value: hub.stats().connections },
  ]);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    clearInterval(broadcast);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.close(1001, 'SHUTDOWN');
    wss.close();
    server.close();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  log.info('started', { name: 'arcade' });
}
