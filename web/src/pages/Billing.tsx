import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type FollowupStatus } from '../api';
import { Empty, ErrorNote, Loading, PageHead } from '../components/bits';
import { ago, idr, minutesLabel } from '../format';
import { itemsText, usePaymentMutation } from './Orders';

const FOLLOWUP_LABEL: Record<FollowupStatus, string> = { draft: 'Draf', sent: 'Terkirim', skipped: 'Dilewati' };

function keepText(keepUntil: number | null): { text: string; late: boolean } {
  if (keepUntil === null) return { text: 'Tanpa batas keep', late: false };
  const minutes = Math.round((keepUntil - Date.now()) / 60_000);
  if (minutes <= 0) return { text: `Lewat batas keep ${minutesLabel(-minutes)}`, late: true };
  return { text: `Keep sisa ${minutesLabel(minutes)}`, late: minutes <= 60 };
}

export function Billing() {
  const qc = useQueryClient();
  const orders = useQuery({ queryKey: ['orders', 'unpaid'], queryFn: () => api.orders('unpaid'), refetchInterval: 5000 });
  const followups = useQuery({ queryKey: ['followups'], queryFn: api.followups, refetchInterval: 5000 });
  const pay = usePaymentMutation();
  const [copied, setCopied] = useState<number | null>(null);
  const setStatus = useMutation({
    mutationFn: (v: { id: number; status: FollowupStatus }) => api.setFollowupStatus(v.id, v.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['followups'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const copy = async (id: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch {
      setCopied(null);
    }
  };
  const unpaid = orders.data?.orders ?? [];
  const drafts = (followups.data?.followups ?? []).filter((f) => f.status === 'draft');
  const history = (followups.data?.followups ?? []).filter((f) => f.status !== 'draft').slice(0, 10);
  return (
    <>
      <PageHead title="Tagihan" sub="Pesanan belum bayar dan pengingat yang ditulis Ping" />
      {orders.error && !orders.data ? <ErrorNote error={orders.error} /> : null}
      <div className="grid-2">
        <section className="card" aria-label="Pesanan belum bayar">
          <div className="card-head">
            <h2>Belum bayar</h2>
            <span className="muted">{unpaid.length} pesanan</span>
          </div>
          {orders.isPending ? (
            <Loading rows={4} height={64} />
          ) : unpaid.length === 0 ? (
            <Empty title="Semua pesanan lunas">Tidak ada tagihan yang perlu dikejar.</Empty>
          ) : (
            unpaid.map((o) => {
              const keep = keepText(o.keepUntil);
              return (
                <div key={o.id} className="draft">
                  <div className="draft-head">
                    <strong>
                      <Link to={`/chat/${encodeURIComponent(o.conversationId)}`} className="link" style={{ minHeight: 0 }}>
                        #{o.code}
                      </Link>{' '}
                      · {o.customerName ?? o.customerRef}
                    </strong>
                    <strong>{idr(o.totalIdr)}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {itemsText(o)}
                  </div>
                  <div className="draft-head">
                    <span className={`status ${keep.late ? 'needs_human' : 'unpaid'}`} style={{ marginRight: 'auto' }}>
                      {keep.text}
                    </span>
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={pay.isPending}
                      onClick={() => pay.mutate({ id: o.id, status: 'paid' })}
                    >
                      Tandai lunas
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={pay.isPending}
                      onClick={() => pay.mutate({ id: o.id, status: 'cancelled' })}
                    >
                      Batalkan
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section className="card" aria-label="Pengingat dari Ping">
          <div className="card-head">
            <h2>Pengingat dari Ping</h2>
            <span className="muted">{drafts.length} draf</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            Ping hanya menulis draf. Salin pesannya lalu kirim sendiri dari WhatsApp toko, supaya nomor Anda tidak dianggap mengirim pesan massal.
          </p>
          {followups.isPending ? (
            <Loading rows={3} height={90} />
          ) : drafts.length === 0 ? (
            <Empty title="Belum ada draf">Ping menulis pengingat untuk pesanan yang belum dibayar setelah beberapa waktu.</Empty>
          ) : (
            drafts.map((f) => (
              <div key={f.id} className="draft">
                <div className="draft-head">
                  <strong>
                    #{f.orderCode} · {f.customerName ?? f.customerRef}
                  </strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {idr(f.totalIdr)} · {ago(f.createdAt)}
                  </span>
                </div>
                <div className="draft-text">{f.text}</div>
                <div className="draft-head" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn small" onClick={() => void copy(f.id, f.text)}>
                    {copied === f.id ? 'Tersalin' : 'Salin pesan'}
                  </button>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: f.id, status: 'sent' })}
                  >
                    Tandai terkirim
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: f.id, status: 'skipped' })}
                  >
                    Lewati
                  </button>
                </div>
              </div>
            ))
          )}
          {history.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <h3 className="section-title" style={{ marginBottom: 4 }}>
                Riwayat
              </h3>
              {history.map((f) => (
                <div key={f.id} className="stat-line">
                  <span>
                    #{f.orderCode} · {f.customerName ?? f.customerRef}
                  </span>
                  <span className={`status ${f.status}`}>{FOLLOWUP_LABEL[f.status]}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
