import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, hermesProfileDir } from '../config.js';
import { costUsd, type TokenUsage } from '../core/cost.js';

export interface RunResult {
  text: string;
  usage: TokenUsage;
  costUsd: number;
}

export function profileExists(profile: string): boolean {
  return fs.existsSync(path.join(hermesProfileDir(profile), 'config.yaml'));
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Baca berkas pemakaian yang ditulis `hermes --usage-file`, termasuk panggilan tambahan (mis. pembuatan judul). */
export function parseUsageFile(raw: string): { usage: TokenUsage; costUsd: number } {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  const aux = (data.auxiliary && typeof data.auxiliary === 'object' ? data.auxiliary : {}) as Record<string, unknown>;
  const usage: TokenUsage = {
    input: num(data.input_tokens) + num(aux.input_tokens),
    cached: num(data.cache_read_tokens) + num(aux.cache_read_tokens),
    output: num(data.output_tokens) + num(aux.output_tokens),
  };
  const reported = num(data.estimated_cost_usd) + num(aux.estimated_cost_usd);
  return { usage, costUsd: reported > 0 ? reported : costUsd(usage, config.cost.rates) };
}

/**
 * Jalankan satu perintah sekali-jalan pada sebuah profil Hermes dan kembalikan jawaban beserta biayanya.
 * Prompt dikirim sebagai argumen, tanpa shell, sehingga isi chat pelanggan tidak bisa menjadi perintah.
 */
export function runOneShot(profile: string, prompt: string, timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-run-'));
    const usageFile = path.join(dir, 'usage.json');
    const child = spawn(config.hermes.bin, ['-p', profile, '-z', prompt, '--usage-file', usageFile], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      fs.rm(dir, { recursive: true, force: true }, () => undefined);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`Hermes (${profile}) tidak selesai dalam ${Math.round(timeoutMs / 1000)} detik`)));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', (e) => finish(() => reject(new Error(`Tidak bisa menjalankan ${config.hermes.bin}: ${e.message}`))));
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`Hermes (${profile}) keluar dengan kode ${code}: ${(err || out).trim().slice(-300)}`));
          return;
        }
        let usageRaw = '';
        try {
          usageRaw = fs.readFileSync(usageFile, 'utf8');
        } catch {
          usageRaw = '';
        }
        resolve({ text: out.trim(), ...parseUsageFile(usageRaw) });
      });
    });
  });
}

export interface GatewayStatus {
  /** 'running' bila proses gateway hidup, 'stopped' bila tercatat mati, 'unknown' bila tidak terbaca. */
  gateway: 'running' | 'stopped' | 'unknown';
  /** Ada sesi WhatsApp tersimpan (sudah pernah scan QR). */
  whatsappPaired: boolean;
}

function readGatewayState(dir: string): 'running' | 'stopped' | 'unknown' {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'gateway_state.json'), 'utf8')) as Record<string, unknown>;
    const pid = typeof data.pid === 'number' ? data.pid : 0;
    if (pid > 0) {
      try {
        process.kill(pid, 0);
        return 'running';
      } catch {
        return 'stopped';
      }
    }
    return 'stopped';
  } catch {
    return 'unknown';
  }
}

export function gatewayStatus(profile: string): GatewayStatus {
  const dir = hermesProfileDir(profile);
  let gateway = readGatewayState(dir);
  // Profil bisa dilayani gateway profil default (mode multiplexer), jadi cek ke sana juga.
  if (gateway !== 'running' && readGatewayState(config.hermes.home) === 'running') gateway = 'running';
  const sessionDirs = [path.join(dir, 'platforms', 'whatsapp', 'session'), path.join(dir, 'whatsapp', 'session')];
  const whatsappPaired = sessionDirs.some((d) => {
    try {
      return fs.readdirSync(d).length > 0;
    } catch {
      return false;
    }
  });
  return { gateway, whatsappPaired };
}
