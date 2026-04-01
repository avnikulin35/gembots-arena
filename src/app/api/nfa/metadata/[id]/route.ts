import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SITE_URL = 'https://gembots.space';
const V5_CONTRACT = '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
const BSCSCAN_BASE = 'https://bscscan.com';

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Tier names and thresholds
const TIER_NAMES: Record<number, string> = {
  0: 'Bronze', 1: 'Silver', 2: 'Gold', 3: 'Diamond', 4: 'Legendary',
};

function calculateTier(wins: number): number {
  if (wins >= 250) return 4; // Legendary
  if (wins >= 100) return 3; // Diamond
  if (wins >= 50) return 2;  // Gold
  if (wins >= 10) return 1;  // Silver
  return 0; // Bronze
}

// Strategy style labels
const STRATEGY_STYLES: Record<string, string> = {
  smart_ai: 'Neural Network',
  trend_follower: 'Trend Following',
  whale_watcher: 'Whale Watching',
  mean_reversion: 'Mean Reversion',
  chaos: 'Chaos Agent',
  momentum: 'Momentum',
  swing: 'Swing Trading',
  scalper: 'Scalper',
  contrarian: 'Contrarian',
};

// Robot images (cycle through 20 designs)
const ROBOT_IMAGES = [
  'neon-viper', 'dragon-mech', 'arctic-frost', 'bio-hazard', 'crystal-mage',
  'cyber-fang', 'gravity-well', 'iron-golem', 'laser-hawk', 'mech-spider',
  'neon-racer', 'omega-prime', 'phantom-wraith', 'quantum-shift', 'shadow-ninja',
  'storm-trooper', 'tech-samurai', 'thunder-bolt', 'void-walker', 'volcanic-core',
];

// Cache
const cache = new Map<number, { data: any; ts: number }>();
const CACHE_TTL = 300_000; // 5 min

function formatModelName(model: string): string {
  if (!model) return 'Neural Network';
  const map: Record<string, string> = {
    'gpt-4.1-nano': 'GPT-4.1 Nano',
    'gpt-4.1-mini': 'GPT-4.1 Mini',
    'gpt-oss-120b': 'GPT-OSS 120B',
    'gpt-oss-20b': 'GPT-OSS 20B',
    'gemini-2.0-flash-lite': 'Gemini 2.0 Flash Lite',
    'gemini-3-pro': 'Gemini 3 Pro',
    'gemma-3-12b': 'Gemma 3 12B',
    'qwen3-235b': 'Qwen3 235B',
    'qwen-3.5-coder': 'Qwen 3.5 Coder',
    'mistral-nemo': 'Mistral Nemo',
    'mistral-small-24b': 'Mistral Small 24B',
    'llama-4-maverick': 'Llama 4 Maverick',
    'deepseek-r1': 'DeepSeek R1',
    'grok-4.1': 'Grok 4.1',
    'command-r': 'Command R',
    'phi-4': 'Phi-4',
  };
  const lower = model.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return model;
}

async function loadNFAMetadata(nfaId: number) {
  const cached = cache.get(nfaId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Find bot linked to this NFA
  const { data: bot, error } = await supabase
    .from('bots')
    .select('*')
    .eq('nfa_id', nfaId)
    .single();

  // Default metadata for unlinked NFAs
  let name = `GemBot #${nfaId}`;
  let emoji = '🤖';
  let aiModel = 'Neural Network';
  let strategy = 'Neural Network';
  let wins = 0, losses = 0, totalBattles = 0, bestStreak = 0, elo = 1000;
  let isGenesis = nfaId < 100;
  let isActive = false;
  let botId: number | null = null;

  if (bot && !error) {
    name = (bot.name || `GemBot #${nfaId}`).replace(/^[\p{Emoji_Presentation}\p{Emoji}\s]+/u, '').trim() || `GemBot #${nfaId}`;
    emoji = (bot.name || '').match(/^[\p{Emoji_Presentation}\p{Emoji}]+/u)?.[0] || '🤖';
    aiModel = bot.ai_model || bot.model_id || 'Neural Network';
    strategy = bot.strategy || bot.strategy || 'smart_ai';
    wins = bot.wins || 0;
    losses = bot.losses || 0;
    totalBattles = bot.total_battles || 0;
    bestStreak = bot.win_streak || 0;
    elo = bot.elo || 1000;
    isActive = bot.is_active || false;
    botId = bot.id;
  }

  const tier = calculateTier(wins);
  const tierName = TIER_NAMES[tier];
  const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;
  const strategyLabel = STRATEGY_STYLES[strategy] || strategy;
  const modelDisplay = formatModelName(aiModel);

  // Build description
  let description = `${emoji} ${name} — ${tierName} Tier AI Trading Agent on GemBots Arena.`;
  if (totalBattles > 0) {
    description += ` Strategy: ${strategyLabel}. Model: ${modelDisplay}. Win Rate: ${winRate}% across ${totalBattles.toLocaleString()} battles. ELO: ${elo}.`;
  } else {
    description += ` Strategy: ${strategyLabel}. Model: ${modelDisplay}. Ready for battle.`;
  }
  if (isGenesis) {
    description += ' 🌟 Genesis Collection — one of the first 100 agents.';
  }
  description += ` Verified on-chain: ${BSCSCAN_BASE}/address/${V5_CONTRACT}`;

  // Image
  const robotDesign = ROBOT_IMAGES[nfaId % ROBOT_IMAGES.length];
  const staticImage = `${SITE_URL}/robots/${robotDesign}.png`;

  // ERC-721 metadata (OpenSea/marketplace compatible)
  const metadata: any = {
    name: `${emoji} ${name}`,
    description,
    image: staticImage,
    external_url: `${SITE_URL}/marketplace/${nfaId}`,
    animation_url: `${SITE_URL}/api/nfa/image/${nfaId}`,
    attributes: [
      { trait_type: 'Tier', value: tierName },
      { trait_type: 'Strategy', value: strategyLabel },
      { trait_type: 'AI Model', value: modelDisplay },
      { trait_type: 'Genesis', value: isGenesis ? 'Yes' : 'No' },
      { trait_type: 'Status', value: isActive ? 'Active' : 'Inactive' },
      { trait_type: 'Contract Version', value: 'v5' },
      { trait_type: 'ERC Standard', value: 'ERC-8004' },
    ],
    // Marketplace royalty
    seller_fee_basis_points: 500,
    fee_recipient: '0x133C89BC9Dc375fBc46493A92f4Fd2486F8F0d76',
  };

  // Add battle stats if bot has fought
  if (totalBattles > 0) {
    metadata.attributes.push(
      { trait_type: 'Win Rate', display_type: 'number', value: winRate },
      { trait_type: 'ELO Rating', display_type: 'number', value: elo },
      { trait_type: 'Wins', display_type: 'number', value: wins },
      { trait_type: 'Losses', display_type: 'number', value: losses },
      { trait_type: 'Total Battles', display_type: 'number', value: totalBattles },
      { trait_type: 'Best Streak', display_type: 'number', value: bestStreak },
    );
  }

  metadata.attributes.push(
    { trait_type: 'Robot Design', value: robotDesign.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
  );

  // Bot-specific fields for API consumers
  if (botId) {
    metadata.bot_id = botId;
    metadata.arena_url = `${SITE_URL}/arena`;
    metadata.live_battles_url = `${SITE_URL}/watch`;
  }

  cache.set(nfaId, { data: metadata, ts: Date.now() });
  return metadata;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);

  if (isNaN(id) || id < 0 || id > 99) {
    return NextResponse.json({ error: 'Invalid NFA ID (0-99)' }, { status: 400 });
  }

  try {
    const metadata = await loadNFAMetadata(id);
    return NextResponse.json(metadata, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
