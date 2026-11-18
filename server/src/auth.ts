import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SESSION_DAYS = 7;
export const SESSION_COOKIE = 'sigap_session';

/** Baca rahasia dari berkas di folder data, atau buat baru bila belum ada. Berkas hanya bisa dibaca pemiliknya. */
function secretFile(name: string): string {
  const file = path.join(config.dataDir, name);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // belum ada
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const value = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
  return value;
}

let sessionSecret: string | null = null;
let ingestToken: string | null = null;

export function getIngestToken(): string {
  ingestToken ??= secretFile('ingest.token');
  return ingestToken;
}

function sign(payload: string): string {
  sessionSecret ??= secretFile('session.secret');
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function authRequired(): boolean {
  return config.accessCode.length > 0;
}

export function createSession(now: number): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86_400;
  const expires = String(now + maxAge * 1000);
  return { value: `${expires}.${sign(expires)}`, maxAge };
}

export function validSession(cookie: string | undefined, now: number): boolean {
  if (!cookie) return false;
  const [expires, mac] = cookie.split('.');
  if (!expires || !mac) return false;
  if (!safeEqual(mac, sign(expires))) return false;
  return Number(expires) > now;
}

/** Pembatas percobaan login: setelah 5 kali salah dari satu alamat, jeda makin lama hingga 5 menit. */
export class LoginLimiter {
  private fails = new Map<string, { count: number; until: number }>();

  retryAfterMs(ip: string, now: number): number {
    const entry = this.fails.get(ip);
    return entry && entry.until > now ? entry.until - now : 0;
  }

  fail(ip: string, now: number): void {
    const entry = this.fails.get(ip) ?? { count: 0, until: 0 };
    entry.count++;
    if (entry.count >= 5) entry.until = now + Math.min(300_000, 1000 * 2 ** (entry.count - 5));
    this.fails.set(ip, entry);
  }

  success(ip: string): void {
    this.fails.delete(ip);
  }
}
