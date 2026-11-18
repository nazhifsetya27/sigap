import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, Loading, PageHead } from '../components/bits';
import { idr, shortDate, tokens } from '../format';
import { projectionText } from './Home';

export function Costs() {
  const { data, error, isPending } = useQuery({ queryKey: ['costs'], queryFn: api.costs, refetchInterval: 5000 });
  if (isPending) {
    return (
      <>
        <PageHead title="Biaya AI" />
        <Loading rows={3} height={120} />
      </>
    );
  }
  if (!data) return <ErrorNote error={error} />;
  const proj = projectionText(data);
  const p = data.projection;
  const used = data.creditIdr > 0 ? Math.min(100, (data.spentIdr / data.creditIdr) * 100) : 0;
  const maxDay = Math.max(1, ...data.daily.map((d) => d.idr));
  const totalTokens = data.tokens.input + data.tokens.cached + data.tokens.output;
  const cachedShare = totalTokens > 0 ? Math.round((data.tokens.cached / totalTokens) * 100) : 0;
  return (
    <>
      <PageHead title="Biaya AI" sub={`${data.provider} · ${data.model}`}>
        {data.demo ? <span className="pill demo">Data contoh, bukan hasil ukur</span> : null}
        <Link to="/pengaturan" className="btn">
          Ubah saldo dan asumsi
        </Link>
      </PageHead>
      <div className="grid-2">
        <section className="card" aria-label="Sisa gaji">
          <div className="card-head">
            <h2>Sisa gaji admin AI</h2>
          </div>
          <div className="cost-top">
            <div>
              <div className="cost-big">{idr(data.remainingIdr)}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                dari saldo {idr(data.creditIdr)}
              </div>
            </div>
            <div className="projection">
              <strong>{proj.title}</strong>
              <span>{proj.note}</span>
            </div>
          </div>
          <div className="meter" role="img" aria-label={`Saldo terpakai ${Math.round(used)} persen`}>
            <i style={{ width: `${used}%` }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="stat-line">
              <span className="muted">Terpakai hari ini</span>
              <strong>{idr(data.todayIdr)}</strong>
            </div>
            <div className="stat-line">
              <span className="muted">Terpakai sejak saldo dicatat</span>
              <strong>{idr(data.spentIdr)}</strong>
            </div>
            <div className="stat-line">
              <span className="muted">Rata-rata per percakapan, ketiga admin</span>
              <strong>{p.avgPerConversationIdr === null ? '–' : idr(p.avgPerConversationIdr)}</strong>
            </div>
          </div>
        </section>

        <section className="card" aria-label="Cara proyeksi dihitung">
          <div className="card-head">
            <h2>Cara angka ini dihitung</h2>
          </div>
          <ol className="steps">
            <li>
              Biaya ketiga admin dijumlahkan, lalu dibagi <strong>{p.basisConversations.toLocaleString('id-ID')}</strong> percakapan yang sudah terukur.
            </li>
            <li>
              Hasilnya dikalikan asumsi <strong>{p.chatsPerDay.toLocaleString('id-ID')} chat per hari</strong>.
            </li>
            <li>Sisa saldo dibagi biaya per hari itu. Hasilnya perkiraan, bukan janji.</li>
          </ol>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Makin sedikit percakapan terukur, makin kasar perkiraannya. Biaya pesan WhatsApp dari Meta, bila Anda memakai API resmi, belum termasuk.
          </p>
        </section>
      </div>

      <div className="grid-2">
        <section className="card" aria-label="Biaya per admin">
          <div className="card-head">
            <h2>Biaya per admin</h2>
            <span className="muted">sepanjang waktu</span>
          </div>
          {(['echo', 'tally', 'ping'] as const).map((key) => {
            const value = data.totalByAgent[key];
            const share = data.totalIdr > 0 ? (value / data.totalIdr) * 100 : 0;
            const name = data.perAgent.find((a) => a.key === key)?.name ?? key;
            return (
              <div key={key} className="agent-cost">
                <span className="name">{name}</span>
                <span className="meter small">
                  <i style={{ width: `${share}%`, background: `var(--${key}-dot)` }} />
                </span>
                <span className="amount">{idr(value)}</span>
              </div>
            );
          })}
          <div className="stat-line" style={{ marginTop: 8 }}>
            <span className="muted">Total</span>
            <strong>{idr(data.totalIdr)}</strong>
          </div>
        </section>

        <section className="card" aria-label="Pemakaian token">
          <div className="card-head">
            <h2>Token terpakai</h2>
            <span className="muted">{cachedShare}% dari cache</span>
          </div>
          <div className="stat-line">
            <span>Input baru</span>
            <span>
              <strong>{tokens(data.tokens.input)}</strong> <span className="muted">· US${data.rates.input} per 1 jt</span>
            </span>
          </div>
          <div className="stat-line">
            <span>Input dari cache</span>
            <span>
              <strong>{tokens(data.tokens.cached)}</strong> <span className="muted">· US${data.rates.cached} per 1 jt</span>
            </span>
          </div>
          <div className="stat-line">
            <span>Output</span>
            <span>
              <strong>{tokens(data.tokens.output)}</strong> <span className="muted">· US${data.rates.output} per 1 jt</span>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Kurs yang dipakai Rp{Math.round(data.idrPerUsd).toLocaleString('id-ID')} per US$1.
          </p>
        </section>
      </div>

      <section className="card" aria-label="Biaya 14 hari terakhir">
        <div className="card-head">
          <h2>Biaya 14 hari terakhir</h2>
        </div>
        {data.daily.length === 0 ? (
          <p className="muted">Belum ada biaya tercatat.</p>
        ) : (
          <div className="bars" role="img" aria-label="Grafik batang biaya harian">
            {data.daily.map((d) => (
              <div key={d.day} className="bar" title={`${shortDate(d.day)}: ${idr(d.idr)}`}>
                <span>{idr(d.idr)}</span>
                <i style={{ height: `${Math.max(2, (d.idr / maxDay) * 80)}%` }} />
                <span>{shortDate(d.day)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
