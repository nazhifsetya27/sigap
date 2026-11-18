import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorNote, Loading, PageHead } from '../components/bits';
import { useOverview } from '../components/Layout';

export function Settings() {
  const qc = useQueryClient();
  const { data, error, isPending } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const overview = useOverview();
  const [form, setForm] = useState({ storeName: '', creditUsd: '', idrPerUsd: '', chatsPerDay: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({
      storeName: data.storeName,
      creditUsd: String(data.creditUsd),
      idrPerUsd: String(data.idrPerUsd),
      chatsPerDay: String(data.chatsPerDay),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const patch: Parameters<typeof api.saveSettings>[0] = {
        storeName: form.storeName,
        idrPerUsd: Number(form.idrPerUsd),
        chatsPerDay: Number(form.chatsPerDay),
      };
      // Saldo hanya dikirim bila diubah, karena mengubahnya menggeser titik acuan hitungan biaya.
      if (data && Number(form.creditUsd) !== data.creditUsd) patch.creditUsd = Number(form.creditUsd);
      return api.saveSettings(patch);
    },
    onSuccess: (next) => {
      qc.setQueryData(['settings'], { ...data, ...next });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      void qc.invalidateQueries({ queryKey: ['costs'] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (isPending) {
    return (
      <>
        <PageHead title="Pengaturan" />
        <Loading rows={4} height={60} />
      </>
    );
  }
  if (!data) return <ErrorNote error={error} />;
  const conn = overview.data?.connection;
  const agents = overview.data?.agents ?? [];
  return (
    <>
      <PageHead title="Pengaturan" />
      <div className="grid-2">
        <section className="card" aria-label="Toko dan biaya">
          <div className="card-head">
            <h2>Toko dan biaya</h2>
          </div>
          <form className="form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="storeName">Nama toko</label>
              <input id="storeName" className="input" value={form.storeName} onChange={set('storeName')} maxLength={60} required />
            </div>
            <div className="field">
              <label htmlFor="creditUsd">Saldo penyedia model (US$)</label>
              <input id="creditUsd" className="input" inputMode="decimal" value={form.creditUsd} onChange={set('creditUsd')} required />
              <small>Isi sesuai saldo di dasbor penyedia. Saat angka ini diubah, biaya dihitung ulang mulai dari sekarang.</small>
            </div>
            <div className="field">
              <label htmlFor="idrPerUsd">Kurs rupiah per US$1</label>
              <input id="idrPerUsd" className="input" inputMode="decimal" value={form.idrPerUsd} onChange={set('idrPerUsd')} required />
              <small>Pakai kurs saat top up. Contoh: Rp20.000 menjadi US$1.09 berarti 18349.</small>
            </div>
            <div className="field">
              <label htmlFor="chatsPerDay">Asumsi chat per hari</label>
              <input id="chatsPerDay" className="input" inputMode="numeric" value={form.chatsPerDay} onChange={set('chatsPerDay')} required />
              <small>Dipakai untuk memperkirakan saldo kuat berapa hari.</small>
            </div>
            {save.error ? <div className="error-text" role="alert">{save.error.message}</div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="submit" className="btn primary" disabled={save.isPending}>
                {save.isPending ? 'Menyimpan…' : 'Simpan'}
              </button>
              {saved ? <span className="muted" role="status">Tersimpan</span> : null}
            </div>
          </form>
        </section>

        <section className="card" aria-label="Sambungan">
          <div className="card-head">
            <h2>Sambungan</h2>
          </div>
          <div className="stat-line">
            <span className="muted">Sumber data</span>
            <strong>{data.dataSource === 'demo' ? 'Data contoh' : 'Hermes Agent'}</strong>
          </div>
          <div className="stat-line">
            <span className="muted">WhatsApp</span>
            <strong>{conn?.label ?? '–'}</strong>
          </div>
          {agents.map((a) => (
            <div key={a.key} className="stat-line">
              <span className="muted">
                {a.name} · {a.role}
              </span>
              <strong>{a.state === 'offline' ? a.label : 'Siap'}</strong>
            </div>
          ))}
          {conn?.problem ? (
            <div className="banner" role="alert" style={{ marginTop: 10 }}>
              {conn.problem}
            </div>
          ) : null}
          {data.dataSource === 'demo' ? (
            <div className="banner info" style={{ marginTop: 12 }}>
              Portal sedang menampilkan data contoh. Untuk data asli:
              <ol className="steps" style={{ marginTop: 6 }}>
                <li>
                  Jalankan <code>scripts/setup-hermes.sh</code> untuk membuat profil Echo, Tally, dan Ping.
                </li>
                <li>
                  Pasangkan WhatsApp dengan <code>hermes -p echo whatsapp</code>.
                </li>
                <li>
                  Isi <code>DATA_SOURCE=hermes</code> di <code>.env</code>, lalu jalankan ulang portal.
                </li>
              </ol>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
