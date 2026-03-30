'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TickerEvent {
  id: string;
  text: string;
  icon: string;
  time: string;
  type: 'battle' | 'result';
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function LiveTicker() {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const data = await res.json();
        const battles = data.recentBattles || [];
        if (battles.length === 0) { setIsLive(false); return; }

        const tickerEvents: TickerEvent[] = battles.map((b: any) => ({
          id: b.id,
          text: `${b.bot1} vs ${b.bot2} on $${b.token}`,
          icon: b.winner === 'Draw' ? '🤝' : '🏆',
          time: timeAgo(b.resolvedAt),
          type: 'result' as const,
        }));

        setEvents(tickerEvents);
        setIsLive(false);
      } catch {
        // silently fail — don't crash the page
      }
    }

    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (events.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % events.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [events.length]);

  if (events.length === 0) return null;

  const current = events[currentIndex % events.length];

  return (
    <div className="w-full bg-gray-900/80 backdrop-blur-sm border-y border-gray-800 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`relative flex h-2.5 w-2.5 ${isLive ? '' : 'opacity-50'}`}>
              {isLive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLive ? 'bg-red-500' : 'bg-gray-500'}`}></span>
            </span>
            <span className={`font-bold text-xs tracking-wider ${isLive ? 'text-red-400' : 'text-gray-500'}`}>
              {isLive ? 'LIVE' : 'RECENT'}
            </span>
          </div>
          <div className="flex-1 overflow-hidden relative h-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={current?.id || 'empty'}
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -16, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex items-center gap-2"
              >
                <span>{current?.icon}</span>
                <span className="text-gray-200 truncate">{current?.text}</span>
                <span className="text-gray-500 text-xs shrink-0">{current?.time}</span>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="shrink-0 text-xs text-gray-500">
            {events.length} recent
          </div>
        </div>
      </div>
    </div>
  );
}
