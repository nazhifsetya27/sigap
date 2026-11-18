import { beforeEach, describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../src/core/time.js';
import { Store } from '../src/store.js';

let store: Store;
const T0 = Date.UTC(2026, 10, 18, 3, 0, 0);

function conv(id: string, startedAt = T0) {
  store.upsertConversation({ id, source: 'test', customerId: '6281234567890', customerRef: '6281••••890', customerName: null, startedAt });
}

beforeEach(() => {
  store = new Store(':memory:');
});

describe('percakapan', () => {
  it('pesan yang sama tidak tersimpan dua kali dan hitungan tetap benar', () => {
    conv('c1');
    expect(store.addMessage({ id: 'c1:1', conversation_id: 'c1', role: 'customer', text: 'halo', ts: T0 + 1000 })).toBe(true);
    expect(store.addMessage({ id: 'c1:1', conversation_id: 'c1', role: 'customer', text: 'halo', ts: T0 + 1000 })).toBe(false);
    store.addMessage({ id: 'c1:2', conversation_id: 'c1', role: 'ai', text: 'halo kak', ts: T0 + 5000 });
    const c = store.getConversation('c1')!;
    expect(c.message_count).toBe(2);
    expect(c.last_customer_at).toBe(T0 + 1000);
    expect(c.last_ai_at).toBe(T0 + 5000);
    expect(store.countChats(T0, T0 + HOUR)).toBe(1);
    expect(store.avgFirstReplySeconds(T0, T0 + HOUR)).toBe(4);
  });

  it('chat yang belum dibalas terhitung sedang ditangani', () => {
    conv('c1');
    store.addMessage({ id: 'c1:1', conversation_id: 'c1', role: 'customer', text: 'ready?', ts: T0 });
    expect(store.pendingReplies(T0 + 10_000, 90_000)).toBe(1);
    store.addMessage({ id: 'c1:2', conversation_id: 'c1', role: 'ai', text: 'ready kak', ts: T0 + 4000 });
    expect(store.pendingReplies(T0 + 10_000, 90_000)).toBe(0);
  });

  it('hanya chat yang sudah tenang dan punya pesan baru yang dianalisis', () => {
    conv('c1');
    store.addMessage({ id: 'c1:1', conversation_id: 'c1', role: 'customer', text: 'a', ts: T0 });
    store.addMessage({ id: 'c1:2', conversation_id: 'c1', role: 'ai', text: 'b', ts: T0 + 1000 });
    expect(store.conversationsNeedingAnalysis(T0 + 10_000, 45_000)).toHaveLength(0);
    expect(store.conversationsNeedingAnalysis(T0 + MINUTE, 45_000)).toHaveLength(1);
    store.markAnalyzed('c1', 2, { needsHuman: true, reason: 'Komplain', summary: 'x', customerName: 'Rina' }, T0 + MINUTE);
    expect(store.conversationsNeedingAnalysis(T0 + HOUR, 45_000)).toHaveLength(0);
    expect(store.getConversation('c1')!.status).toBe('needs_human');
    expect(store.waitingHuman()).toEqual({ count: 1, oldestAt: T0 + MINUTE });
  });

  it('chat yang sudah ditutup terbuka lagi saat pelanggan menulis', () => {
    conv('c1');
    store.setConversationStatus('c1', 'done');
    store.addMessage({ id: 'c1:1', conversation_id: 'c1', role: 'customer', text: 'kak', ts: T0 });
    expect(store.getConversation('c1')!.status).toBe('ai');
  });
});

describe('pesanan dan pengingat', () => {
  const data = {
    customerName: 'Rina',
    items: [{ name: 'Gamis Aluna', variant: 'sage, M', qty: 1, price_idr: 189000 }],
    totalIdr: 217000,
    paymentMethod: 'transfer',
    paymentStatus: 'unpaid' as const,
    keepMs: 3 * HOUR,
  };

  it('satu percakapan menghasilkan satu pesanan yang diperbarui, bukan digandakan', () => {
    conv('c1');
    const first = store.upsertOrder('c1', data, T0);
    const second = store.upsertOrder('c1', { ...data, totalIdr: 230000 }, T0 + MINUTE);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.order.code).toBe(first.order.code);
    expect(store.listOrders()).toHaveLength(1);
    expect(store.listOrders()[0]!.total_idr).toBe(230000);
  });

  it('pesanan yang sudah ditandai lunas tidak kembali menjadi belum bayar', () => {
    conv('c1');
    const { order } = store.upsertOrder('c1', data, T0);
    store.setOrderPayment(order.id, 'paid', T0 + MINUTE);
    const again = store.upsertOrder('c1', data, T0 + 2 * MINUTE);
    expect(again.order.payment_status).toBe('paid');
  });

  it('pengingat hanya dibuat untuk pesanan belum bayar yang cukup lama, dan sekali saja', () => {
    conv('c1');
    conv('c2');
    const a = store.upsertOrder('c1', data, T0).order;
    store.upsertOrder('c2', data, T0 + 50 * MINUTE);
    const due = store.unpaidOrdersNeedingFollowup(T0 + HOUR, 30 * MINUTE);
    expect(due.map((o) => o.id)).toEqual([a.id]);
    store.addFollowup(a.id, 'Halo kak', T0 + HOUR);
    store.addFollowup(a.id, 'dobel', T0 + HOUR);
    expect(store.unpaidOrdersNeedingFollowup(T0 + HOUR, 30 * MINUTE)).toHaveLength(0);
    expect(store.listFollowups()).toHaveLength(1);
    expect(store.draftFollowups()).toBe(1);
  });

  it('menghitung pesanan belum bayar dan yang hampir lewat batas keep', () => {
    conv('c1');
    store.upsertOrder('c1', data, T0);
    const stats = store.unpaidStats(T0 + 2.5 * HOUR, HOUR);
    expect(stats).toEqual({ count: 1, total: 217000, expiringSoon: 1, nextKeepUntil: T0 + 3 * HOUR });
  });
});

describe('biaya', () => {
  it('pemakaian kumulatif dicatat sebagai selisih, jadi polling berulang tidak menggandakan biaya', () => {
    store.recordSessionUsage('echo', 's1', { input: 1000, cached: 0, output: 50 }, 0.001, T0);
    store.recordSessionUsage('echo', 's1', { input: 1000, cached: 0, output: 50 }, 0.001, T0 + 3000);
    store.recordSessionUsage('echo', 's1', { input: 1500, cached: 4000, output: 90 }, 0.0016, T0 + 6000);
    expect(store.sumCost()).toBeCloseTo(0.0016, 9);
    expect(store.tokenTotals()).toEqual({ input: 1500, cached: 4000, output: 90 });
    expect(store.measuredConversations()).toBe(1);
  });

  it('memisahkan biaya per agent dan per rentang waktu', () => {
    store.addCost('echo', { input: 1, cached: 0, output: 0 }, 0.01, null, T0);
    store.addCost('tally', { input: 1, cached: 0, output: 0 }, 0.02, null, T0 + HOUR);
    expect(store.costByAgent()).toEqual({ echo: 0.01, tally: 0.02, ping: 0 });
    expect(store.sumCost({ since: T0 + MINUTE })).toBeCloseTo(0.02, 9);
    expect(store.sumCost({ agent: 'echo' })).toBeCloseTo(0.01, 9);
  });

  it('mengelompokkan biaya per hari menurut zona waktu toko', () => {
    const offset = 7 * HOUR; // WIB
    const day = Date.UTC(2026, 10, 17, 17, 0, 0); // 18 Nov 00.00 WIB
    store.addCost('echo', { input: 1, cached: 0, output: 0 }, 0.01, null, day + HOUR);
    store.addCost('tally', { input: 1, cached: 0, output: 0 }, 0.02, null, day + 20 * HOUR);
    store.addCost('echo', { input: 1, cached: 0, output: 0 }, 0.04, null, day + 25 * HOUR);
    const rows = store.costByDay(0, offset);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day, tokens: 2 });
    expect(rows[0]!.cost_usd).toBeCloseTo(0.03, 9);
    expect(rows[1]!.day).toBe(day + 24 * HOUR);
  });

  it('transaksi bersarang tidak melempar galat', () => {
    expect(() =>
      store.transaction(() => store.recordSessionUsage('echo', 's2', { input: 10, cached: 0, output: 1 }, 0.0001, T0)),
    ).not.toThrow();
  });
});
