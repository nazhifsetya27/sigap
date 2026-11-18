import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';
import { BoxIcon, BrandMark, ChatIcon, HomeIcon, OfficeIcon, ReceiptIcon, SlidersIcon, WalletIcon } from './icons';

export function useOverview() {
  return useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 3000 });
}

interface Item {
  to: string;
  label: string;
  short: string;
  icon: ReactNode;
  badge?: { count: number; tone: 'danger' | 'warn' };
  mobile: boolean;
}

export function Layout() {
  const { data } = useOverview();
  const waiting = data?.actions.waitingHuman.count ?? 0;
  const unpaid = data?.actions.unpaid.count ?? 0;
  const items: Item[] = [
    { to: '/', label: 'Beranda', short: 'Beranda', icon: <HomeIcon />, mobile: true },
    { to: '/kantor', label: 'Kantor AI', short: 'Kantor', icon: <OfficeIcon />, mobile: true },
    { to: '/chat', label: 'Chat', short: 'Chat', icon: <ChatIcon />, badge: { count: waiting, tone: 'danger' }, mobile: true },
    { to: '/pesanan', label: 'Pesanan', short: 'Pesanan', icon: <BoxIcon />, mobile: true },
    { to: '/tagihan', label: 'Tagihan', short: 'Tagihan', icon: <ReceiptIcon />, badge: { count: unpaid, tone: 'warn' }, mobile: false },
    { to: '/biaya', label: 'Biaya AI', short: 'Biaya', icon: <WalletIcon />, mobile: true },
    { to: '/pengaturan', label: 'Pengaturan', short: 'Atur', icon: <SlidersIcon />, mobile: false },
  ];
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Menu utama">
        <div className="brand">
          <BrandMark />
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">Sigap</div>
            <div className="brand-store">{data?.storeName ?? ' '}</div>
          </div>
        </div>
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {it.icon}
            <span className="grow">{it.label}</span>
            {it.badge && it.badge.count > 0 ? <span className={`badge ${it.badge.tone}`}>{it.badge.count}</span> : null}
          </NavLink>
        ))}
        <div className="sidebar-foot">Admin AI untuk toko di WhatsApp</div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Menu bawah">
        {items
          .filter((it) => it.mobile)
          .map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {it.icon}
              <span>{it.short}</span>
              {it.badge && it.badge.count > 0 ? <span className={`badge ${it.badge.tone}`}>{it.badge.count}</span> : null}
            </NavLink>
          ))}
      </nav>
    </div>
  );
}
