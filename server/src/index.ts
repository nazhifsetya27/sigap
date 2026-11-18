import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { registerApi } from './api.js';
import { authRequired, getIngestToken } from './auth.js';
import { config } from './config.js';
import { DemoSource } from './sources/demo.js';
import { HermesSessionSource } from './sources/hermes-sessions.js';
import type { StatusProvider } from './status.js';
import { Store } from './store.js';
import { HermesWorker } from './worker.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, trustProxy: true, bodyLimit: 64 * 1024 });
await app.register(cookie);

let store: Store;
let provider: StatusProvider;
let worker: HermesWorker | null = null;
let stop: () => void;

if (config.dataSource === 'demo') {
  // Data contoh dibuat ulang setiap server menyala dan disimpan terpisah dari data asli.
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(config.dataDir, `demo.db${suffix}`), { force: true });
  store = new Store(path.join(config.dataDir, 'demo.db'));
  const demo = new DemoSource(store);
  demo.start();
  provider = demo;
  stop = () => demo.stop();
} else {
  store = new Store(path.join(config.dataDir, 'sigap.db'));
  worker = new HermesWorker(store, new HermesSessionSource(store), (msg) => app.log.warn(msg));
  worker.start();
  provider = worker;
  stop = () => worker?.stop();
  getIngestToken();
}

registerApi(app, { store, provider, worker });

const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Tidak ditemukan' });
  });
}

const shutdown = () => {
  stop();
  void app.close().then(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
const exposed = config.host !== '127.0.0.1' && config.host !== 'localhost';
console.log(`Sigap berjalan di http://${config.host}:${config.port} (sumber data: ${config.dataSource})`);
if (!authRequired() && exposed) {
  console.warn('PERINGATAN: ACCESS_CODE kosong padahal server bisa diakses dari luar. Isi ACCESS_CODE di .env.');
}
