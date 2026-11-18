import { describe, expect, it } from 'vitest';
import { parsePingResponse } from '../src/agents/ping.js';
import { buildTranscript, parseTallyResponse } from '../src/agents/tally.js';
import { MIN_PROJECTION_BASIS, costUsd, project } from '../src/core/cost.js';
import { extractJson, maskCustomer } from '../src/core/text.js';
import { HOUR, startOfDay } from '../src/core/time.js';
import { parseUsageFile } from '../src/runtime/hermes.js';

const RATES = { input: 0.15, cached: 0.003, output: 0.6 };

describe('biaya', () => {
  it('cocok dengan angka yang dicatat Hermes untuk satu panggilan nyata ke Fenrir', () => {
    // Diukur 18 Nov 2026: 17.945 input baru, 16.313 input ter-cache, 60 output.
    expect(costUsd({ input: 17945, cached: 16313, output: 60 }, RATES)).toBeCloseTo(0.002776689, 9);
  });

  it('tidak menampilkan proyeksi sebelum data cukup', () => {
    const p = project({
      creditUsd: 1.09,
      spentSinceCreditUsd: 0.002,
      totalSpentUsd: 0.002,
      measuredConversations: MIN_PROJECTION_BASIS - 1,
      chatsPerDay: 200,
    });
    expect(p.days).toBeNull();
    expect(p.avgPerConversationUsd).toBeCloseTo(0.001, 9);
  });

  it('menghitung hari dari sisa saldo, biaya per percakapan, dan asumsi chat per hari', () => {
    const p = project({ creditUsd: 1, spentSinceCreditUsd: 0.2, totalSpentUsd: 0.2, measuredConversations: 100, chatsPerDay: 200 });
    // 0,2 / 100 = 0,002 per percakapan; 200 chat = 0,4 per hari; sisa 0,8 berarti 2 hari.
    expect(p.remainingUsd).toBeCloseTo(0.8, 9);
    expect(p.days).toBeCloseTo(2, 9);
  });

  it('sisa saldo tidak pernah negatif', () => {
    const p = project({ creditUsd: 1, spentSinceCreditUsd: 5, totalSpentUsd: 5, measuredConversations: 10, chatsPerDay: 200 });
    expect(p.remainingUsd).toBe(0);
    expect(p.days).toBe(0);
  });
});

describe('berkas pemakaian Hermes', () => {
  it('menjumlahkan panggilan utama dan panggilan tambahan', () => {
    const parsed = parseUsageFile(
      JSON.stringify({
        input_tokens: 17061,
        output_tokens: 3,
        cache_read_tokens: 0,
        estimated_cost_usd: 0.00256095,
        auxiliary: { input_tokens: 240, output_tokens: 10, cache_read_tokens: 0, estimated_cost_usd: 0.000042 },
      }),
    );
    expect(parsed.usage).toEqual({ input: 17301, cached: 0, output: 13 });
    expect(parsed.costUsd).toBeCloseTo(0.00260295, 9);
  });

  it('berkas rusak menghasilkan nol, bukan galat', () => {
    expect(parseUsageFile('bukan json')).toEqual({ usage: { input: 0, cached: 0, output: 0 }, costUsd: 0 });
  });
});

describe('teks', () => {
  it('menyamarkan nomor pelanggan', () => {
    expect(maskCustomer('6281234567890@s.whatsapp.net')).toBe('6281••••890');
    expect(maskCustomer('abc')).toBe('abc');
  });

  it('mengambil JSON dari jawaban yang dibungkus teks atau pagar kode', () => {
    expect(extractJson('Ini hasilnya:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('oke [{"code":"SG-1"}] selesai')).toEqual([{ code: 'SG-1' }]);
    expect(extractJson('tidak ada')).toBeNull();
  });

  it('awal hari mengikuti zona waktu Jakarta', () => {
    const now = Date.UTC(2026, 10, 18, 4, 30, 15); // 11.30.15 WIB
    expect(startOfDay(now, 'Asia/Jakarta')).toBe(Date.UTC(2026, 10, 17, 17, 0, 0));
    expect(now - startOfDay(now, 'Asia/Jakarta')).toBe(11 * HOUR + 30 * 60_000 + 15_000);
  });
});

describe('Tally', () => {
  it('membaca pesanan yang valid', () => {
    const r = parseTallyResponse(
      '{"has_order": true, "order": {"customer_name": "Rina", "items": [{"name": "Gamis Aluna", "variant": "sage, M", "qty": 1, "price_idr": 189000}], "total_idr": 217000, "payment_method": "transfer", "payment_status": "unpaid"}, "needs_human": false, "needs_human_reason": null, "summary": "Pesan gamis"}',
    );
    expect(r?.hasOrder).toBe(true);
    expect(r?.order?.totalIdr).toBe(217000);
    expect(r?.order?.paymentStatus).toBe('unpaid');
    expect(r?.needsHuman).toBe(false);
  });

  it('tidak mengarang total bila harga barang tidak lengkap', () => {
    const r = parseTallyResponse(
      '{"has_order": true, "order": {"items": [{"name": "Kulot", "qty": 2, "price_idr": null}], "total_idr": null}, "needs_human": false, "summary": "x"}',
    );
    expect(r?.hasOrder).toBe(false);
    expect(r?.order).toBeNull();
  });

  it('menjumlahkan sendiri hanya bila semua harga tersedia', () => {
    const r = parseTallyResponse(
      '{"has_order": true, "order": {"items": [{"name": "Kulot", "qty": 2, "price_idr": 99000}], "total_idr": null}, "needs_human": false, "summary": "x"}',
    );
    expect(r?.order?.totalIdr).toBe(198000);
  });

  it('menandai komplain dan memberi alasan bawaan', () => {
    const r = parseTallyResponse('{"has_order": false, "order": null, "needs_human": true, "summary": "Komplain"}');
    expect(r?.needsHuman).toBe(true);
    expect(r?.needsHumanReason).toBe('Perlu ditangani admin');
  });

  it('menolak jawaban yang bukan objek JSON', () => {
    expect(parseTallyResponse('maaf saya tidak bisa')).toBeNull();
    expect(parseTallyResponse('[1,2]')).toBeNull();
  });

  it('memotong percakapan panjang dari depan', () => {
    const messages = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      conversation_id: 'c',
      role: 'customer' as const,
      text: `pesan nomor ${i} `.repeat(5),
      ts: i,
    }));
    const t = buildTranscript(messages);
    expect(t.startsWith('[...dipotong...]')).toBe(true);
    expect(t).toContain('pesan nomor 399');
  });
});

describe('Ping', () => {
  it('hanya menerima kode pesanan yang diminta dan membuang duplikat', () => {
    const drafts = parsePingResponse(
      '[{"code":"SG-1001","text":"Halo kak"},{"code":"SG-9999","text":"asing"},{"code":"SG-1001","text":"dobel"},{"code":"SG-1002","text":""}]',
      new Set(['SG-1001', 'SG-1002']),
    );
    expect(drafts).toEqual([{ code: 'SG-1001', text: 'Halo kak' }]);
  });
});
