import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ConvStatus } from '../api';
import { Empty, ErrorNote, Loading, PageHead } from '../components/bits';
import { ChevronLeft } from '../components/icons';
import { ago, clock } from '../format';

const FILTERS: { key: ConvStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'needs_human', label: 'Perlu admin' },
  { key: 'ai', label: 'Ditangani AI' },
  { key: 'done', label: 'Selesai' },
];

const STATUS_LABEL: Record<ConvStatus, string> = { ai: 'Ditangani AI', needs_human: 'Perlu admin', done: 'Selesai' };
const SENDER: Record<'customer' | 'ai' | 'human', string> = { customer: 'Pelanggan', ai: 'Echo', human: 'Admin' };

function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.conversation(id),
    refetchInterval: 3000,
  });
  const setStatus = useMutation({
    mutationFn: (status: ConvStatus) => api.setConversationStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const bottom = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [count, id]);

  if (isPending) return <div className="card thread"><div style={{ padding: 18 }}><Loading rows={4} height={44} /></div></div>;
  if (!data) return <div className="card thread"><div style={{ padding: 18 }}><ErrorNote error={error} /></div></div>;
  const c = data.conversation;
  return (
    <section className="card thread" aria-label="Isi percakapan">
      <div className="thread-head">
        <Link to="/chat" className="btn small back-link" aria-label="Kembali ke daftar chat">
          <ChevronLeft size={16} />
        </Link>
        <div className="who">
          <strong>{c.customerName ?? c.customerRef}</strong>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {c.customerRef}
            {c.summary ? ` · ${c.summary}` : ''}
          </div>
        </div>
        <span className={`status ${c.status}`}>{STATUS_LABEL[c.status]}</span>
        {c.status === 'needs_human' ? (
          <button type="button" className="btn small primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate('done')}>
            Tandai selesai
          </button>
        ) : c.status === 'done' ? (
          <button type="button" className="btn small" disabled={setStatus.isPending} onClick={() => setStatus.mutate('ai')}>
            Buka lagi
          </button>
        ) : (
          <button type="button" className="btn small" disabled={setStatus.isPending} onClick={() => setStatus.mutate('done')}>
            Tandai selesai
          </button>
        )}
      </div>
      {c.status === 'needs_human' && c.reason ? (
        <div className="banner" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
          Dioper ke admin: {c.reason}
        </div>
      ) : null}
      <div className="thread-body">
        {data.messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.text}
            <span className="msg-meta">
              {SENDER[m.role]} · {clock(m.ts)}
            </span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="thread-foot">Membalas dari portal belum tersedia. Balas pelanggan ini lewat WhatsApp toko Anda.</div>
    </section>
  );
}

export function Chat() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get('status');
  const filter: ConvStatus | 'all' = raw === 'needs_human' || raw === 'ai' || raw === 'done' ? raw : 'all';
  const { data, error, isPending } = useQuery({
    queryKey: ['conversations', filter],
    queryFn: () => api.conversations(filter === 'all' ? undefined : filter),
    refetchInterval: 4000,
  });
  const list = data?.conversations ?? [];
  const query = filter === 'all' ? '' : `?status=${filter}`;
  return (
    <>
      <PageHead title="Chat" sub="Percakapan WhatsApp yang ditangani Echo" />
      <div className="tabs" role="group" aria-label="Saring chat">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="tab"
            aria-pressed={filter === f.key}
            onClick={() => {
              setParams(f.key === 'all' ? {} : { status: f.key });
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && !data ? <ErrorNote error={error} /> : null}
      <div className={`chat${id ? ' has-thread' : ''}`}>
        <section className="card chat-list" aria-label="Daftar chat">
          {isPending ? (
            <div style={{ padding: 10 }}>
              <Loading rows={5} height={52} />
            </div>
          ) : list.length === 0 ? (
            <Empty title="Belum ada chat">Chat pelanggan akan muncul di sini begitu WhatsApp terhubung.</Empty>
          ) : (
            list.map((c) => (
              <div
                key={c.id}
                role="link"
                tabIndex={0}
                className={`chat-item${c.id === id ? ' active' : ''}`}
                onClick={() => navigate(`/chat/${encodeURIComponent(c.id)}${query}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/chat/${encodeURIComponent(c.id)}${query}`);
                }}
              >
                <div className="chat-item-top">
                  <strong>{c.customerName ?? c.customerRef}</strong>
                  {c.status === 'needs_human' ? <span className="status needs_human">Perlu admin</span> : null}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {ago(c.lastMessageAt)}
                  </span>
                </div>
                <div className="chat-item-preview">
                  {c.preview ? `${c.preview.role === 'customer' ? '' : 'Echo: '}${c.preview.text}` : 'Belum ada pesan'}
                </div>
              </div>
            ))
          )}
        </section>
        {id ? (
          <Thread id={id} />
        ) : (
          <section className="card thread">
            <Empty title="Pilih chat">Buka salah satu percakapan untuk melihat isinya.</Empty>
          </section>
        )}
      </div>
    </>
  );
}
