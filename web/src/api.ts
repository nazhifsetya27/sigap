export type AgentKey = 'echo' | 'tally' | 'ping';
export type AgentState = 'working' | 'idle' | 'offline';
export type ConvStatus = 'ai' | 'needs_human' | 'done';
export type PaymentStatus = 'unpaid' | 'paid' | 'cancelled';
export type FollowupStatus = 'draft' | 'sent' | 'skipped';

export interface Agent {
  key: AgentKey;
  name: string;
  role: string;
  state: AgentState;
  label: string;
}

export interface CostSummary {
  provider: string;
  model: string;
  idrPerUsd: number;
  creditIdr: number;
  spentIdr: number;
  remainingIdr: number;
  todayIdr: number;
  perAgent: { key: AgentKey; name: string; idr: number; share: number }[];
  projection: { days: number | null; chatsPerDay: number; basisConversations: number; avgPerConversationIdr: number | null };
}

export interface Overview {
  demo: boolean;
  storeName: string;
  updatedAt: number;
  connection: { mode: 'demo' | 'qr' | 'api'; state: 'connected' | 'disconnected' | 'unknown'; label: string; problem: string | null };
  actions: {
    waitingHuman: { count: number; oldestMinutes: number | null };
    unpaid: { count: number; totalIdr: number; expiringSoon: number; nextKeepMinutes: number | null };
    followupDrafts: { count: number };
  };
  agents: Agent[];
  kpi: {
    chats: number;
    chatsDeltaPct: number | null;
    aiHandledPct: number | null;
    handoffs: number;
    orders: number;
    ordersDelta: number;
    revenueIdr: number;
    avgOrderIdr: number | null;
    unpaidCount: number;
    unpaidIdr: number;
    firstReplySeconds: number | null;
  };
  cost: CostSummary;
  feed: { id: number; ts: number; agent: AgentKey; agentName: string; text: string; needsHuman: boolean }[];
}

export interface ConversationListItem {
  id: string;
  customerRef: string;
  customerName: string | null;
  status: ConvStatus;
  reason: string | null;
  summary: string | null;
  lastMessageAt: number;
  messageCount: number;
  preview: { role: 'customer' | 'ai' | 'human'; text: string } | null;
}

export interface ConversationDetail {
  conversation: {
    id: string;
    customerRef: string;
    customerName: string | null;
    status: ConvStatus;
    reason: string | null;
    summary: string | null;
    startedAt: number;
    lastMessageAt: number;
  };
  messages: { id: string; role: 'customer' | 'ai' | 'human'; text: string; ts: number }[];
}

export interface Order {
  id: number;
  code: string;
  conversationId: string;
  customerRef: string;
  customerName: string | null;
  items: { name: string; variant: string | null; qty: number; price_idr: number | null }[];
  totalIdr: number;
  paymentMethod: string | null;
  paymentStatus: PaymentStatus;
  createdAt: number;
  keepUntil: number | null;
}

export interface Followup {
  id: number;
  orderCode: string;
  customerRef: string;
  customerName: string | null;
  totalIdr: number;
  text: string;
  status: FollowupStatus;
  createdAt: number;
}

export interface Costs extends CostSummary {
  demo: boolean;
  rates: { input: number; cached: number; output: number };
  tokens: { input: number; cached: number; output: number };
  totalIdr: number;
  totalByAgent: Record<AgentKey, number>;
  daily: { day: number; idr: number; tokens: number }[];
}

export interface Settings {
  creditUsd: number;
  creditSince: number;
  idrPerUsd: number;
  chatsPerDay: number;
  storeName: string;
  timeZone: string;
  dataSource: 'demo' | 'hermes';
}

export interface Session {
  authRequired: boolean;
  authenticated: boolean;
  dataSource: 'demo' | 'hermes';
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'sigap', ...init?.headers },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Tidak bisa menghubungi server', 0);
  }
  if (res.status === 401 && path !== '/api/login') {
    window.dispatchEvent(new Event('sigap:unauthorized'));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Permintaan gagal (${res.status})`, res.status);
  return data as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  session: () => request<Session>('/api/session'),
  login: (code: string) => post<{ ok: true }>('/api/login', { code }),
  logout: () => post<{ ok: true }>('/api/logout', {}),
  overview: () => request<Overview>('/api/overview'),
  conversations: (status?: ConvStatus) =>
    request<{ conversations: ConversationListItem[] }>(`/api/conversations${status ? `?status=${status}` : ''}`),
  conversation: (id: string) => request<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`),
  setConversationStatus: (id: string, status: ConvStatus) =>
    post<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}/status`, { status }),
  orders: (payment?: PaymentStatus) => request<{ orders: Order[] }>(`/api/orders${payment ? `?payment=${payment}` : ''}`),
  setOrderPayment: (id: number, status: PaymentStatus) => post<{ ok: true }>(`/api/orders/${id}/payment`, { status }),
  followups: () => request<{ followups: Followup[] }>('/api/followups'),
  setFollowupStatus: (id: number, status: FollowupStatus) => post<{ ok: true }>(`/api/followups/${id}/status`, { status }),
  costs: () => request<Costs>('/api/costs'),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Pick<Settings, 'creditUsd' | 'idrPerUsd' | 'chatsPerDay' | 'storeName'>>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
};
