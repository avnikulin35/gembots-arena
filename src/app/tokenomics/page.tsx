import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Bot,
  Coins,
  Flame,
  Gavel,
  Gem,
  Layers3,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'GemBots Tokenomics — GEMBOT on BNB Chain',
  description:
    'GEMBOT tokenomics for GemBots Arena: utility, distribution, compete-to-earn mechanics, and TGE roadmap on BNB Chain.',
};

const HERO_STATS = [
  { label: 'Total Supply', value: '1B', hint: 'GEMBOT' },
  { label: 'Network', value: 'BNB Chain', hint: 'BEP-20' },
  { label: 'Initial Float', value: '10.19%', hint: '101.9M at TGE' },
  { label: 'Live Product Stats', value: '749K+', hint: 'battles completed' },
];

const UTILITY_BLOCKS = [
  {
    icon: Gem,
    title: 'NFA Minting',
    text: 'Future NFA minting, premium agent creation, and upgrade paths are priced in GEMBOT to create direct token demand.',
  },
  {
    icon: Trophy,
    title: 'Compete-to-Earn',
    text: 'Winning bots earn GEMBOT based on battle performance, ELO, rarity tier, and anti-farming controls.',
  },
  {
    icon: Coins,
    title: 'Battle Betting',
    text: 'Users can place battle-side predictions and event wagers in token, increasing platform velocity and treasury flows.',
  },
  {
    icon: Sparkles,
    title: 'Staking Perks',
    text: 'Stake GEMBOT to unlock reward boosts, premium strategies, private leagues, and reduced platform fees.',
  },
  {
    icon: Gavel,
    title: 'Governance',
    text: 'Holders and stakers can help steer new pairs, arena rules, model support, and treasury priorities over time.',
  },
];

const DISTRIBUTION = [
  { label: 'Community & Rewards', percent: 28, color: 'from-violet-500 to-fuchsia-500' },
  { label: 'Treasury', percent: 20, color: 'from-fuchsia-500 to-purple-500' },
  { label: 'Ecosystem Fund', percent: 15, color: 'from-pink-500 to-rose-500' },
  { label: 'Team', percent: 15, color: 'from-cyan-500 to-sky-500' },
  { label: 'Liquidity', percent: 10, color: 'from-emerald-500 to-green-500' },
  { label: 'Marketing & Growth', percent: 7, color: 'from-amber-400 to-yellow-500' },
  { label: 'Advisors', percent: 3, color: 'from-red-500 to-rose-500' },
  { label: 'Public Sale / IDO', percent: 2, color: 'from-slate-400 to-slate-300' },
];

const EARN_FACTORS = [
  {
    title: 'Base win reward',
    value: '8 GEMBOT',
    text: 'Starting reward unit before multipliers are applied.',
  },
  {
    title: 'Tier multiplier',
    value: '1.00× → 2.40×',
    text: 'Bronze through Legendary rarity tiers scale upside.',
  },
  {
    title: 'ELO multiplier',
    value: '0.85× → 1.70×',
    text: 'Higher-rated bots earn more for consistently strong performance.',
  },
  {
    title: 'Daily cap',
    value: '350K / day',
    text: 'Emission ceiling keeps rewards bounded and sustainable.',
  },
];

const ROADMAP = [
  {
    phase: 'Phase 1',
    title: 'Token Launch + Staking',
    text: 'Deploy GEMBOT, launch liquidity, and activate staking with fee discounts and holder utility.',
    icon: Rocket,
  },
  {
    phase: 'Phase 2',
    title: 'Compete-to-Earn Activation',
    text: 'Turn proven arena performance into tokenized rewards with ELO-aware emissions and anti-abuse controls.',
    icon: Bot,
  },
  {
    phase: 'Phase 3',
    title: 'Betting + Governance',
    text: 'Expand utility into battle betting, treasury signaling, and voting on new pairs, rules, and models.',
    icon: Layers3,
  },
];

const distributionGradient = `conic-gradient(
  #8b5cf6 0% 28%,
  #c026d3 28% 48%,
  #ec4899 48% 63%,
  #06b6d4 63% 78%,
  #22c55e 78% 88%,
  #f59e0b 88% 95%,
  #ef4444 95% 98%,
  #cbd5e1 98% 100%
)`;

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="max-w-3xl">
      <div className="mb-3 inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-200">
        {eyebrow}
      </div>
      <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-gray-400">{text}</p>
    </div>
  );
}

export default function TokenomicsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.20),transparent_28%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_24%),linear-gradient(to_bottom,#090b14,#07070b)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:64px_64px]" />

      <div className="relative z-10">
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-24 sm:pt-28">
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-200">
                <ShieldCheck className="h-4 w-4" /> Hidden page · direct link only
              </div>
              <h1 className="text-5xl font-black leading-none tracking-tight sm:text-6xl md:text-7xl">
                <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-white bg-clip-text text-transparent">
                  GEMBOT Token
                </span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-300 sm:text-xl">
                The token economy for GemBots Arena — a live AI trading league on BNB Chain built around minting, staking, rewards, betting, and governance.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <div className="rounded-full border border-violet-500/25 bg-white/5 px-4 py-2 text-sm text-violet-100">1,000,000,000 total supply</div>
                <div className="rounded-full border border-cyan-500/25 bg-white/5 px-4 py-2 text-sm text-cyan-100">BNB Chain · BEP-20</div>
                <div className="rounded-full border border-emerald-500/25 bg-white/5 px-4 py-2 text-sm text-emerald-100">101.9M initial circulating</div>
              </div>
            </div>

            <div className="rounded-3xl border border-violet-500/20 bg-white/5 p-6 shadow-[0_0_60px_rgba(139,92,246,0.10)] backdrop-blur-sm">
              <div className="grid grid-cols-2 gap-4">
                {HERO_STATS.map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-white/8 bg-black/20 p-5">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">{stat.label}</div>
                    <div className="mt-2 text-2xl font-black text-white sm:text-3xl">{stat.value}</div>
                    <div className="mt-1 text-sm text-gray-400">{stat.hint}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-fuchsia-500/20 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 p-5">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-violet-200">Core Thesis</div>
                <p className="mt-2 text-sm leading-7 text-gray-300">
                  GEMBOT turns real arena activity into a scalable on-chain game economy: stronger bots earn more, committed holders unlock more, and treasury value grows with platform usage.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading
            eyebrow="Token Utility"
            title="Five core demand loops"
            text="The token is designed to sit inside platform activity rather than outside it. Every major utility loop reinforces product usage and long-term alignment."
          />

          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-5">
            {UTILITY_BLOCKS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border border-white/8 bg-white/[0.04] p-6 backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-violet-400/30 hover:bg-white/[0.06]"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-200">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-gray-400">{item.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading
            eyebrow="Distribution"
            title="1B supply allocated for growth, treasury, and long-term alignment"
            text="The distribution is weighted toward community incentives, treasury durability, and ecosystem expansion while keeping TGE float relatively conservative."
          />

          <div className="mt-12 grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="flex items-center justify-center rounded-3xl border border-white/8 bg-white/[0.04] p-8">
              <div className="relative flex h-72 w-72 items-center justify-center rounded-full" style={{ background: distributionGradient }}>
                <div className="flex h-44 w-44 flex-col items-center justify-center rounded-full border border-white/8 bg-[#0b0d16] text-center shadow-[inset_0_0_20px_rgba(139,92,246,0.14)]">
                  <div className="text-4xl font-black text-white">1B</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-gray-400">Total Supply</div>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {DISTRIBUTION.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{item.label}</div>
                    <div className="text-sm font-black text-violet-200">{item.percent}%</div>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/6">
                    <div className={`h-full rounded-full bg-gradient-to-r ${item.color}`} style={{ width: `${item.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading
            eyebrow="Earn Mechanics"
            title="Bots earn tokens by winning, climbing ELO, and sustaining quality"
            text="Compete-to-earn rewards are intentionally performance-weighted. The model rewards better agents and long-term participation while capping daily emissions."
          />

          <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-white/8 bg-white/[0.04] p-8">
              <div className="mb-6 inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
                Reward Formula
              </div>
              <div className="rounded-2xl border border-fuchsia-500/20 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 p-5 text-base font-semibold leading-8 text-white sm:text-lg">
                Reward per win = Base Win Reward × Tier Multiplier × ELO Multiplier × Activity Quality Multiplier
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {EARN_FACTORS.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/8 bg-black/20 p-5">
                    <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{item.title}</div>
                    <div className="mt-2 text-2xl font-black text-white">{item.value}</div>
                    <p className="mt-2 text-sm leading-7 text-gray-400">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/8 bg-white/[0.04] p-8">
              <div className="mb-5 flex items-center gap-3 text-white">
                <Flame className="h-5 w-5 text-fuchsia-300" />
                <h3 className="text-xl font-bold">Tier progression snapshot</h3>
              </div>
              <div className="space-y-4">
                {[
                  ['Bronze', '1.00×'],
                  ['Silver', '1.15×'],
                  ['Gold', '1.35×'],
                  ['Platinum', '1.60×'],
                  ['Diamond', '1.95×'],
                  ['Legendary', '2.40×'],
                ].map(([tier, mult], index) => (
                  <div key={tier} className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-200">{index + 1}</div>
                      <span className="font-semibold text-white">{tier}</span>
                    </div>
                    <span className="text-sm font-black text-fuchsia-200">{mult}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm leading-7 text-emerald-100">
                Emissions decay over time and anti-farming controls limit per-bot and per-wallet concentration.
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading
            eyebrow="TGE Roadmap"
            title="Three-step rollout from launch to full token economy"
            text="The roadmap stages utility in a controlled order: first liquidity and staking, then rewards, then deeper game-economy features like betting and governance."
          />

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {ROADMAP.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.phase} className="rounded-3xl border border-white/8 bg-white/[0.04] p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
                      {item.phase}
                    </div>
                    <Icon className="h-5 w-5 text-fuchsia-300" />
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-white">{item.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-gray-400">{item.text}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-12 rounded-3xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 p-8 text-center">
            <div className="mx-auto max-w-3xl">
              <h3 className="text-2xl font-black text-white sm:text-3xl">Built for direct URL access now, ready for wider rollout later</h3>
              <p className="mt-4 text-base leading-8 text-gray-300">
                This page is intentionally hidden from navigation for now. It exists as a clean tokenomics landing page for partners, investors, and launch discussions.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/whitepaper"
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition-all hover:border-violet-400/40 hover:bg-white/10"
                >
                  Read Whitepaper
                </Link>
                <Link
                  href="/mint"
                  className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-3 font-semibold text-white transition-all hover:shadow-[0_0_30px_rgba(168,85,247,0.35)]"
                >
                  Explore GemBots
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
