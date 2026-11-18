import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, hermesProfileDir } from '../config.js';
import { costUsd } from '../core/cost.js';
import { maskCustomer } from '../core/text.js';
import { DAY, HOUR, MINUTE } from '../core/time.js';
import type { Store } from '../store.js';

export interface PollResult {
  ok: boolean;
  error: string | null;
  sessions: number;
  newMessages: number;
}

type Row = Record<string, unknown>;

/**
 * Membaca percakapan WhatsApp dari penyimpanan sesi Hermes milik profil Echo.
 * Hanya membaca (read-only): portal tidak pernah menulis ke berkas milik Hermes.
 */
export class HermesSessionSource {
  private lastSeen = new Map<string, number>();
  private firstPoll = true;
  lastResult: PollResult = { ok: false, error: 'Belum pernah dibaca', sessions: 0, newMessages: 0 };

  constructor(private readonly store: Store) {}

  private dbPath(): string {
    return path.join(hermesProfileDir(config.hermes.profiles.echo), 'state.db');
  }

  poll(now: number): PollResult {
    const file = this.dbPath();
    if (!fs.existsSync(file)) {
      this.lastResult = {
        ok: false,
        error: `Profil Hermes "${config.hermes.profiles.echo}" belum punya penyimpanan sesi`,
        sessions: 0,
        newMessages: 0,
      };
      return this.lastResult;
    }
    let src: DatabaseSync | null = null;
    try {
      src = new DatabaseSync(file, { readOnly: true });
      src.exec('PRAGMA busy_timeout = 2000');
      this.lastResult = this.read(src, now);
    } catch (err) {
      this.lastResult = { ok: false, error: err instanceof Error ? err.message : String(err), sessions: 0, newMessages: 0 };
    } finally {
      try {
        src?.close();
      } catch {
        // abaikan
      }
    }
    return this.lastResult;
  }

  private read(src: DatabaseSync, now: number): PollResult {
    const columns = new Set((src.prepare('PRAGMA table_info(sessions)').all() as Row[]).map((r) => String(r.name)));
    const has = (c: string) => columns.has(c);
    const activity = has('last_activity_at') ? 'COALESCE(last_activity_at, started_at)' : 'started_at';
    const pick = (c: string, fallback: string) => (has(c) ? c : `${fallback} AS ${c}`);
    const lookbackMs = this.firstPoll ? 30 * DAY : 6 * HOUR;
    const marks = config.hermes.sources.map(() => '?').join(', ');
    const sessions = src
      .prepare(
        `SELECT id, source, ${pick('user_id', 'NULL')}, ${pick('chat_id', 'NULL')}, ${pick('display_name', 'NULL')},
                started_at, ${activity} AS activity,
                ${pick('input_tokens', '0')}, ${pick('output_tokens', '0')}, ${pick('cache_read_tokens', '0')},
                ${pick('estimated_cost_usd', 'NULL')}
         FROM sessions WHERE source IN (${marks}) AND ${activity} >= ? ORDER BY started_at`,
      )
      .all(...config.hermes.sources, (now - lookbackMs) / 1000) as Row[];

    const readMessages = src.prepare(
      `SELECT id, role, content, timestamp FROM messages
       WHERE session_id = ? AND id > ? AND role IN ('user', 'assistant') AND content IS NOT NULL AND TRIM(content) <> ''
       ORDER BY id`,
    );

    let newMessages = 0;
    for (const s of sessions) {
      const sessionId = String(s.id);
      const convId = `hermes:${sessionId}`;
      const customerId = String(s.user_id ?? s.chat_id ?? sessionId);
      const startedAt = Math.round(Number(s.started_at) * 1000);
      const customerRef = maskCustomer(customerId);
      this.store.upsertConversation({
        id: convId,
        source: String(s.source),
        customerId,
        customerRef,
        customerName: s.display_name ? String(s.display_name) : null,
        startedAt,
      });

      const after = this.lastSeen.get(sessionId) ?? 0;
      const rows = readMessages.all(sessionId, after) as Row[];
      let maxId = after;
      let aiReplied = false;
      let lastTs = startedAt;
      this.store.transaction(() => {
        for (const m of rows) {
          const id = Number(m.id);
          if (id > maxId) maxId = id;
          const ts = Math.round(Number(m.timestamp) * 1000);
          lastTs = Math.max(lastTs, ts);
          const role = m.role === 'user' ? 'customer' : 'ai';
          const inserted = this.store.addMessage({
            id: `${convId}:${id}`,
            conversation_id: convId,
            role,
            text: String(m.content).trim(),
            ts,
          });
          if (inserted) {
            newMessages++;
            if (role === 'ai') aiReplied = true;
          }
        }
      });
      this.lastSeen.set(sessionId, maxId);

      // Catat aktivitas Echo, paling sering sekali per dua menit per chat supaya umpan tidak penuh.
      if (aiReplied && !this.firstPoll) {
        const last = this.store.lastEventAt('echo', 'reply', convId);
        if (last === null || lastTs - last > 2 * MINUTE) {
          this.store.addEvent({ ts: lastTs, agent: 'echo', kind: 'reply', text: `Membalas chat ${customerRef}`, ref: convId });
        }
      }

      const usage = {
        input: Number(s.input_tokens ?? 0),
        cached: Number(s.cache_read_tokens ?? 0),
        output: Number(s.output_tokens ?? 0),
      };
      const reported = s.estimated_cost_usd === null || s.estimated_cost_usd === undefined ? 0 : Number(s.estimated_cost_usd);
      const cost = reported > 0 ? reported : costUsd(usage, config.cost.rates);
      this.store.recordSessionUsage('echo', sessionId, usage, cost, Math.round(Number(s.activity) * 1000));
    }
    this.firstPoll = false;
    return { ok: true, error: null, sessions: sessions.length, newMessages };
  }
}
