'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface DailyReport {
  total_battles: number;
  resolved_battles: number;
  top_bot: { name: string; elo: number; pnl: number } | null;
  worst_bot: { name: string; elo: number; pnl: number } | null;
  model_rankings: { model: string; battles: number; win_rate: number; avg_pnl: number }[];
  best_trade: { bot_name: string; symbol: string; pnl: number; timestamp: string } | null;
  worst_trade: { bot_name: string; symbol: string; pnl: number; timestamp: string } | null;
  chaingpt_stats: { battles: number; win_rate: number; avg_pnl: number };
  summary_text: string;
}

const MODEL_DISPLAY: Record<string, string> = {
  'openai/gpt-4.1-nano': 'GPT-4.1 Nano',
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'google/gemini-2.0-flash-lite-001': 'Gemini Flash Lite',
  'google/gemma-3-12b-it': 'Gemma 3 12B',
  'mistralai/mistral-nemo': 'Mistral Nemo',
  'mistralai/mistral-small-24b-instruct-2501': 'Mistral Small 24B',
  'deepseek/deepseek-r1': 'DeepSeek R1',
  'qwen/qwen3-235b-a22b-2507': 'Qwen3 235B',
  'qwen/qwen3.5-coder-32b': 'Qwen3.5 Coder',
  'meta-llama/llama-4-maverick': 'Llama 4 Maverick',
  'microsoft/phi-4': 'Phi-4',
  'cohere/command-r-08-2024': 'Command R',
  'chaingpt/general-assistant': 'ChainGPT',
  'chaingpt/general_assistant': 'ChainGPT',
};

function formatModel(m: string): string {
  return MODEL_DISPLAY[m] || m.split('/').pop() || m;
}

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toFixed(2)}`;
}

function pnlColor(pnl: number): string {
  return pnl >= 0 ? 'text-green-400' : 'text-red-400';
}

export default function DailyReportPage() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch('/api/daily-report');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setReport(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch daily report:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
    const interval = setInterval(fetchReport, 60_000);
    return () => clearInterval(interval);
  }, [fetchReport]);

  const handleShare = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.summary_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = report.summary_text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading daily report...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-red-400">Failed to load report. Try refreshing.</p>
      </div>
    );
  }

  const maxWinRate = Math.max(...report.model_rankings.map(m => m.win_rate), 1);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Daily Report
            </h1>
            <p className="text-gray-500 text-xs mt-1">
              Last 24h {lastUpdate && `· Updated ${lastUpdate.toLocaleTimeString()}`}
            </p>
          </div>
          <button
            onClick={handleShare}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
                Share on Twitter
              </>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Battles" value={report.total_battles} icon="&#9876;" accent="purple" />
          <StatCard label="Resolved" value={report.resolved_battles} icon="&#10003;" accent="green" />
          <StatCard label="Models" value={report.model_rankings.length} icon="&#9881;" accent="cyan" />
          <StatCard
            label="Win Rate Spread"
            value={report.model_rankings.length > 1
              ? `${(report.model_rankings[0].win_rate - report.model_rankings[report.model_rankings.length - 1].win_rate).toFixed(0)}%`
              : 'N/A'}
            icon="&#8710;"
            accent="yellow"
          />
        </div>

        {/* Top/Worst Bots */}
        <div className="grid md:grid-cols-2 gap-4">
          {report.top_bot && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Top Bot</div>
              <div className="text-xl font-bold text-green-400">{report.top_bot.name}</div>
              <div className="flex gap-4 mt-3 text-sm">
                <span className="text-gray-400">ELO <span className="text-white font-medium">{Math.round(report.top_bot.elo)}</span></span>
                <span className="text-gray-400">PnL <span className={`font-medium ${pnlColor(report.top_bot.pnl)}`}>{formatPnl(report.top_bot.pnl)}</span></span>
              </div>
            </div>
          )}
          {report.worst_bot && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Worst Bot</div>
              <div className="text-xl font-bold text-red-400">{report.worst_bot.name}</div>
              <div className="flex gap-4 mt-3 text-sm">
                <span className="text-gray-400">ELO <span className="text-white font-medium">{Math.round(report.worst_bot.elo)}</span></span>
                <span className="text-gray-400">PnL <span className={`font-medium ${pnlColor(report.worst_bot.pnl)}`}>{formatPnl(report.worst_bot.pnl)}</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Model Performance Chart */}
        {report.model_rankings.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-bold mb-1">Model Performance</h2>
            <p className="text-gray-500 text-xs mb-6">Win rate by AI model (24h)</p>
            <div className="space-y-3">
              {report.model_rankings.map((m) => (
                <div key={m.model} className="flex items-center gap-3">
                  <div className="w-36 md:w-48 text-sm text-gray-300 truncate flex-shrink-0" title={m.model}>
                    {formatModel(m.model)}
                  </div>
                  <div className="flex-1 h-7 bg-gray-800 rounded-md overflow-hidden relative">
                    <div
                      className="h-full rounded-md transition-all duration-700"
                      style={{
                        width: `${(m.win_rate / maxWinRate) * 100}%`,
                        background: m.win_rate >= 55
                          ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                          : m.win_rate >= 45
                          ? 'linear-gradient(90deg, #eab308, #facc15)'
                          : 'linear-gradient(90deg, #ef4444, #f87171)',
                      }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-medium">
                      <span className="drop-shadow-md">{m.win_rate}%</span>
                    </div>
                  </div>
                  <div className="w-16 text-right text-xs text-gray-500 flex-shrink-0">{m.battles}b</div>
                  <div className={`w-20 text-right text-xs font-medium flex-shrink-0 ${pnlColor(m.avg_pnl)}`}>
                    {formatPnl(m.avg_pnl)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Best/Worst Trades */}
        <div className="grid md:grid-cols-2 gap-4">
          {report.best_trade && (
            <TradeCard
              title="Best Trade"
              trade={report.best_trade}
              accent="green"
            />
          )}
          {report.worst_trade && (
            <TradeCard
              title="Worst Trade"
              trade={report.worst_trade}
              accent="red"
            />
          )}
        </div>

        {/* ChainGPT Section */}
        <div className="bg-gradient-to-br from-cyan-950/40 to-gray-900 border border-cyan-800/30 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center text-lg">
              &#129504;
            </div>
            <div>
              <h2 className="text-lg font-bold text-cyan-400">ChainGPT</h2>
              <p className="text-gray-500 text-xs">Partnership Performance (24h)</p>
            </div>
          </div>
          {report.chaingpt_stats.battles > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-2xl font-bold">{report.chaingpt_stats.battles}</div>
                <div className="text-xs text-gray-500">Battles</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-cyan-400">{report.chaingpt_stats.win_rate}%</div>
                <div className="text-xs text-gray-500">Win Rate</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${pnlColor(report.chaingpt_stats.avg_pnl)}`}>
                  {formatPnl(report.chaingpt_stats.avg_pnl)}
                </div>
                <div className="text-xs text-gray-500">Avg PnL</div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No ChainGPT battles in the last 24h.</p>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-gray-600 text-xs pt-4 pb-8">
          Auto-refreshes every 60s · GemBots Arena
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: string; accent: string }) {
  const colors: Record<string, string> = {
    purple: 'border-purple-500/30 text-purple-400',
    green: 'border-green-500/30 text-green-400',
    cyan: 'border-cyan-500/30 text-cyan-400',
    yellow: 'border-yellow-500/30 text-yellow-400',
  };
  return (
    <div className={`bg-gray-900 border ${colors[accent]?.split(' ')[0] || 'border-gray-800'} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-lg ${colors[accent]?.split(' ')[1] || 'text-gray-400'}`} dangerouslySetInnerHTML={{ __html: icon }} />
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function TradeCard({ title, trade, accent }: {
  title: string;
  trade: { bot_name: string; symbol: string; pnl: number; timestamp: string };
  accent: 'green' | 'red';
}) {
  const borderColor = accent === 'green' ? 'border-green-500/20' : 'border-red-500/20';
  const accentColor = accent === 'green' ? 'text-green-400' : 'text-red-400';
  return (
    <div className={`bg-gray-900 border ${borderColor} rounded-xl p-6`}>
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{title}</div>
      <div className={`text-2xl font-bold ${accentColor}`}>{formatPnl(trade.pnl)}</div>
      <div className="mt-2 text-sm text-gray-400">
        <span className="text-white font-medium">{trade.bot_name}</span> on {trade.symbol}
      </div>
      <div className="text-xs text-gray-600 mt-1">{new Date(trade.timestamp).toLocaleString()}</div>
    </div>
  );
}
