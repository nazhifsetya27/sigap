import type { AgentKey } from './config.js';

export type AgentState = 'working' | 'idle' | 'offline';

export interface AgentStatus {
  state: AgentState;
  label: string;
}

export interface ConnectionStatus {
  /** demo = data contoh, qr = WhatsApp lewat tautan perangkat, api = WhatsApp Cloud API resmi. */
  mode: 'demo' | 'qr' | 'api';
  state: 'connected' | 'disconnected' | 'unknown';
  label: string;
  /** Pesan masalah pada sumber data, bila ada. */
  problem: string | null;
}

/** Apa pun yang menggerakkan portal (data contoh atau Hermes) melaporkan statusnya lewat antarmuka ini. */
export interface StatusProvider {
  agentStates(now: number): Record<AgentKey, AgentStatus>;
  connection(now: number): ConnectionStatus;
}

export function clock(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(ts))
    .replace(':', '.');
}
