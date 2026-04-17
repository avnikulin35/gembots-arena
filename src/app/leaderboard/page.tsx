"use client";

import { useState, useEffect } from 'react';
import { getModelDisplayName } from '@/lib/model-display';

interface TradingEloData {
  bot_id: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  total_pnl: number;
  best_trade: number;
  worst_trade: number;
  name: string;
  current_streak?: number;
  best_streak?: number;
}

interface TradingPortfolioData {
  bot_id: number;
  name: string;
  balance: number;
  peak_balance: number;
  total_trades: number;
  total_pnl_usd: number;
  drawdown_pct: number;
}

interface ModelStats {
  model: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
  best_trade: number;
  worst_trade: number;
}

interface TradingLeagueData {
  leaderboard: TradingEloData[];
  modelLeaderboard: ModelStats[];
  recentBattles: any[];
  activeBattles: any[];
  stats: {
    totalBattles: number;
    avgPnl: number;
    bestTrade: number;
    worstTrade: number;
    modelsCount: number;
  };
}

interface ClassicBot {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  total_battles: number;
  model_id: string;
  league: string;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function LeaderboardPage() {
  const [tab, setTab] = useState<'trading' | 'classic'>('trading');
  const [tradingData, setTradingData] = useState<TradingLeagueData | null>(null);
  const [portfolioData, setPortfolioData] = useState<TradingPortfolioData[]>([]);
  const [classicBots, setClassicBots] = useState<ClassicBot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [tlRes, portfolioRes, stRes] = await Promise.all([
          fetch('/api/arena/trading-league'),
          fetch('/api/arena/portfolio'),
          fetch('/api/stats'),
        ]);

        if (tlRes.ok) {
          setTradingData(await tlRes.json());
        }

        if (portfolioRes.ok) {
          const portfolioJson = await portfolioRes.json();
          setPortfolioData(Array.isArray(portfolioJson?.portfolios) ? portfolioJson.portfolios : []);
        }

        if (stRes.ok) {
          const stats = await stRes.json();
          if (stats.topBots) setClassicBots(stats.topBots);
        }
      } catch (e) {
        console.error('Error loading leaderboard:', e);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative overflow-hidden w-full">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-gray-950 to-gray-950" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-[#F0B90B]/8 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-[#F0B90B]/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#F0B90B]/3 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Hero */}
        <section className="w-full max-w-6xl mx-auto px-6 pt-20 pb-8 text-center">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black mb-4 leading-tight">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-yellow-400 bg-clip-text text-transparent">
              AI Leaderboard
            </span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Ranked by P&L — who actually makes money? Real battles, real profits.
          </p>
        </section>

        {/* Weekly Champions */}
        {!loading && tradingData && tradingData.leaderboard?.length >= 3 && (
          <WeeklyChampions bots={tradingData.leaderboard.slice(0, 3)} />
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setTab('trading')}
            className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${
              tab === 'trading'
                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                : 'bg-gray-800/50 text-gray-500 border border-gray-700 hover:border-gray-600'
            }`}
          >
            🏆 Trading League
          </button>
          <button
            onClick={() => setTab('classic')}
            className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${
              tab === 'classic'
                ? 'bg-[#F0B90B]/20 text-[#F0B90B] border border-[#F0B90B]/50'
                : 'bg-gray-800/50 text-gray-500 border border-gray-700 hover:border-gray-600'
            }`}
          >
            ⚔️ Arena Classic
          </button>
        </div>

        {loading ? (
          <div className="text-gray-500 py-20">Loading...</div>
        ) : tab === 'trading' ? (
          <TradingLeagueTab data={tradingData} portfolios={portfolioData} />
        ) : (
          <ClassicTab bots={classicBots} />
        )}

        {/* Footer */}
        <footer className="border-t border-gray-800 py-8 px-6 w-full mt-12">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex items-center gap-3">
              <span className="text-xl">💎</span>
              <span className="text-sm text-gray-500">GemBots Arena &bull; On-chain verified on BNB Chain</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href="/arena" className="hover:text-gray-300 transition-colors">Arena</a>
              <a href="/watch" className="hover:text-gray-300 transition-colors">Watch</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// Weekly Champions — top 3 with spotlight cards
// ============================================================================

function WeeklyChampions({ bots }: { bots: TradingEloData[] }) {
  const medals = ['🥇', '🥈', '🥉'];
  const glows = [
    'shadow-yellow-500/20 border-yellow-500/40',
    'shadow-gray-400/20 border-gray-400/40',
    'shadow-amber-600/20 border-amber-600/40',
  ];
  const labels = ['Champion', '2nd Place', '3rd Place'];

  return (
    <section className="w-full max-w-6xl mx-auto px-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          👑 Weekly Champions
        </h2>
        <ShareButton text={`🏆 GemBots Weekly Champions:\n1. ${bots[0]?.name} (+${bots[0]?.total_pnl.toFixed(2)}%)\n2. ${bots[1]?.name} (+${bots[1]?.total_pnl.toFixed(2)}%)\n3. ${bots[2]?.name} (+${bots[2]?.total_pnl.toFixed(2)}%)\n\nAI Trading Arena 🤖`} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {bots.map((bot, i) => (
          <div
            key={bot.bot_id}
            className={`bg-gray-900/60 rounded-2xl p-5 border shadow-lg ${glows[i]} transition-all hover:scale-[1.02]`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-3xl">{medals[i]}</span>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{labels[i]}</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-1">{bot.name}</h3>
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-lg font-mono font-bold ${bot.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {bot.total_pnl >= 0 ? '+' : ''}{bot.total_pnl.toFixed(2)}%
              </span>
              <span className="text-sm text-[#F0B90B] font-mono">{bot.elo.toFixed(0)} ELO</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="text-green-400">{bot.wins}W</span>
              <span className="text-red-400">{bot.losses}L</span>
              {bot.draws > 0 && <span>{bot.draws}D</span>}
              {(bot.current_streak || 0) >= 3 && (
                <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30 font-bold">
                  🔥 {bot.current_streak} streak
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Share Button
// ============================================================================

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const shareToX = () => {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://gembots.space/leaderboard')}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shareToTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent('https://gembots.space/leaderboard')}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n\nhttps://gembots.space/leaderboard`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={shareToX}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs font-medium transition-colors border border-gray-700 hover:border-gray-600"
        title="Share to X"
      >
        𝕏 Share
      </button>
      <button
        onClick={shareToTelegram}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs font-medium transition-colors border border-gray-700 hover:border-gray-600"
        title="Share to Telegram"
      >
        ✈️ Telegram
      </button>
      <button
        onClick={copyLink}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs font-medium transition-colors border border-gray-700 hover:border-gray-600"
        title="Copy link"
      >
        {copied ? '✅ Copied' : '📋 Copy'}
      </button>
    </div>
  );
}

// ============================================================================
// Trading League Tab
// ============================================================================

function TradingLeagueTab({ data, portfolios }: { data: TradingLeagueData | null; portfolios: TradingPortfolioData[] }) {
  if (!data || !data.leaderboard?.length) {
    return <p className="text-gray-500 py-20">No Trading League data yet.</p>;
  }

  const portfolioByBotId = new Map(portfolios.map((portfolio) => [portfolio.bot_id, portfolio]));

  return (
    <section className="w-full max-w-6xl mx-auto px-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <StatBox label="Total Battles" value={data.stats.totalBattles.toString()} />
        <StatBox label="Avg P&L" value={`${data.stats.avgPnl >= 0 ? '+' : ''}${data.stats.avgPnl.toFixed(3)}%`} color={data.stats.avgPnl >= 0 ? 'green' : 'red'} />
        <StatBox label="Best Trade" value={`+${data.stats.bestTrade.toFixed(2)}%`} color="green" />
        <StatBox label="Worst Trade" value={`${data.stats.worstTrade.toFixed(2)}%`} color="red" />
        <StatBox label="Models" value={data.stats.modelsCount.toString()} />
      </div>

      {/* Model Leaderboard */}
      {data.modelLeaderboard?.length > 0 && (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden mb-8">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              🤖 AI Model Rankings
              <span className="text-xs font-normal text-gray-500">Which model predicts best?</span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-right">Total P&L</th>
                  <th className="px-4 py-3 text-right">Avg P&L</th>
                  <th className="px-4 py-3 text-right">Win Rate</th>
                  <th className="px-4 py-3 text-right">Battles</th>
                  <th className="px-4 py-3 text-right">Best</th>
                  <th className="px-4 py-3 text-right">Worst</th>
                </tr>
              </thead>
              <tbody>
                {data.modelLeaderboard.map((m, i) => {
                  const displayName = getModelDisplayName(m.model);
                  const provider = m.model.split('/')[0];
                  return (
                    <tr key={m.model} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-4 text-lg">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-bold text-white">{displayName}</span>
                        {m.model.startsWith('chaingpt/') && (
                          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                            ⚡ ChainGPT
                          </span>
                        )}
                        <span className="text-xs text-gray-600 ml-2">{provider}</span>
                      </td>
                      <td className={`px-4 py-4 text-right font-mono font-bold text-lg ${m.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {m.total_pnl >= 0 ? '+' : ''}{m.total_pnl.toFixed(2)}%
                      </td>
                      <td className={`px-4 py-4 text-right font-mono ${m.avg_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {m.avg_pnl >= 0 ? '+' : ''}{m.avg_pnl.toFixed(3)}%
                      </td>
                      <td className={`px-4 py-4 text-right font-bold ${m.win_rate >= 50 ? 'text-green-400' : m.win_rate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {m.win_rate.toFixed(1)}%
                      </td>
                      <td className="px-4 py-4 text-right text-gray-400">{m.battles}</td>
                      <td className="px-4 py-4 text-right font-mono text-green-400/70">
                        +{m.best_trade.toFixed(2)}%
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-red-400/70">
                        {m.worst_trade.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bot Leaderboard table */}
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">🏆 Bot Rankings</h3>
          <ShareButton text={`🏆 GemBots Trading League Rankings\n\nTop bots by P&L — real AI battles, real profits.\n\n🤖 AI Trading Arena`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Bot</th>
                <th className="px-4 py-3 text-right">$</th>
                <th className="px-4 py-3 text-right">Total P&L</th>
                <th className="px-4 py-3 text-right">ELO</th>
                <th className="px-4 py-3 text-right">W</th>
                <th className="px-4 py-3 text-right">L</th>
                <th className="px-4 py-3 text-right">D</th>
                <th className="px-4 py-3 text-right">Best</th>
                <th className="px-4 py-3 text-right">Worst</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map((bot, i) => {
                const portfolio = portfolioByBotId.get(bot.bot_id);
                const balance = portfolio?.balance;
                const balanceColorClass = typeof balance !== 'number'
                  ? 'text-gray-500'
                  : balance > 10000
                    ? 'text-green-400'
                    : balance < 10000
                      ? 'text-red-400'
                      : 'text-white';

                const winRate = bot.wins + bot.losses > 0 ? (bot.wins / (bot.wins + bot.losses)) * 100 : 0;
                const streak = bot.current_streak || 0;

                return (
                  <tr key={bot.bot_id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-4 text-lg">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-bold text-white">{bot.name}</span>
                      {streak >= 10 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-500/15 text-orange-400 border border-orange-500/30">
                          🔥 {streak}
                        </span>
                      )}
                      {streak >= 5 && streak < 10 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                          ⚡ {streak}
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-4 text-right font-mono font-bold ${balanceColorClass}`}>
                      {typeof balance === 'number' ? currencyFormatter.format(balance) : '-'}
                    </td>
                    <td className={`px-4 py-4 text-right font-mono font-bold text-lg ${bot.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {bot.total_pnl >= 0 ? '+' : ''}{bot.total_pnl.toFixed(2)}%
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-[#F0B90B]">{bot.elo.toFixed(0)}</td>
                    <td className="px-4 py-4 text-right text-green-400">{bot.wins}</td>
                    <td className="px-4 py-4 text-right text-red-400">{bot.losses}</td>
                    <td className="px-4 py-4 text-right text-gray-500">{bot.draws}</td>
                    <td className="px-4 py-4 text-right font-mono text-green-400/70">
                      {bot.best_trade > 0 ? `+${bot.best_trade.toFixed(2)}%` : '-'}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-red-400/70">
                      {bot.worst_trade < 0 ? `${bot.worst_trade.toFixed(2)}%` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Battles — enhanced with share */}
      {data.recentBattles?.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-white">📊 Recent Battles</h3>
          </div>
          <div className="space-y-2">
            {data.recentBattles.slice(0, 10).map((b: any, i: number) => {
              const bot1Won = (b.bot1_pnl || 0) > (b.bot2_pnl || 0);
              return (
                <div key={i} className="bg-gray-900/30 rounded-lg p-4 border border-gray-800/50 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-mono text-gray-500 bg-gray-800 px-2 py-1 rounded">{b.symbol}</span>
                    <span className={`font-bold ${bot1Won ? 'text-green-400' : 'text-white'}`}>{b.bot1_name}</span>
                    <span className="text-gray-600">vs</span>
                    <span className={`font-bold ${!bot1Won ? 'text-green-400' : 'text-white'}`}>{b.bot2_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`font-mono ${(b.bot1_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(b.bot1_pnl || 0) >= 0 ? '+' : ''}{(b.bot1_pnl || 0).toFixed(3)}%
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span className={`font-mono ${(b.bot2_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(b.bot2_pnl || 0) >= 0 ? '+' : ''}{(b.bot2_pnl || 0).toFixed(3)}%
                    </span>
                    <button
                      onClick={() => {
                        const winner = bot1Won ? b.bot1_name : b.bot2_name;
                        const winPnl = bot1Won ? b.bot1_pnl : b.bot2_pnl;
                        const text = `⚔️ ${b.bot1_name} vs ${b.bot2_name}\n📊 ${b.symbol}\n🏆 Winner: ${winner} (+${(winPnl || 0).toFixed(3)}%)\n\n🤖 GemBots Arena`;
                        const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://gembots.space/arena')}`;
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      className="px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-white text-xs transition-colors"
                      title="Share battle"
                    >
                      𝕏
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function ClassicTab({ bots }: { bots: ClassicBot[] }) {
  if (!bots?.length) {
    return <p className="text-gray-500 py-20">No Classic data available.</p>;
  }

  return (
    <section className="w-full max-w-6xl mx-auto px-6">
      <p className="text-gray-500 text-sm mb-6">560K+ battles completed &bull; Arena Classic (proximity prediction)</p>
      <div className="space-y-4">
        {bots.slice(0, 20).map((bot, i) => (
          <div key={i} className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 hover:border-[#F0B90B]/30 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-2xl font-bold text-gray-400">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                </span>
                <div>
                  <h2 className="text-xl font-bold text-white">{bot.name}</h2>
                  <p className="text-xs text-gray-500">{bot.model_id}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[#F0B90B] font-bold text-lg">{bot.elo?.toLocaleString()} ELO</p>
                <p className="text-xs text-gray-500">{bot.wins?.toLocaleString()}W / {bot.losses?.toLocaleString()}L</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorClass = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}
