import type { AgentKey } from '../api';
import { ErrorNote, Loading, PageHead } from '../components/bits';
import { useOverview } from '../components/Layout';
import { Office, officeSummary } from '../components/Office';
import { idr } from '../format';

const JOBS: Record<AgentKey, string> = {
  echo: 'Menjawab chat pelanggan di WhatsApp dari katalog dan aturan toko. Komplain dan retur diteruskan ke Anda.',
  tally: 'Merekap pesanan dari chat yang berakhir dengan order. Chat tanpa order tidak ia sentuh, jadi tidak ada token terbuang.',
  ping: 'Menulis draf pengingat untuk pesanan yang belum dibayar. Pengirimannya tetap di tangan Anda.',
};

const STATE_LABEL = { working: 'Bekerja', idle: 'Menunggu', offline: 'Belum aktif' } as const;

export function OfficePage() {
  const { data, error, isPending } = useOverview();
  if (isPending) {
    return (
      <>
        <PageHead title="Kantor AI" />
        <Loading rows={2} height={220} />
      </>
    );
  }
  if (!data) return <ErrorNote error={error} />;
  return (
    <>
      <PageHead title="Kantor AI" sub={officeSummary(data.agents)}>
        {data.demo ? <span className="pill demo">Data contoh, bukan hasil ukur</span> : null}
      </PageHead>
      <section className="stage" aria-label="Kantor AI">
        <Office agents={data.agents} />
      </section>
      <div className="grid-2">
        {data.agents.map((a) => {
          const cost = data.cost.perAgent.find((c) => c.key === a.key);
          return (
            <section key={a.key} className="card" aria-label={a.name}>
              <div className="card-head">
                <h2>
                  {a.name} · {a.role}
                </h2>
                <span className={`status ${a.state === 'working' ? 'paid' : a.state === 'idle' ? 'ai' : 'cancelled'}`}>
                  {STATE_LABEL[a.state]}
                </span>
              </div>
              <p>{JOBS[a.key]}</p>
              <div className="stat-line" style={{ marginTop: 10 }}>
                <span className="muted">Sedang apa</span>
                <strong>{a.label}</strong>
              </div>
              <div className="stat-line">
                <span className="muted">Biaya hari ini</span>
                <strong>{idr(cost?.idr ?? 0)}</strong>
              </div>
            </section>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Gerak dan lampu di kantor mengikuti status asli tiap admin. Admin yang diam berarti memang sedang tidak ada pekerjaan.
      </p>
    </>
  );
}
