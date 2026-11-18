import { Link } from 'react-router-dom';
import type { Overview } from '../api';
import { ErrorNote, Loading, Num, PageHead } from '../components/bits';
import { ChevronRight, WalletIcon } from '../components/icons';
import { useOverview } from '../components/Layout';
import { Office, officeSummary } from '../components/Office';
import { clock, daysLabel, idr, idrShort, longDate, minutesLabel, seconds } from '../format';

const int = (n: number) => Math.round(n).toLocaleString('id-ID');

function countTone(count: number, tone: 'danger' | 'warn' | 'info'): string {
  return `action-count ${count === 0 ? 'zero' : tone}`;
}

function Actions({ a }: { a: Overview['actions'] }) {
  const waitingNote =
    a.waitingHuman.count === 0
      ? 'Semua chat ditangani AI'
      : a.waitingHuman.oldestMinutes === null
        ? 'Menunggu Anda'
        : `Terlama sudah ${minutesLabel(a.waitingHuman.oldestMinutes)}`;
  const unpaidNote =
    a.unpaid.count === 0
      ? 'Tidak ada tagihan terbuka'
      : a.unpaid.expiringSoon > 0
        ? `${a.unpaid.expiringSoon} hampir lewat batas keep`
        : `Senilai ${idrShort(a.unpaid.totalIdr)}`;
  return (
    <section aria-label="Perlu tindakan">
      <h2 className="section-title">Perlu tindakan</h2>
      <div className="actions">
        <Link to="/chat?status=needs_human" className="action">
          <span className={countTone(a.waitingHuman.count, 'danger')}>{a.waitingHuman.count}</span>
          <span className="action-body">
            <strong>Chat menunggu admin</strong>
            <span>{waitingNote}</span>
          </span>
          <ChevronRight />
        </Link>
        <Link to="/tagihan" className="action">
          <span className={countTone(a.unpaid.count, 'warn')}>{a.unpaid.count}</span>
          <span className="action-body">
            <strong>Pesanan belum bayar</strong>
            <span>{unpaidNote}</span>
          </span>
          <ChevronRight />
        </Link>
        <Link to="/tagihan" className="action">
          <span className={countTone(a.followupDrafts.count, 'info')}>{a.followupDrafts.count}</span>
          <span className="action-body">
            <strong>Pengingat siap dikirim</strong>
            <span>{a.followupDrafts.count === 0 ? 'Belum ada draf dari Ping' : 'Ditulis Ping, tinggal Anda kirim'}</span>
          </span>
          <ChevronRight />
        </Link>
      </div>
    </section>
  );
}

function Kpis({ k }: { k: Overview['kpi'] }) {
  const delta = k.chatsDeltaPct;
  return (
    <section className="kpis narrow" aria-label="Metrik toko hari ini">
      <div className="kpi">
        <span className="kpi-label">Chat masuk</span>
        <span className="kpi-value">
          <Num value={k.chats} format={int} />
        </span>
        <span className={`kpi-note ${delta === null ? '' : delta >= 0 ? 'up' : 'down'}`}>
          {delta === null ? 'Belum ada pembanding kemarin' : `${delta >= 0 ? 'Naik' : 'Turun'} ${Math.abs(delta)}% dari kemarin`}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Dibalas AI</span>
        <span className="kpi-value">{k.aiHandledPct === null ? '–' : `${k.aiHandledPct}%`}</span>
        <span className="kpi-note">{k.handoffs === 0 ? 'Belum ada yang dioper' : `${k.handoffs} dioper ke admin`}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Order terekap</span>
        <span className="kpi-value">
          <Num value={k.orders} format={int} />
        </span>
        <span className={`kpi-note ${k.ordersDelta > 0 ? 'up' : k.ordersDelta < 0 ? 'down' : ''}`}>
          {k.ordersDelta === 0 ? 'Sama dengan kemarin' : `${k.ordersDelta > 0 ? 'Naik' : 'Turun'} ${Math.abs(k.ordersDelta)} dari kemarin`}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Omzet terekap</span>
        <span className="kpi-value">
          <Num value={k.revenueIdr} format={idrShort} />
        </span>
        <span className="kpi-note">{k.avgOrderIdr === null ? 'Belum ada order' : `Rata-rata ${idrShort(k.avgOrderIdr)} per order`}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Belum bayar</span>
        <span className="kpi-value">
          <Num value={k.unpaidCount} format={int} />
        </span>
        <span className={`kpi-note ${k.unpaidCount > 0 ? 'warn' : ''}`}>
          {k.unpaidCount > 0 ? `Senilai ${idrShort(k.unpaidIdr)}` : 'Semua lunas'}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Waktu respons</span>
        <span className="kpi-value">{k.firstReplySeconds === null ? '–' : seconds(k.firstReplySeconds)}</span>
        <span className="kpi-note">Rata-rata balasan pertama</span>
      </div>
    </section>
  );
}

export function projectionText(c: Overview['cost']): { title: string; note: string } {
  const p = c.projection;
  if (p.days === null) {
    return {
      title: 'Belum cukup data',
      note: `Butuh minimal 3 percakapan terukur, baru ada ${p.basisConversations}`,
    };
  }
  return { title: `Kuat ${daysLabel(p.days)}`, note: `dengan ${p.chatsPerDay.toLocaleString('id-ID')} chat per hari` };
}

function CostCard({ c }: { c: Overview['cost'] }) {
  const used = c.creditIdr > 0 ? Math.min(100, (c.spentIdr / c.creditIdr) * 100) : 0;
  const proj = projectionText(c);
  return (
    <section className="card narrow" aria-label="Gaji admin AI">
      <div className="card-head">
        <h2>Gaji admin AI</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {c.provider} · {c.model.split('/').pop()}
        </span>
      </div>
      <div className="cost-top">
        <div>
          <div className="cost-big">
            <Num value={c.todayIdr} format={idr} />
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            terpakai hari ini
          </div>
        </div>
        <div className="projection">
          <strong>{proj.title}</strong>
          <span>{proj.note}</span>
        </div>
      </div>
      <div className="meter-label">
        <span className="muted">Saldo terpakai</span>
        <strong>
          {idr(c.spentIdr)} dari {idr(c.creditIdr)}
        </strong>
      </div>
      <div className="meter" role="img" aria-label={`Saldo terpakai ${Math.round(used)} persen`}>
        <i style={{ width: `${used}%` }} />
      </div>
      <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        {c.perAgent.map((a) => (
          <div key={a.key} className="agent-cost">
            <span className="name">{a.name}</span>
            <span className="meter small">
              <i style={{ width: `${Math.round(a.share * 100)}%`, background: `var(--${a.key}-dot)` }} />
            </span>
            <span className="amount">{idr(a.idr)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Feed({ feed }: { feed: Overview['feed'] }) {
  return (
    <section className="card wide" aria-label="Aktivitas langsung">
      <div className="card-head">
        <h2>Aktivitas langsung</h2>
        <Link to="/chat" className="link">
          Lihat semua
        </Link>
      </div>
      {feed.length === 0 ? (
        <p className="muted" style={{ padding: '16px 0' }}>
          Belum ada aktivitas. Begitu ada chat masuk, kerja tiap admin muncul di sini.
        </p>
      ) : (
        feed.map((f) => (
          <div key={f.id} className="feed-row">
            <span className="feed-time">{clock(f.ts)}</span>
            <span className="feed-agent">
              <span className={`dot ${f.agent}`} />
              {f.agentName}
            </span>
            <span className="feed-text">
              {f.text}
              {f.needsHuman ? <span className="needs-you"> · perlu Anda</span> : null}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

export function Home() {
  const { data, error, isPending } = useOverview();
  if (isPending) {
    return (
      <>
        <PageHead title="Beranda" />
        <Loading rows={4} height={90} />
      </>
    );
  }
  if (!data) return <ErrorNote error={error} />;
  const conn = data.connection;
  const proj = data.cost.projection;
  return (
    <>
      <PageHead title="Beranda" sub={`${longDate(data.updatedAt)} · diperbarui ${clock(data.updatedAt)}`}>
        {data.demo ? <span className="pill demo">Data contoh, bukan hasil ukur</span> : null}
        <span className="pill">
          <span className={`dot ${conn.state}`} />
          {conn.label}
        </span>
        <Link to="/biaya" className="salary-pill">
          <WalletIcon />
          <span>
            Sisa gaji {idr(data.cost.remainingIdr)}
            {proj.days !== null ? ` · kuat ${daysLabel(proj.days)}` : ''}
          </span>
        </Link>
      </PageHead>
      {error ? <ErrorNote error={error} /> : null}
      {conn.problem ? (
        <div className="banner" role="alert">
          Sumber data bermasalah: {conn.problem}. <Link to="/pengaturan" className="link" style={{ minHeight: 0 }}>Lihat cara memasang</Link>
        </div>
      ) : null}
      <Actions a={data.actions} />
      <div className="row-split">
        <section className="stage wide" aria-label="Kantor AI">
          <div className="stage-head">
            <h2>Kantor AI</h2>
            <span className="muted">{officeSummary(data.agents)}</span>
            <Link to="/kantor" className="stage-btn">
              Buka kantor
            </Link>
          </div>
          <Office agents={data.agents} />
        </section>
        <Kpis k={data.kpi} />
      </div>
      <div className="row-split">
        <Feed feed={data.feed} />
        <CostCard c={data.cost} />
      </div>
    </>
  );
}
