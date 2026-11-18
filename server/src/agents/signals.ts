import type { MessageRow } from '../store.js';

/**
 * Tanda-tanda yang dibaca langsung dari balasan Echo, tanpa memanggil model.
 * Echo diperintah (lihat hermes/echo/SOUL.md) memakai kata-kata ini, sehingga portal
 * bisa memutuskan dengan gratis apakah sebuah chat perlu direkap Tally atau dioper ke admin.
 */

// Echo menutup pesanan dengan satu pesan berisi "Rekap: ... total ...".
const ORDER = /\brekap\b[\s\S]*\btotal\b|\btotal\b[\s\S]*\brekap\b/i;

// Echo berkata "teruskan ke admin" untuk komplain, dan "cek dulu ke tim" bila tidak tahu jawabannya.
const ESCALATE = /terus\w*\s+ke\s+(admin|tim)|cek\s+dulu\s+ke\s+(admin|tim)/i;

/** Ada pesan Echo yang merekap pesanan beserta totalnya. */
export function hasOrderSignal(messages: MessageRow[]): boolean {
  return messages.some((m) => m.role === 'ai' && ORDER.test(m.text));
}

/**
 * Echo meneruskan chat ke admin. Mengembalikan alasan singkat berisi pesan pelanggan yang memicunya,
 * atau null bila tidak ada operan pada pesan-pesan yang diberikan.
 */
export function escalationSignal(messages: MessageRow[]): string | null {
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'ai' && ESCALATE.test(m.text)) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  for (let i = at; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'customer') {
      const quote = m.text.replace(/\s+/g, ' ').trim().slice(0, 90);
      if (quote) return `Echo meneruskan ke admin: "${quote}"`;
    }
  }
  return 'Echo meneruskan chat ini ke admin';
}
