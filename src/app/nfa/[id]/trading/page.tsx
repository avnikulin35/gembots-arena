'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import NFATradingDashboard, { type TradingConfig, type TradingMode, type TradingWalletInfo } from '@/components/NFATradingDashboard';
import NFATradeHistory, { type TradeHistoryItem } from '@/components/NFATradeHistory';

interface WalletBalanceItem { symbol: string; balance: string; address?: string; }

const mockWallet = (nfaId: number): TradingWalletInfo => ({
  botId: nfaId,
  nfaId,
  name: `NFA #${nfaId}`,
  wallet: null,
  mode: 'off',
  config: {
    max_position_pct: 10,
    max_daily_loss_pct: 5,
    max_trades_per_day: 20,
    confidence_threshold: 0.7,
    take_profit_pct: 5,
    stop_loss_pct: 3,
    allowed_pairs: ['BNB/USDT', 'ETH/USDT', 'CAKE/USDT'],
    auto_compound: false,
    use_trailing_stop: true,
  },
  stats: {
    total_trades: 0,
    open_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    win_rate: 0,
    total_pnl_usd: 0,
    avg_pnl_pct: 0,
    max_drawdown_pct: 0,
  },
});

const mockTrades = (): TradeHistoryItem[] => [
  { id: 1, time: new Date(Date.now() - 3600_000).toISOString(), pair: 'BNB/USDT', action: 'BUY', amount: '$1,250', pnl: 2.4, txHash: null, status: 'confirmed', mode: 'paper' },
  { id: 2, time: new Date(Date.now() - 7200_000).toISOString(), pair: 'ETH/USDT', action: 'SELL', amount: '$980', pnl: -0.8, txHash: null, status: 'confirmed', mode: 'paper' },
  { id: 3, time: new Date(Date.now() - 1.5 * 86400_000).toISOString(), pair: 'CAKE/USDT', action: 'BUY', amount: '$430', pnl: null, txHash: null, status: 'pending', mode: 'live' },
];

export default function NfaTradingPage() {
  const params = useParams();
  const nfaId = Number(params.id);
  const [walletInfo, setWalletInfo] = useState<TradingWalletInfo | null>(null);
  const [trades, setTrades] = useState<TradeHistoryItem[]>([]);
  const [balances, setBalances] = useState<WalletBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [walletRes, historyRes, balanceRes] = await Promise.allSettled([
        fetch(`/api/nfa/trading/wallet?nfaId=${nfaId}`),
        fetch(`/api/nfa/trading/history?nfaId=${nfaId}&limit=100`),
        fetch(`/api/nfa/trading/balance?nfaId=${nfaId}&ownerAddress=0x0000000000000000000000000000000000000000`),
      ]);

      if (walletRes.status === 'fulfilled' && walletRes.value.ok) {
        const data = await walletRes.value.json();
        setWalletInfo({ ...mockWallet(nfaId), ...data, config: { ...mockWallet(nfaId).config, ...(data.config || {}) } });
      } else {
        setWalletInfo(mockWallet(nfaId));
      }

      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const data = await historyRes.value.json();
        setTrades((data.trades || []).map((t: any) => ({
          id: t.id,
          time: t.open_at || t.time || new Date().toISOString(),
          pair: t.symbol,
          action: String(t.action || 'HOLD').toUpperCase(),
          amount: `$${Number(t.size || 0).toFixed(0)}`,
          pnl: typeof t.pnl_usd === 'number' ? t.pnl_usd : null,
          txHash: t.tx_hash || null,
          status: t.status || 'confirmed',
          mode: 'paper',
        })));
      } else {
        setTrades(mockTrades());
      }

      if (balanceRes.status === 'fulfilled' && balanceRes.value.ok) {
        const data = await balanceRes.value.json();
        setBalances([
          { symbol: 'BNB', balance: Number(data.bnb || 0).toFixed(4) },
          ...(Array.isArray(data.tokens) ? data.tokens.map((t: any) => ({ symbol: t.symbol, balance: t.balance, address: t.address })) : []),
        ]);
      } else {
        setBalances([
          { symbol: 'BNB', balance: '0.0000' },
          { symbol: 'USDT', balance: '1,250.00' },
        ]);
      }
    } catch (e) {
      setError('Trading APIs are not fully available yet — showing fallback UI.');
      setWalletInfo(mockWallet(nfaId));
      setTrades(mockTrades());
      setBalances([{ symbol: 'BNB', balance: '0.0000' }, { symbol: 'USDT', balance: '1,250.00' }]);
    } finally {
      setLoading(false);
    }
  }, [nfaId]);

  useEffect(() => { void load(); }, [load]);

  const handleModeChange = async (mode: TradingMode) => {
    setSaving(true);
    try {
      const res = await fetch('/api/nfa/trading/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nfaId, ownerAddress: '0x0000000000000000000000000000000000000000', mode }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch {
      setWalletInfo(prev => prev ? { ...prev, mode } : prev);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfig = async (config: TradingConfig) => {
    setSaving(true);
    try {
      const res = await fetch('/api/nfa/trading/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nfaId, ownerAddress: '0x0000000000000000000000000000000000000000', config }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch {
      setWalletInfo(prev => prev ? { ...prev, config } : prev);
    } finally {
      setSaving(false);
    }
  };

  const pageStatus = useMemo(() => error ? error : loading ? 'Loading dashboard…' : 'Connected UI ready', [error, loading]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_40%),linear-gradient(180deg,#020617_0%,#020617_100%)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-400">NFA / Trading</p>
            <h1 className="mt-1 text-3xl font-black sm:text-4xl">Live trading control room</h1>
            <p className="mt-1 text-sm text-slate-400">Wallet, risk, execution mode, and trade history in one place.</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">{pageStatus}</div>
        </div>

        <div className="space-y-6">
          <NFATradingDashboard
            nfaId={nfaId}
            walletInfo={walletInfo}
            balances={balances}
            loading={loading}
            saving={saving}
            onModeChange={handleModeChange}
            onSaveConfig={handleSaveConfig}
            onGenerateWallet={load}
            onRefresh={load}
            onRequestLiveEnable={() => handleModeChange('live')}
          />

          <NFATradeHistory trades={trades} loading={loading} emptyLabel="No executions yet — once backend fills nfa_trades/history, they’ll show here." />
        </div>
      </div>
    </main>
  );
}
