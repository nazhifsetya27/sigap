import type { Agent, AgentKey } from '../api';

const SHIRT: Record<AgentKey, string> = { echo: '#2CC7BF', tally: '#F5B83D', ping: '#7FB0FF' };

function stateWord(state: Agent['state']): string {
  return state === 'working' ? 'sedang bekerja' : state === 'idle' ? 'menunggu' : 'belum aktif';
}

/** Satu meja isometrik. Warna lampu dan gerak mengikuti status asli agent, tidak ada animasi hiasan. */
function Desk({ agent }: { agent: Agent }) {
  const shirt = SHIRT[agent.key];
  const live = agent.state === 'working';
  const lamp = live ? '#3DD68C' : '#93A1A8';
  const screen = agent.state === 'offline' ? '#3A474D' : live ? shirt : '#4A5A62';
  return (
    <svg viewBox="0 0 200 156" role="img" aria-label={`${agent.name} ${stateWord(agent.state)} di mejanya`}>
      <polygon points="100,50 186.6,100 100,150 13.4,100" fill="#141C1F" stroke="#26343A" strokeWidth="1" />
      <g className="bot">
        <rect x="125.4" y="38" width="22" height="44" rx="9" fill={shirt} />
        <rect x="133.4" y="30" width="6" height="9" fill="#93A1A8" />
        <rect x="126.4" y="12" width="20" height="19" rx="6" fill="#E8EEF0" />
        <circle cx="132.4" cy="21.5" r="1.8" fill="#0C1214" />
        <circle cx="140.4" cy="21.5" r="1.8" fill="#0C1214" />
        <line x1="136.4" y1="12" x2="136.4" y2="6" stroke="#93A1A8" strokeWidth="1.5" />
        <circle className="led" cx="136.4" cy="5" r="2.6" fill={lamp} />
      </g>
      <polygon points="91.3,45 143.3,75 117.3,90 65.4,60" fill="#33424A" />
      <polygon points="65.4,60 117.3,90 117.3,120 65.4,90" fill="#1B2529" />
      <polygon points="143.3,75 117.3,90 117.3,120 143.3,105" fill="#263238" />
      <polygon points="105.2,63 122.5,73 122.5,49 105.2,39" fill="#0C1214" stroke={screen} strokeWidth="1.5" />
      <circle className="led" cx="113.8" cy="58" r="1.7" fill={lamp} />
      {agent.key === 'tally' ? (
        <>
          <polygon points="115.6,75 124.2,80 115.6,85 107,80" fill="#E8EEF0" />
          <polygon points="115.6,73 124.2,78 115.6,83 107,78" fill={shirt} />
        </>
      ) : (
        <polygon points="115.6,77 122.5,81 115.6,85 108.7,81" fill={shirt} />
      )}
    </svg>
  );
}

function Avatar({ agentKey }: { agentKey: AgentKey }) {
  return (
    <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
      <rect x="1" y="1" width="34" height="34" rx="10" fill={SHIRT[agentKey]} />
      <rect x="9" y="11" width="18" height="15" rx="5" fill="#E8EEF0" />
      <circle cx="14.5" cy="18.5" r="1.7" fill="#0C1214" />
      <circle cx="21.5" cy="18.5" r="1.7" fill="#0C1214" />
    </svg>
  );
}

export function Office({ agents }: { agents: Agent[] }) {
  return (
    <>
      <div className="stations">
        {agents.map((a) => (
          <div key={a.key} className={`station ${a.state}`}>
            <div className="bubble" title={a.label}>
              <span className="dot" />
              <span>{a.label}</span>
            </div>
            <Desk agent={a} />
            <div>
              <div className="station-name">{a.name}</div>
              <div className="station-role">{a.role}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="agent-rows">
        {agents.map((a) => (
          <div key={a.key} className="agent-row">
            <Avatar agentKey={a.key} />
            <div className="who">
              <strong>
                {a.name} · {a.role}
              </strong>
              <span>{a.label}</span>
            </div>
            <span className={`dot ${a.state}`} />
            <span className="sr-only">{stateWord(a.state)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function officeSummary(agents: Agent[]): string {
  const working = agents.filter((a) => a.state === 'working').length;
  const idle = agents.filter((a) => a.state === 'idle').length;
  const offline = agents.filter((a) => a.state === 'offline').length;
  const parts = [`${agents.length} admin`, `${working} bekerja`, `${idle} menunggu`];
  if (offline > 0) parts.push(`${offline} belum aktif`);
  return parts.join(' · ');
}
