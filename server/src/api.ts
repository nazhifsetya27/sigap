import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import {
  LoginLimiter,
  SESSION_COOKIE,
  authRequired,
  createSession,
  getIngestToken,
  safeEqual,
  validSession,
} from './auth.js';
import { DAY, startOfDay } from './core/time.js';
import { buildCost, buildOverview, readSettings } from './overview.js';
import type { StatusProvider } from './status.js';
import type { ConvStatus, FollowupStatus, PaymentStatus, Store } from './store.js';
import type { HermesWorker } from './worker.js';

export interface AppContext {
  store: Store;
  provider: StatusProvider;
  worker: HermesWorker | null;
}

const OPEN_PATHS = new Set(['/api/health', '/api/session', '/api/login', '/api/logout']);
const CONV_STATUSES: ConvStatus[] = ['ai', 'needs_human', 'done'];
const PAYMENT_STATUSES: PaymentStatus[] = ['unpaid', 'paid', 'cancelled'];
const FOLLOWUP_STATUSES: FollowupStatus[] = ['draft', 'sent', 'skipped'];

function body(req: FastifyRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function bad(reply: FastifyReply, message: string, code = 400) {
  return reply.code(code).send({ error: message });
}

export function registerApi(app: FastifyInstance, ctx: AppContext): void {
  const { store } = ctx;
  const limiter = new LoginLimiter();

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/') || OPEN_PATHS.has(url)) return;
    if (url.startsWith('/api/ingest/')) {
      const token = req.headers['x-sigap-token'];
      if (typeof token !== 'string' || !safeEqual(token, getIngestToken())) return bad(reply, 'Token tidak sah', 401);
      return;
    }
    if (authRequired() && !validSession(req.cookies[SESSION_COOKIE], Date.now())) return bad(reply, 'Perlu login', 401);
    // Permintaan yang mengubah data wajib membawa header khusus, yang tidak bisa dikirim situs lain tanpa izin.
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'sigap') return bad(reply, 'Permintaan ditolak', 403);
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/session', async (req) => ({
    authRequired: authRequired(),
    authenticated: !authRequired() || validSession(req.cookies[SESSION_COOKIE], Date.now()),
    dataSource: config.dataSource,
  }));

  app.post('/api/login', async (req, reply) => {
    const now = Date.now();
    if (!authRequired()) return { ok: true };
    const wait = limiter.retryAfterMs(req.ip, now);
    if (wait > 0) return bad(reply, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 1000)} detik.`, 429);
    const code = body(req).code;
    if (typeof code !== 'string' || !safeEqual(code, config.accessCode)) {
      limiter.fail(req.ip, now);
      return bad(reply, 'Kode akses salah', 401);
    }
    limiter.success(req.ip);
    const session = createSession(now);
    reply.setCookie(SESSION_COOKIE, session.value, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: session.maxAge,
    });
    return { ok: true };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/overview', async () => buildOverview(store, ctx.provider, Date.now()));

  app.get('/api/conversations', async (req) => {
    const status = oneOf((req.query as Record<string, unknown>).status, CONV_STATUSES);
    const rows = store.listConversations({ status: status ?? undefined, limit: 150 });
    return {
      conversations: rows.map((c) => {
        const preview = store.lastMessagePreview(c.id);
        return {
          id: c.id,
          customerRef: c.customer_ref,
          customerName: c.customer_name,
          status: c.status,
          reason: c.needs_human_reason,
          summary: c.summary,
          lastMessageAt: c.last_message_at,
          messageCount: c.message_count,
          preview: preview ? { role: preview.role, text: preview.text.slice(0, 140) } : null,
        };
      }),
    };
  });

  app.get('/api/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = store.getConversation(id);
    if (!conv) return bad(reply, 'Percakapan tidak ditemukan', 404);
    return {
      conversation: {
        id: conv.id,
        customerRef: conv.customer_ref,
        customerName: conv.customer_name,
        status: conv.status,
        reason: conv.needs_human_reason,
        summary: conv.summary,
        startedAt: conv.started_at,
        lastMessageAt: conv.last_message_at,
      },
      messages: store.listMessages(id).map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.ts })),
    };
  });

  app.post('/api/conversations/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = oneOf(body(req).status, CONV_STATUSES);
    if (!status) return bad(reply, 'Status tidak dikenal');
    if (!store.setConversationStatus(id, status)) return bad(reply, 'Percakapan tidak ditemukan', 404);
    return { ok: true };
  });

  app.get('/api/orders', async (req) => {
    const payment = oneOf((req.query as Record<string, unknown>).payment, PAYMENT_STATUSES);
    const orders = store.listOrders({ paymentStatus: payment ?? undefined });
    return {
      orders: orders.map((o) => ({
        id: o.id,
        code: o.code,
        conversationId: o.conversation_id,
        customerRef: o.customer_ref,
        customerName: o.customer_name,
        items: o.items,
        totalIdr: o.total_idr,
        paymentMethod: o.payment_method,
        paymentStatus: o.payment_status,
        createdAt: o.created_at,
        keepUntil: o.keep_until,
      })),
    };
  });

  app.post('/api/orders/:id/payment', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const status = oneOf(body(req).status, PAYMENT_STATUSES);
    if (!Number.isInteger(id) || !status) return bad(reply, 'Permintaan tidak valid');
    if (!store.setOrderPayment(id, status, Date.now())) return bad(reply, 'Pesanan tidak ditemukan', 404);
    return { ok: true };
  });

  app.get('/api/followups', async () => ({
    followups: store.listFollowups().map((f) => ({
      id: f.id,
      orderCode: f.order_code,
      customerRef: f.customer_ref,
      customerName: f.customer_name,
      totalIdr: f.total_idr,
      text: f.text,
      status: f.status,
      createdAt: f.created_at,
    })),
  }));

  app.post('/api/followups/:id/status', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const status = oneOf(body(req).status, FOLLOWUP_STATUSES);
    if (!Number.isInteger(id) || !status) return bad(reply, 'Permintaan tidak valid');
    if (!store.setFollowupStatus(id, status)) return bad(reply, 'Pengingat tidak ditemukan', 404);
    return { ok: true };
  });

  app.get('/api/costs', async () => {
    const now = Date.now();
    const today = startOfDay(now, config.timeZone);
    const offset = (DAY - (today % DAY)) % DAY;
    const s = readSettings(store);
    const all = store.costByAgent(0);
    return {
      ...buildCost(store, now),
      demo: ctx.provider.connection(now).mode === 'demo',
      rates: config.cost.rates,
      tokens: store.tokenTotals(0),
      totalIdr: store.sumCost() * s.idrPerUsd,
      totalByAgent: { echo: all.echo * s.idrPerUsd, tally: all.tally * s.idrPerUsd, ping: all.ping * s.idrPerUsd },
      daily: store.costByDay(today - 13 * DAY, offset).map((d) => ({ day: d.day, idr: d.cost_usd * s.idrPerUsd, tokens: d.tokens })),
    };
  });

  app.get('/api/settings', async () => {
    const s = readSettings(store);
    return { ...s, timeZone: config.timeZone, dataSource: config.dataSource };
  });

  app.put('/api/settings', async (req, reply) => {
    const b = body(req);
    const numeric: Array<[string, string, number, number]> = [
      ['creditUsd', 'credit_usd', 0, 100_000],
      ['idrPerUsd', 'idr_per_usd', 1, 1_000_000],
      ['chatsPerDay', 'chats_per_day', 1, 1_000_000],
    ];
    for (const [field, key, min, max] of numeric) {
      if (b[field] === undefined) continue;
      const n = Number(b[field]);
      if (!Number.isFinite(n) || n < min || n > max) return bad(reply, `Nilai ${field} tidak valid`);
      store.setSetting(key, String(n));
      // Mengubah saldo berarti menetapkan titik acuan baru: biaya dihitung dari saat ini.
      if (field === 'creditUsd') store.setSetting('credit_since', String(Date.now()));
    }
    if (b.storeName !== undefined) {
      if (typeof b.storeName !== 'string' || !b.storeName.trim()) return bad(reply, 'Nama toko tidak boleh kosong');
      store.setSetting('store_name', b.storeName.trim().slice(0, 60));
    }
    return readSettings(store);
  });

  app.post('/api/ingest/hermes-event', async (req) => {
    const b = body(req);
    if (ctx.worker && typeof b.event === 'string' && typeof b.session_id === 'string') {
      ctx.worker.noteGatewayEvent(b.event, b.session_id, Date.now());
    }
    return { ok: true };
  });
}
