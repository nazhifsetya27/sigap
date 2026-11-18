import os from 'node:os';
import path from 'node:path';

try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  // .env opsional: semua nilai punya bawaan.
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function expandHome(p: string): string {
  return path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
}

export type DataSource = 'demo' | 'hermes';
export type AgentKey = 'echo' | 'tally' | 'ping';

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: num(process.env.PORT, 4310),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  dataSource: (process.env.DATA_SOURCE === 'hermes' ? 'hermes' : 'demo') as DataSource,
  accessCode: process.env.ACCESS_CODE ?? '',
  storeName: process.env.STORE_NAME ?? 'Toko Anda',
  timeZone: process.env.TIMEZONE ?? 'Asia/Jakarta',
  hermes: {
    home: expandHome(process.env.HERMES_HOME ?? '~/.hermes'),
    bin: process.env.HERMES_BIN ?? 'hermes',
    sources: (process.env.HERMES_SOURCES ?? 'whatsapp,whatsapp_cloud')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    profiles: {
      echo: process.env.ECHO_PROFILE ?? 'echo',
      tally: process.env.TALLY_PROFILE ?? 'tally',
      ping: process.env.PING_PROFILE ?? 'ping',
    } satisfies Record<AgentKey, string>,
  },
  cost: {
    creditUsd: num(process.env.CREDIT_USD, 1.09),
    idrPerUsd: num(process.env.IDR_PER_USD, 18349),
    chatsPerDay: num(process.env.CHATS_PER_DAY, 200),
    rates: {
      input: num(process.env.RATE_INPUT, 0.15),
      cached: num(process.env.RATE_CACHED, 0.003),
      output: num(process.env.RATE_OUTPUT, 0.6),
    },
    providerName: process.env.PROVIDER_NAME ?? 'Fenrir',
    providerModel: process.env.PROVIDER_MODEL ?? 'deepseek/deepseek-v4.1-flash',
  },
};

export const AGENTS: Record<AgentKey, { name: string; role: string }> = {
  echo: { name: 'Echo', role: 'CS WhatsApp' },
  tally: { name: 'Tally', role: 'Rekap order' },
  ping: { name: 'Ping', role: 'Follow-up tagihan' },
};

/** Folder profil Hermes. Profil "default" tinggal di HERMES_HOME itu sendiri. */
export function hermesProfileDir(profile: string): string {
  return profile === 'default' ? config.hermes.home : path.join(config.hermes.home, 'profiles', profile);
}
