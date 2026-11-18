import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Folder Hermes tiruan harus sudah ditentukan sebelum konfigurasi dimuat.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-hermes-'));
process.env.HERMES_HOME = home;
process.env.ECHO_PROFILE = 'echo';
process.env.HERMES_SOURCES = 'whatsapp';

const { HermesSessionSource } = await import('../src/sources/hermes-sessions.js');
const { Store } = await import('../src/store.js');

const profileDir = path.join(home, 'profiles', 'echo');
const NOW = Date.UTC(2026, 10, 18, 5, 0, 0);
const sec = (ms: number) => ms / 1000;

function createHermesDb(extraColumns: boolean): DatabaseSync {
  fs.mkdirSync(profileDir, { recursive: true });
  const db = new DatabaseSync(path.join(profileDir, 'state.db'));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, chat_id TEXT, display_name TEXT,
      started_at REAL NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0
      ${extraColumns ? ', last_activity_at REAL, estimated_cost_usd REAL' : ''}
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL
    );
  `);
  return db;
}

describe('pembaca sesi Hermes', () => {
  let hermes: DatabaseSync;

  beforeAll(() => {
    hermes = createHermesDb(true);
    hermes
      .prepare(
        `INSERT INTO sessions (id, source, user_id, chat_id, display_name, started_at, last_activity_at, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('s1', 'whatsapp', '6281234567890@s.whatsapp.net', '6281234567890@s.whatsapp.net', 'Rina', sec(NOW - 60_000), sec(NOW - 50_000), 1000, 40, 0, 0.000174);
    hermes
      .prepare('INSERT INTO sessions (id, source, user_id, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?)')
      .run('s-cli', 'cli', 'owner', sec(NOW - 60_000), sec(NOW - 60_000));
    const add = hermes.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)');
    add.run('s1', 'user', 'kak gamis aluna ready?', sec(NOW - 60_000));
    add.run('s1', 'assistant', '', sec(NOW - 58_000));
    add.run('s1', 'tool', 'keluaran alat', sec(NOW - 57_000));
    add.run('s1', 'assistant', 'Ready kak, 189.000.', sec(NOW - 55_000));
    add.run('s-cli', 'user', 'pesan pribadi pemilik', sec(NOW - 60_000));
  });

  afterAll(() => {
    hermes.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('hanya mengambil chat WhatsApp, menyamarkan nomor, dan melewati pesan kosong atau pesan alat', () => {
    const store = new Store(':memory:');
    const source = new HermesSessionSource(store);
    const first = source.poll(NOW);
    expect(first).toMatchObject({ ok: true, sessions: 1, newMessages: 2 });

    const [conv] = store.listConversations();
    expect(conv).toMatchObject({ id: 'hermes:s1', customer_ref: '6281••••890', customer_name: 'Rina', message_count: 2 });
    expect(store.listMessages('hermes:s1').map((m) => [m.role, m.text])).toEqual([
      ['customer', 'kak gamis aluna ready?'],
      ['ai', 'Ready kak, 189.000.'],
    ]);
    expect(store.sumCost({ agent: 'echo' })).toBeCloseTo(0.000174, 9);
  });

  it('polling berulang tidak menggandakan pesan atau biaya, dan menangkap pesan baru', () => {
    const store = new Store(':memory:');
    const source = new HermesSessionSource(store);
    source.poll(NOW);
    expect(source.poll(NOW + 3000).newMessages).toBe(0);
    expect(store.sumCost()).toBeCloseTo(0.000174, 9);

    hermes.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run('s1', 'user', 'ongkir ke medan?', sec(NOW + 4000));
    hermes
      .prepare('UPDATE sessions SET last_activity_at = ?, input_tokens = 1200, cache_read_tokens = 900, estimated_cost_usd = 0.00021 WHERE id = ?')
      .run(sec(NOW + 4000), 's1');
    const next = source.poll(NOW + 6000);
    expect(next.newMessages).toBe(1);
    expect(store.getConversation('hermes:s1')!.message_count).toBe(3);
    expect(store.sumCost()).toBeCloseTo(0.00021, 9);
    expect(store.pendingReplies(NOW + 6000, 90_000)).toBe(1);
  });

  it('melaporkan masalah dengan jelas saat profil belum ada', () => {
    const store = new Store(':memory:');
    const source = new HermesSessionSource(store);
    fs.renameSync(path.join(profileDir, 'state.db'), path.join(profileDir, 'state.db.bak'));
    try {
      const result = source.poll(NOW);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('echo');
    } finally {
      fs.renameSync(path.join(profileDir, 'state.db.bak'), path.join(profileDir, 'state.db'));
    }
  });
});

describe('pembaca sesi Hermes versi lama', () => {
  it('tetap berjalan tanpa kolom biaya dan aktivitas, dengan menghitung biaya dari token', async () => {
    const oldHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-hermes-old-'));
    const dir = path.join(oldHome, 'profiles', 'echo');
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'state.db'));
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, started_at REAL NOT NULL,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL);
    `);
    db.prepare('INSERT INTO sessions (id, source, user_id, started_at, input_tokens, output_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      's9', 'whatsapp', '628999000111', sec(NOW - 1000), 17945, 60, 16313,
    );
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run('s9', 'user', 'halo', sec(NOW - 1000));
    db.close();

    const { config } = await import('../src/config.js');
    const original = config.hermes.home;
    config.hermes.home = oldHome;
    try {
      const store = new Store(':memory:');
      const result = new HermesSessionSource(store).poll(NOW);
      expect(result).toMatchObject({ ok: true, sessions: 1, newMessages: 1 });
      expect(store.sumCost()).toBeCloseTo(0.002776689, 9);
    } finally {
      config.hermes.home = original;
      fs.rmSync(oldHome, { recursive: true, force: true });
    }
  });
});
