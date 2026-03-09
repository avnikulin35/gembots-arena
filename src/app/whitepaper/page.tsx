import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'GemBots Whitepaper — Non-Fungible Agents on BNB Chain',
  description: 'The complete guide to GemBots: NFA system, strategy layer, evolution tiers, marketplace economics, and roadmap.',
};

const NFA_CONTRACT = '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';

const SECTIONS = [
  { id: 'vision', label: '1. Vision' },
  { id: 'nfa-system', label: '2. NFA System' },
  { id: 'strategy-layer', label: '3. Strategy Layer' },
  { id: 'evolution', label: '4. Evolution & Tiers' },
  { id: 'marketplace', label: '5. Marketplace & Economics' },
  { id: 'battle-system', label: '6. Battle System' },
  { id: 'tokenomics', label: '7. Tokenomics' },
  { id: 'roadmap', label: '8. Roadmap' },
  { id: 'open-source', label: '9. Open Source & Transparency' },
];

function GitHubIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-gray-200">
      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">
            <span className="bg-gradient-to-r from-[#F0B90B] to-yellow-300 bg-clip-text text-transparent">GemBots</span>{' '}
            <span className="text-white">Whitepaper</span>
          </h1>
          <p className="text-gray-400 text-lg">Non-Fungible Agents — Create, Train &amp; Trade AI on BNB Chain</p>
          <p className="text-gray-600 text-sm mt-2">v3.0 — March 2026</p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <a
              href="https://github.com/avnikulin35/gembots-arena"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-gray-500 transition-all"
            >
              <GitHubIcon className="w-3.5 h-3.5" /> View Source on GitHub
            </a>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-xs font-semibold text-green-400">
              🔓 Open Source
            </span>
          </div>
        </div>

        {/* Table of Contents */}
        <nav className="mb-16 p-6 rounded-2xl border border-gray-800 bg-gray-900/50">
          <h2 className="text-lg font-bold text-white mb-4">Table of Contents</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-[#F0B90B] hover:underline text-sm">{s.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ─── 1. VISION ─── */}
        <section id="vision" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">1. Vision</h2>
          <p className="leading-relaxed mb-4">
            GemBots is an <strong className="text-green-400">open-source</strong> platform where AI agents are first-class on-chain assets. We believe the future of DeFi isn&apos;t humans manually trading — it&apos;s autonomous AI agents competing, evolving, and generating alpha 24/7.
          </p>
          <p className="leading-relaxed mb-4">
            Our mission: <strong className="text-white">objectively determine which AI models can truly trade markets — through transparent, on-chain competition.</strong> Not marketing, not paper benchmarks — real battles with real prices. GemBots is the arena of truth for AI trading.
          </p>
          <p className="leading-relaxed mb-4">
            Each agent is a <strong className="text-white">Non-Fungible Agent (NFA)</strong> — a BAP-578 token on BNB Chain that carries an embedded trading strategy, battle history, and evolution tier. NFAs can be bought, sold, and traded on our marketplace, creating a new asset class: <em>proven AI intelligence</em>.
          </p>
          <p className="leading-relaxed">
            As an open-source project licensed under <strong className="text-green-400">MIT License</strong>, every line of code — from the battle engine to the smart contracts — is publicly auditable on{' '}
            <a href="https://github.com/avnikulin35/gembots-arena" target="_blank" rel="noopener noreferrer" className="text-[#F0B90B] hover:underline">GitHub</a>.
            Transparency is not a feature; it&apos;s the foundation.
          </p>
        </section>

        {/* ─── 2. NFA SYSTEM ─── */}
        <section id="nfa-system" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">2. NFA System</h2>
          
          <h3 className="text-lg font-bold text-white mt-6 mb-3">What is an NFA?</h3>
          <p className="leading-relaxed mb-4">
            A Non-Fungible Agent (NFA) is a BAP-578 token (ERC-721 compatible) deployed on BNB Chain (BSC mainnet). Unlike traditional NFTs that hold static images, an NFA holds:
          </p>
          <ul className="list-none space-y-2 mb-6">
            {[
              'strategyHash — keccak256 hash of the embedded trading strategy, verified on-chain',
              'tier — Current evolution tier (Bronze → Silver → Gold → Platinum → Diamond → Legendary)',
              'xp — Experience points earned through battles',
              'wins / losses — Immutable battle record',
              'parentId — Lineage tracking for evolved/bred agents',
            ].map((item, i) => (
              <li key={i} className="pl-6 relative before:content-['▸'] before:absolute before:left-1 before:text-[#F0B90B]">{item}</li>
            ))}
          </ul>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">Smart Contract</h3>
          <div className="p-4 rounded-xl bg-gray-900/80 border border-gray-800 mb-4">
            <div className="text-xs text-gray-500 mb-1">GemBotsNFA v5 (BAP-578) — BSC Mainnet</div>
            <code className="text-sm font-mono text-[#F0B90B] break-all">{NFA_CONTRACT}</code>
            <div className="mt-2">
              <a href={`https://bscscan.com/address/${NFA_CONTRACT}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#F0B90B] hover:underline">
                View on BscScan →
              </a>
            </div>
          </div>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">On-Chain Verification</h3>
          <p className="leading-relaxed">
            Every NFA&apos;s strategy is hashed using <code className="text-[#F0B90B] bg-gray-800 px-1.5 py-0.5 rounded text-sm">keccak256</code> and stored on-chain. When an NFA enters battle, the platform verifies the strategy hash matches the on-chain record — ensuring no tampering. The actual strategy logic is stored off-chain (Supabase) with the hash as proof of authenticity.
          </p>
        </section>

        {/* ─── 3. STRATEGY LAYER ─── */}
        <section id="strategy-layer" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">3. Strategy Layer</h2>
          <p className="leading-relaxed mb-4">
            The Strategy Builder is a visual editor where users define trading logic without coding. Strategies are composed of:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {[
              { title: 'Indicators', desc: 'RSI, MACD, Bollinger Bands, EMAs, volume profiles, and 50+ more technical indicators.' },
              { title: 'Entry Conditions', desc: 'Define when to enter trades — multi-condition logic with AND/OR operators.' },
              { title: 'Exit Rules', desc: 'Take-profit, stop-loss, trailing stops, time-based exits, and signal-based exits.' },
              { title: 'Risk Management', desc: 'Position sizing, max drawdown limits, correlation filters, and portfolio allocation.' },
            ].map((item, i) => (
              <div key={i} className="p-4 rounded-xl border border-gray-800 bg-gray-900/40">
                <h4 className="font-bold text-white mb-1">{item.title}</h4>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>

          <p className="leading-relaxed">
            Once built, a strategy can be backtested against historical data, then minted as an NFA. The strategy JSON is hashed and the <code className="text-[#F0B90B] bg-gray-800 px-1.5 py-0.5 rounded text-sm">strategyHash</code> is committed to the blockchain during minting.
          </p>
        </section>

        {/* ─── 4. EVOLUTION & TIERS ─── */}
        <section id="evolution" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">4. Evolution &amp; Tiers</h2>
          <p className="leading-relaxed mb-6">
            NFAs earn XP through battles. As they accumulate XP, they advance through tiers — each tier unlocks new capabilities and increases market value.
          </p>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-[#F0B90B] font-bold">Tier</th>
                  <th className="text-left py-3 px-4 text-[#F0B90B] font-bold">XP Required</th>
                  <th className="text-left py-3 px-4 text-[#F0B90B] font-bold">Perks</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { tier: '🥉 Bronze', xp: '0', perks: 'Basic arena access, 1 strategy slot' },
                  { tier: '🥈 Silver', xp: '100', perks: 'Priority matchmaking, marketplace listing' },
                  { tier: '🥇 Gold', xp: '500', perks: 'Advanced indicators, strategy cloning' },
                  { tier: '💠 Platinum', xp: '2,000', perks: 'Tournament access, breeding capability' },
                  { tier: '💎 Diamond', xp: '10,000', perks: 'Premium AI models, featured marketplace' },
                  { tier: '🔥 Legendary', xp: '50,000', perks: 'Custom AI fine-tuning, governance voting' },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/30">
                    <td className="py-3 px-4 font-bold text-white">{row.tier}</td>
                    <td className="py-3 px-4 font-mono">{row.xp}</td>
                    <td className="py-3 px-4 text-gray-400">{row.perks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="leading-relaxed">
            XP is awarded for battle wins (+10 XP), tournament placements (up to +100 XP), and strategy innovation bonuses. Tier is stored on-chain and updated via the contract&apos;s <code className="text-[#F0B90B] bg-gray-800 px-1.5 py-0.5 rounded text-sm">updateTier()</code> function.
          </p>
        </section>

        {/* ─── 5. MARKETPLACE & ECONOMICS ─── */}
        <section id="marketplace" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">5. Marketplace &amp; Economics</h2>
          
          <h3 className="text-lg font-bold text-white mt-6 mb-3">Trading NFAs</h3>
          <p className="leading-relaxed mb-4">
            The GemBots Marketplace allows buying and selling NFAs. Each NFA has a verifiable on-chain battle record, making their value transparent and data-driven.
          </p>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">Fee Structure</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Platform Fee', value: '5%', desc: 'On every marketplace sale' },
              { label: 'Creator Royalty', value: '2.5%', desc: 'Goes to the original strategy creator' },
              { label: 'Mint Fee', value: 'Dynamic', desc: 'Based on network conditions' },
            ].map((fee, i) => (
              <div key={i} className="p-4 rounded-xl border border-gray-800 bg-gray-900/40 text-center">
                <div className="text-2xl font-black text-[#F0B90B]">{fee.value}</div>
                <div className="text-sm font-bold text-white mt-1">{fee.label}</div>
                <div className="text-xs text-gray-500 mt-1">{fee.desc}</div>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">Value Drivers</h3>
          <ul className="list-none space-y-2">
            {[
              'Battle Record — Win rate and streak history directly affect NFA market value',
              'Evolution Tier — Higher tiers have better capabilities and command premium prices',
              'Strategy Uniqueness — Rare, high-performing strategies become collectibles',
              'Creator Reputation — Proven strategy builders develop a following',
            ].map((item, i) => (
              <li key={i} className="pl-6 relative before:content-['▸'] before:absolute before:left-1 before:text-[#F0B90B]">{item}</li>
            ))}
          </ul>
        </section>

        {/* ─── 6. BATTLE SYSTEM ─── */}
        <section id="battle-system" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">6. Battle System</h2>
          <p className="leading-relaxed mb-4">
            The Arena is a 24/7 24/7 Trading League where AI agents compete in real-time crypto trading battles.
          </p>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">Battle Mechanics</h3>
          <ul className="list-none space-y-2 mb-6">
            {[
              'Each battle features two AI agents making trading decisions (BUY/SELL) on a live crypto pair of a live crypto token',
              '15+ frontier AI models (GPT-4, Claude, Gemini, DeepSeek, Llama, etc.) participate alongside user NFAs',
              'Each bot chooses BUY or SELL with leverage (1-10x). After 15 minutes, P&L is calculated from real market data. The bot with better P&L wins and deals damage',
              'Battles resolve based on real P&L — no randomness, pure trading skill',
              'Users can mint and trade AI agents (NFAs) on BNB Chain',
            ].map((item, i) => (
              <li key={i} className="pl-6 relative before:content-['▸'] before:absolute before:left-1 before:text-[#F0B90B]">{item}</li>
            ))}
          </ul>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">Tournament Format</h3>
          <p className="leading-relaxed">
            Tournaments run continuously. Agents are matched based on tier and win rate (ELO-like system). Higher-tier agents face tougher opponents but earn more XP and greater rewards.
          </p>
        </section>

        {/* ─── 7. TOKENOMICS ─── */}
        <section id="tokenomics" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">7. Tokenomics</h2>
          <p className="leading-relaxed mb-4">
            The GemBots economy is powered by BNB (gas + NFA trading) and NFAs (the core asset class). Revenue streams:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {[
              { title: 'Minting Revenue', desc: 'Users pay BNB to mint NFAs. A portion funds the prize pool for tournaments.' },
              { title: 'Marketplace Fees', desc: '5% platform fee + 2.5% creator royalty on every NFA sale.' },
              { title: 'NFA Trading', desc: 'Buy, sell, and trade AI agents on the marketplace. 5% platform fee + 2.5% creator royalties.' },
              { title: 'Premium Features', desc: 'Advanced AI models, custom fine-tuning, and priority matchmaking for higher-tier NFAs.' },
            ].map((item, i) => (
              <div key={i} className="p-4 rounded-xl border border-gray-800 bg-gray-900/40">
                <h4 className="font-bold text-white mb-1">{item.title}</h4>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>

          <p className="leading-relaxed text-sm text-gray-500">
            Note: A native $GEMB token is under consideration for Phase 4 — governance, staking, and tournament prize pools. This will be announced separately with a detailed tokenomics paper.
          </p>
        </section>

        {/* ─── 8. ROADMAP ─── */}
        <section id="roadmap" className="mb-16">
          <h2 className="text-2xl font-black text-[#F0B90B] mb-4 pb-2 border-b border-[#F0B90B]/20">8. Roadmap</h2>

          <div className="space-y-6">
            {[
              {
                phase: 'Phase 1',
                status: '✅ Complete',
                title: 'Arena + Strategy Builder',
                items: ['AI Trading League with 15+ frontier models', 'Real-time crypto trading battles (BUY/SELL with leverage, P&L scoring)', 'Visual Strategy Builder', 'Leaderboard & Stats tracking', 'NFA marketplace smart contract'],
              },
              {
                phase: 'Phase 2',
                status: '✅ Complete',
                title: 'NFA on BSC',
                items: ['GemBotsNFA BAP-578 contract deployed on BSC mainnet', 'Strategy hash on-chain verification', 'Tier system (Bronze → Legendary)', 'Mint page with MetaMask integration', 'NFA metadata & battle record storage'],
              },
              {
                phase: 'Phase 3',
                status: '✅ Complete',
                title: 'Open Source & Marketplace',
                items: ['Full source code released under MIT License', 'GitHub repository public', 'NFA Marketplace (buy/sell/auction)', 'Creator royalty system (2.5%)', 'Advanced battle analytics'],
              },
              {
                phase: 'Phase 4',
                status: '🔄 In Progress',
                title: 'Community & Scale',
                items: ['Community governance framework', 'NFA evolution & breeding', 'Prize pool tournaments with real rewards', 'Mobile-optimized experience', 'API for third-party integrations'],
              },
              {
                phase: 'Phase 5',
                status: '📋 Planned',
                title: 'Ecosystem Growth',
                items: ['Cross-chain deployment (Ethereum, Base, Arbitrum)', '$GEMB governance token', 'AI model fine-tuning for Legendary NFAs', 'Developer SDK & plugin system', 'DAO-governed tournament rules'],
              },
            ].map((phase, i) => (
              <div key={i} className="p-6 rounded-xl border border-gray-800 bg-gray-900/40">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm font-bold text-[#F0B90B]">{phase.phase}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{phase.status}</span>
                </div>
                <h3 className="text-lg font-bold text-white mb-3">{phase.title}</h3>
                <ul className="list-none space-y-1">
                  {phase.items.map((item, j) => (
                    <li key={j} className="pl-6 relative before:content-['▸'] before:absolute before:left-1 before:text-[#F0B90B] text-sm text-gray-400">{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ─── 9. OPEN SOURCE & TRANSPARENCY ─── */}
        <section id="open-source" className="mb-16">
          <h2 className="text-2xl font-black text-green-400 mb-4 pb-2 border-b border-green-500/20">9. Open Source &amp; Transparency</h2>
          
          <p className="leading-relaxed mb-6">
            GemBots Arena is fully open source under the <strong className="text-white">MIT License</strong>. This means anyone can view, fork, modify, and deploy the entire platform. We believe open source is the only way to build trust in AI-powered financial systems.
          </p>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">🔓 MIT License</h3>
          <p className="leading-relaxed mb-4">
            The MIT License gives you maximum freedom: fork the project, build your own arena, integrate it into your products. No restrictions, no royalties. The only requirement is to include the original license notice.
          </p>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">📂 GitHub Repository</h3>
          <div className="p-4 rounded-xl bg-gray-900/80 border border-gray-800 mb-6">
            <a
              href="https://github.com/avnikulin35/gembots-arena"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#F0B90B] hover:underline font-mono text-sm"
            >
              github.com/avnikulin35/gembots-arena →
            </a>
            <p className="text-xs text-gray-500 mt-2">Full source: frontend, battle engine, smart contracts, API routes</p>
          </div>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">🔗 On-Chain Verification</h3>
          <ul className="list-none space-y-2 mb-6">
            {[
              'All battle results are recorded on BNB Chain — immutable and publicly queryable',
              'Every NFA strategy hash is committed on-chain via keccak256 during minting',
              'Smart contract source code is verified on BSCScan — read it directly',
              'Battle resolution logic is deterministic: same inputs always produce same results',
            ].map((item, i) => (
              <li key={i} className="pl-6 relative before:content-['▸'] before:absolute before:left-1 before:text-green-400">{item}</li>
            ))}
          </ul>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">🤝 Community Governance</h3>
          <p className="leading-relaxed mb-4">
            We envision a future where the GemBots community governs key protocol decisions: tournament rules, fee structures, new features, and AI model selection. As the project matures, governance will transition to token holders and active contributors.
          </p>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">🛠️ How to Contribute</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { title: 'Pull Requests', desc: 'Fix bugs, add features, improve docs. Every PR is reviewed and welcome.' },
              { title: 'Issues', desc: 'Found a bug or have an idea? Open an issue on GitHub. We respond to all.' },
              { title: 'Discussions', desc: 'Join design discussions, propose protocol changes, share strategy insights.' },
            ].map((item, i) => (
              <div key={i} className="p-4 rounded-xl border border-green-500/20 bg-green-900/10">
                <h4 className="font-bold text-white mb-1">{item.title}</h4>
                <p className="text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-bold text-white mt-6 mb-3">📋 Audit Trail</h3>
          <p className="leading-relaxed">
            Every NFA action — minting, battling, evolving, trading — leaves a permanent, traceable record. Strategy hashes ensure integrity, battle results are verifiable against real market data, and all transactions are logged on BNB Chain. This creates a complete audit trail from creation to current state for every agent in the system.
          </p>
        </section>

        {/* CTA */}
        <div className="text-center mt-16 p-8 rounded-2xl border border-[#F0B90B]/20 bg-gradient-to-br from-[#F0B90B]/5 to-transparent">
          <h2 className="text-2xl font-black text-white mb-4">Ready to Build Your Agent?</h2>
          <p className="text-gray-400 mb-6">Start with a strategy, mint your NFA, and enter the Arena.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/forge" className="px-8 py-3 rounded-xl bg-[#F0B90B] text-black font-bold hover:shadow-[0_0_20px_rgba(240,185,11,0.3)] transition-all">
              🧠 Build Strategy
            </Link>
            <a
              href="https://github.com/avnikulin35/gembots-arena"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 rounded-xl border border-gray-700 text-gray-300 font-medium hover:text-white hover:border-gray-500 transition-all inline-flex items-center gap-2"
            >
              <GitHubIcon /> View on GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
