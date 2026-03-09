/**
 * NFA Strategy Adapter
 * 
 * Bridges NFA on-chain strategies → Arena prediction modifiers.
 * 
 * Flow:
 *   1. Bot has nfa_id in Supabase → look up strategy
 *   2. Check in-memory cache first (TTL = 1 hour)
 *   3. Check Supabase strategy_cache column
 *   4. Fall back to on-chain contract read
 *   5. Parse strategy JSON → return prediction modifiers
 * 
 * NFA Strategy Params (0–100 scale):
 *   aggression, defense, speed, adaptability, riskTolerance,
 *   patternRecognition, counterStrategy, bluffFrequency, endgameShift
 * 
 * Output: prediction modifiers that alter the base prediction from preset strategies/LLM
 */

const { ethers } = require('ethers');

// ─── Config ──────────────────────────────────────────────────────────────────

const NFA_CONTRACT_ADDRESS = '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5'; // v5
const NFA_FAILURE_THRESHOLD = 3; // NFA fails N times consecutively -> blacklist
const NFA_BLACKLIST_TTL_MS = 60 * 60 * 1000; // Blacklist duration for NFA (1 hour)
const BLACKLISTED_NFA_IDS_INITIAL = new Set([31]); // NFA #31 is known to be problematic

// ─── In-Memory State ─────────────────────────────────────────────────────────

// Map<nfaId, { count: number, blacklistedUntil: number }>
const _nfaFailureAttempts = new Map();
// Set<nfaId>
const _nfaBlacklist = new Set(BLACKLISTED_NFA_IDS_INITIAL);

// Initialize _nfaFailureAttempts for initially blacklisted NFAs
BLACKLISTED_NFA_IDS_INITIAL.forEach(nfaId => {
  _nfaFailureAttempts.set(nfaId, { count: NFA_FAILURE_THRESHOLD, blacklistedUntil: Date.now() + NFA_BLACKLIST_TTL_MS });
});
const BSC_RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed1.binance.org';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const NFA_STRATEGY_ABI = [
  'function getStrategy(uint256 nfaId) view returns (string modelId, bytes32 strategyHash, string strategyURI)',
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

// Map<botId, { strategy, fetchedAt }>
const _cache = new Map();

// ─── Supabase Helper ─────────────────────────────────────────────────────────

async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('json')) return res.json();
  return null;
}

// ─── On-Chain Reader ─────────────────────────────────────────────────────────

let _provider = null;
let _contract = null;

function getContract() {
  if (!_contract) {
    _provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    _contract = new ethers.Contract(NFA_CONTRACT_ADDRESS, NFA_STRATEGY_ABI, _provider);
  }
  return _contract;
}

/**
 * Read strategyURI from on-chain NFA contract
 * @param {number} nfaId
 * @returns {object|null} Parsed strategy JSON or null
 */
async function readStrategyFromChain(nfaId) {
  // --- DEBUG LOGGING ---
  if (nfaId === 31) {
    console.log(`  🔍 NFA Strategy: readStrategyFromChain called for NFA #31.`);
    console.log(`  🔍 NFA Strategy: _nfaFailureAttempts for #31 (before try):`, _nfaFailureAttempts.get(31));
  }
  // --- END DEBUG LOGGING ---

  try {
    const contract = getContract();
    const result = await contract.getStrategy(nfaId);
    const strategyURI = result.strategyURI || result[2];

    // Success: reset failure attempts for this NFA
    if (_nfaFailureAttempts.has(nfaId)) {
      _nfaFailureAttempts.delete(nfaId);
      // --- DEBUG LOGGING ---
      if (nfaId === 31) {
        console.log(`  ✅ NFA Strategy: Successfully read NFA #31. Resetting attempts.`);
      }
      // --- END DEBUG LOGGING ---
    }

    if (!strategyURI || strategyURI === '') return null;

    // Parse data URI: data:application/json;base64,...
    if (strategyURI.startsWith('data:')) {
      const commaIdx = strategyURI.indexOf(',');
      if (commaIdx === -1) return null;
      const base64 = strategyURI.slice(commaIdx + 1);
      const json = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(json);
    }

    // HTTPS/IPFS URI — fetch it
    if (strategyURI.startsWith('http') || strategyURI.startsWith('ipfs://')) {
      const url = strategyURI.startsWith('ipfs://')
        ? `https://ipfs.io/ipfs/${strategyURI.slice(7)}`
        : strategyURI;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.json();
    }

    return null;
  } catch (err) {
    // Increment failure count
    const attempts = _nfaFailureAttempts.get(nfaId) || { count: 0, blacklistedUntil: 0 };
    attempts.count++;

    // --- DEBUG LOGGING ---
    if (nfaId === 31) {
      console.log(`  ❌ NFA Strategy: Error reading NFA #31. New attempt count: ${attempts.count}. Blacklist status: ${_nfaBlacklist.has(31) ? 'blacklisted' : 'not blacklisted'}`);
      console.log(`  ❌ NFA Strategy: Blacklisted until: ${attempts.blacklistedUntil ? new Date(attempts.blacklistedUntil).toLocaleTimeString() : 'N/A'}`);
    }
    // --- END DEBUG LOGGING ---

    if (attempts.count >= NFA_FAILURE_THRESHOLD) {
      attempts.blacklistedUntil = Date.now() + NFA_BLACKLIST_TTL_MS;
      _nfaBlacklist.add(nfaId);
      console.error(`  ❌ NFA Strategy: Blacklisting NFA #${nfaId} for ${NFA_BLACKLIST_TTL_MS / 1000 / 60} minutes due to persistent errors.`);
    } else {
      console.error(`  ⚠️ NFA Strategy: Failed to read NFA #${nfaId} from chain (attempt ${attempts.count}/${NFA_FAILURE_THRESHOLD}): ${err.message}`);
    }
    _nfaFailureAttempts.set(nfaId, attempts);
    return null;
  }
}

// ─── Strategy Fetcher (with cache layers) ────────────────────────────────────

/**
 * Get NFA strategy for a bot, with 3-tier caching:
 *   1. In-memory Map (fastest, TTL 1h)
 *   2. Supabase strategy_cache column
 *   3. On-chain contract read (slowest, writes back to cache)
 * 
 * @param {number} botId
 * @returns {object|null} Strategy object { params: { aggression, defense, ... }, ... } or null
 */
async function getStrategyForBot(botId) {
  // ── Layer 1: In-memory cache ──
  const cached = _cache.get(botId);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.strategy;
  }

  try {
    // ── Fetch bot's nfa_id and strategy_cache from Supabase ──
    const rows = await supabaseRequest(`bots?id=eq.${botId}&select=nfa_id,strategy_cache`);
    if (!rows || rows.length === 0) return null;

    const bot = rows[0];
    if (bot.nfa_id === null || bot.nfa_id === undefined) return null;

    // --- DEBUG LOGGING ---
    if (bot.nfa_id === 31) {
      console.log(`  🔍 NFA Strategy: getStrategyForBot called for NFA #31. Current blacklist status: ${_nfaBlacklist.has(31) ? 'blacklisted' : 'not blacklisted'}`);
      console.log(`  🔍 NFA Strategy: _nfaFailureAttempts for #31:`, _nfaFailureAttempts.get(31));
    }
    // --- END DEBUG LOGGING ---

    // NEW: Check global NFA blacklist *before* attempting chain read
    if (_nfaBlacklist.has(bot.nfa_id)) {
      const blacklistedUntil = _nfaFailureAttempts.get(bot.nfa_id)?.blacklistedUntil;
      if (blacklistedUntil && Date.now() < blacklistedUntil) {
        console.log(`  ℹ️ NFA Strategy: Skipping blacklisted NFA #${bot.nfa_id} until ${new Date(blacklistedUntil).toLocaleTimeString()}.`);
        return null;
      } else if (blacklistedUntil) {
        // Blacklist expired, remove from blacklist and reset attempts
        _nfaBlacklist.delete(bot.nfa_id);
        _nfaFailureAttempts.delete(bot.nfa_id);
        console.log(`  ℹ️ NFA Strategy: Blacklist expired for NFA #${bot.nfa_id}. Retrying.`);
      }
    }

    // ── Layer 2: Supabase strategy_cache ──
    if (bot.strategy_cache) {
      try {
        const strategy = JSON.parse(bot.strategy_cache);
        if (strategy && strategy.params) {
          _cache.set(botId, { strategy, fetchedAt: Date.now() });
          return strategy;
        }
      } catch {
        // Corrupted cache, fall through to chain read
      }
    }

    // ── Layer 3: On-chain read ──
    const strategy = await readStrategyFromChain(bot.nfa_id);
    if (!strategy || !strategy.params) return null;

    // Write back to all caches
    _cache.set(botId, { strategy, fetchedAt: Date.now() });

    // Write to Supabase cache (non-blocking)
    updateStrategyCache(botId, strategy).catch(err => {
      console.error(`  ⚠️ NFA Strategy: Failed to cache strategy for bot ${botId}: ${err.message}`);
    });

    return strategy;
  } catch (err) {
    console.error(`  ⚠️ NFA Strategy: Error fetching for bot ${botId}: ${err.message}`);
    return null;
  }
}

/**
 * Update strategy_cache in Supabase (non-blocking background operation)
 */
async function updateStrategyCache(botId, strategy) {
  await supabaseRequest(`bots?id=eq.${botId}`, {
    method: 'PATCH',
    body: JSON.stringify({ strategy_cache: JSON.stringify(strategy) }),
    prefer: 'return=minimal',
  });
}

// ─── Strategy → Prediction Modifiers ─────────────────────────────────────────

/**
 * Default NFA params (used as baseline when a param is missing)
 */
const DEFAULT_NFA_PARAMS = {
  aggression: 50,
  defense: 50,
  speed: 50,
  adaptability: 50,
  riskTolerance: 50,
  patternRecognition: 50,
  counterStrategy: 50,
  bluffFrequency: 0,
  endgameShift: 50,
};

/**
 * Convert NFA strategy params (0-100) into prediction modifiers.
 * 
 * Returns an object with modifier functions/values that alter the base prediction.
 * 
 * @param {object} strategyParams - { aggression: 0-100, defense: 0-100, ... }
 * @returns {object} Modifiers for use in prediction generation
 */
function strategyToModifiers(strategyParams) {
  const p = { ...DEFAULT_NFA_PARAMS, ...strategyParams };
  
  // Normalize 0-100 → 0.0-1.0
  const aggression = p.aggression / 100;
  const defense = p.defense / 100;
  const speed = p.speed / 100;
  const adaptability = p.adaptability / 100;
  const riskTolerance = p.riskTolerance / 100;
  const patternRecognition = p.patternRecognition / 100;
  const counterStrategy = p.counterStrategy / 100;
  const bluffFrequency = p.bluffFrequency / 100;
  const endgameShift = p.endgameShift / 100;

  return {
    /**
     * Scale how far the prediction deviates from 1.0.
     * High aggression → predictions further from 1.0 (more extreme calls)
     * High defense → predictions closer to 1.0 (conservative)
     * Net effect: aggression pulls out, defense pulls in.
     */
    predictionScale: 0.5 + aggression * 0.8 - defense * 0.4,
    //  aggression=100,defense=0 → 1.3 (very bold)
    //  aggression=0,defense=100 → 0.1 (very conservative)
    //  aggression=50,defense=50 → 0.7 (neutral-ish)

    /**
     * Momentum multiplier — how much to follow the trend.
     * High speed → react strongly to momentum signals.
     * High patternRecognition → amplify trend-following.
     */
    momentumFactor: 0.6 + speed * 0.5 + patternRecognition * 0.3,
    //  speed=100,pattern=100 → 1.4 (heavy trend following)
    //  speed=0,pattern=0 → 0.6 (ignore momentum)

    /**
     * Contrarian probability — chance to flip prediction direction.
     * Driven by bluffFrequency and counterStrategy.
     */
    contrarianChance: bluffFrequency * 0.3 + counterStrategy * 0.15,
    //  bluff=100,counter=100 → 0.45 (45% chance to go contrarian)
    //  bluff=0,counter=0 → 0 (never contrarian)

    /**
     * Risk multiplier — max prediction range extension.
     * High riskTolerance → wider prediction range (can predict 5x+).
     * Low riskTolerance → narrower range (max ~2x).
     */
    maxPrediction: 2.0 + riskTolerance * 3.0,
    //  risk=100 → 5.0
    //  risk=0 → 2.0

    /**
     * Adaptability noise — randomness added to predictions.
     * High adaptability → slight randomness (adapting to conditions).
     */
    noiseFactor: 0.05 + adaptability * 0.15,
    //  adapt=100 → 0.20
    //  adapt=0 → 0.05

    /**
     * Endgame shift — prediction bias as battle progresses.
     * High endgameShift → more aggressive towards end of battle.
     * (Not used per-tick, but passed through for future use)
     */
    endgameShift,

    // Raw params for custom use
    raw: p,
  };
}

/**
 * Apply NFA strategy modifiers to a base prediction.
 * 
 * @param {number} basePrediction - The prediction from LLM or preset strategy (e.g. 1.5)
 * @param {object} modifiers - Output from strategyToModifiers()
 * @param {object} token - Market token data (for momentum calculations)
 * @returns {number} Modified prediction, clamped to [0.1, maxPrediction]
 */
function applyNFAModifiers(basePrediction, modifiers, token) {
  let pred = basePrediction;

  // 1. Scale deviation from 1.0
  const deviation = pred - 1.0;
  pred = 1.0 + deviation * modifiers.predictionScale;

  // 2. Momentum factor — amplify/dampen based on recent price action
  const momentum = (token?.price_change_1h || 0) / 100;
  if (Math.abs(momentum) > 0.05) {
    // Scale momentum influence by the factor
    const momentumPush = momentum * (modifiers.momentumFactor - 0.8);
    pred += momentumPush;
  }

  // 3. Contrarian flip — chance to invert prediction direction
  if (modifiers.contrarianChance > 0 && Math.random() < modifiers.contrarianChance) {
    // Flip around 1.0: if pred = 1.5, becomes 0.5; if pred = 0.7, becomes 1.3
    pred = 2.0 - pred;
  }

  // 4. Noise
  pred += (Math.random() - 0.5) * modifiers.noiseFactor * 2;

  // 5. Clamp to allowed range
  const minPred = Math.max(0.1, 2.0 - modifiers.maxPrediction);
  pred = Math.max(minPred, Math.min(modifiers.maxPrediction, pred));

  return parseFloat(pred.toFixed(2));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get NFA-modified prediction for a bot.
 * 
 * If bot has NFA with strategy → modifies basePrediction using NFA params.
 * If bot has no NFA → returns basePrediction unchanged.
 * 
 * @param {number} botId
 * @param {number} basePrediction - Prediction from LLM/preset strategy
 * @param {object} token - Market token data
 * @returns {Promise<{prediction: number, usedNFA: boolean, strategyName: string|null}>}
 */
async function getNFAModifiedPrediction(botId, basePrediction, token) {
  const strategy = await getStrategyForBot(botId);

  if (!strategy || !strategy.params) {
    return {
      prediction: basePrediction,
      usedNFA: false,
      strategyName: null,
    };
  }

  const modifiers = strategyToModifiers(strategy.params);
  const modified = applyNFAModifiers(basePrediction, modifiers, token);

  return {
    prediction: modified,
    usedNFA: true,
    strategyName: strategy.name || strategy.style || 'NFA Strategy',
  };
}

/**
 * Invalidate cached strategy for a bot (call after NFA link/update).
 */
function invalidateCache(botId) {
  _cache.delete(botId);
}

/**
 * Get cache stats (for monitoring).
 */
function getCacheStats() {
  let active = 0;
  let expired = 0;
  const now = Date.now();
  for (const [, entry] of _cache) {
    if (now - entry.fetchedAt < CACHE_TTL_MS) active++;
    else expired++;
  }
  return { active, expired, total: _cache.size };
}

module.exports = {
  getStrategyForBot,
  getNFAModifiedPrediction,
  strategyToModifiers,
  applyNFAModifiers,
  updateStrategyCache,
  invalidateCache,
  getCacheStats,
  readStrategyFromChain,
  DEFAULT_NFA_PARAMS,
};
