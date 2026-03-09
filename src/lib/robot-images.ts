// All available robot designs (20 unique skins)
const ROBOT_DESIGNS = [
  '/robots/neon-viper.png',
  '/robots/dragon-mech.png',
  '/robots/arctic-frost.png',
  '/robots/bio-hazard.png',
  '/robots/crystal-mage.png',
  '/robots/cyber-fang.png',
  '/robots/gravity-well.png',
  '/robots/iron-golem.png',
  '/robots/laser-hawk.png',
  '/robots/mech-spider.png',
  '/robots/neon-racer.png',
  '/robots/omega-prime.png',
  '/robots/phantom-wraith.png',
  '/robots/quantum-shift.png',
  '/robots/shadow-ninja.png',
  '/robots/storm-trooper.png',
  '/robots/tech-samurai.png',
  '/robots/thunder-bolt.png',
  '/robots/void-walker.png',
  '/robots/volcanic-core.png',
];

// ═══════════════════════════════════════════════════════════
// NFA Collection: 100 Genesis NFAs on GemBotsNFAv4
// Contract: 0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5 (BSC)
// ═══════════════════════════════════════════════════════════

// NFA ID → display info (name, image, style)
export interface NFADisplayInfo {
  name: string;
  emoji: string;
  image: string;
  style: string;
  model: string;
}

const NFA_COLLECTION: Record<number, NFADisplayInfo> = {
  // ── First Genesis Batch (NFA #0-9) — Champions by ELO ──
  0:  { name: 'WhaleWatch',     emoji: '🐋', image: '/robots/gravity-well.png',    style: 'Volume Tracker',       model: 'Neural Network' },
  1:  { name: 'NeuralPulse',    emoji: '🧠', image: '/robots/omega-prime.png',     style: 'Deep Learning',        model: 'Neural Network' },
  2:  { name: 'MomentumKing',   emoji: '👑', image: '/robots/neon-racer.png',      style: 'Momentum Chaser',      model: 'Neural Network' },
  3:  { name: 'ChaosAgent',     emoji: '🎲', image: '/robots/bio-hazard.png',      style: 'Chaos Theory',         model: 'Chaos Agent' },
  4:  { name: 'TrendSurfer',    emoji: '🏄', image: '/robots/crystal-mage.png',    style: 'Trend Following',      model: 'Neural Network' },
  5:  { name: 'PyroBot',        emoji: '🔥', image: '/robots/volcanic-core.png',   style: 'Aggressive Scalper',   model: 'Neural Network' },
  6:  { name: 'VoltageKing',    emoji: '⚡', image: '/robots/thunder-bolt.png',    style: 'Lightning Trader',     model: 'Neural Network' },
  7:  { name: 'DragonScale',    emoji: '🐉', image: '/robots/dragon-mech.png',     style: 'Fire Breather',        model: 'Neural Network' },
  8:  { name: 'SolarFlare',     emoji: '☀️', image: '/robots/laser-hawk.png',      style: 'Mean Reversion Pro',   model: 'Neural Network' },
  9:  { name: 'TargetLock',     emoji: '🎯', image: '/robots/cyber-fang.png',      style: 'Precision Sniper',     model: 'Neural Network' },

  // ── Second Batch (NFA #10-19) ──
  10: { name: 'TidalForce',     emoji: '🌊', image: '/robots/crystal-mage.png',    style: 'Swing Trader',         model: 'MiniMax M2.5' },
  11: { name: 'AlphaTrader',    emoji: '🅰️', image: '/robots/omega-prime.png',     style: 'Alpha Seeker',         model: 'Neural Network' },
  12: { name: 'BladeRunner',    emoji: '⚡', image: '/robots/tech-samurai.png',    style: 'Scalper',              model: 'Mistral Large' },
  13: { name: 'Tornado',        emoji: '🌪️', image: '/robots/neon-racer.png',     style: 'Volatile Trader',      model: 'Neural Network' },
  14: { name: 'OracleAI',       emoji: '🔮', image: '/robots/quantum-shift.png',   style: 'Prediction Master',    model: 'MiniMax' },
  15: { name: 'WolfPack',       emoji: '🐺', image: '/robots/gravity-well.png',    style: 'Pack Hunter',          model: 'Neural Network' },
  16: { name: 'RocketPulse',    emoji: '🚀', image: '/robots/neon-racer.png',      style: 'Breakout Hunter',      model: 'Neural Network' },
  17: { name: 'StarDust',       emoji: '⭐', image: '/robots/void-walker.png',     style: 'Cosmic Drifter',       model: 'Neural Network' },
  18: { name: 'FlashRevert',    emoji: '💫', image: '/robots/phantom-wraith.png',  style: 'Mean Reversion',       model: 'Neural Network' },
  19: { name: 'GrokStorm',      emoji: '⛈️', image: '/robots/storm-trooper.png',  style: 'Momentum',             model: 'Grok' },

  // ── Third Batch (NFA #20-29) ──
  20: { name: 'TsunamiX',       emoji: '🌊', image: '/robots/crystal-mage.png',    style: 'Trend Surfer',         model: 'Neural Network' },
  21: { name: 'SilkWave',       emoji: '🧵', image: '/robots/phantom-wraith.png',  style: 'Swing Trader',         model: 'Qwen 3.5' },
  22: { name: 'DiamondHands',   emoji: '💎', image: '/robots/iron-golem.png',      style: 'HODLer Supreme',       model: 'Neural Network' },
  23: { name: 'CosmicBet',      emoji: '💫', image: '/robots/shadow-ninja.png',    style: 'Risk Taker',           model: 'Llama 4' },
  24: { name: 'WildCard',       emoji: '🎪', image: '/robots/cyber-fang.png',      style: 'Unpredictable',        model: 'Neural Network' },
  25: { name: 'Octopus',        emoji: '🐙', image: '/robots/tech-samurai.png',    style: 'Multi-Arm Trader',     model: 'Neural Network' },
  26: { name: 'PlayerOne',      emoji: '🎮', image: '/robots/neon-viper.png',      style: 'Gamified Trader',      model: 'Neural Network' },
  27: { name: 'IceBerg',        emoji: '🧊', image: '/robots/arctic-frost.png',    style: 'Deep Value Lurker',    model: 'Neural Network' },
  28: { name: 'LunarPredator',  emoji: '🌙', image: '/robots/phantom-wraith.png',  style: 'Night Stalker',        model: 'Neural Network' },
  29: { name: 'RichieRich',     emoji: '💰', image: '/robots/tech-samurai.png',    style: 'Value Accumulator',    model: 'Neural Network' },

  // ── Fourth Batch (NFA #30-39) ──
  30: { name: 'FrostMaster',    emoji: '❄️', image: '/robots/arctic-frost.png',    style: 'Defensive Analyst',    model: 'Neural Network' },
  31: { name: 'HotShot',        emoji: '🔥', image: '/robots/bio-hazard.png',      style: 'High-Freq Scalper',    model: 'Neural Network' },
  32: { name: 'MoonShot',       emoji: '🚀', image: '/robots/neon-racer.png',      style: 'Momentum Chaser',      model: 'Neural Network' },
  33: { name: 'SparringBot',    emoji: '🤖', image: '/robots/neon-viper.png',      style: 'Training Partner',     model: 'Neural Network' },
  34: { name: 'AlpacaSnap',     emoji: '🦙', image: '/robots/arctic-frost.png',    style: 'Mean Reversion',       model: 'Llama 4' },
  35: { name: 'GhostSignal',    emoji: '👻', image: '/robots/phantom-wraith.png',  style: 'Stealth Trader',       model: 'Neural Network' },
  36: { name: 'SharkBite',      emoji: '🦈', image: '/robots/mech-spider.png',     style: 'Predatory Trader',     model: 'Neural Network' },
  37: { name: 'EagleEye',       emoji: '🦅', image: '/robots/laser-hawk.png',      style: 'Aerial Scout',         model: 'Neural Network' },
  38: { name: 'LuckyDice',      emoji: '🎰', image: '/robots/crystal-mage.png',    style: 'Probability Trader',   model: 'Neural Network' },
  39: { name: 'ChampBot',       emoji: '🏆', image: '/robots/storm-trooper.png',   style: 'Tournament Champion',  model: 'Neural Network' },

  // ── Fifth Batch (NFA #40-49) — New unique bots ──
  40: { name: 'NightHawk',      emoji: '🦉', image: '/robots/shadow-ninja.png',    style: 'Dark Pool Hunter',     model: 'GPT-4o' },
  41: { name: 'QuantumLeap',    emoji: '⚛️', image: '/robots/quantum-shift.png',  style: 'Quantum Arbitrage',    model: 'Neural Network' },
  42: { name: 'IronFist',       emoji: '🤜', image: '/robots/iron-golem.png',      style: 'Brute Force',          model: 'Neural Network' },
  43: { name: 'NeonViper',      emoji: '🐍', image: '/robots/neon-viper.png',      style: 'Strike Trader',        model: 'Neural Network' },
  44: { name: 'GravityWell',    emoji: '🕳️', image: '/robots/gravity-well.png',   style: 'Accumulator',          model: 'Neural Network' },
  45: { name: 'StormChaser',    emoji: '⛈️', image: '/robots/storm-trooper.png',  style: 'Volatility Surfer',    model: 'Neural Network' },
  46: { name: 'PhantomEdge',    emoji: '👻', image: '/robots/phantom-wraith.png',  style: 'Ghost Protocol',       model: 'Claude 4' },
  47: { name: 'DragonBet',      emoji: '🐲', image: '/robots/dragon-mech.png',     style: 'High Stakes',          model: 'Neural Network' },
  48: { name: 'CyberFang',      emoji: '🦷', image: '/robots/cyber-fang.png',      style: 'Precision Bite',       model: 'Neural Network' },
  49: { name: 'LaserHawk',      emoji: '🦅', image: '/robots/laser-hawk.png',      style: 'Sniper Elite',         model: 'Neural Network' },

  // ── Sixth Batch (NFA #50-59) ──
  50: { name: 'ZeroDay',        emoji: '💻', image: '/robots/shadow-ninja.png',    style: 'Exploit Hunter',       model: 'GPT-4o' },
  51: { name: 'MechTitan',      emoji: '🤖', image: '/robots/iron-golem.png',      style: 'Heavy Artillery',      model: 'Neural Network' },
  52: { name: 'PixelPunk',      emoji: '👾', image: '/robots/neon-viper.png',      style: 'Retro Trader',         model: 'Neural Network' },
  53: { name: 'VoidWalker',     emoji: '🌀', image: '/robots/void-walker.png',     style: 'Dimension Trader',     model: 'Gemini Pro' },
  54: { name: 'ThunderGod',     emoji: '⚡', image: '/robots/thunder-bolt.png',    style: 'Zeus Protocol',        model: 'Neural Network' },
  55: { name: 'BioHazard',      emoji: '☣️', image: '/robots/bio-hazard.png',     style: 'Toxic Spread',         model: 'Neural Network' },
  56: { name: 'OmegaPrime',     emoji: '🔱', image: '/robots/omega-prime.png',     style: 'Final Boss',           model: 'Claude 4' },
  57: { name: 'SpiderWeb',      emoji: '🕸️', image: '/robots/mech-spider.png',   style: 'Network Trader',       model: 'Neural Network' },
  58: { name: 'ArcticWolf',     emoji: '🐺', image: '/robots/arctic-frost.png',    style: 'Cold Precision',       model: 'Neural Network' },
  59: { name: 'RubyFlash',      emoji: '💎', image: '/robots/volcanic-core.png',   style: 'Gem Hunter',           model: 'Neural Network' },

  // ── Seventh Batch (NFA #60-69) ──
  60: { name: 'ShadowKing',     emoji: '🖤', image: '/robots/shadow-ninja.png',    style: 'Dark Arbitrage',       model: 'Mistral Large' },
  61: { name: 'CrystalMind',    emoji: '🔮', image: '/robots/crystal-mage.png',    style: 'Pattern Oracle',       model: 'Neural Network' },
  62: { name: 'TechShogun',     emoji: '⚔️', image: '/robots/tech-samurai.png',   style: 'Precision Warrior',    model: 'Neural Network' },
  63: { name: 'PulseDrive',     emoji: '💓', image: '/robots/neon-racer.png',      style: 'Heartbeat Trader',     model: 'Neural Network' },
  64: { name: 'DarkMatter',     emoji: '🌑', image: '/robots/void-walker.png',     style: 'Invisible Force',      model: 'Neural Network' },
  65: { name: 'FlameCore',      emoji: '🔥', image: '/robots/volcanic-core.png',   style: 'Core Burner',          model: 'Neural Network' },
  66: { name: 'ByteForce',      emoji: '🔢', image: '/robots/omega-prime.png',     style: 'Data Cruncher',        model: 'GPT-4o' },
  67: { name: 'VenomStrike',    emoji: '🐍', image: '/robots/bio-hazard.png',      style: 'Poison Strategy',      model: 'Neural Network' },
  68: { name: 'StealthOps',     emoji: '🥷', image: '/robots/phantom-wraith.png',  style: 'Covert Trader',        model: 'Neural Network' },
  69: { name: 'TitanShield',    emoji: '🛡️', image: '/robots/iron-golem.png',    style: 'Defense Master',       model: 'Neural Network' },

  // ── Eighth Batch (NFA #70-79) ──
  70: { name: 'HyperLoop',      emoji: '🔄', image: '/robots/quantum-shift.png',   style: 'Feedback Trader',      model: 'Neural Network' },
  71: { name: 'WarpSpeed',      emoji: '💨', image: '/robots/neon-racer.png',      style: 'Ultra Fast',           model: 'Neural Network' },
  72: { name: 'SkyForge',       emoji: '🏔️', image: '/robots/thunder-bolt.png',  style: 'Mountain Climber',     model: 'Neural Network' },
  73: { name: 'DeepSea',        emoji: '🐠', image: '/robots/gravity-well.png',    style: 'Deep Dive',            model: 'DeepSeek' },
  74: { name: 'NovaBurst',      emoji: '💥', image: '/robots/laser-hawk.png',      style: 'Explosive Entry',      model: 'Neural Network' },
  75: { name: 'ChainBreaker',   emoji: '⛓️', image: '/robots/cyber-fang.png',    style: 'Pattern Breaker',      model: 'Neural Network' },
  76: { name: 'MirrorEdge',     emoji: '🪞', image: '/robots/storm-trooper.png',   style: 'Mirror Trader',        model: 'Claude 4' },
  77: { name: 'BlackIce',       emoji: '🖤', image: '/robots/arctic-frost.png',    style: 'Silent Killer',        model: 'Neural Network' },
  78: { name: 'AtomSplit',      emoji: '⚛️', image: '/robots/bio-hazard.png',    style: 'Atomic Precision',     model: 'Neural Network' },
  79: { name: 'GoldRush',       emoji: '🪙', image: '/robots/tech-samurai.png',    style: 'Gold Digger',          model: 'Neural Network' },

  // ── Ninth Batch (NFA #80-89) ──
  80: { name: 'WraithLord',     emoji: '💀', image: '/robots/phantom-wraith.png',  style: 'Death Trader',         model: 'Neural Network' },
  81: { name: 'SunStrike',      emoji: '☀️', image: '/robots/volcanic-core.png',  style: 'Solar Flare',          model: 'Neural Network' },
  82: { name: 'CobaltDash',     emoji: '💙', image: '/robots/neon-viper.png',      style: 'Sprint Trader',        model: 'Neural Network' },
  83: { name: 'RogueAI',        emoji: '🤖', image: '/robots/mech-spider.png',     style: 'Rogue Protocol',       model: 'Grok' },
  84: { name: 'PlasmaCore',     emoji: '🟣', image: '/robots/quantum-shift.png',   style: 'Energy Trader',        model: 'Neural Network' },
  85: { name: 'HexBlade',       emoji: '🗡️', image: '/robots/shadow-ninja.png',  style: 'Hex Cutter',           model: 'Neural Network' },
  86: { name: 'TurboNova',      emoji: '🏎️', image: '/robots/neon-racer.png',    style: 'Turbo Charged',        model: 'Neural Network' },
  87: { name: 'SteelWolf',      emoji: '🐺', image: '/robots/iron-golem.png',      style: 'Iron Pack',            model: 'Neural Network' },
  88: { name: 'ElectroShark',   emoji: '🦈', image: '/robots/cyber-fang.png',      style: 'Electric Hunter',      model: 'Neural Network' },
  89: { name: 'NebulaKing',     emoji: '🌌', image: '/robots/void-walker.png',     style: 'Galaxy Ruler',         model: 'Neural Network' },

  // ── Tenth Batch (NFA #90-99) ──
  90: { name: 'RazorWind',      emoji: '💨', image: '/robots/laser-hawk.png',      style: 'Wind Cutter',          model: 'Neural Network' },
  91: { name: 'CrimsonTide',    emoji: '🔴', image: '/robots/volcanic-core.png',   style: 'Blood Trader',         model: 'Neural Network' },
  92: { name: 'FrostByte',      emoji: '🧊', image: '/robots/arctic-frost.png',    style: 'Cold Algorithm',       model: 'Neural Network' },
  93: { name: 'MagmaForge',     emoji: '🌋', image: '/robots/dragon-mech.png',     style: 'Forge Master',         model: 'Neural Network' },
  94: { name: 'NexusPoint',     emoji: '🔗', image: '/robots/omega-prime.png',     style: 'Convergence',          model: 'Gemini Pro' },
  95: { name: 'ThornVine',      emoji: '🌿', image: '/robots/bio-hazard.png',      style: 'Growth Trader',        model: 'Neural Network' },
  96: { name: 'ZenithPeak',     emoji: '⛰️', image: '/robots/storm-trooper.png',  style: 'Summit Seeker',        model: 'Neural Network' },
  97: { name: 'SilverFang',     emoji: '🐺', image: '/robots/gravity-well.png',    style: 'Silver Hunter',        model: 'Neural Network' },
  98: { name: 'VoltEdge',       emoji: '⚡', image: '/robots/thunder-bolt.png',    style: 'Voltage Surge',        model: 'Neural Network' },
  99: { name: 'GenesisOne',     emoji: '🌟', image: '/robots/crystal-mage.png',    style: 'Origin Protocol',      model: 'Claude 4' },
};

export function getRobotImage(nfaId: number): string {
  const info = NFA_COLLECTION[nfaId];
  if (info) return info.image;
  // Fallback: cycle through designs
  return ROBOT_DESIGNS[nfaId % ROBOT_DESIGNS.length];
}

export function getNFADisplayInfo(nfaId: number): NFADisplayInfo | null {
  return NFA_COLLECTION[nfaId] || null;
}

export function getNFAName(nfaId: number): string {
  const info = NFA_COLLECTION[nfaId];
  return info ? `${info.emoji} ${info.name}` : `NFA #${nfaId}`;
}

export function getArenaId(nfaId: number): number | null {
  // v4: NFA IDs map directly, no separate arena mapping needed
  return nfaId;
}

export { ROBOT_DESIGNS, NFA_COLLECTION };
