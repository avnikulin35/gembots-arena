'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useEVMWallet } from '@/providers/EVMWalletProvider';
import TierBadge from '@/components/TierBadge';
import {
  mintNFA,
  estimateMintGas,
  NFA_CONTRACT_ADDRESS,
  MINT_FEE_BNB,
  TIER_MINT_FEES,
  Tier,
  bscscanAddress,
  getReadContract,
  TIER_COLORS,
  TIER_GLOW,
  type AgentMetadata,
} from '@/lib/nfa';
import { ethers } from 'ethers';

// ============================================================================
// Tier System — BYOK Pricing
// ============================================================================

const TIERS = [
  {
    id: 'bronze',
    name: 'Bronze',
    emoji: '🥉',
    tierIndex: 0,
    fee: '0.01',
    models: ['meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
    modelNames: ['Llama 3.1 8B', 'Mistral 7B'],
    byok: false,
    description: 'Free AI models. Perfect for getting started.',
    features: ['Free AI models', 'Trading League battles', 'P&L tracking'],
    color: '#CD7F32',
    glowColor: 'rgba(205,127,50,0.35)',
    gradient: 'from-amber-900/30 to-yellow-900/20',
    borderColor: 'border-amber-700/50',
    accentText: 'text-amber-400',
  },
  {
    id: 'silver',
    name: 'Silver',
    emoji: '🥈',
    tierIndex: 1,
    fee: '0.03',
    models: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-exp:free', 'anthropic/claude-3.5-haiku'],
    modelNames: ['GPT-4o Mini', 'Gemini 2.0 Flash', 'Claude 3.5 Haiku'],
    byok: true,
    description: 'Bring your own API key. Stronger models.',
    features: ['Mid-tier AI models', 'Custom name & emoji', 'Priority matchmaking', 'BYOK — your key, your control'],
    color: '#C0C0C0',
    glowColor: 'rgba(192,192,192,0.35)',
    gradient: 'from-gray-600/30 to-gray-700/20',
    borderColor: 'border-gray-400/50',
    accentText: 'text-gray-300',
  },
  {
    id: 'gold',
    name: 'Gold',
    emoji: '🥇',
    tierIndex: 2,
    fee: '0.1',
    models: ['anthropic/claude-sonnet-4-5', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
    modelNames: ['Claude Sonnet 4.5', 'GPT-4o', 'Gemini 2.5 Pro'],
    byok: true,
    description: 'Top-tier models. Maximum competitive edge.',
    features: ['Premium AI models', 'Custom everything', 'ELO boost +50', 'Priority matchmaking', 'BYOK — your key, your control'],
    color: '#FFD700',
    glowColor: 'rgba(255,215,0,0.4)',
    gradient: 'from-yellow-700/30 to-amber-800/20',
    borderColor: 'border-yellow-500/50',
    accentText: 'text-yellow-400',
  },
];

// Available strategies for NFA v2
const STRATEGIES = [
  'DragonScale', 'SolarFlare', 'PyroBot', 'WhaleWatch',
  'VoltageKing', 'TargetLock', 'EqniMb', 'FrostMaster',
  'MoonShot', 'TsunamiX', 'SharkBite', 'LunarPredator',
];

// Fun bot emojis for custom names
const BOT_EMOJIS = ['🤖', '🦾', '⚡', '🔥', '🧠', '💎', '🚀', '🎯', '🦈', '🐉', '👾', '🛸', '⚔️', '🌊', '🌀', '💀'];

// Step labels
const STEP_LABELS = ['Select Tier', 'Configure Bot', 'API Key', 'Review & Mint'];

export default function MintPage() {
  const { connected, address, signer, connect, connecting } = useEVMWallet();

  // Wizard state
  const [step, setStep] = useState(1);
  const [selectedTier, setSelectedTier] = useState<typeof TIERS[number] | null>(null);

  // Bot configuration
  const [botName, setBotName] = useState('');
  const [botEmoji, setBotEmoji] = useState('🤖');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGIES[0]);
  const [systemPrompt, setSystemPrompt] = useState('');

  // API Key (BYOK)
  const [apiKey, setApiKey] = useState('');
  const [keyTestStatus, setKeyTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [keyTestMessage, setKeyTestMessage] = useState('');

  // Mint state
  const [contractFee, setContractFee] = useState<string>(MINT_FEE_BNB);
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [mintedId, setMintedId] = useState<number | null>(null);
  const [arenaStatus, setArenaStatus] = useState<{
    arenaBot?: { id: number; name: string; hp: number; league: string; status: string };
    match?: { battleId: string; opponent: string; token: string } | null;
  } | null>(null);

  // Fetch on-chain mint fee
  useEffect(() => {
    fetchContractFee();
  }, []);

  const fetchContractFee = async () => {
    try {
      const contract = getReadContract();
      // v4: mintFee() returns Bronze fee for backward compat
      const fee = await contract.mintFee();
      setContractFee(ethers.formatEther(fee));
    } catch (err) {
      console.error('Failed to fetch mint fee:', err);
    }
  };

  // Estimate gas when on review step
  useEffect(() => {
    if (signer && step === 4 && selectedTier) {
      estimateGas();
    }
  }, [signer, step, selectedTier]);

  const estimateGas = async () => {
    if (!signer) return;
    setGasEstimate(null);
    const uri = buildTokenURI();
    const estimate = await estimateMintGas(signer, uri, selectedStrategy);
    if (estimate) {
      setGasEstimate(estimate.gasCostBNB);
    }
  };

  // Effective fee: max(tierFee, contractFee) to satisfy on-chain requirement
  const effectiveFee = selectedTier
    ? Math.max(parseFloat(selectedTier.fee), parseFloat(contractFee)).toString()
    : contractFee;

  const buildTokenURI = () => {
    const metadata = {
      name: `${botName || 'GemBot'} NFA`,
      description: systemPrompt.slice(0, 500),
      tier: selectedTier?.id || 'bronze',
      model: selectedModel,
      strategy: selectedStrategy,
      emoji: botEmoji,
      createdAt: new Date().toISOString(),
    };
    return `data:application/json;base64,${btoa(JSON.stringify(metadata))}`;
  };

  // ============================================================================
  // API Key Test
  // ============================================================================

  const testApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      setKeyTestStatus('error');
      setKeyTestMessage('Please enter an API key');
      return;
    }

    setKeyTestStatus('testing');
    setKeyTestMessage('Testing your key...');

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://gembots.ainmid.com',
          'X-Title': 'GemBots Arena',
        },
        body: JSON.stringify({
          model: selectedModel || 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
          max_tokens: 5,
        }),
      });

      if (res.ok) {
        setKeyTestStatus('success');
        setKeyTestMessage('✅ Key works! Model access confirmed.');
      } else {
        const err = await res.json().catch(() => ({}));
        setKeyTestStatus('error');
        setKeyTestMessage(`❌ ${(err as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`}`);
      }
    } catch (err) {
      setKeyTestStatus('error');
      setKeyTestMessage(`❌ Network error: ${(err as Error).message}`);
    }
  }, [apiKey, selectedModel]);

  // ============================================================================
  // Mint Handler
  // ============================================================================

  const handleMint = async () => {
    if (!signer || !selectedTier) return;
    setMinting(true);
    setMintError(null);
    setTxHash(null);

    try {
      const uri = buildTokenURI();
      const agentMeta: AgentMetadata = {
        persona: JSON.stringify({
          name: botName || 'GemBot',
          emoji: botEmoji,
          tier: selectedTier.id,
          style: selectedStrategy,
        }),
        experience: systemPrompt.slice(0, 200) || selectedTier.description,
        voiceHash: '',
        animationURI: '',
        vaultURI: uri,
        vaultHash: ethers.keccak256(ethers.toUtf8Bytes(uri)),
      };

      // mintNFA v4: pass tier for on-chain tier-based pricing
      const tierEnum = selectedTier.tierIndex as Tier;
      const receipt = await mintNFA(signer, uri, selectedStrategy, selectedModel, agentMeta, tierEnum);

      if (receipt) {
        setTxHash(receipt.hash);

        // Parse Minted event to get the ID
        const iface = new ethers.Interface([
          'event NFAMinted(uint256 indexed nfaId, address indexed owner, bytes32 configHash, bool genesis)',
        ]);
        let mintedNfaId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsed && parsed.name === 'NFAMinted') {
              mintedNfaId = Number(parsed.args.nfaId);
              setMintedId(mintedNfaId);
              break;
            }
          } catch {
            // Not our event
          }
        }

        // Store API key in localStorage (NEVER on server)
        if (mintedNfaId !== null && apiKey.trim() && selectedTier.byok) {
          try {
            localStorage.setItem(`gembots_apikey_${mintedNfaId}`, apiKey.trim());
          } catch {
            console.warn('Failed to save API key to localStorage');
          }
        }

        // Link NFA to bot config in Supabase
        if (mintedNfaId !== null && address) {
          try {
            await fetch('/api/nfa/link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                botId: mintedNfaId, // use NFA ID as bot ID for new flow
                nfaId: mintedNfaId,
                evmAddress: address,
              }),
            });
          } catch (linkErr) {
            console.warn('Failed to link NFA to bot in DB:', linkErr);
          }

          // Save bot config to Supabase via our new endpoint
          try {
            await fetch('/api/nfa/save-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nfaId: mintedNfaId,
                tier: selectedTier.id,
                model: selectedModel,
                strategy: selectedStrategy,
                botName: botName || 'GemBot',
                botEmoji,
                systemPrompt: systemPrompt.slice(0, 500),
                evmAddress: address,
                byok: selectedTier.byok,
              }),
            });
          } catch (saveErr) {
            console.warn('Failed to save bot config:', saveErr);
          }

          // Auto-activate on Arena after mint
          try {
            const activateRes = await fetch('/api/arena/activate-nfa', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                botId: mintedNfaId,
                nfaId: mintedNfaId,
                botName: `${botEmoji} ${botName || 'GemBot'}`,
                strategy: selectedStrategy,
                evmAddress: address,
              }),
            });
            const activateData = await activateRes.json();
            if (activateData.success) {
              setArenaStatus(activateData);
            }
          } catch (activateErr) {
            console.warn('Arena activation failed:', activateErr);
          }
        }
      }
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setMintError(e.reason || e.message || 'Minting failed');
    } finally {
      setMinting(false);
    }
  };

  // ============================================================================
  // Navigation helpers
  // ============================================================================

  const canProceed = () => {
    switch (step) {
      case 1: return selectedTier !== null;
      case 2: return selectedModel !== '';
      case 3: return !selectedTier?.byok || apiKey.trim() !== '';
      case 4: return true;
      default: return false;
    }
  };

  const goNext = () => {
    if (step === 2 && selectedTier && !selectedTier.byok) {
      setStep(4);
    } else {
      setStep(Math.min(step + 1, 4));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    if (step === 4 && selectedTier && !selectedTier.byok) {
      setStep(2);
    } else {
      setStep(Math.max(step - 1, 1));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Total steps (Bronze skips API key step)
  const totalSteps = selectedTier && !selectedTier.byok ? 3 : 4;
  const displaySteps = selectedTier && !selectedTier.byok
    ? [1, 2, 4] // skip step 3
    : [1, 2, 3, 4];

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
      {/* Hero — compact on steps 2+ */}
      <div className="relative overflow-hidden border-b border-gray-800">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/20 via-transparent to-pink-900/20" />
        <div className={`max-w-4xl mx-auto px-4 sm:px-6 relative text-center transition-all ${step === 1 && !mintedId ? 'py-10' : 'py-4'}`}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className={`font-bold mb-1 transition-all ${step === 1 && !mintedId ? 'text-4xl sm:text-5xl mb-3' : 'text-2xl sm:text-3xl'}`}>
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-red-400 bg-clip-text text-transparent">
                Mint Your NFA
              </span>
            </h1>
            {(step === 1 && !mintedId) && (
              <p className="text-gray-400 text-lg max-w-xl mx-auto">
                Create a Non-Fungible Agent on BNB Chain. Choose your tier, configure your bot, and enter the Arena.
              </p>
            )}
          </motion.div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* ============================================================ */}
        {/* Success State */}
        {/* ============================================================ */}
        {txHash && mintedId && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8 bg-green-900/20 border border-green-500/30 rounded-2xl p-8 text-center"
          >
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-green-400 mb-2">
              {botEmoji} {botName || 'GemBot'} #{mintedId} is LIVE!
            </h2>
            <p className="text-gray-400 mb-2">
              Your <span className="font-bold" style={{ color: selectedTier?.color }}>{selectedTier?.emoji} {selectedTier?.name}</span> tier bot is now on-chain
            </p>
            <p className="text-gray-500 text-sm mb-4">
              Strategy: <span className="text-yellow-400">{selectedStrategy}</span> · Model: <span className="text-purple-400">{selectedTier?.modelNames[selectedTier.models.indexOf(selectedModel)] || selectedModel}</span>
            </p>

            {/* Arena Status */}
            {arenaStatus?.arenaBot && (
              <div className="mb-6 bg-purple-900/20 border border-purple-500/30 rounded-xl p-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-lg">⚔️</span>
                  <span className="font-bold text-purple-300">Arena Activated!</span>
                </div>
                <div className="text-sm text-gray-400 space-y-1">
                  <p>HP: <span className="text-green-400">{arenaStatus.arenaBot.hp}</span> | League: <span className="text-yellow-400 capitalize">{arenaStatus.arenaBot.league}</span></p>
                  {arenaStatus.match ? (
                    <p className="text-green-400 font-medium mt-2">
                      🔴 LIVE — Matched vs <span className="text-red-400">{arenaStatus.match.opponent}</span> on {arenaStatus.match.token}!
                    </p>
                  ) : (
                    <p className="text-blue-400 mt-2">🔍 Waiting in lobby for an opponent...</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              {arenaStatus?.match ? (
                <Link href="/arena" className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-white font-bold hover:shadow-lg transition-all animate-pulse">
                  🔴 Watch Live Battle
                </Link>
              ) : (
                <Link href="/arena" className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold hover:shadow-lg transition-all">
                  ⚔️ Go to Arena
                </Link>
              )}
              <a href={`https://bscscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                className="px-6 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 font-medium hover:text-white transition-colors">
                View TX ↗
              </a>
            </div>
          </motion.div>
        )}

        {/* ============================================================ */}
        {/* Step Progress Indicator */}
        {/* ============================================================ */}
        {!mintedId && (
          <>
            <div className="flex items-center justify-center gap-2 mb-6">
              {displaySteps.map((s, idx) => (
                <div key={s} className="flex items-center gap-2">
                  <button
                    onClick={() => { if (s < step) setStep(s); }}
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                      s === step
                        ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]'
                        : s < step
                        ? 'bg-purple-600/30 text-purple-300 cursor-pointer hover:bg-purple-600/50'
                        : 'bg-gray-800 text-gray-600'
                    }`}
                  >
                    {s < step ? '✓' : idx + 1}
                  </button>
                  {idx < displaySteps.length - 1 && (
                    <div className={`w-10 sm:w-16 h-0.5 ${s < step ? 'bg-purple-500' : 'bg-gray-700'}`} />
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-6 sm:gap-12 mb-8 text-xs text-gray-500">
              {displaySteps.map((s) => {
                const label = s === 1 ? 'Select Tier' : s === 2 ? 'Configure' : s === 3 ? 'API Key' : 'Mint';
                return (
                  <span key={s} className={step === s ? 'text-purple-400 font-medium' : ''}>
                    {label}
                  </span>
                );
              })}
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* STEP 1: Select Tier */}
        {/* ============================================================ */}
        <AnimatePresence mode="wait">
          {step === 1 && !mintedId && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="text-center mb-2">
                <h2 className="text-xl font-bold text-white">Choose Your Tier</h2>
                <p className="text-sm text-gray-400 mt-1">Higher tiers unlock stronger AI models</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {TIERS.map((tier) => {
                  const isSelected = selectedTier?.id === tier.id;
                  return (
                    <button
                      key={tier.id}
                      onClick={() => {
                        setSelectedTier(tier);
                        setSelectedModel(tier.models[0]);
                      }}
                      className={`relative p-6 rounded-2xl border-2 transition-all text-left group ${
                        isSelected
                          ? `bg-gradient-to-b ${tier.gradient} ${tier.borderColor}`
                          : 'bg-gray-800/30 border-gray-700/50 hover:border-gray-600'
                      }`}
                      style={isSelected ? { boxShadow: `0 0 25px ${tier.glowColor}` } : {}}
                    >
                      {/* Popular badge for Gold */}
                      {tier.id === 'gold' && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-yellow-500 text-black text-[10px] font-bold uppercase tracking-wider">
                          Best Value
                        </div>
                      )}

                      {/* Tier header */}
                      <div className="text-center mb-4">
                        <div className="text-4xl mb-2">{tier.emoji}</div>
                        <h3 className="text-lg font-bold" style={{ color: tier.color }}>{tier.name}</h3>
                        <div className="mt-1">
                          <span className="text-2xl font-bold text-white">{tier.fee}</span>
                          <span className="text-gray-400 text-sm ml-1">BNB</span>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-xs text-gray-400 text-center mb-4">{tier.description}</p>

                      {/* Models */}
                      <div className="mb-4">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">AI Models</div>
                        <div className="space-y-1">
                          {tier.modelNames.map((name, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className={tier.accentText}>•</span>
                              <span className="text-gray-300">{name}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Features */}
                      <div className="space-y-1.5">
                        {tier.features.map((feat, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                            <span className="text-green-500">✓</span>
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>

                      {/* Selection indicator */}
                      {isSelected && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-white text-sm"
                          style={{ backgroundColor: tier.color }}
                        >
                          ✓
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={goNext}
                  disabled={!canProceed()}
                  className="px-6 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Configure Bot →
                </button>
              </div>
            </motion.div>
          )}

          {/* ============================================================ */}
          {/* STEP 2: Configure Bot */}
          {/* ============================================================ */}
          {step === 2 && !mintedId && selectedTier && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-white mb-1">⚙️ Configure Your Bot</h2>
                <p className="text-sm text-gray-400">
                  <span style={{ color: selectedTier.color }}>{selectedTier.emoji} {selectedTier.name}</span> tier selected — customize your fighter
                </p>
              </div>

              <div className="space-y-5">
                {/* Bot Name & Emoji */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Bot Name</label>
                    <input
                      type="text"
                      value={botName}
                      onChange={(e) => setBotName(e.target.value.slice(0, 24))}
                      placeholder="e.g. AlphaHunter"
                      maxLength={24}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                    <span className="text-[10px] text-gray-600">{botName.length}/24</span>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Emoji</label>
                    <div className="flex flex-wrap gap-1.5">
                      {BOT_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => setBotEmoji(emoji)}
                          className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all ${
                            botEmoji === emoji
                              ? 'bg-purple-600/30 border border-purple-500/50 scale-110'
                              : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Model Selection */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">AI Model</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {selectedTier.models.map((model, i) => (
                      <button
                        key={model}
                        onClick={() => setSelectedModel(model)}
                        className={`px-4 py-3 rounded-xl text-left transition-all border ${
                          selectedModel === model
                            ? 'bg-purple-500/20 border-purple-500/50 text-white'
                            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                        }`}
                      >
                        <div className="font-medium text-sm">{selectedTier.modelNames[i]}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5 font-mono truncate">{model}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Strategy Selection */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Strategy</label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {STRATEGIES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSelectedStrategy(s)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                          selectedStrategy === s
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* System Prompt */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Custom Prompt <span className="text-gray-600">(optional)</span></label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Describe your bot's trading style, personality, or custom instructions..."
                    rows={3}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-y"
                  />
                  <span className="text-[10px] text-gray-600">{systemPrompt.length}/500</span>
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={goBack} className="px-6 py-3 rounded-xl bg-gray-800 text-gray-400 font-medium hover:text-white transition-colors">
                  ← Back
                </button>
                <button
                  onClick={goNext}
                  disabled={!canProceed()}
                  className="px-6 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {selectedTier.byok ? 'Next: API Key →' : 'Next: Review →'}
                </button>
              </div>
            </motion.div>
          )}

          {/* ============================================================ */}
          {/* STEP 3: API Key (Silver/Gold only) */}
          {/* ============================================================ */}
          {step === 3 && !mintedId && selectedTier?.byok && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-white mb-1">🔑 Your OpenRouter API Key</h2>
                <p className="text-sm text-gray-400">
                  Required for <span style={{ color: selectedTier.color }}>{selectedTier.emoji} {selectedTier.name}</span> tier models
                </p>
              </div>

              {/* Security Badge */}
              <div className="bg-green-900/15 border border-green-500/20 rounded-xl p-4 flex items-start gap-3">
                <span className="text-2xl mt-0.5">🔒</span>
                <div>
                  <h4 className="text-green-400 font-bold text-sm">Your key is safe</h4>
                  <p className="text-green-300/70 text-xs mt-1">
                    Your API key <strong>never touches our servers</strong>. It&apos;s stored only in your browser&apos;s localStorage. 
                    During battles, the key is sent directly to OpenRouter — we never see, log, or store it.
                  </p>
                </div>
              </div>

              {/* API Key Input */}
              <div>
                <label className="text-sm text-gray-400 mb-2 block">OpenRouter API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyTestStatus('idle');
                    }}
                    placeholder="sk-or-v1-..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors font-mono"
                  />
                  <button
                    onClick={testApiKey}
                    disabled={keyTestStatus === 'testing' || !apiKey.trim()}
                    className={`px-4 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-all border ${
                      keyTestStatus === 'success'
                        ? 'bg-green-900/30 border-green-500/50 text-green-400'
                        : keyTestStatus === 'error'
                        ? 'bg-red-900/30 border-red-500/50 text-red-400'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white hover:border-gray-600'
                    } disabled:opacity-40`}
                  >
                    {keyTestStatus === 'testing' ? (
                      <span className="flex items-center gap-1">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Testing...
                      </span>
                    ) : keyTestStatus === 'success' ? '✅ Works!' : '🧪 Test Key'}
                  </button>
                </div>
                {keyTestMessage && (
                  <p className={`text-xs mt-2 ${keyTestStatus === 'success' ? 'text-green-400' : keyTestStatus === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                    {keyTestMessage}
                  </p>
                )}
              </div>

              {/* How to get a key */}
              <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4">
                <h4 className="text-gray-300 font-medium text-sm mb-2">Don&apos;t have a key?</h4>
                <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside">
                  <li>Go to <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline">openrouter.ai</a></li>
                  <li>Sign up and add credits ($5 is enough for hundreds of battles)</li>
                  <li>Go to Keys → Create Key → paste it above</li>
                </ol>
              </div>

              <div className="flex justify-between">
                <button onClick={goBack} className="px-6 py-3 rounded-xl bg-gray-800 text-gray-400 font-medium hover:text-white transition-colors">
                  ← Back
                </button>
                <button
                  onClick={goNext}
                  disabled={!canProceed()}
                  className="px-6 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Review & Mint →
                </button>
              </div>
            </motion.div>
          )}

          {/* ============================================================ */}
          {/* STEP 4: Review & Mint */}
          {/* ============================================================ */}
          {step === 4 && !mintedId && selectedTier && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-bold text-white">⚡ Review & Mint</h2>

              {/* Preview Card */}
              <div
                className={`rounded-2xl border-2 overflow-hidden transition-all`}
                style={{
                  borderColor: `${selectedTier.color}44`,
                  boxShadow: `0 0 30px ${selectedTier.glowColor}`,
                  background: `linear-gradient(135deg, ${selectedTier.color}08 0%, transparent 50%, ${selectedTier.color}05 100%)`,
                }}
              >
                <div className="p-6">
                  {/* Bot Identity */}
                  <div className="flex items-center gap-4 mb-6">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                      style={{ backgroundColor: `${selectedTier.color}15`, border: `1px solid ${selectedTier.color}33` }}
                    >
                      {botEmoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-lg">{botName || 'GemBot'}</h3>
                        <TierBadge tier={selectedTier.tierIndex} size="sm" />
                      </div>
                      <p className="text-sm text-gray-400 mt-0.5">
                        {selectedTier.modelNames[selectedTier.models.indexOf(selectedModel)] || selectedModel}
                      </p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 font-medium">
                        {selectedStrategy}
                      </span>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-900/40 rounded-xl p-3">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Tier</span>
                      <div className="font-medium mt-1" style={{ color: selectedTier.color }}>
                        {selectedTier.emoji} {selectedTier.name}
                      </div>
                    </div>
                    <div className="bg-gray-900/40 rounded-xl p-3">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Model</span>
                      <div className="font-medium text-white mt-1 truncate">
                        {selectedTier.modelNames[selectedTier.models.indexOf(selectedModel)]}
                      </div>
                    </div>
                    <div className="bg-gray-900/40 rounded-xl p-3">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Strategy</span>
                      <div className="font-medium text-purple-300 mt-1">{selectedStrategy}</div>
                    </div>
                    <div className="bg-gray-900/40 rounded-xl p-3">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">API Key</span>
                      <div className="font-medium mt-1">
                        {selectedTier.byok ? (
                          <span className="text-green-400">{apiKey ? '✅ Provided' : '❌ Missing'}</span>
                        ) : (
                          <span className="text-gray-400">Not needed</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {systemPrompt && (
                    <div className="mt-4">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Custom Prompt</span>
                      <div className="text-xs text-gray-400 bg-gray-900/50 p-3 rounded-xl mt-1 max-h-16 overflow-y-auto">
                        {systemPrompt.slice(0, 200)}{systemPrompt.length > 200 ? '...' : ''}
                      </div>
                    </div>
                  )}
                </div>

                {/* Cost Breakdown */}
                <div className="border-t p-6 space-y-2" style={{ borderColor: `${selectedTier.color}22` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Mint Fee ({selectedTier.name})</span>
                    <span className="text-lg font-bold text-yellow-400">{effectiveFee} BNB</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Estimated Gas</span>
                    <span className="text-sm text-yellow-400 font-mono">
                      {gasEstimate ? `~${parseFloat(gasEstimate).toFixed(6)} BNB` : 'Estimating...'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: `${selectedTier.color}15` }}>
                    <span className="text-sm text-white font-medium">Total Cost</span>
                    <span className="text-lg font-bold text-yellow-400">
                      ~{(parseFloat(effectiveFee) + parseFloat(gasEstimate || '0.0005')).toFixed(4)} BNB
                    </span>
                  </div>
                </div>
              </div>

              {/* Error */}
              {mintError && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
                  <p className="text-red-400 text-sm">{mintError}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between">
                <button onClick={goBack} className="px-6 py-3 rounded-xl bg-gray-800 text-gray-400 font-medium hover:text-white transition-colors">
                  ← Back
                </button>

                {!connected ? (
                  <button
                    onClick={connect}
                    disabled={connecting}
                    className="px-8 py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all disabled:opacity-50"
                  >
                    {connecting ? 'Connecting...' : '🦊 Connect Wallet'}
                  </button>
                ) : (
                  <button
                    onClick={handleMint}
                    disabled={minting}
                    className="px-8 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg hover:shadow-[0_0_20px_rgba(147,51,234,0.3)] transition-all disabled:opacity-50"
                  >
                    {minting ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Minting ({effectiveFee} BNB)...
                      </span>
                    ) : (
                      `⚡ Mint NFA (${effectiveFee} BNB)`
                    )}
                  </button>
                )}
              </div>

              {/* Contract Info */}
              <div className="text-center pt-4 border-t border-gray-800">
                <p className="text-[10px] text-gray-600">
                  Contract:{' '}
                  <a
                    href={bscscanAddress(NFA_CONTRACT_ADDRESS)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-gray-400 font-mono"
                  >
                    {NFA_CONTRACT_ADDRESS}
                  </a>
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
