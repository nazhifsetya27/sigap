export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
}

export interface Rates {
  /** USD per 1 juta token. */
  input: number;
  cached: number;
  output: number;
}

/** Biaya USD dari jumlah token. `input` adalah input yang TIDAK ter-cache. */
export function costUsd(usage: TokenUsage, rates: Rates): number {
  return (usage.input * rates.input + usage.cached * rates.cached + usage.output * rates.output) / 1_000_000;
}

export interface ProjectionInput {
  /** Saldo kredit pada titik acuan. */
  creditUsd: number;
  /** Biaya sejak titik acuan saldo. */
  spentSinceCreditUsd: number;
  /** Biaya seluruh agent sepanjang waktu, untuk menghitung rata-rata per percakapan. */
  totalSpentUsd: number;
  /** Jumlah percakapan yang biayanya terukur. */
  measuredConversations: number;
  /** Asumsi jumlah percakapan per hari. */
  chatsPerDay: number;
}

export interface Projection {
  remainingUsd: number;
  /** Biaya semua agent dibagi jumlah percakapan terukur. null bila belum ada data. */
  avgPerConversationUsd: number | null;
  /** Perkiraan hari sampai saldo habis. null bila data belum cukup. */
  days: number | null;
  chatsPerDay: number;
  basisConversations: number;
}

/** Minimal percakapan terukur sebelum proyeksi ditampilkan. */
export const MIN_PROJECTION_BASIS = 3;

export function project(input: ProjectionInput): Projection {
  const remainingUsd = Math.max(0, input.creditUsd - input.spentSinceCreditUsd);
  const avg = input.measuredConversations > 0 ? input.totalSpentUsd / input.measuredConversations : null;
  let days: number | null = null;
  if (avg !== null && avg > 0 && input.chatsPerDay > 0 && input.measuredConversations >= MIN_PROJECTION_BASIS) {
    days = remainingUsd / (avg * input.chatsPerDay);
  }
  return {
    remainingUsd,
    avgPerConversationUsd: avg,
    days,
    chatsPerDay: input.chatsPerDay,
    basisConversations: input.measuredConversations,
  };
}
