import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { BrandMark } from '../components/icons';

export function Login({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const login = useMutation({ mutationFn: () => api.login(code), onSuccess: onDone });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <div className="brand-name">Sigap</div>
        </div>
        <div className="field">
          <label htmlFor="code">Kode akses</label>
          <input
            id="code"
            className="input"
            type="password"
            autoComplete="current-password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
        </div>
        {login.error ? (
          <div className="error-text" role="alert">
            {login.error.message}
          </div>
        ) : null}
        <button type="submit" className="btn primary" disabled={login.isPending || code.length === 0}>
          {login.isPending ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
