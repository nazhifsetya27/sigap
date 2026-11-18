/** Awal hari (00:00) pada zona waktu tertentu, sebagai epoch milidetik. */
export function startOfDay(now: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(now))) parts[p.type] = p.value;
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return now - (now % 1000) - seconds * 1000;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
