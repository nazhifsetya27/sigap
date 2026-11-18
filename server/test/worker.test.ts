import { describe, expect, it } from 'vitest';
import { escalationSignal, hasOrderSignal } from '../src/agents/signals.js';
import type { RunResult } from '../src/runtime/hermes.js';
import { Store, type MessageRow } from '../src/store.js';
import { HermesWorker } from '../src/worker.js';

const msg = (role: MessageRow['role'], text: string, i = 0): MessageRow => ({ id: `m${i}`, conversation_id: 'c', role, text, ts: i });

describe('tanda dari balasan Echo', () => {
  it('mengenali rekap pesanan dari balasan Echo yang sebenarnya', () => {
    expect(
      hasOrderSignal([msg('ai', 'Siap kak Rina. Rekap: 1x Gamis Aluna sage M 189.000 + ongkir 28.000, total 217.000. Barang kami keep 3 jam ya kak.')]),
    ).toBe(true);
  });

  it('tanya stok, sapaan, atau tawaran merekap bukan pesanan', () => {
    expect(hasOrderSignal([msg('ai', 'Ready kak, sage M masih ada, harganya 189.000. Mau Echo bantu rekap ordernya?')])).toBe(false);
    expect(hasOrderSignal([msg('ai', 'Halo kak, selamat datang di Seruni Daily.')])).toBe(false);
  });

  it('kata rekap dari pelanggan tidak dihitung', () => {
    expect(hasOrderSignal([msg('customer', 'tolong rekap totalnya kak')])).toBe(false);
  });

  it('mengenali operan ke admin dan mengutip pesan pelanggan yang memicunya', () => {
    const reason = escalationSignal([
      msg('customer', 'barang yang kemarin dateng sobek kak, saya mau refund', 0),
      msg('ai', 'Aduh maaf banget ya kak. Boleh dibantu kirim nomor ordernya? Echo teruskan ke admin buat diproses ya kak.', 1),
    ]);
    expect(reason).toBe('Echo meneruskan ke admin: "barang yang kemarin dateng sobek kak, saya mau refund"');
    expect(escalationSignal([msg('ai', 'Baik kak, sudah kami teruskan ke admin.')])).toBe('Echo meneruskan chat ini ke admin');
    expect(escalationSignal([msg('customer', 'soal promo gimana kak', 0), msg('ai', 'Echo cek dulu ke tim ya kak.', 1)])).toContain('soal promo');
  });

  it('balasan biasa bukan operan', () => {
    expect(escalationSignal([msg('ai', 'Ke Medan ongkirnya 28.000 kak.')])).toBeNull();
  });
});

describe('penjadwal Tally', () => {
  const OLD = Date.now() - 120_000;

  function setup(replyText: string) {
    const store = new Store(':memory:');
    const calls: string[] = [];
    const run = async (profile: string): Promise<RunResult> => {
      calls.push(profile);
      return { text: replyText, usage: { input: 1800, cached: 0, output: 200 }, costUsd: 0.0004 };
    };
    const source = { poll: () => ({ ok: true, error: null, sessions: 0, newMessages: 0 }), lastResult: { ok: true, error: null, sessions: 0, newMessages: 0 } };
    const worker = new HermesWorker(store, source, () => undefined, { run, profileExists: () => true });
    const chat = (id: string, lines: Array<[MessageRow['role'], string]>) => {
      store.upsertConversation({ id, source: 'whatsapp', customerId: '6281234567890', customerRef: '6281••••890', customerName: null, startedAt: OLD });
      lines.forEach(([role, text], i) => store.addMessage({ id: `${id}:${i}`, conversation_id: id, role, text, ts: OLD + i * 1000 }));
    };
    return { store, worker, calls, chat };
  }

  const ORDER_JSON =
    '{"has_order": true, "order": {"customer_name": "Rina", "items": [{"name": "Gamis Aluna", "variant": "sage, M", "qty": 1, "price_idr": 189000}], "total_idr": 217000, "payment_method": "transfer", "payment_status": "unpaid"}, "needs_human": false, "needs_human_reason": null, "summary": "Pesan gamis"}';

  it('chat tanpa pesanan tidak memanggil Tally dan tidak menimbulkan biaya', async () => {
    const t = setup(ORDER_JSON);
    t.chat('a', [['customer', 'Halo'], ['ai', 'Halo kak, selamat datang di Seruni Daily.']]);
    t.chat('b', [['customer', 'gamis aluna sage M ready?'], ['ai', 'Ready kak, harganya 189.000. Mau Echo bantu rekap ordernya?']]);
    await t.worker.runTally();
    expect(t.calls).toEqual([]);
    expect(t.store.sumCost()).toBe(0);
    expect(t.store.listOrders()).toHaveLength(0);
    expect(t.store.conversationsNeedingAnalysis(Date.now(), 45_000)).toHaveLength(0);
  });

  it('chat dengan rekap pesanan memanggil Tally satu kali dan mencatat pesanannya', async () => {
    const t = setup(ORDER_JSON);
    t.chat('a', [
      ['customer', 'jadi 1 ya kak, transfer'],
      ['ai', 'Siap kak. Rekap: 1x Gamis Aluna sage M 189.000 + ongkir 28.000, total 217.000.'],
    ]);
    await t.worker.runTally();
    await t.worker.runTally();
    expect(t.calls).toEqual(['tally']);
    expect(t.store.listOrders()[0]).toMatchObject({ total_idr: 217000, payment_status: 'unpaid' });
    expect(t.store.sumCost({ agent: 'tally' })).toBeCloseTo(0.0004, 9);
  });

  it('komplain ditandai perlu admin tanpa memanggil Tally', async () => {
    const t = setup(ORDER_JSON);
    t.chat('a', [
      ['customer', 'gamisnya kekecilan kak, mau tukar'],
      ['ai', 'Mohon maaf kak. Boleh minta nomor ordernya? Kami teruskan ke admin ya.'],
    ]);
    await t.worker.runTally();
    expect(t.calls).toEqual([]);
    const conv = t.store.getConversation('a')!;
    expect(conv.status).toBe('needs_human');
    expect(conv.needs_human_reason).toContain('kekecilan');
    const [event] = t.store.recentEvents(1);
    expect(event).toMatchObject({ agent: 'echo', needs_human: 1 });
  });

  it('chat yang sudah ditutup tidak ditandai ulang karena operan lama', async () => {
    const t = setup(ORDER_JSON);
    t.chat('a', [['customer', 'barang sobek kak'], ['ai', 'Maaf kak, kami teruskan ke admin ya.']]);
    await t.worker.runTally();
    t.store.setConversationStatus('a', 'done');
    t.store.addMessage({ id: 'a:9', conversation_id: 'a', role: 'customer', text: 'makasih kak sudah beres', ts: OLD + 9000 });
    t.store.addMessage({ id: 'a:10', conversation_id: 'a', role: 'ai', text: 'Sama-sama kak.', ts: OLD + 10_000 });
    await t.worker.runTally();
    expect(t.store.getConversation('a')!.status).toBe('ai');
    expect(t.calls).toEqual([]);
  });

  it('pesan baru setelah pesanan direkap memicu rekap ulang, misalnya saat pelanggan bilang sudah bayar', async () => {
    const t = setup(ORDER_JSON);
    t.chat('a', [['customer', 'jadi ya kak'], ['ai', 'Rekap: 1x Gamis Aluna, total 217.000.']]);
    await t.worker.runTally();
    t.store.addMessage({ id: 'a:5', conversation_id: 'a', role: 'customer', text: 'sudah transfer ya kak', ts: OLD + 5000 });
    t.store.addMessage({ id: 'a:6', conversation_id: 'a', role: 'ai', text: 'Terima kasih kak, kami cek ya.', ts: OLD + 6000 });
    await t.worker.runTally();
    expect(t.calls).toEqual(['tally', 'tally']);
    expect(t.store.listOrders()).toHaveLength(1);
  });
});
