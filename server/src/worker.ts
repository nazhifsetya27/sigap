import { config, type AgentKey } from './config.js';
import { buildPingPrompt, parsePingResponse } from './agents/ping.js';
import { buildTallyPrompt, orderEventText, parseTallyResponse } from './agents/tally.js';
import { formatIdr } from './core/text.js';
import { HOUR, MINUTE } from './core/time.js';
import { gatewayStatus, profileExists, runOneShot } from './runtime/hermes.js';
import type { HermesSessionSource } from './sources/hermes-sessions.js';
import { clock, type AgentStatus, type ConnectionStatus, type StatusProvider } from './status.js';
import type { OrderRow, Store } from './store.js';

function envMs(name: string, fallback: number, unitMs: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n * unitMs : fallback;
}

const INGEST_EVERY = 3_000;
const TALLY_EVERY = 10_000;
const PING_EVERY = envMs('PING_EVERY_MINUTES', 5 * MINUTE, MINUTE);
const TALLY_QUIET = envMs('TALLY_QUIET_SECONDS', 45_000, 1000);
const FOLLOWUP_AFTER = envMs('FOLLOWUP_AFTER_MINUTES', 30 * MINUTE, MINUTE);
const KEEP_FOR = envMs('KEEP_HOURS', 3 * HOUR, HOUR);
const MAX_ATTEMPTS = 3;

/** Menggerakkan portal dari Hermes: menarik chat Echo, lalu menjalankan Tally dan Ping secara bergantian. */
export class HermesWorker implements StatusProvider {
  private timers: NodeJS.Timeout[] = [];
  private queueBusy = false;
  private inflight = new Map<string, number>();
  private attempts = new Map<string, number>();
  private nextPingAt = Date.now() + PING_EVERY;

  constructor(
    private readonly store: Store,
    private readonly source: HermesSessionSource,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  start(): void {
    this.store.failStaleRuns(Date.now());
    this.source.poll(Date.now());
    this.timers.push(setInterval(() => this.source.poll(Date.now()), INGEST_EVERY));
    this.timers.push(setInterval(() => void this.runTally(), TALLY_EVERY));
    this.timers.push(
      setInterval(() => {
        this.nextPingAt = Date.now() + PING_EVERY;
        void this.runPing();
      }, PING_EVERY),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Dipanggil hook gateway Hermes saat Echo mulai atau selesai memproses pesan. */
  noteGatewayEvent(event: string, sessionId: string, now: number): void {
    if (event === 'agent:start') this.inflight.set(sessionId, now);
    else if (event === 'agent:end') {
      this.inflight.delete(sessionId);
      this.source.poll(now);
    }
  }

  private bump(key: string): number {
    const n = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, n);
    return n;
  }

  /** Tally dan Ping memakai satu antrean supaya tidak ada dua proses Hermes berjalan bersamaan. */
  private async exclusive(fn: () => Promise<void>): Promise<void> {
    if (this.queueBusy) return;
    this.queueBusy = true;
    try {
      await fn();
    } catch (err) {
      this.log(`worker: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.queueBusy = false;
    }
  }

  async runTally(): Promise<void> {
    if (!profileExists(config.hermes.profiles.tally)) return;
    await this.exclusive(async () => {
      const pending = this.store.conversationsNeedingAnalysis(Date.now(), TALLY_QUIET, 3);
      for (const conv of pending) {
        const messages = this.store.listMessages(conv.id);
        const upto = messages.length;
        const runId = this.store.startRun('tally', 'analyze', conv.id, Date.now());
        try {
          const res = await runOneShot(config.hermes.profiles.tally, buildTallyPrompt(messages));
          const now = Date.now();
          this.store.addCost('tally', res.usage, res.costUsd, conv.id, now);
          const parsed = parseTallyResponse(res.text);
          if (!parsed) throw new Error('Jawaban Tally bukan JSON yang valid');
          this.store.markAnalyzed(
            conv.id,
            upto,
            {
              needsHuman: parsed.needsHuman,
              reason: parsed.needsHumanReason,
              summary: parsed.summary,
              customerName: parsed.order?.customerName ?? null,
            },
            now,
          );
          if (parsed.needsHuman && conv.status !== 'needs_human') {
            this.store.addEvent({
              ts: now,
              agent: 'tally',
              kind: 'escalate',
              text: `Menandai chat ${conv.customer_ref} perlu admin: ${parsed.needsHumanReason ?? 'perlu ditangani'}`,
              needsHuman: true,
              ref: conv.id,
            });
          }
          if (parsed.order) {
            const { order, created } = this.store.upsertOrder(
              conv.id,
              {
                customerName: parsed.order.customerName,
                items: parsed.order.items,
                totalIdr: parsed.order.totalIdr,
                paymentMethod: parsed.order.paymentMethod,
                paymentStatus: parsed.order.paymentStatus,
                keepMs: KEEP_FOR,
              },
              now,
            );
            this.store.addEvent({
              ts: now,
              agent: 'tally',
              kind: 'order',
              text: orderEventText(order.code, order.total_idr, created),
              ref: conv.id,
            });
          }
          this.store.finishRun(runId, 'ok', null, now);
          this.attempts.delete(conv.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.store.finishRun(runId, 'error', message, Date.now());
          this.log(`tally: ${message}`);
          // Setelah beberapa kali gagal, lewati chat ini supaya token tidak terus terbakar untuk hal yang sama.
          if (this.bump(conv.id) >= MAX_ATTEMPTS) {
            this.store.markAnalyzed(conv.id, upto, { needsHuman: false, reason: null, summary: null, customerName: null }, Date.now());
            this.attempts.delete(conv.id);
          }
        }
      }
    });
  }

  private fallbackReminder(o: OrderRow): string {
    const items = o.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
    return `Halo kak ${o.customer_name ?? ''}`.trim() + `, pesanan ${items} senilai ${formatIdr(o.total_idr)} masih kami simpan ya. Kalau ada kendala pembayaran, kabari kami kak.`;
  }

  async runPing(): Promise<void> {
    if (!profileExists(config.hermes.profiles.ping)) return;
    await this.exclusive(async () => {
      const orders = this.store.unpaidOrdersNeedingFollowup(Date.now(), FOLLOWUP_AFTER, 10);
      if (orders.length === 0) return;
      const runId = this.store.startRun('ping', 'followup', null, Date.now());
      try {
        const res = await runOneShot(config.hermes.profiles.ping, buildPingPrompt(orders, Date.now()));
        const now = Date.now();
        this.store.addCost('ping', res.usage, res.costUsd, null, now);
        const drafts = parsePingResponse(res.text, new Set(orders.map((o) => o.code)));
        const byCode = new Map(drafts.map((d) => [d.code, d.text]));
        let written = 0;
        for (const o of orders) {
          const text = byCode.get(o.code);
          if (text) {
            this.store.addFollowup(o.id, text, now);
            written++;
          } else if (this.bump(`ping:${o.id}`) >= 2) {
            // Model melewatkan pesanan ini dua kali: pakai pesan baku supaya tidak diulang terus.
            this.store.addFollowup(o.id, this.fallbackReminder(o), now);
            written++;
          }
        }
        if (written > 0) {
          this.store.addEvent({ ts: now, agent: 'ping', kind: 'followup', text: `Menyiapkan ${written} pengingat pembayaran` });
        }
        this.store.finishRun(runId, 'ok', null, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.store.finishRun(runId, 'error', message, Date.now());
        this.log(`ping: ${message}`);
      }
    });
  }

  agentStates(now: number): Record<AgentKey, AgentStatus> {
    const profiles = config.hermes.profiles;
    const echo = ((): AgentStatus => {
      if (!profileExists(profiles.echo)) return { state: 'offline', label: 'Profil belum dibuat' };
      const gw = gatewayStatus(profiles.echo);
      if (!gw.whatsappPaired) return { state: 'offline', label: 'WhatsApp belum dipasangkan' };
      if (gw.gateway !== 'running') return { state: 'offline', label: 'Gateway belum jalan' };
      for (const [id, ts] of this.inflight) if (now - ts > 2 * MINUTE) this.inflight.delete(id);
      const active = Math.max(this.inflight.size, this.store.pendingReplies(now, 90_000));
      return active > 0 ? { state: 'working', label: `Membalas ${active} chat` } : { state: 'idle', label: 'Siaga menunggu chat' };
    })();
    const background = (key: 'tally' | 'ping', workingLabel: string, idleLabel: string): AgentStatus => {
      if (!profileExists(profiles[key])) return { state: 'offline', label: 'Profil belum dibuat' };
      return this.store.runningRun(key) ? { state: 'working', label: workingLabel } : { state: 'idle', label: idleLabel };
    };
    return {
      echo,
      tally: background('tally', 'Merekap chat terbaru', 'Menunggu chat selesai'),
      ping: background('ping', 'Menulis pengingat', `Cek berikutnya ${clock(this.nextPingAt, config.timeZone)}`),
    };
  }

  connection(): ConnectionStatus {
    const profile = config.hermes.profiles.echo;
    const problem = this.source.lastResult.ok ? null : this.source.lastResult.error;
    if (!profileExists(profile)) {
      return { mode: 'qr', state: 'disconnected', label: 'Profil Echo belum dibuat', problem };
    }
    const gw = gatewayStatus(profile);
    if (!gw.whatsappPaired) return { mode: 'qr', state: 'disconnected', label: 'WhatsApp belum dipasangkan', problem };
    if (gw.gateway === 'running') return { mode: 'qr', state: 'connected', label: 'WhatsApp terhubung · QR', problem };
    return {
      mode: 'qr',
      state: gw.gateway === 'stopped' ? 'disconnected' : 'unknown',
      label: gw.gateway === 'stopped' ? 'Gateway Hermes mati' : 'Status WhatsApp belum terbaca',
      problem,
    };
  }
}
