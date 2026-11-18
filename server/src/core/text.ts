/** Samarkan nomor pelanggan untuk tampilan: 6281234567890 menjadi 6281••••890. */
export function maskCustomer(raw: string): string {
  const local = raw.replace(/@.*/, '');
  const digits = local.replace(/\D/g, '');
  if (digits.length >= 8) return `${digits.slice(0, 4)}••••${digits.slice(-3)}`;
  return local.slice(0, 16) || 'Pelanggan';
}

/** Ambil objek atau array JSON pertama dari jawaban model yang mungkin berisi teks lain. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced?.[1] ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const open = candidate[start];
    const close = open === '{' ? '}' : ']';
    const end = candidate.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

export function formatIdr(idr: number): string {
  return `Rp${Math.round(idr).toLocaleString('id-ID')}`;
}
