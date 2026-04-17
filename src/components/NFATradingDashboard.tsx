'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type TradingMode = 'off' | 'paper' | 'live';

export interface WalletBalanceItem {
  symbol: string;
  balance: string;
  address?: string;
}

export interface TradingConfig {
  max_position_pct: number;
  max_daily_loss_pct: number;
  max_trades_per_day: number;
  confidence_threshold: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  allowed_pairs?: string[];
  auto_compound?: boolean;
  use_trailing_stop?: boolean;
}

export interface TradingWalletInfo {
  botId: number;
  nfaId: number;
  name: string;
  wallet: string | null;
  mode: TradingMode;
  config: TradingConfig;
  stats: {
    total_trades?: number;
    open_trades?: number;
    winning_trades?: number;
    losing_trades?: number;
    win_rate?: number;
    total_pnl_usd?: number;
    avg_pnl_pct?: number;
    max_drawdown_pct?: number;
    updated_at?: string;
  } | null;
}

interface Props {
  nfaId: number;
  walletInfo: TradingWalletInfo | null;
  balances: WalletBalanceItem[];
  loading?: boolean;
  saving?: boolean;
  onModeChange?: (mode: TradingMode) => void;
  onSaveConfig?: (config: TradingConfig) => void;
  onGenerateWallet?: () => void;
  onRefresh?: () => void;
  onRequestLiveEnable?: () => void;
}

const defaultConfig: TradingConfig = {
  max_position_pct: 10,
  max_daily_loss_pct: 5,
  max_trades_per_day: 20,
  confidence_threshold: 0.7,
  take_profit_pct: 5,
  stop_loss_pct: 3,
  allowed_pairs: ['BNB/USDT', 'ETH/USDT', 'CAKE/USDT'],
  auto_compound: false,
  use_trailing_stop: true,
};

function modeLabel(mode: TradingMode) {
  return mode.toUpperCase();
}

function riskState(cfg: TradingConfig, walletExists: boolean, mode: TradingMode) {
  if (mode === 'live') return { label: 'LIVE', tone: 'red', note: 'Real funds active' };
  if (!walletExists) return { label: 'SETUP', tone: 'yellow', note: 'Wallet missing' };
  if (mode === 'paper') return { label: 'SAFE', tone: 'emerald', note: 'Paper trading only' };
  return { label: 'IDLE', tone: 'slate', note: 'Trading off' };
}

function TonePill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    yellow: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    red: 'bg-red-500/15 text-red-300 border-red-500/30',
    slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[tone] || styles.slate}`}>{children}</span>;
}

function MiniChart() {
  const points = [64, 62, 67, 66, 71, 69, 74, 73, 79];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const scale = (v: number) => 100 - ((v - min) / (max - min || 1)) * 100;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * (100 / (points.length - 1))} ${scale(p)}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" className="h-40 w-full">
      <defs>
        <linearGradient id="pnlFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(34,197,94,0.45)" />
          <stop offset="100%" stopColor="rgba(34,197,94,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx="12" fill="#0b1220" />
      <path d={`${path} L 100 100 L 0 100 Z`} fill="url(#pnlFill)" />
      <path d={path} fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NFATradingDashboard({
  walletInfo,
  balances,
  loading,
  saving,
  onModeChange,
  onSaveConfig,
  onGenerateWallet,
  onRefresh,
  onRequestLiveEnable,
}: Props) {
  const [config, setConfig] = useState<TradingConfig>({ ...defaultConfig, ...(walletInfo?.config || {}) });
  const [liveWarningOpen, setLiveWarningOpen] = useState(false);

  useEffect(() => {
    setConfig({ ...defaultConfig, ...(walletInfo?.config || {}) });
  }, [walletInfo]);

  const derivedRisk = useMemo(() => riskState(config, Boolean(walletInfo?.wallet), walletInfo?.mode || 'off'), [config, walletInfo]);

  const applyMode = (mode: TradingMode) => {
    if (mode === 'live') {
      setLiveWarningOpen(true);
      return;
    }
    onModeChange?.(mode);
  };

  const save = () => onSaveConfig?.(config);

  return (
    <div className="space-y-6 text-slate-100">
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-400">NFA Trading Dashboard</p>
              <h2 className="mt-2 text-2xl font-bold">{walletInfo?.name || `NFA #${walletInfo?.nfaId ?? '—'}`}</h2>
              <p className="mt-1 text-sm text-slate-400">Configure wallet, risk controls, and live execution mode.</p>
            </div>
            <div className="flex gap-2">
              <TonePill tone={derivedRisk.tone}>{derivedRisk.label}</TonePill>
              <button onClick={onRefresh} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/40 hover:text-white">Refresh</button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {(['off', 'paper', 'live'] as TradingMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => applyMode(mode)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${walletInfo?.mode === mode ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'}`}
              >
                <div className="text-xs text-slate-400">Mode</div>
                <div className="mt-1 text-lg font-semibold">{modeLabel(mode)}</div>
                <div className="mt-1 text-xs text-slate-500">{mode === 'live' ? 'Real money trades' : mode === 'paper' ? 'Simulated orders' : 'Execution paused'}</div>
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Wallet info</h3>
                <span className="text-xs text-slate-500">BSC mainnet</span>
              </div>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="text-slate-500">Address</div>
                  <div className="mt-1 break-all font-mono text-slate-200">{walletInfo?.wallet || 'No wallet generated yet'}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {balances.length > 0 ? balances.map(b => (
                    <div key={b.symbol} className="rounded-xl border border-white/5 bg-white/5 p-3">
                      <div className="text-xs text-slate-500">{b.symbol}</div>
                      <div className="mt-1 font-mono text-base font-semibold">{b.balance}</div>
                    </div>
                  )) : (
                    <div className="col-span-2 rounded-xl border border-dashed border-white/10 bg-white/5 p-3 text-sm text-slate-500">Balances will appear after wallet funding or API integration.</div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                {!walletInfo?.wallet && (
                  <button onClick={onGenerateWallet} className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">Generate wallet</button>
                )}
                <button onClick={onRefresh} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:border-white/20 hover:text-white">Reload balances</button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <h3 className="font-semibold">Risk status</h3>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Current posture</span>
                  <TonePill tone={derivedRisk.tone}>{derivedRisk.note}</TonePill>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Max position" value={`${config.max_position_pct}%`} />
                  <Stat label="Daily loss" value={`${config.max_daily_loss_pct}%`} />
                  <Stat label="Trades/day" value={`${config.max_trades_per_day}`} />
                  <Stat label="Confidence" value={`${Math.round((config.confidence_threshold || 0) * 100)}%`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Live P&L</h3>
              <p className="text-xs text-slate-500">Integration point for chart feed / websocket stream</p>
            </div>
            <TonePill tone="emerald">+12.8%</TonePill>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 p-3">
            <MiniChart />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Total P&L" value={walletInfo?.stats?.total_pnl_usd != null ? `$${walletInfo.stats.total_pnl_usd.toFixed(2)}` : '$0.00'} />
            <Stat label="Win rate" value={walletInfo?.stats?.win_rate != null ? `${walletInfo.stats.win_rate.toFixed(1)}%` : '—'} />
            <Stat label="Drawdown" value={walletInfo?.stats?.max_drawdown_pct != null ? `${walletInfo.stats.max_drawdown_pct.toFixed(1)}%` : '—'} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Trading config editor</h3>
              <p className="text-xs text-slate-500">Graceful fallback while backend is offline.</p>
            </div>
            <button disabled={saving} onClick={save} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">Save config</button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Slider label="Max position %" value={config.max_position_pct} min={1} max={50} onChange={v => setConfig({ ...config, max_position_pct: v })} />
            <Slider label="Max daily loss %" value={config.max_daily_loss_pct} min={1} max={20} onChange={v => setConfig({ ...config, max_daily_loss_pct: v })} />
            <Slider label="Trades / day" value={config.max_trades_per_day} min={1} max={100} onChange={v => setConfig({ ...config, max_trades_per_day: v })} />
            <Slider label="Confidence threshold" value={Math.round(config.confidence_threshold * 100)} min={10} max={100} onChange={v => setConfig({ ...config, confidence_threshold: v / 100 })} />
            <Slider label="Take profit %" value={config.take_profit_pct} min={1} max={25} onChange={v => setConfig({ ...config, take_profit_pct: v })} />
            <Slider label="Stop loss %" value={config.stop_loss_pct} min={1} max={20} onChange={v => setConfig({ ...config, stop_loss_pct: v })} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-300">
            <Check label="Auto compound" checked={!!config.auto_compound} onChange={checked => setConfig({ ...config, auto_compound: checked })} />
            <Check label="Trailing stop" checked={!!config.use_trailing_stop} onChange={checked => setConfig({ ...config, use_trailing_stop: checked })} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5">
          <h3 className="font-semibold">Execution summary</h3>
          <div className="mt-4 space-y-3 text-sm">
            <SummaryRow label="Wallet status" value={walletInfo?.wallet ? 'Ready' : 'Not created'} />
            <SummaryRow label="Active mode" value={modeLabel(walletInfo?.mode || 'off')} />
            <SummaryRow label="Allowed pairs" value={config.allowed_pairs?.join(', ') || '—'} />
            <SummaryRow label="Risk label" value={derivedRisk.note} />
          </div>
          <div className="mt-4 rounded-2xl border border-dashed border-cyan-500/30 bg-cyan-500/5 p-4 text-sm text-cyan-100/80">
            Use this space later for websocket execution status, order latency, and fill details.
          </div>
        </div>
      </div>

      <AnimatePresence>
        {liveWarningOpen && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="w-full max-w-lg rounded-3xl border border-red-500/30 bg-slate-950 p-6 shadow-2xl" initial={{ scale: 0.96, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 20 }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-red-400">Warning</p>
                  <h4 className="mt-1 text-xl font-bold">Enable Live Trading?</h4>
                </div>
                <button onClick={() => setLiveWarningOpen(false)} className="text-2xl leading-none text-slate-500 hover:text-white">×</button>
              </div>
              <p className="mt-4 text-sm text-slate-300">Live trading uses REAL funds. Make sure you understand execution risk, slippage, and wallet exposure.</p>
              <div className="mt-4 space-y-2 text-sm text-slate-300">
                {['I understand losses can happen', 'Wallet is funded with BNB for gas', 'Risk limits are set and saved'].map(item => (
                  <label key={item} className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                    <input type="checkbox" className="mt-1 accent-red-500" />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
              <div className="mt-5 flex gap-3">
                <button onClick={() => setLiveWarningOpen(false)} className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:text-white">Cancel</button>
                <button onClick={() => { setLiveWarningOpen(false); onRequestLiveEnable?.(); onModeChange?.('live'); }} className="flex-1 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white hover:bg-red-400">Enable Live Trading</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-mono text-sm font-semibold text-slate-100">{value}</div></div>;
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; }) {
  return (
    <label className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-cyan-300">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="mt-3 w-full accent-cyan-400" />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void; }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-cyan-400" />
      <span>{label}</span>
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-100">{value}</span></div>;
}
