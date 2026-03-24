import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface ChainGPTData {
  date?: string;
  bot?: { name?: string; id?: number; elo?: number };
  battles?: { total?: number; last24h?: number; wins?: number; losses?: number; draws?: number; winRate?: number };
  commentator?: { total?: number; last24h?: number; totalComments?: number; chaingptMentions?: number };
  apiCalls?: { battles?: number; commentator?: number; strategyFactory?: number; other?: number; total?: number; last24h?: number };
  credits?: { estimated_used?: number; total?: number; remaining?: number; usagePercent?: number };
  strategyFactory?: { historicalCalls?: number };
}

function loadData(): ChainGPTData | null {
  try {
    const reportPath = path.join(process.cwd(), 'data', 'chaingpt-report.json');
    if (!fs.existsSync(reportPath)) return null;
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch { return null; }
}

function fmt(value: number) { return value.toLocaleString('en-US'); }
function pct(value: number) { return `${value.toFixed(1)}%`; }

function getWinRateColor(winRate: number) {
  if (winRate > 50) return 'text-green-400';
  if (winRate >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

export default function ChainGPTUsagePage() {
  const data = loadData();

  const metrics = (() => {
    const battlesTotal = data?.battles?.total ?? 0;
    const battlesLast24h = data?.battles?.last24h ?? 0;
    const wins = data?.battles?.wins ?? 0;
    const losses = data?.battles?.losses ?? 0;
    const draws = data?.battles?.draws ?? 0;
    const winRate = data?.battles?.winRate ?? 0;

    const commentatorTotal = data?.commentator?.total ?? data?.commentator?.totalComments ?? 0;
    const commentatorLast24h = data?.commentator?.last24h ?? 0;

    const apiBattles = data?.apiCalls?.battles ?? battlesTotal;
    const apiCommentator = data?.apiCalls?.commentator ?? commentatorTotal;
    const apiOther = data?.apiCalls?.other ?? data?.apiCalls?.strategyFactory ?? data?.strategyFactory?.historicalCalls ?? Math.max(0, (data?.apiCalls?.total ?? 0) - apiBattles - apiCommentator);
    const apiTotal = data?.apiCalls?.total ?? apiBattles + apiCommentator + apiOther;
    const apiLast24h = data?.apiCalls?.last24h ?? battlesLast24h + commentatorLast24h;

    const creditsTotal = data?.credits?.total ?? 1500000;
    const creditsUsed = data?.credits?.estimated_used ?? apiTotal;
    const usagePercent = data?.credits?.usagePercent ?? (creditsTotal > 0 ? (creditsUsed / creditsTotal) * 100 : 0);
    const dailyBurn = apiLast24h;

    const breakdown = [
      {
        label: 'Battles',
        value: apiBattles,
        width: apiTotal > 0 ? (apiBattles / apiTotal) * 100 : 0,
        color: 'from-orange-500 to-orange-400',
        textColor: 'text-orange-300',
      },
      {
        label: 'Commentator',
        value: apiCommentator,
        width: apiTotal > 0 ? (apiCommentator / apiTotal) * 100 : 0,
        color: 'from-cyan-500 to-sky-400',
        textColor: 'text-cyan-300',
      },
      {
        label: 'Other',
        value: apiOther,
        width: apiTotal > 0 ? (apiOther / apiTotal) * 100 : 0,
        color: 'from-violet-500 to-fuchsia-400',
        textColor: 'text-violet-300',
      },
    ];

    return {
      battlesTotal,
      battlesLast24h,
      wins,
      losses,
      draws,
      winRate,
      commentatorTotal,
      commentatorLast24h,
      apiTotal,
      apiLast24h,
      creditsTotal,
      creditsUsed,
      usagePercent,
      dailyBurn,
      breakdown,
    };
  })();

  const dateLabel = data?.date || '—';

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] px-4 py-10 text-white flex items-center justify-center">
        <div className="text-gray-400 text-lg">Report not generated yet. Run: node scripts/chaingpt-usage-report.js</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 rounded-3xl border border-[#333] bg-[#12121c] p-6 shadow-[0_0_40px_rgba(255,102,0,0.08)] sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#ff6600]/30 bg-[#ff6600]/10 px-3 py-1 text-sm font-medium text-[#ff9a57]">
                <span className="h-2 w-2 rounded-full bg-[#ff6600]" />
                Powered by ChainGPT AI
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                ChainGPT Integration Report
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400 sm:text-base">
                Ops dashboard — ChainGPT battle performance, commentary generation, API consumption, and credit usage.
              </p>
            </div>
            <div className="rounded-2xl border border-[#333] bg-[#0f0f16] px-4 py-3 text-sm text-gray-300">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Last updated</div>
              <div className="mt-1 text-base font-semibold text-white">{dateLabel}</div>
            </div>
          </div>
        </div>

        <>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <section className="rounded-3xl border border-[#333] bg-[#1a1a2e] p-6">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Trading Bot</div>
                    <div className="mt-2 text-2xl font-bold text-white">{data?.bot?.name ?? 'ChainGPT'}</div>
                  </div>
                  <div className="rounded-full border border-[#ff6600]/30 bg-[#ff6600]/10 px-3 py-1 text-xs font-semibold text-[#ff9a57]">
                    Bot #{data?.bot?.id ?? 38}
                  </div>
                </div>

                <div className="mb-5">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">ELO Rating</div>
                  <div className="mt-2 text-5xl font-black text-[#ff6600]">{fmt(data?.bot?.elo ?? 1500)}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Battles</div>
                    <div className="mt-2 text-2xl font-bold text-white">{fmt(metrics.battlesTotal)}</div>
                    <div className="mt-1 text-sm text-gray-400">{fmt(metrics.battlesLast24h)} in last 24h</div>
                  </div>
                  <div className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Win Rate</div>
                    <div className={`mt-2 text-2xl font-bold ${getWinRateColor(metrics.winRate)}`}>
                      {pct(metrics.winRate)}
                    </div>
                    <div className="mt-1 text-sm text-gray-400">Color coded performance</div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[#333] bg-[#121220] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">W / L / D</div>
                  <div className="mt-3 flex items-center gap-3 text-sm font-semibold sm:text-base">
                    <span className="rounded-full bg-green-500/10 px-3 py-1 text-green-300">W {fmt(metrics.wins)}</span>
                    <span className="rounded-full bg-red-500/10 px-3 py-1 text-red-300">L {fmt(metrics.losses)}</span>
                    <span className="rounded-full bg-gray-500/10 px-3 py-1 text-gray-300">D {fmt(metrics.draws)}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-[#333] bg-[#1a1a2e] p-6">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Battle Commentator</div>
                <div className="mt-2 text-2xl font-bold text-white">AI Commentary Engine</div>

                <div className="mt-6 grid gap-4">
                  <div className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Total commentaries generated</div>
                    <div className="mt-2 text-4xl font-black text-cyan-300">{fmt(metrics.commentatorTotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Last 24h</div>
                    <div className="mt-2 text-3xl font-bold text-white">{fmt(metrics.commentatorLast24h)}</div>
                  </div>
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm leading-6 text-cyan-100/90">
                    Every battle gets AI commentary powered by ChainGPT.
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-[#333] bg-[#1a1a2e] p-6">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Credits</div>
                <div className="mt-2 text-2xl font-bold text-white">Usage & Burn</div>

                <div className="mt-6 rounded-2xl border border-[#333] bg-[#121220] p-4">
                  <div className="flex items-center justify-between gap-3 text-sm text-gray-300">
                    <span>{fmt(metrics.creditsUsed)} used</span>
                    <span>{fmt(metrics.creditsTotal)} total</span>
                  </div>

                  <div className="mt-4 h-4 overflow-hidden rounded-full bg-[#0d0d0d]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#ff6600] via-orange-400 to-amber-300 transition-all"
                      style={{ width: `${Math.min(metrics.usagePercent, 100)}%` }}
                    />
                  </div>

                  <div className="mt-3 text-3xl font-black text-[#ff6600]">{pct(metrics.usagePercent)}</div>
                  <div className="mt-1 text-sm text-gray-400">Estimated platform-wide credit consumption</div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Estimated daily burn rate</div>
                    <div className="mt-2 text-2xl font-bold text-white">{fmt(metrics.dailyBurn)}</div>
                    <div className="mt-1 text-sm text-gray-400">API calls / 24h</div>
                  </div>
                  <div className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">API calls total</div>
                    <div className="mt-2 text-2xl font-bold text-white">{fmt(metrics.apiTotal)}</div>
                    <div className="mt-1 text-sm text-gray-400">Tracked consumption</div>
                  </div>
                </div>
              </section>
            </div>

            <section className="mt-6 rounded-3xl border border-[#333] bg-[#1a1a2e] p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">API Calls Breakdown</div>
                  <h2 className="mt-2 text-2xl font-bold text-white">Battles vs Commentator vs Other</h2>
                </div>
                <div className="text-sm text-gray-400">Pure CSS stacked bar • no external chart libs</div>
              </div>

              <div className="mt-6 overflow-hidden rounded-full border border-[#333] bg-[#0d0d0d]">
                <div className="flex h-7 w-full">
                  {metrics.breakdown.map((item) => (
                    <div
                      key={item.label}
                      className={`h-full bg-gradient-to-r ${item.color}`}
                      style={{ width: `${item.width}%` }}
                      title={`${item.label}: ${fmt(item.value)}`}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                {metrics.breakdown.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-[#333] bg-[#121220] p-4">
                    <div className={`text-sm font-semibold ${item.textColor}`}>{item.label}</div>
                    <div className="mt-2 text-3xl font-black text-white">{fmt(item.value)}</div>
                    <div className="mt-1 text-sm text-gray-400">
                      {metrics.apiTotal > 0 ? pct((item.value / metrics.apiTotal) * 100) : '0.0%'} of tracked usage
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
      </div>
    </div>
  );
}
