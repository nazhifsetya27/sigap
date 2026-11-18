import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentKey } from './config.js';
import type { TokenUsage } from './core/cost.js';

export type ConvStatus = 'ai' | 'needs_human' | 'done';
export type MessageRole = 'customer' | 'ai' | 'human';
export type PaymentStatus = 'unpaid' | 'paid' | 'cancelled';
export type FollowupStatus = 'draft' | 'sent' | 'skipped';

export interface ConversationRow {
  id: string;
  source: string;
  customer_id: string;
  customer_ref: string;
  customer_name: string | null;
  started_at: number;
  last_message_at: number;
  last_customer_at: number | null;
  last_ai_at: number | null;
  message_count: number;
  status: ConvStatus;
  escalated_at: number | null;
  needs_human_reason: string | null;
  summary: string | null;
  analyzed_upto: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  text: string;
  ts: number;
}

export interface OrderItem {
  name: string;
  variant: string | null;
  qty: number;
  price_idr: number | null;
}

export interface OrderRow {
  id: number;
  code: string;
  conversation_id: string;
  customer_name: string | null;
  customer_ref: string;
  items: OrderItem[];
  total_idr: number;
  payment_method: string | null;
  payment_status: PaymentStatus;
  created_at: number;
  updated_at: number;
  keep_until: number | null;
}

export interface FollowupRow {
  id: number;
  order_id: number;
  order_code: string;
  customer_ref: string;
  customer_name: string | null;
  total_idr: number;
  text: string;
  status: FollowupStatus;
  created_at: number;
}

export interface EventRow {
  id: number;
  ts: number;
  agent: AgentKey;
  kind: string;
  text: string;
  needs_human: number;
  ref: string | null;
}

/**
 * Skema versi 1. Setiap tabel utama membawa store_id supaya nanti bisa melayani
 * banyak toko tanpa migrasi besar; versi ini hanya memakai satu toko, 'default'.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL DEFAULT 'default',
    source TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    customer_ref TEXT NOT NULL,
    customer_name TEXT,
    started_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL,
    last_customer_at INTEGER,
    last_ai_at INTEGER,
    message_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ai',
    escalated_at INTEGER,
    needs_human_reason TEXT,
    summary TEXT,
    analyzed_upto INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_conv_last ON conversations(store_id, last_message_at DESC);
  CREATE INDEX idx_conv_status ON conversations(store_id, status);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX idx_msg_conv ON messages(conversation_id, ts);
  CREATE INDEX idx_msg_role_ts ON messages(role, ts);

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL DEFAULT 'default',
    code TEXT NOT NULL UNIQUE,
    conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    customer_name TEXT,
    items_json TEXT NOT NULL,
    total_idr INTEGER NOT NULL,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    keep_until INTEGER
  );
  CREATE INDEX idx_orders_status ON orders(store_id, payment_status);

  CREATE TABLE followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL DEFAULT 'default',
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    error TEXT
  );

  CREATE TABLE cost_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL DEFAULT 'default',
    ts INTEGER NOT NULL,
    agent TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    ref TEXT
  );
  CREATE INDEX idx_cost_ts ON cost_events(store_id, ts);

  CREATE TABLE session_usage (
    session_id TEXT PRIMARY KEY,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL DEFAULT 'default',
    ts INTEGER NOT NULL,
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    needs_human INTEGER NOT NULL DEFAULT 0,
    ref TEXT
  );
  CREATE INDEX idx_events_ts ON events(store_id, ts DESC);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    const current = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  private txDepth = 0;

  /** Transaksi yang boleh bersarang: hanya lapisan terluar yang membuka dan menutupnya. */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.db.exec('BEGIN');
    this.txDepth++;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  // ---------- pengaturan ----------

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  getNumberSetting(key: string, fallback: number): number {
    const raw = this.getSetting(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  // ---------- percakapan ----------

  upsertConversation(c: {
    id: string;
    source: string;
    customerId: string;
    customerRef: string;
    customerName: string | null;
    startedAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conversations (id, source, customer_id, customer_ref, customer_name, started_at, last_message_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET customer_name = COALESCE(conversations.customer_name, excluded.customer_name)`,
      )
      .run(c.id, c.source, c.customerId, c.customerRef, c.customerName, c.startedAt, c.startedAt);
  }

  /** Simpan pesan bila belum ada. Mengembalikan true bila pesan baru. */
  addMessage(m: MessageRow): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO messages (id, conversation_id, role, text, ts) VALUES (?, ?, ?, ?, ?)')
      .run(m.id, m.conversation_id, m.role, m.text, m.ts);
    if (Number(res.changes) === 0) return false;
    this.db
      .prepare(
        `UPDATE conversations SET
           message_count = message_count + 1,
           last_message_at = MAX(last_message_at, ?1),
           last_customer_at = CASE WHEN ?2 = 'customer' THEN MAX(COALESCE(last_customer_at, 0), ?1) ELSE last_customer_at END,
           last_ai_at = CASE WHEN ?2 <> 'customer' THEN MAX(COALESCE(last_ai_at, 0), ?1) ELSE last_ai_at END,
           status = CASE WHEN ?2 = 'customer' AND status = 'done' THEN 'ai' ELSE status END
         WHERE id = ?3`,
      )
      .run(m.ts, m.role, m.conversation_id);
    return true;
  }

  getConversation(id: string): ConversationRow | null {
    return (this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined) ?? null;
  }

  listConversations(opts: { status?: ConvStatus; limit?: number } = {}): ConversationRow[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    if (opts.status) {
      return this.db
        .prepare('SELECT * FROM conversations WHERE status = ? ORDER BY last_message_at DESC LIMIT ?')
        .all(opts.status, limit) as unknown as ConversationRow[];
    }
    return this.db
      .prepare('SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT ?')
      .all(limit) as unknown as ConversationRow[];
  }

  listMessages(conversationId: string): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts, id')
      .all(conversationId) as unknown as MessageRow[];
  }

  lastMessagePreview(conversationId: string): { role: MessageRole; text: string } | null {
    const row = this.db
      .prepare('SELECT role, text FROM messages WHERE conversation_id = ? ORDER BY ts DESC, id DESC LIMIT 1')
      .get(conversationId) as { role: MessageRole; text: string } | undefined;
    return row ?? null;
  }

  /** Percakapan yang sudah tenang dan punya pesan baru sejak analisis terakhir. */
  conversationsNeedingAnalysis(now: number, quietMs: number, limit = 5): ConversationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM conversations
         WHERE message_count > analyzed_upto AND last_ai_at IS NOT NULL AND last_message_at <= ?
         ORDER BY last_message_at ASC LIMIT ?`,
      )
      .all(now - quietMs, limit) as unknown as ConversationRow[];
  }

  markAnalyzed(
    id: string,
    upto: number,
    patch: { needsHuman: boolean; reason: string | null; summary: string | null; customerName: string | null },
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE conversations SET
           analyzed_upto = ?1,
           summary = COALESCE(?2, summary),
           customer_name = COALESCE(?3, customer_name),
           status = CASE WHEN ?4 = 1 AND status <> 'done' THEN 'needs_human' ELSE status END,
           escalated_at = CASE WHEN ?4 = 1 AND escalated_at IS NULL THEN ?5 ELSE escalated_at END,
           needs_human_reason = CASE WHEN ?4 = 1 THEN ?6 ELSE needs_human_reason END
         WHERE id = ?7`,
      )
      .run(upto, patch.summary, patch.customerName, patch.needsHuman ? 1 : 0, now, patch.reason, id);
  }

  setConversationStatus(id: string, status: ConvStatus): boolean {
    const res = this.db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, id);
    return Number(res.changes) > 0;
  }

  // ---------- pesanan ----------

  private mapOrder(row: Row): OrderRow {
    let items: OrderItem[] = [];
    try {
      const parsed = JSON.parse(String(row.items_json));
      if (Array.isArray(parsed)) items = parsed as OrderItem[];
    } catch {
      items = [];
    }
    return {
      id: Number(row.id),
      code: String(row.code),
      conversation_id: String(row.conversation_id),
      customer_name: (row.customer_name as string | null) ?? null,
      customer_ref: String(row.customer_ref ?? ''),
      items,
      total_idr: Number(row.total_idr),
      payment_method: (row.payment_method as string | null) ?? null,
      payment_status: row.payment_status as PaymentStatus,
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      keep_until: row.keep_until === null || row.keep_until === undefined ? null : Number(row.keep_until),
    };
  }

  private static readonly ORDER_SELECT = `SELECT o.*, c.customer_ref AS customer_ref FROM orders o JOIN conversations c ON c.id = o.conversation_id`;

  /** Buat atau perbarui pesanan milik satu percakapan. Mengembalikan pesanan dan apakah baru dibuat. */
  upsertOrder(
    conversationId: string,
    data: {
      customerName: string | null;
      items: OrderItem[];
      totalIdr: number;
      paymentMethod: string | null;
      paymentStatus: PaymentStatus;
      keepMs: number;
    },
    now: number,
  ): { order: OrderRow; created: boolean } {
    const existing = this.db.prepare('SELECT id, payment_status FROM orders WHERE conversation_id = ?').get(conversationId) as
      | { id: number; payment_status: PaymentStatus }
      | undefined;
    if (existing) {
      // Status yang sudah diubah pemilik toko (lunas/batal) tidak ditimpa balik menjadi belum bayar.
      const status: PaymentStatus =
        existing.payment_status !== 'unpaid' && data.paymentStatus === 'unpaid' ? existing.payment_status : data.paymentStatus;
      this.db
        .prepare(
          `UPDATE orders SET customer_name = COALESCE(?, customer_name), items_json = ?, total_idr = ?,
             payment_method = COALESCE(?, payment_method), payment_status = ?, updated_at = ? WHERE id = ?`,
        )
        .run(data.customerName, JSON.stringify(data.items), data.totalIdr, data.paymentMethod, status, now, existing.id);
      return { order: this.getOrder(existing.id)!, created: false };
    }
    const next = (this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM orders').get() as { n: number }).n;
    const code = `SG-${1000 + Number(next)}`;
    const res = this.db
      .prepare(
        `INSERT INTO orders (code, conversation_id, customer_name, items_json, total_idr, payment_method, payment_status, created_at, updated_at, keep_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code,
        conversationId,
        data.customerName,
        JSON.stringify(data.items),
        data.totalIdr,
        data.paymentMethod,
        data.paymentStatus,
        now,
        now,
        data.paymentStatus === 'unpaid' ? now + data.keepMs : null,
      );
    return { order: this.getOrder(Number(res.lastInsertRowid))!, created: true };
  }

  getOrder(id: number): OrderRow | null {
    const row = this.db.prepare(`${Store.ORDER_SELECT} WHERE o.id = ?`).get(id) as Row | undefined;
    return row ? this.mapOrder(row) : null;
  }

  listOrders(opts: { paymentStatus?: PaymentStatus; limit?: number } = {}): OrderRow[] {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const rows = opts.paymentStatus
      ? this.db
          .prepare(`${Store.ORDER_SELECT} WHERE o.payment_status = ? ORDER BY o.created_at DESC LIMIT ?`)
          .all(opts.paymentStatus, limit)
      : this.db.prepare(`${Store.ORDER_SELECT} ORDER BY o.created_at DESC LIMIT ?`).all(limit);
    return (rows as Row[]).map((r) => this.mapOrder(r));
  }

  setOrderPayment(id: number, status: PaymentStatus, now: number): boolean {
    const res = this.db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    return Number(res.changes) > 0;
  }

  /** Pesanan belum bayar yang sudah cukup lama dan belum punya draft pengingat. */
  unpaidOrdersNeedingFollowup(now: number, olderThanMs: number, limit = 10): OrderRow[] {
    const rows = this.db
      .prepare(
        `${Store.ORDER_SELECT}
         WHERE o.payment_status = 'unpaid' AND o.created_at <= ?
           AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.order_id = o.id)
         ORDER BY o.created_at ASC LIMIT ?`,
      )
      .all(now - olderThanMs, limit) as Row[];
    return rows.map((r) => this.mapOrder(r));
  }

  // ---------- pengingat ----------

  addFollowup(orderId: number, text: string, now: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO followups (order_id, text, status, created_at) VALUES (?, ?, ?, ?)')
      .run(orderId, text, 'draft', now);
  }

  listFollowups(status?: FollowupStatus): FollowupRow[] {
    const base = `SELECT f.id, f.order_id, o.code AS order_code, c.customer_ref, o.customer_name, o.total_idr, f.text, f.status, f.created_at
                  FROM followups f JOIN orders o ON o.id = f.order_id JOIN conversations c ON c.id = o.conversation_id`;
    const rows = status
      ? this.db.prepare(`${base} WHERE f.status = ? ORDER BY f.created_at DESC`).all(status)
      : this.db.prepare(`${base} ORDER BY f.created_at DESC LIMIT 200`).all();
    return rows as unknown as FollowupRow[];
  }

  setFollowupStatus(id: number, status: FollowupStatus): boolean {
    const res = this.db.prepare('UPDATE followups SET status = ? WHERE id = ?').run(status, id);
    return Number(res.changes) > 0;
  }

  // ---------- proses agent dan biaya ----------

  startRun(agent: AgentKey, kind: string, ref: string | null, now: number): number {
    const res = this.db
      .prepare('INSERT INTO agent_runs (agent, kind, ref, started_at, status) VALUES (?, ?, ?, ?, ?)')
      .run(agent, kind, ref, now, 'running');
    return Number(res.lastInsertRowid);
  }

  finishRun(id: number, status: 'ok' | 'error', error: string | null, now: number): void {
    this.db.prepare('UPDATE agent_runs SET ended_at = ?, status = ?, error = ? WHERE id = ?').run(now, status, error, id);
  }

  /** Proses yang masih 'running' saat server mati ditandai gagal supaya status agent tidak menggantung. */
  failStaleRuns(now: number): void {
    this.db
      .prepare(`UPDATE agent_runs SET ended_at = ?, status = 'error', error = 'server berhenti' WHERE status = 'running'`)
      .run(now);
  }

  addCost(agent: AgentKey, usage: TokenUsage, costUsdValue: number, ref: string | null, ts: number): void {
    if (costUsdValue <= 0 && usage.input + usage.cached + usage.output <= 0) return;
    this.db
      .prepare(
        'INSERT INTO cost_events (ts, agent, input_tokens, cached_tokens, output_tokens, cost_usd, ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ts, agent, usage.input, usage.cached, usage.output, costUsdValue, ref);
  }

  /**
   * Catat pemakaian kumulatif satu sesi sumber. Yang masuk ke cost_events hanya selisihnya,
   * jadi polling berulang tidak menggandakan biaya.
   */
  recordSessionUsage(agent: AgentKey, sessionId: string, total: TokenUsage, totalCostUsd: number, ts: number): void {
    const prev = (this.db.prepare('SELECT * FROM session_usage WHERE session_id = ?').get(sessionId) as
      | { input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number }
      | undefined) ?? { input_tokens: 0, cached_tokens: 0, output_tokens: 0, cost_usd: 0 };
    const delta: TokenUsage = {
      input: Math.max(0, total.input - prev.input_tokens),
      cached: Math.max(0, total.cached - prev.cached_tokens),
      output: Math.max(0, total.output - prev.output_tokens),
    };
    const deltaCost = Math.max(0, totalCostUsd - prev.cost_usd);
    if (deltaCost <= 0 && delta.input + delta.cached + delta.output <= 0) return;
    this.transaction(() => {
      this.addCost(agent, delta, deltaCost, sessionId, ts);
      this.db
        .prepare(
          `INSERT INTO session_usage (session_id, input_tokens, cached_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET input_tokens = excluded.input_tokens, cached_tokens = excluded.cached_tokens,
             output_tokens = excluded.output_tokens, cost_usd = excluded.cost_usd`,
        )
        .run(sessionId, total.input, total.cached, total.output, totalCostUsd);
    });
  }

  sumCost(opts: { since?: number; until?: number; agent?: AgentKey } = {}): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_events
         WHERE ts >= ? AND ts < ? AND (? IS NULL OR agent = ?)`,
      )
      .get(opts.since ?? 0, opts.until ?? Number.MAX_SAFE_INTEGER, opts.agent ?? null, opts.agent ?? null) as { total: number };
    return Number(row.total);
  }

  costByAgent(since = 0): Record<AgentKey, number> {
    const out: Record<AgentKey, number> = { echo: 0, tally: 0, ping: 0 };
    const rows = this.db
      .prepare('SELECT agent, COALESCE(SUM(cost_usd), 0) AS total FROM cost_events WHERE ts >= ? GROUP BY agent')
      .all(since) as { agent: AgentKey; total: number }[];
    for (const r of rows) if (r.agent in out) out[r.agent] = Number(r.total);
    return out;
  }

  costByDay(since: number, dayStartOffsetMs: number): { day: number; cost_usd: number; tokens: number }[] {
    const rows = this.db
      .prepare(
        // CAST wajib: parameter terikat sebagai bilangan pecahan, jadi tanpa ini pembagiannya tidak dibulatkan per hari.
        `SELECT CAST((ts + ?1) / 86400000 AS INTEGER) AS day_index, SUM(cost_usd) AS cost_usd,
                SUM(input_tokens + cached_tokens + output_tokens) AS tokens
         FROM cost_events WHERE ts >= ?2 GROUP BY day_index ORDER BY day_index`,
      )
      .all(dayStartOffsetMs, since) as { day_index: number; cost_usd: number; tokens: number }[];
    return rows.map((r) => ({
      day: Math.floor(Number(r.day_index)) * 86_400_000 - dayStartOffsetMs,
      cost_usd: Number(r.cost_usd),
      tokens: Number(r.tokens),
    }));
  }

  tokenTotals(since = 0): TokenUsage {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(cached_tokens), 0) AS cached,
                COALESCE(SUM(output_tokens), 0) AS output FROM cost_events WHERE ts >= ?`,
      )
      .get(since) as { input: number; cached: number; output: number };
    return { input: Number(row.input), cached: Number(row.cached), output: Number(row.output) };
  }

  /** Jumlah percakapan yang biayanya sudah terukur (punya catatan pemakaian). */
  measuredConversations(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM session_usage WHERE cost_usd > 0').get() as { n: number };
    return Number(row.n);
  }

  // ---------- aktivitas ----------

  addEvent(e: { ts: number; agent: AgentKey; kind: string; text: string; needsHuman?: boolean; ref?: string | null }): void {
    this.db
      .prepare('INSERT INTO events (ts, agent, kind, text, needs_human, ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.ts, e.agent, e.kind, e.text, e.needsHuman ? 1 : 0, e.ref ?? null);
  }

  recentEvents(limit = 8): EventRow[] {
    return this.db.prepare('SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ?').all(limit) as unknown as EventRow[];
  }

  lastEventAt(agent: AgentKey, kind: string, ref: string): number | null {
    const row = this.db
      .prepare('SELECT MAX(ts) AS ts FROM events WHERE agent = ? AND kind = ? AND ref = ?')
      .get(agent, kind, ref) as { ts: number | null };
    return row.ts === null ? null : Number(row.ts);
  }

  // ---------- agregat untuk Beranda ----------

  countChats(since: number, until: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(DISTINCT conversation_id) AS n FROM messages WHERE role = 'customer' AND ts >= ? AND ts < ?`)
      .get(since, until) as { n: number };
    return Number(row.n);
  }

  countEscalated(since: number, until: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM conversations WHERE escalated_at >= ? AND escalated_at < ?')
      .get(since, until) as { n: number };
    return Number(row.n);
  }

  orderStats(since: number, until: number): { count: number; revenue: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_idr), 0) AS revenue FROM orders
         WHERE created_at >= ? AND created_at < ? AND payment_status <> 'cancelled'`,
      )
      .get(since, until) as { n: number; revenue: number };
    return { count: Number(row.n), revenue: Number(row.revenue) };
  }

  unpaidStats(now: number, soonMs: number): { count: number; total: number; expiringSoon: number; nextKeepUntil: number | null } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_idr), 0) AS total,
                COALESCE(SUM(CASE WHEN keep_until IS NOT NULL AND keep_until <= ?1 THEN 1 ELSE 0 END), 0) AS soon,
                MIN(CASE WHEN keep_until IS NOT NULL AND keep_until > ?2 THEN keep_until END) AS next_keep
         FROM orders WHERE payment_status = 'unpaid'`,
      )
      .get(now + soonMs, now) as { n: number; total: number; soon: number; next_keep: number | null };
    return {
      count: Number(row.n),
      total: Number(row.total),
      expiringSoon: Number(row.soon),
      nextKeepUntil: row.next_keep === null ? null : Number(row.next_keep),
    };
  }

  waitingHuman(): { count: number; oldestAt: number | null } {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n, MIN(escalated_at) AS oldest FROM conversations WHERE status = 'needs_human'`)
      .get() as { n: number; oldest: number | null };
    return { count: Number(row.n), oldestAt: row.oldest === null ? null : Number(row.oldest) };
  }

  draftFollowups(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM followups WHERE status = 'draft'`).get() as { n: number };
    return Number(row.n);
  }

  /** Rata-rata detik dari pesan pertama pelanggan sampai balasan pertama AI, untuk chat pada rentang waktu. */
  avgFirstReplySeconds(since: number, until: number): number | null {
    const row = this.db
      .prepare(
        `SELECT AVG(d) AS avg_ms FROM (
           SELECT (SELECT MIN(m2.ts) FROM messages m2
                   WHERE m2.conversation_id = fc.conversation_id AND m2.role <> 'customer' AND m2.ts >= fc.t) - fc.t AS d
           FROM (SELECT conversation_id, MIN(ts) AS t FROM messages
                 WHERE role = 'customer' AND ts >= ? AND ts < ? GROUP BY conversation_id) fc
         ) WHERE d IS NOT NULL`,
      )
      .get(since, until) as { avg_ms: number | null };
    return row.avg_ms === null ? null : Number(row.avg_ms) / 1000;
  }

  /** Chat yang pesan terakhirnya dari pelanggan dan masih baru: AI sedang atau segera membalas. */
  pendingReplies(now: number, windowMs: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM conversations
         WHERE status = 'ai' AND last_customer_at IS NOT NULL AND last_customer_at >= ?
           AND (last_ai_at IS NULL OR last_ai_at < last_customer_at)`,
      )
      .get(now - windowMs) as { n: number };
    return Number(row.n);
  }

  runningRun(agent: AgentKey): { kind: string; ref: string | null; started_at: number } | null {
    const row = this.db
      .prepare(`SELECT kind, ref, started_at FROM agent_runs WHERE agent = ? AND status = 'running' ORDER BY id DESC LIMIT 1`)
      .get(agent) as { kind: string; ref: string | null; started_at: number } | undefined;
    return row ?? null;
  }
}
