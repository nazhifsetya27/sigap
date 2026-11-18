const TZ = 'Asia/Jakarta';

export function idr(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}

/** Rupiah ringkas untuk kartu metrik: Rp6,84 jt atau Rp180 rb. */
export function idrShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jt`;
  if (abs >= 10_000) return `Rp${Math.round(value / 1000).toLocaleString('id-ID')} rb`;
  return idr(value);
}

export function clock(ts: number): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(ts))
    .replace(':', '.');
}

export function longDate(ts: number): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ts));
}

export function shortDate(ts: number): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(ts));
}

/** Waktu relatif singkat: "baru saja", "12 mnt", "3 jam", atau tanggal. */
export function ago(ts: number, now = Date.now()): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam`;
  return shortDate(ts);
}

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} menit`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

export function daysLabel(days: number): string {
  if (days >= 10) return `±${Math.round(days)} hari`;
  if (days >= 1) return `±${days.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`;
  const hours = Math.round(days * 24);
  return hours >= 1 ? `±${hours} jam` : 'kurang dari 1 jam';
}

export function seconds(value: number): string {
  if (value < 60) return `${Math.round(value)} dtk`;
  return `${(value / 60).toLocaleString('id-ID', { maximumFractionDigits: 1 })} mnt`;
}

export function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jt`;
  if (value >= 1000) return `${(value / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} rb`;
  return String(value);
}
