import { config, type AgentKey } from '../config.js';
import { orderEventText } from '../agents/tally.js';
import { costUsd, type TokenUsage } from '../core/cost.js';
import { maskCustomer } from '../core/text.js';
import { DAY, HOUR, MINUTE, startOfDay } from '../core/time.js';
import { clock, type AgentStatus, type ConnectionStatus, type StatusProvider } from '../status.js';
import type { OrderItem, Store } from '../store.js';

interface Script {
  lines: Array<['c' | 'a', string]>;
  order?: { items: OrderItem[]; total: number; method: 'transfer' | 'qris' | 'cod'; paid: boolean };
  needsHuman?: string;
  summary: string;
}

const NAMES = ['Rina', 'Dita', 'Maya', 'Ayu', 'Nisa', 'Putri', 'Wulan', 'Salsa', 'Indah', 'Fitri', 'Lia', 'Tika'];

const SCRIPTS: Script[] = [
  {
    summary: 'Pesan Gamis Aluna sage M, kirim ke Medan, belum bayar',
    lines: [
      ['c', 'kak gamis aluna sage ukuran M ready?'],
      ['a', 'Ready kak. Gamis Aluna sage ukuran M masih ada, harganya 189.000.'],
      ['c', 'ongkir ke medan berapa ya'],
      ['a', 'Ke Medan ongkirnya 28.000 kak, estimasi 2 sampai 5 hari.'],
      ['c', 'oke jadi 1 ya kak, transfer'],
      ['a', 'Siap kak. Rekap: 1x Gamis Aluna sage M 189.000 + ongkir 28.000, total 217.000. Barang kami keep 3 jam ya kak.'],
    ],
    order: { items: [{ name: 'Gamis Aluna', variant: 'sage, M', qty: 1, price_idr: 189000 }], total: 217000, method: 'transfer', paid: false },
  },
  {
    summary: 'Pesan 3 Hijab Voal, sudah bayar lewat QRIS',
    lines: [
      ['c', 'hijab voal warna mocca sama nude ada kak?'],
      ['a', 'Ada kak, dua-duanya ready. 45.000 per pcs, beli 3 jadi 120.000.'],
      ['c', 'mau 3 deh, mocca 2 nude 1. kirim bekasi'],
      ['a', 'Siap kak. Rekap: 3x Hijab Voal 120.000 + ongkir 12.000, total 132.000. QRIS kami kirim ya kak.'],
      ['c', 'udah aku bayar ya kak, ini buktinya'],
      ['a', 'Terima kasih kak, pembayarannya kami teruskan ke tim untuk dicek dan pesanan segera diproses.'],
    ],
    order: { items: [{ name: 'Hijab Voal Seruni', variant: 'mocca 2, nude 1', qty: 3, price_idr: 40000 }], total: 132000, method: 'qris', paid: true },
  },
  {
    summary: 'Tanya ukuran tunik, belum memesan',
    lines: [
      ['c', 'kak tunik kirana lingkar dada L berapa?'],
      ['a', 'Tunik Kirana ukuran L lingkar dadanya 104 cm kak. Kalau ragu di antara dua ukuran, kami sarankan ambil yang lebih besar.'],
      ['c', 'oke aku pikir2 dulu ya'],
      ['a', 'Siap kak, kabari saja kalau mau lanjut ya.'],
    ],
  },
  {
    summary: 'Komplain ukuran tidak sesuai, minta tukar',
    lines: [
      ['c', 'kak gamis yang kemarin dateng kekecilan, padahal udah pesen L'],
      ['a', 'Mohon maaf atas kendalanya kak. Boleh minta nomor ordernya? Keluhan ini kami teruskan ke admin untuk dibantu.'],
      ['c', 'ordernya yang atas nama saya kemarin sore, tolong cepet ya'],
      ['a', 'Baik kak, sudah kami teruskan ke admin. Mohon ditunggu sebentar ya.'],
    ],
    needsHuman: 'Komplain ukuran, minta tukar',
  },
  {
    summary: 'Pesan Kulot Daily COD ke Semarang',
    lines: [
      ['c', 'kulot daily hitam bisa COD ga kak?'],
      ['a', 'Bisa kak untuk wilayah Jawa, tambah biaya COD 5.000. Kulot Daily hitam 99.000.'],
      ['c', 'mau 2 kak, kirim semarang, COD'],
      ['a', 'Siap kak. Rekap: 2x Kulot Daily hitam 198.000 + ongkir 15.000 + COD 5.000, total 218.000.'],
    ],
    order: { items: [{ name: 'Kulot Daily', variant: 'hitam', qty: 2, price_idr: 99000 }], total: 218000, method: 'cod', paid: false },
  },
  {
    summary: 'Pesan Tunik Kirana dan Pashmina, belum bayar',
    lines: [
      ['c', 'tunik kirana navy L sama pashmina jersey abu ready kak?'],
      ['a', 'Ready semua kak. Tunik Kirana navy L 149.000 dan Pashmina Jersey abu 39.000.'],
      ['c', 'jadi kak dua-duanya, kirim ke Surabaya ya transfer'],
      ['a', 'Siap kak. Rekap: Tunik Kirana navy L 149.000 + Pashmina Jersey abu 39.000 + ongkir 15.000, total 203.000. Kami keep 3 jam ya kak.'],
    ],
    order: {
      items: [
        { name: 'Tunik Kirana', variant: 'navy, L', qty: 1, price_idr: 149000 },
        { name: 'Pashmina Jersey', variant: 'abu', qty: 1, price_idr: 39000 },
      ],
      total: 203000,
      method: 'transfer',
      paid: false,
    },
  },
];

// Pemakaian token contoh per balasan. Angka ini rekaan untuk mengisi tampilan, bukan hasil ukur.
const ECHO_REPLY: TokenUsage = { input: 600, cached: 3800, output: 90 };
const TALLY_RUN: TokenUsage = { input: 900, cached: 2500, output: 160 };
const PING_RUN: TokenUsage = { input: 700, cached: 2200, output: 220 };

interface Active {
  convId: string;
  ref: string;
  name: string;
  script: Script;
  step: number;
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** Mengisi portal dengan data contoh yang terus bergerak, untuk melihat tampilan tanpa WhatsApp. */
export class DemoSource implements StatusProvider {
  private timers: NodeJS.Timeout[] = [];
  private active: Active[] = [];
  private seq = 0;
  private tallyBusyUntil = 0;
  private pingBusyUntil = 0;
  private nextPingAt = Date.now() + MINUTE;

  constructor(private readonly store: Store) {}

  start(): void {
    const now = Date.now();
    this.seed(now);
    this.timers.push(setInterval(() => this.tick(Date.now()), 2500));
    this.timers.push(
      setInterval(() => {
        this.nextPingAt = Date.now() + MINUTE;
        this.ping(Date.now(), 2 * MINUTE);
      }, MINUTE),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private newConversation(startedAtRaw: number): Active {
    const startedAt = Math.round(startedAtRaw);
    this.seq++;
    const phone = `6281${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
    const convId = `demo:${startedAt}:${this.seq}`;
    const name = pick(NAMES);
    this.store.upsertConversation({
      id: convId,
      source: 'demo',
      customerId: phone,
      customerRef: maskCustomer(phone),
      customerName: name,
      startedAt,
    });
    return { convId, ref: maskCustomer(phone), name, script: pick(SCRIPTS), step: 0 };
  }

  private say(a: Active, ts: number): void {
    const line = a.script.lines[a.step];
    if (!line) return;
    const role = line[0] === 'c' ? 'customer' : 'ai';
    this.store.addMessage({ id: `${a.convId}:${a.step}`, conversation_id: a.convId, role, text: line[1], ts });
    if (role === 'ai') {
      const replies = a.script.lines.slice(0, a.step + 1).filter((l) => l[0] === 'a').length;
      const total: TokenUsage = {
        input: ECHO_REPLY.input * replies,
        cached: ECHO_REPLY.cached * replies,
        output: ECHO_REPLY.output * replies,
      };
      this.store.recordSessionUsage('echo', a.convId, total, costUsd(total, config.cost.rates), ts);
    }
    a.step++;
  }

  /** Terapkan hasil akhir percakapan: rekap Tally, pesanan, atau operan ke admin. */
  private finish(a: Active, ts: number, opts: { live: boolean; keepOpen: boolean; forcePaid: boolean }): void {
    this.store.addCost('tally', TALLY_RUN, costUsd(TALLY_RUN, config.cost.rates), a.convId, ts);
    this.store.markAnalyzed(
      a.convId,
      a.script.lines.length,
      { needsHuman: Boolean(a.script.needsHuman), reason: a.script.needsHuman ?? null, summary: a.script.summary, customerName: a.name },
      ts,
    );
    if (a.script.needsHuman) {
      if (!opts.keepOpen) this.store.setConversationStatus(a.convId, 'done');
      if (opts.live) {
        this.store.addEvent({
          ts,
          agent: 'tally',
          kind: 'escalate',
          text: `Menandai chat ${a.ref} perlu admin: ${a.script.needsHuman}`,
          needsHuman: true,
          ref: a.convId,
        });
      }
    }
    if (a.script.order) {
      const paid = a.script.order.paid || opts.forcePaid;
      const { order } = this.store.upsertOrder(
        a.convId,
        {
          customerName: a.name,
          items: a.script.order.items,
          totalIdr: a.script.order.total,
          paymentMethod: a.script.order.method,
          paymentStatus: paid ? 'paid' : 'unpaid',
          keepMs: 3 * HOUR,
        },
        ts,
      );
      if (opts.live) {
        this.store.addEvent({ ts, agent: 'tally', kind: 'order', text: orderEventText(order.code, order.total_idr, true), ref: a.convId });
      }
    }
  }

  private playWhole(startedAt: number, now: number): void {
    const a = this.newConversation(startedAt);
    let ts = startedAt;
    while (a.step < a.script.lines.length) {
      const isCustomer = a.script.lines[a.step]![0] === 'c';
      ts += isCustomer ? 20_000 + Math.random() * 40_000 : 4000 + Math.random() * 5000;
      this.say(a, Math.min(ts, now));
    }
    const age = now - ts;
    this.finish(a, Math.min(ts + 50_000, now), {
      live: age < 60 * MINUTE,
      keepOpen: age < 90 * MINUTE,
      // Pesanan lama dianggap sudah lunas supaya daftar belum bayar tetap masuk akal.
      forcePaid: age > 3 * HOUR || Math.random() < 0.45,
    });
    if (age < 20 * MINUTE) {
      this.store.addEvent({ ts: Math.min(ts, now), agent: 'echo', kind: 'reply', text: `Membalas chat ${a.ref}`, ref: a.convId });
    }
  }

  private seed(now: number): void {
    const today = startOfDay(now, config.timeZone);
    const openAt = (dayStart: number) => dayStart + 8 * HOUR;
    this.store.transaction(() => {
      // Kemarin: satu hari penuh, sebagai pembanding.
      for (let i = 0; i < 150; i++) this.playWhole(openAt(today - DAY) + Math.random() * 14 * HOUR, now);
      // Hari ini: dari jam buka sampai sekarang.
      const from = Math.min(openAt(today), now - HOUR);
      const hours = Math.max(1, (now - from) / HOUR);
      const count = Math.min(170, Math.round(hours * 13));
      for (let i = 0; i < count; i++) this.playWhole(from + Math.random() * (now - from - 3 * MINUTE), now);
    });
    this.ping(now, 35 * MINUTE);
  }

  private tick(now: number): void {
    for (const a of this.active) this.say(a, now);
    const done = this.active.filter((a) => a.step >= a.script.lines.length);
    this.active = this.active.filter((a) => a.step < a.script.lines.length);
    for (const a of done) {
      this.store.addEvent({ ts: now, agent: 'echo', kind: 'reply', text: `Membalas chat ${a.ref}`, ref: a.convId });
      this.finish(a, now, { live: true, keepOpen: true, forcePaid: false });
      this.tallyBusyUntil = now + 6000;
    }
    if (this.active.length < 3 && Math.random() < 0.3) {
      const a = this.newConversation(now);
      this.say(a, now);
      this.active.push(a);
    }
  }

  private ping(now: number, olderThanMs: number): void {
    const orders = this.store.unpaidOrdersNeedingFollowup(now, olderThanMs, 10);
    if (orders.length === 0) return;
    for (const o of orders) {
      const items = o.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
      this.store.addFollowup(
        o.id,
        `Halo kak ${o.customer_name ?? ''}, pesanan ${items} masih kami keep ya. Totalnya Rp${o.total_idr.toLocaleString('id-ID')}. Kalau ada kendala pembayaran, kabari kami kak.`,
        now,
      );
    }
    this.store.addCost('ping', PING_RUN, costUsd(PING_RUN, config.cost.rates), null, now);
    this.store.addEvent({ ts: now, agent: 'ping', kind: 'followup', text: `Menyiapkan ${orders.length} pengingat pembayaran` });
    this.pingBusyUntil = now + 5000;
  }

  agentStates(now: number): Record<AgentKey, AgentStatus> {
    const replying = Math.max(this.active.length, this.store.pendingReplies(now, 30_000));
    return {
      echo: replying > 0 ? { state: 'working', label: `Membalas ${replying} chat` } : { state: 'idle', label: 'Siaga menunggu chat' },
      tally: now < this.tallyBusyUntil ? { state: 'working', label: 'Merekap chat terbaru' } : { state: 'idle', label: 'Menunggu chat selesai' },
      ping:
        now < this.pingBusyUntil
          ? { state: 'working', label: 'Menulis pengingat' }
          : { state: 'idle', label: `Cek berikutnya ${clock(this.nextPingAt, config.timeZone)}` },
    };
  }

  connection(): ConnectionStatus {
    return { mode: 'demo', state: 'connected', label: 'Mode contoh, tanpa WhatsApp', problem: null };
  }
}
