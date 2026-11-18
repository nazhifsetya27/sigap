import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, api } from './api';
import { ErrorNote, Loading } from './components/bits';
import { Layout } from './components/Layout';
import { Billing } from './pages/Billing';
import { Chat } from './pages/Chat';
import { Costs } from './pages/Costs';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { OfficePage } from './pages/OfficePage';
import { Orders } from './pages/Orders';
import { Settings } from './pages/Settings';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Kegagalan jaringan dicoba lagi; penolakan dari server (4xx) tidak.
      retry: (count, error) => (error instanceof ApiError && error.status >= 400 && error.status < 500 ? false : count < 3),
      staleTime: 1500,
      refetchOnWindowFocus: true,
    },
  },
});

function App() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: api.session });
  useEffect(() => {
    const onUnauthorized = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('sigap:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sigap:unauthorized', onUnauthorized);
  }, [qc]);

  if (session.isPending) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
        <Loading rows={3} height={64} />
      </div>
    );
  }
  if (!session.data) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
        <ErrorNote error={session.error} />
      </div>
    );
  }
  if (session.data.authRequired && !session.data.authenticated) {
    return <Login onDone={() => void qc.invalidateQueries()} />;
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="kantor" element={<OfficePage />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:id" element={<Chat />} />
        <Route path="pesanan" element={<Orders />} />
        <Route path="tagihan" element={<Billing />} />
        <Route path="biaya" element={<Costs />} />
        <Route path="pengaturan" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
