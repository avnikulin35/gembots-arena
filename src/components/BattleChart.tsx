'use client';

import { useEffect, useRef, useState } from 'react';

interface BotData {
  id: number;
  name: string;
  model: string;
  action: string;
  leverage: number;
  confidence: number;
  take_profit: number;
  stop_loss: number;
  reasoning: string;
  pnl: number | null;
  isWinner: boolean;
}

interface BattleChartData {
  battle: {
    id: string;
    symbol: string;
    status: string;
    entry_price: number;
    exit_price: number | null;
    started_at: string;
    resolved_at: string | null;
    winner_id: number | null;
  };
  bot1: BotData;
  bot2: BotData;
  marketData: Record<string, number>;
  klines: number[][];
}

function getModelShort(model: string) {
  if (!model) return '?';
  if (model.includes('chaingpt')) return 'ChainGPT';
  const parts = model.split('/');
  return parts[parts.length - 1]?.split('-').slice(0, 2).join('-') || model;
}

function ActionBadge({ action, size = 'md' }: { action: string; size?: 'sm' | 'md' }) {
  const colors: Record<string, string> = {
    BUY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    SELL: 'bg-red-500/20 text-red-400 border-red-500/30',
    HOLD: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  const cls = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';
  return (
    <span className={`${cls} rounded border font-mono font-bold ${colors[action] || 'bg-gray-700 text-gray-300'}`}>
      {action}
    </span>
  );
}

function PnlDisplay({ pnl }: { pnl: number | null }) {
  if (pnl == null) return <span className="text-gray-500">pending</span>;
  const color = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-gray-400';
  return <span className={`font-mono font-bold ${color}`}>{pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%</span>;
}

function CandlestickChart({ klines, entryPrice, exitPrice, bot1Action, bot2Action }: {
  klines: number[][];
  entryPrice: number;
  exitPrice: number | null;
  bot1Action: string;
  bot2Action: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || klines.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Find price range
    const prices = klines.flatMap(k => [k[2], k[3]]); // highs and lows
    if (entryPrice) prices.push(entryPrice);
    if (exitPrice) prices.push(exitPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;
    const padding = priceRange * 0.1;
    const yMin = minPrice - padding;
    const yMax = maxPrice + padding;

    const toY = (price: number) => H - ((price - yMin) / (yMax - yMin)) * (H - 40) - 20;
    const candleW = Math.max(2, (W - 60) / klines.length - 1);

    // Background
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 0.5;
    const priceSteps = 5;
    for (let i = 0; i <= priceSteps; i++) {
      const price = yMin + (yMax - yMin) * (i / priceSteps);
      const y = toY(price);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      // Price label
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(price > 1000 ? 0 : 2), W - 2, y - 2);
    }

    // Candles
    klines.forEach((k, i) => {
      const [, open, high, low, close] = k;
      const x = 30 + i * (candleW + 1);
      const isGreen = close >= open;

      // Wick
      ctx.strokeStyle = isGreen ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleW / 2, toY(high));
      ctx.lineTo(x + candleW / 2, toY(low));
      ctx.stroke();

      // Body
      ctx.fillStyle = isGreen ? '#10b981' : '#ef4444';
      const bodyTop = toY(Math.max(open, close));
      const bodyBot = toY(Math.min(open, close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillRect(x, bodyTop, candleW, bodyH);
    });

    // Entry price line
    if (entryPrice) {
      const y = toY(entryPrice);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#8b5cf6';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`ENTRY ${entryPrice.toFixed(entryPrice > 1000 ? 0 : 2)}`, 4, y - 4);
    }

    // Exit price line
    if (exitPrice) {
      const y = toY(exitPrice);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`EXIT ${exitPrice.toFixed(exitPrice > 1000 ? 0 : 2)}`, 4, y - 4);
    }

  }, [klines, entryPrice, exitPrice, bot1Action, bot2Action]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: '280px' }}
    />
  );
}

export default function BattleChart({ battleId, onClose }: { battleId: string; onClose: () => void }) {
  const [data, setData] = useState<BattleChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/battles/${battleId}/chart`)
      .then(r => r.ok ? r.json() : Promise.reject('Failed to load'))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [battleId]);

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl p-8 text-gray-400">Loading battle...</div>
    </div>
  );

  if (error || !data) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl p-8">
        <p className="text-red-400">{error || 'No data'}</p>
        <button onClick={onClose} className="mt-4 text-gray-400 hover:text-white">Close</button>
      </div>
    </div>
  );

  const { battle, bot1, bot2, marketData, klines } = data;
  const isChainGPT1 = bot1.model?.includes('chaingpt');
  const isChainGPT2 = bot2.model?.includes('chaingpt');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-700/50 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">{battle.symbol}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${battle.status === 'resolved' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
              {battle.status}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">×</button>
        </div>

        {/* Chart */}
        <div className="p-4">
          {klines.length > 0 ? (
            <CandlestickChart
              klines={klines}
              entryPrice={battle.entry_price}
              exitPrice={battle.exit_price}
              bot1Action={bot1.action}
              bot2Action={bot2.action}
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 bg-gray-800/30 rounded-lg">
              No chart data available
            </div>
          )}
        </div>

        {/* Bots comparison */}
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          {[bot1, bot2].map((bot, idx) => {
            const isChainGPT = idx === 0 ? isChainGPT1 : isChainGPT2;
            return (
              <div key={idx} className={`rounded-xl p-3 border ${bot.isWinner ? 'border-emerald-500/40 bg-emerald-900/10' : 'border-gray-700/40 bg-gray-800/30'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">{bot.name}</span>
                    {bot.isWinner && <span className="text-xs text-emerald-400">👑</span>}
                  </div>
                  <ActionBadge action={bot.action} size="sm" />
                </div>

                <div className="text-xs text-gray-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Model</span>
                    <span className="text-gray-300 font-mono">{getModelShort(bot.model)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Leverage</span>
                    <span className="text-gray-300">{bot.leverage}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Confidence</span>
                    <span className="text-gray-300">{(bot.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TP / SL</span>
                    <span className="text-gray-300">{bot.take_profit}% / {bot.stop_loss}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P&L</span>
                    <PnlDisplay pnl={bot.pnl} />
                  </div>
                </div>

                {isChainGPT && (
                  <div className="mt-2 text-xs px-2 py-1 rounded bg-purple-900/30 border border-purple-500/20 text-purple-300">
                    🐋 On-Chain Intelligence Active
                  </div>
                )}

                {bot.reasoning && (
                  <div className="mt-2 text-xs text-gray-500 italic line-clamp-3">
                    &ldquo;{bot.reasoning}&rdquo;
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Technical data */}
        {marketData && (marketData as Record<string, number>).pivot && (
          <div className="px-4 pb-4">
            <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
              <div className="text-xs font-bold text-gray-400 mb-2">TECHNICAL LEVELS</div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div><span className="text-gray-500">Pivot</span> <span className="text-gray-300 font-mono">{(marketData as Record<string, number>).pivot?.toFixed(2)}</span></div>
                <div><span className="text-gray-500">R1</span> <span className="text-red-400 font-mono">{(marketData as Record<string, number>).resistance_1?.toFixed(2)}</span></div>
                <div><span className="text-gray-500">S1</span> <span className="text-emerald-400 font-mono">{(marketData as Record<string, number>).support_1?.toFixed(2)}</span></div>
                <div><span className="text-gray-500">POC</span> <span className="text-blue-400 font-mono">{(marketData as Record<string, number>).volume_poc?.toFixed(2)}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Time info */}
        <div className="px-4 pb-4 text-xs text-gray-600 flex justify-between">
          <span>Started: {new Date(battle.started_at).toLocaleString()}</span>
          {battle.resolved_at && <span>Resolved: {new Date(battle.resolved_at).toLocaleString()}</span>}
        </div>
      </div>
    </div>
  );
}
