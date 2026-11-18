import { AGENTS, config, type AgentKey } from './config.js';
import { project } from './core/cost.js';
import { DAY, HOUR, MINUTE, startOfDay } from './core/time.js';
import type { StatusProvider } from './status.js';
import type { Store } from './store.js';

export interface CostSettings {
  creditUsd: number;
  creditSince: number;
  idrPerUsd: number;
  chatsPerDay: number;
  storeName: string;
}

export function readSettings(store: Store): CostSettings {
  return {
    creditUsd: store.getNumberSetting('credit_usd', config.cost.creditUsd),
    creditSince: store.getNumberSetting('credit_since', 0),
    idrPerUsd: store.getNumberSetting('idr_per_usd', config.cost.idrPerUsd),
    chatsPerDay: store.getNumberSetting('chats_per_day', config.cost.chatsPerDay),
    storeName: store.getSetting('store_name') ?? config.storeName,
  };
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const AGENT_KEYS: AgentKey[] = ['echo', 'tally', 'ping'];

export function buildCost(store: Store, now: number) {
  const s = readSettings(store);
  const today = startOfDay(now, config.timeZone);
  const idr = (usd: number) => usd * s.idrPerUsd;
  const totalSpent = store.sumCost();
  const spentSinceCredit = store.sumCost({ since: s.creditSince });
  const todaySpent = store.sumCost({ since: today });
  const byAgentToday = store.costByAgent(today);
  const proj = project({
    creditUsd: s.creditUsd,
    spentSinceCreditUsd: spentSinceCredit,
    totalSpentUsd: totalSpent,
    measuredConversations: store.measuredConversations(),
    chatsPerDay: s.chatsPerDay,
  });
  return {
    provider: config.cost.providerName,
    model: config.cost.providerModel,
    idrPerUsd: s.idrPerUsd,
    creditIdr: idr(s.creditUsd),
    spentIdr: idr(spentSinceCredit),
    remainingIdr: idr(proj.remainingUsd),
    todayIdr: idr(todaySpent),
    perAgent: AGENT_KEYS.map((key) => ({
      key,
      name: AGENTS[key].name,
      idr: idr(byAgentToday[key]),
      share: todaySpent > 0 ? byAgentToday[key] / todaySpent : 0,
    })),
    projection: {
      days: proj.days,
      chatsPerDay: proj.chatsPerDay,
      basisConversations: proj.basisConversations,
      avgPerConversationIdr: proj.avgPerConversationUsd === null ? null : idr(proj.avgPerConversationUsd),
    },
  };
}

export function buildOverview(store: Store, provider: StatusProvider, now: number) {
  const s = readSettings(store);
  const today = startOfDay(now, config.timeZone);
  const end = now + 1;

  const chats = store.countChats(today, end);
  const chatsPrev = store.countChats(today - DAY, now - DAY);
  const escalated = Math.min(chats, store.countEscalated(today, end));
  const orders = store.orderStats(today, end);
  const ordersPrev = store.orderStats(today - DAY, now - DAY);
  const unpaid = store.unpaidStats(now, HOUR);
  const waiting = store.waitingHuman();
  const firstReply = store.avgFirstReplySeconds(today, end);
  const states = provider.agentStates(now);
  const connection = provider.connection(now);

  return {
    demo: connection.mode === 'demo',
    storeName: s.storeName,
    updatedAt: now,
    connection,
    actions: {
      waitingHuman: {
        count: waiting.count,
        oldestMinutes: waiting.oldestAt === null ? null : Math.max(0, Math.round((now - waiting.oldestAt) / MINUTE)),
      },
      unpaid: {
        count: unpaid.count,
        totalIdr: unpaid.total,
        expiringSoon: unpaid.expiringSoon,
        nextKeepMinutes: unpaid.nextKeepUntil === null ? null : Math.max(0, Math.round((unpaid.nextKeepUntil - now) / MINUTE)),
      },
      followupDrafts: { count: store.draftFollowups() },
    },
    agents: AGENT_KEYS.map((key) => ({ key, name: AGENTS[key].name, role: AGENTS[key].role, ...states[key] })),
    kpi: {
      chats,
      chatsDeltaPct: deltaPct(chats, chatsPrev),
      aiHandledPct: chats > 0 ? Math.round(((chats - escalated) / chats) * 100) : null,
      handoffs: escalated,
      orders: orders.count,
      ordersDelta: orders.count - ordersPrev.count,
      revenueIdr: orders.revenue,
      avgOrderIdr: orders.count > 0 ? orders.revenue / orders.count : null,
      unpaidCount: unpaid.count,
      unpaidIdr: unpaid.total,
      firstReplySeconds: firstReply,
    },
    cost: buildCost(store, now),
    feed: store.recentEvents(8).map((e) => ({
      id: e.id,
      ts: e.ts,
      agent: e.agent,
      agentName: AGENTS[e.agent]?.name ?? e.agent,
      text: e.text,
      needsHuman: e.needs_human === 1,
    })),
  };
}
