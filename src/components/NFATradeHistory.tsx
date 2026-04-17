'use client';

import { useMemo, useState } from 'react';

export interface TradeHistoryItem {
  id: string | number;
  time: string;
  pair: string;
  action: 'BUY' | 'SELL' | 'HOLD' | string;
  amount: string | number;
  pnl: number | null;
  txHash: string | null;
  status: 'pending' | 'confirmed' | 'failed' | string;
  mode?: 'paper' | 'live' | string;
}

interface Props {
  trades: TradeHistoryItem[];
  loading?: boolean;
  emptyLabel?: string;
}

function tone(action: string) {
  const a = action.toUpperCase();
  if (a === 'BUY') return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
  if (a === 'SELL') return 'text-red-300 bg-red-500/15 border-red-500/30';
  return 'text-slate-300 bg-white/5 border-white/10';
}

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s === 'confirmed') return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30';
  if (s === 'failed') return 'text-red-300 bg-red-500/15 border-red-500/30';
  return 'text-yellow-300 bg-yellow-500/15 border-yellow-500/30';
}

export default function NFATradeHistory({ trades, loading, emptyLabel = 'No trades yet' }: Props) {
  const [pairFilter, setPairFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  const pairs = useMemo(() => ['all', ...new Set(trades.map(t => t.pair))], [trades]);

  const filtered = useMemo(() => {
    return trades.filter(t => {
      const pairOk = pairFilter === 'all' || t.pair === pairFilter;
      const statusOk = statusFilter === 'all' || t.status === statusFilter;
      const dateOk = dateFilter === 'all' || (() => {
        const diff = Date.now() - new Date(t.time).getTime();
        if (dateFilter === '24h') return diff <= 24 * 60 * 60 * 1000;
        if (dateFilter === '7d') return diff <= 7 * 24 * 60 * 60 * 1000;
        return true;
      })();
      return pairOk && statusOk && dateOk;
    });
  }, [trades, pairFilter, statusFilter, dateFilter]);

  const summary = useMemo(() => {
    const pnl = filtered.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const closed = filtered.filter(t => typeof t.pnl === 'number');
    const wins = closed.filter(t => (t.pnl || 0) > 0).length;
    const avgSize = filtered.length ? filtered.reduce((sum, t) => sum + Number(t.amount || 0), 0) / filtered.length : 0;
    return {
      pnl,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      avgSize,
    };
  }, [filtered]);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-slate-100 shadow-2xl shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-400">Trade History</p>
          <h3 className="mt-1 text-xl font-bold">Recent fills and paper executions</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Metric label="Total P&L" value={`${summary.pnl >= 0 ? '+' : ''}$${summary.pnl.toFixed(2)}`} tone={summary.pnl >= 0 ? 'emerald' : 'red'} />
          <Metric label="Win rate" value={`${summary.winRate.toFixed(1)}%`} tone="cyan" />
          <Metric label="Avg size" value={`$${summary.avgSize.toFixed(0)}`} tone="slate" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Select label="Pair" value={pairFilter} onChange={setPairFilter} options={pairs} />
        <Select label="Status" value={statusFilter} onChange={setStatusFilter} options={['all', 'confirmed', 'pending', 'failed']} />
        <Select label="Date" value={dateFilter} onChange={setDateFilter} options={['all', '24h', '7d']} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Pair</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">P&L</th>
              <th className="px-4 py-3 font-medium">Tx hash</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading trade history...</td></tr>
            ) : filtered.length > 0 ? filtered.map(trade => (
              <tr key={trade.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-slate-400">{new Date(trade.time).toLocaleString()}</td>
                <td className="px-4 py-3 font-medium text-slate-100">{trade.pair}</td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone(trade.action)}`}>{trade.action}</span></td>
                <td className="px-4 py-3 font-mono text-slate-200">{trade.amount}</td>
                <td className={`px-4 py-3 font-mono font-semibold ${trade.pnl == null ? 'text-slate-500' : trade.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{trade.pnl == null ? 'pending' : `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}%`}</td>
                <td className="px-4 py-3 text-slate-400">{trade.txHash ? <a href={`https://bscscan.com/tx/${trade.txHash}`} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:text-cyan-200">{trade.txHash.slice(0, 10)}…</a> : '—'}</td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(trade.status)}`}>{trade.status}</span></td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">{emptyLabel}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[]; }) {
  return (
    <label className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
      <span className="mr-2 text-slate-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="bg-transparent text-slate-100 outline-none">
        {options.map(o => <option key={o} value={o} className="bg-slate-900">{o}</option>)}
      </select>
    </label>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string; }) {
  const styles: Record<string, string> = { emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', red: 'border-red-500/30 bg-red-500/10 text-red-200', cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200', slate: 'border-white/10 bg-white/5 text-slate-200' };
  return <div className={`rounded-xl border px-3 py-2 ${styles[tone] || styles.slate}`}><div className="text-xs opacity-70">{label}</div><div className="mt-1 font-mono font-semibold">{value}</div></div>;
}
