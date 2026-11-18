import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Order, type PaymentStatus } from '../api';
import { Empty, ErrorNote, Loading, PageHead } from '../components/bits';
import { ago, idr } from '../format';

export const PAYMENT_LABEL: Record<PaymentStatus, string> = { unpaid: 'Belum bayar', paid: 'Lunas', cancelled: 'Batal' };
const METHOD_LABEL: Record<string, string> = { transfer: 'Transfer', qris: 'QRIS', cod: 'COD' };

const FILTERS: { key: PaymentStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'unpaid', label: 'Belum bayar' },
  { key: 'paid', label: 'Lunas' },
  { key: 'cancelled', label: 'Batal' },
];

export function itemsText(o: Order): string {
  return o.items.map((i) => `${i.qty}x ${i.name}${i.variant ? ` (${i.variant})` : ''}`).join(', ');
}

export function usePaymentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; status: PaymentStatus }) => api.setOrderPayment(v.id, v.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function Orders() {
  const [filter, setFilter] = useState<PaymentStatus | 'all'>('all');
  const { data, error, isPending } = useQuery({
    queryKey: ['orders', filter],
    queryFn: () => api.orders(filter === 'all' ? undefined : filter),
    refetchInterval: 5000,
  });
  const pay = usePaymentMutation();
  const orders = data?.orders ?? [];
  return (
    <>
      <PageHead title="Pesanan" sub="Direkap Tally dari percakapan WhatsApp">
        <Link to="/tagihan" className="btn">
          Lihat tagihan
        </Link>
      </PageHead>
      <div className="tabs" role="group" aria-label="Saring pesanan">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="tab" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && !data ? <ErrorNote error={error} /> : null}
      <section className="card">
        {isPending ? (
          <Loading rows={5} height={48} />
        ) : orders.length === 0 ? (
          <Empty title="Belum ada pesanan">Pesanan muncul setelah Tally merekap chat yang berakhir dengan order.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Pelanggan</th>
                  <th>Barang</th>
                  <th className="num">Total</th>
                  <th>Bayar</th>
                  <th>Status</th>
                  <th className="num">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/chat/${encodeURIComponent(o.conversationId)}`} className="link" style={{ minHeight: 0 }}>
                        #{o.code}
                      </Link>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {ago(o.createdAt)}
                      </div>
                    </td>
                    <td>
                      {o.customerName ?? '–'}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {o.customerRef}
                      </div>
                    </td>
                    <td style={{ minWidth: 200 }}>{itemsText(o)}</td>
                    <td className="num">
                      <strong>{idr(o.totalIdr)}</strong>
                    </td>
                    <td>{o.paymentMethod ? (METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod) : '–'}</td>
                    <td>
                      <span className={`status ${o.paymentStatus}`}>{PAYMENT_LABEL[o.paymentStatus]}</span>
                    </td>
                    <td>
                      <div className="cell-actions">
                        {o.paymentStatus === 'unpaid' ? (
                          <>
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
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn small"
                            disabled={pay.isPending}
                            onClick={() => pay.mutate({ id: o.id, status: 'unpaid' })}
                          >
                            Kembalikan
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
