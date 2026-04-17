'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import LiveTicker from '@/components/LiveTicker';
import MobileNav from "@/components/MobileNav";
import Footer from '@/components/Footer';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isTelegram, setIsTelegram] = useState(false);

  const isTgRoute = pathname?.startsWith('/tg');

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg && tg.initData) {
      setIsTelegram(true);
      tg.ready();
      tg.expand();
    }
  }, []);

  // Hide chrome for /tg route or when opened inside Telegram
  const hideChrome = isTgRoute || isTelegram;

  return (
    <>
      {!hideChrome && <Navbar />}
      {!hideChrome && <LiveTicker />}
      <main className="min-h-screen">{children}</main>
      {!hideChrome && <Footer />}
      {!hideChrome && <MobileNav />}
      {!hideChrome && <div className="h-16 md:hidden" />}
    </>
  );
}
