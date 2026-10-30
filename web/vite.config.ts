import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_UPSTREAM ?? 'http://localhost:3000';
const sse = process.env.SSE_UPSTREAM ?? 'http://localhost:3001';

const proxy = {
  '^/v1/races/[^/]+/stream': {
    target: sse,
    timeout: 0,
    proxyTimeout: 0,
    headers: { 'accept-encoding': 'identity' },
  },
  '/v1': { target: api },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: true, proxy },
  preview: { port: 5173, strictPort: true, host: true, proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
