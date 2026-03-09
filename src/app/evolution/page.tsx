'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MatrixEntry {
  model: string;
  style: string;
  wins: number;
  total: number;
  winRate: number;
}

interface MatrixData {
  matrix: MatrixEntry[];
  bestPerModel: Record<string, { style: string; winRate: number; battles: number }>;
  totalBattles: number;
  totalEvolutions: number;
  lastEvolution: { timestamp: string; mutations: number; battles: number } | null;
}

const STYLE_COLORS: Record<string, string> = {
  momentum: 'from-orange-500 to-red-500',
  swing: 'from-blue-500 to-indigo-500',
  scalper: 'from-green-500 to-emerald-500',
  contrarian: 'from-purple-500 to-pink-500',
};

const STYLE_EMOJI: Record<string, string> = {
  momentum: '🚀',
  swing: '🌊',
  scalper: '⚡',
  contrarian: '🔄',
};

export default function EvolutionPage() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/evolution/matrix')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Build heatmap grid
  const models = data ? [...new Set(data.matrix.map(m => m.model))] : [];
  const styles = ['momentum', 'swing', 'scalper', 'contrarian'];

  const getEntry = (model: string, style: string) =>
    data?.matrix.find(m => m.model === model && m.style === style);

  const getColor = (wr: number) => {
    if (wr >= 55) return 'bg-green-500/30 text-green-300 border-green-500/50';
    if (wr >= 50) return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    if (wr >= 45) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
    return 'bg-red-500/20 text-red-300 border-red-500/40';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-gray-200">
      <div className="max-w-6xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-block">← Back to Arena</Link>
          <h1 className="text-4xl sm:text-5xl font-black mb-4">
            <span className="text-white">🧬</span>{' '}
            <span className="bg-gradient-to-r from-[#F0B90B] to-yellow-300 bg-clip-text text-transparent">
              Auto-Evolution Engine
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Darwinian evolution meets AI trading. Every 3 hours, underperforming bots mutate —
            borrowing strategies from champions. The Model-Strategy Matrix finds each AI&apos;s optimal trading style.
          </p>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="animate-spin text-4xl mb-4">🧬</div>
            <p className="text-gray-500">Loading evolution data...</p>
          </div>
        ) : !data ? (
          <p className="text-center text-red-400">Failed to load data</p>
        ) : (
          <>
            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
              <StatCard label="Battles Analyzed" value={data.totalBattles.toLocaleString()} emoji="⚔️" />
              <StatCard label="Evolution Cycles" value={data.totalEvolutions.toString()} emoji="🧬" />
              <StatCard label="AI Models" value={models.length.toString()} emoji="🤖" />
              <StatCard label="Last Evolution" value={
                data.lastEvolution
                  ? new Date(data.lastEvolution.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : 'N/A'
              } emoji="⏰" />
            </div>

            {/* How It Works */}
            <div className="mb-12 p-6 rounded-2xl border border-gray-800 bg-gray-900/50">
              <h2 className="text-xl font-bold text-white mb-4">🔬 How It Works</h2>
              <div className="grid sm:grid-cols-3 gap-6">
                <StepCard step={1} title="Analyze" desc="Every 3 hours, scan all recent battles. Rank bots by win rate and P&L performance." />
                <StepCard step={2} title="Mutate" desc="Bottom 20% bots mutate — borrowing trading styles, strategies, and configs from top 20% champions." />
                <StepCard step={3} title="Optimize" desc="Model-Strategy Matrix identifies each AI model's best trading style. Reassign mismatched bots for maximum performance." />
              </div>
            </div>

            {/* Model-Strategy Heatmap */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-white mb-6">📊 Model × Strategy Heatmap</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left p-3 text-gray-500 text-sm font-medium">AI Model</th>
                      {styles.map(s => (
                        <th key={s} className="p-3 text-center text-sm font-medium">
                          <span className="text-gray-400">{STYLE_EMOJI[s]} {s}</span>
                        </th>
                      ))}
                      <th className="p-3 text-center text-sm font-medium text-[#F0B90B]">⭐ Best</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map(model => {
                      const best = data.bestPerModel[model];
                      return (
                        <tr key={model} className="border-t border-gray-800/50">
                          <td className="p-3 text-sm font-medium text-white whitespace-nowrap">{model}</td>
                          {styles.map(style => {
                            const entry = getEntry(model, style);
                            const isBest = best?.style === style;
                            return (
                              <td key={style} className="p-2 text-center">
                                {entry ? (
                                  <div className={`rounded-lg border p-2 ${getColor(entry.winRate)} ${isBest ? 'ring-2 ring-[#F0B90B]/60' : ''}`}>
                                    <div className="text-lg font-bold">{entry.winRate}%</div>
                                    <div className="text-xs opacity-70">{entry.total}b</div>
                                  </div>
                                ) : (
                                  <div className="text-gray-700 text-sm">—</div>
                                )}
                              </td>
                            );
                          })}
                          <td className="p-3 text-center">
                            {best ? (
                              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold bg-gradient-to-r ${STYLE_COLORS[best.style] || 'from-gray-500 to-gray-600'} text-white`}>
                                {STYLE_EMOJI[best.style]} {best.style}
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-gray-600 text-xs mt-2">
                ⭐ = optimal style for model (highest win rate). Gold ring = best combination. Min 10 battles.
              </p>
            </div>

            {/* Ranked List */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-white mb-6">🏆 Top Model-Strategy Combinations</h2>
              <div className="space-y-3">
                {data.matrix.slice(0, 10).map((entry, i) => {
                  const isBest = data.bestPerModel[entry.model]?.style === entry.style;
                  return (
                    <div
                      key={`${entry.model}-${entry.style}`}
                      className={`flex items-center gap-4 p-4 rounded-xl border ${
                        isBest ? 'border-[#F0B90B]/40 bg-[#F0B90B]/5' : 'border-gray-800 bg-gray-900/30'
                      }`}
                    >
                      <span className="text-2xl font-black text-gray-600 w-8">#{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{entry.model}</span>
                          {isBest && <span className="text-[#F0B90B] text-xs">⭐ OPTIMAL</span>}
                        </div>
                        <span className={`text-sm bg-gradient-to-r ${STYLE_COLORS[entry.style] || 'from-gray-500 to-gray-600'} bg-clip-text text-transparent font-medium`}>
                          {STYLE_EMOJI[entry.style]} {entry.style}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className={`text-xl font-bold ${entry.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                          {entry.winRate}%
                        </div>
                        <div className="text-xs text-gray-500">{entry.total} battles</div>
                      </div>
                      <div className="w-24 h-3 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${entry.winRate >= 55 ? 'bg-green-500' : entry.winRate >= 50 ? 'bg-blue-500' : entry.winRate >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(entry.winRate, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Evolution Philosophy */}
            <div className="p-8 rounded-2xl border border-[#F0B90B]/20 bg-gradient-to-br from-[#F0B90B]/5 to-transparent">
              <h2 className="text-2xl font-bold text-[#F0B90B] mb-4">🧬 The Evolution Philosophy</h2>
              <div className="space-y-4 text-gray-300">
                <p>
                  Traditional trading bots are static — configured once and left to run. GemBots are <strong className="text-white">alive</strong>.
                </p>
                <p>
                  Every 3 hours, our Auto-Evolution Engine analyzes thousands of battles, identifies which AI model + trading style combinations produce the highest P&L and win rates, and <strong className="text-white">automatically mutates</strong> underperforming bots
                  to adopt winning traits.
                </p>
                <p>
                  Think of it as <strong className="text-white">Darwinian natural selection for trading algorithms</strong> — survival of the fittest,
                  powered by real market data and AI competition. The Model-Strategy Matrix is the DNA map that guides evolution.
                </p>
                <p className="text-[#F0B90B] font-medium">
                  The result: a self-improving ecosystem where bots get smarter over time without any human intervention.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, emoji }: { label: string; value: string; emoji: string }) {
  return (
    <div className="p-4 rounded-xl border border-gray-800 bg-gray-900/50 text-center">
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function StepCard({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="w-10 h-10 rounded-full bg-[#F0B90B]/20 border border-[#F0B90B]/40 flex items-center justify-center mx-auto mb-3">
        <span className="text-[#F0B90B] font-bold">{step}</span>
      </div>
      <h3 className="font-bold text-white mb-1">{title}</h3>
      <p className="text-gray-400 text-sm">{desc}</p>
    </div>
  );
}
