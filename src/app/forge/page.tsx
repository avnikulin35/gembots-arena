"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useEVMWallet } from "@/providers/EVMWalletProvider";
import { TIER_MINT_FEES, Tier } from "@/lib/nfa";

// ============================================================================
// NFA Forge — Model / Strategy / Risk configuration before mint
// ============================================================================

const FORGE_MODELS = [
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", tier: "silver", emoji: "🤖" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "silver", emoji: "💎" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude Haiku 3.5", tier: "silver", emoji: "🧠" },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", tier: "gold", emoji: "🌟" },
  { id: "openai/gpt-5", name: "GPT-5", tier: "gold", emoji: "🚀" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "gold", emoji: "⚡" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", tier: "gold", emoji: "🔮" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick", tier: "silver", emoji: "🦙" },
];

const FORGE_STRATEGIES = [
  { id: "momentum", name: "Momentum", emoji: "📈", desc: "Ride strong trends, buy breakouts" },
  { id: "scalper", name: "Scalper", emoji: "⚡", desc: "Quick in-and-out, small frequent gains" },
  { id: "swing", name: "Swing Trader", emoji: "🌊", desc: "Hold positions for days, catch swings" },
  { id: "mean_reversion", name: "Mean Reversion", emoji: "🎯", desc: "Bet on price returning to average" },
  { id: "contrarian", name: "Contrarian", emoji: "🔄", desc: "Go against the crowd" },
];

const RISK_LEVELS = [
  { id: "conservative", name: "Conservative", emoji: "🛡️", leverage: "1-2x", desc: "Low risk, steady returns", color: "emerald" },
  { id: "moderate", name: "Moderate", emoji: "⚖️", leverage: "2-5x", desc: "Balanced risk/reward", color: "blue" },
  { id: "aggressive", name: "Aggressive", emoji: "🔥", leverage: "5-10x", desc: "High risk, high reward", color: "red" },
];

// ============================================================================
// Avatar styles & strategy examples (existing features)
// ============================================================================

const AVATAR_STYLES = [
  { id: "cyberpunk", label: "🤖 Cyberpunk", desc: "Neon-lit chrome warriors" },
  { id: "anime", label: "🎌 Anime", desc: "Japanese mecha style" },
  { id: "realistic", label: "📸 Realistic", desc: "Photorealistic robots" },
  { id: "pixel", label: "👾 Pixel Art", desc: "Retro 8-bit style" },
];

const STRATEGY_EXAMPLES = [
  "A momentum trading bot that buys when RSI crosses above 30 and sells when it crosses below 70, with a 5% trailing stop loss",
  "A DCA vault that auto-buys BNB every day and compounds staking rewards",
  "An arbitrage contract that flash-borrows from Aave and trades between PancakeSwap and BiSwap",
];

export default function ForgePage() {
  const [activeTab, setActiveTab] = useState<"forge" | "avatar" | "strategy">("forge");

  return (
    <div className="min-h-screen bg-gray-950 pt-20 pb-12">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm mb-4">
            ⚡ Powered by AI
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4">
            AI Forge
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Customize your NFA — pick a model, strategy, and risk level, then mint your unique AI trading agent
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="flex justify-center gap-3 mb-8 flex-wrap">
          <button
            onClick={() => setActiveTab("forge")}
            className={`px-6 py-3 rounded-xl font-medium transition-all ${
              activeTab === "forge"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-purple-500/25"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            🔧 NFA Forge
          </button>
          <button
            onClick={() => setActiveTab("avatar")}
            className={`px-6 py-3 rounded-xl font-medium transition-all ${
              activeTab === "avatar"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-purple-500/25"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            🎨 Avatar Forge
          </button>
          <button
            onClick={() => setActiveTab("strategy")}
            className={`px-6 py-3 rounded-xl font-medium transition-all ${
              activeTab === "strategy"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-purple-500/25"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            ⚡ Strategy Builder
          </button>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === "forge" ? (
            <NFAForge key="forge" />
          ) : activeTab === "avatar" ? (
            <AvatarForge key="avatar" />
          ) : (
            <StrategyBuilder key="strategy" />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================================
// NFA Forge — NEW: model + strategy + risk → mint
// ============================================================================

function NFAForge() {
  const { address, connect } = useEVMWallet();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [selectedRisk, setSelectedRisk] = useState<string>("moderate");
  const [nfaName, setNfaName] = useState("");
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; txHash?: string; nfaId?: number; error?: string } | null>(null);

  const selectedModelData = FORGE_MODELS.find(m => m.id === selectedModel);
  const mintTier = selectedModelData?.tier === "gold" ? Tier.Gold : Tier.Silver;
  const mintFee = selectedModelData?.tier === "gold" ? "0.75" : "0.3";

  const canMint = selectedModel && selectedStrategy && selectedRisk && nfaName.trim();

  const handleForge = async () => {
    if (!canMint || !address) return;
    setMinting(true);
    setResult(null);

    try {
      // First, save forge config to backend
      const configRes = await fetch("/api/nfa/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nfaName.trim(),
          modelId: selectedModel,
          strategy: selectedStrategy,
          riskLevel: selectedRisk,
          wallet: address,
        }),
      });
      const configData = await configRes.json();

      if (!configData.success) {
        setResult({ success: false, error: configData.error || "Failed to save forge config" });
        return;
      }

      // Config saved — redirect to mint page with forge params
      setResult({
        success: true,
        nfaId: configData.nfaId,
      });
    } catch (e: any) {
      setResult({ success: false, error: e?.message || "Mint failed" });
    } finally {
      setMinting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      {/* Step 1: Name */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold text-white mb-2">Step 1 — Name your NFA</h3>
        <p className="text-gray-400 text-sm mb-4">Give your AI trading agent a unique name</p>
        <input
          type="text"
          value={nfaName}
          onChange={(e) => setNfaName(e.target.value.slice(0, 24))}
          placeholder="e.g. AlphaHunter, NeonTrader..."
          className="w-full bg-gray-800 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
          maxLength={24}
        />
        <p className="text-gray-500 text-xs mt-2">{nfaName.length}/24 characters</p>
      </div>

      {/* Step 2: Model */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold text-white mb-2">Step 2 — Choose AI Model</h3>
        <p className="text-gray-400 text-sm mb-4">Different models have different trading edges. Gold-tier models are more powerful.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {FORGE_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`p-4 rounded-xl text-left transition-all relative ${
                selectedModel === model.id
                  ? "bg-purple-600/20 border-purple-500 border-2 shadow-lg shadow-purple-500/10"
                  : "bg-gray-800 border border-gray-700 hover:border-gray-600"
              }`}
            >
              <div className="text-2xl mb-2">{model.emoji}</div>
              <div className="font-medium text-white text-sm">{model.name}</div>
              <div className={`text-xs mt-1 ${model.tier === "gold" ? "text-yellow-400" : "text-gray-400"}`}>
                {model.tier === "gold" ? "🥇 Gold Tier" : "🥈 Silver Tier"}
              </div>
              {selectedModel === model.id && (
                <div className="absolute top-2 right-2 text-purple-400">✓</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Step 3: Strategy */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold text-white mb-2">Step 3 — Trading Strategy</h3>
        <p className="text-gray-400 text-sm mb-4">How your bot approaches the market</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {FORGE_STRATEGIES.map((strat) => (
            <button
              key={strat.id}
              onClick={() => setSelectedStrategy(strat.id)}
              className={`p-4 rounded-xl text-left transition-all ${
                selectedStrategy === strat.id
                  ? "bg-purple-600/20 border-purple-500 border-2"
                  : "bg-gray-800 border border-gray-700 hover:border-gray-600"
              }`}
            >
              <div className="text-xl mb-1">{strat.emoji}</div>
              <div className="font-medium text-white text-sm">{strat.name}</div>
              <div className="text-xs text-gray-400 mt-1">{strat.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Step 4: Risk */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold text-white mb-2">Step 4 — Risk Level</h3>
        <p className="text-gray-400 text-sm mb-4">Controls leverage and position sizing</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {RISK_LEVELS.map((risk) => (
            <button
              key={risk.id}
              onClick={() => setSelectedRisk(risk.id)}
              className={`p-5 rounded-xl text-left transition-all ${
                selectedRisk === risk.id
                  ? `bg-${risk.color}-600/20 border-${risk.color}-500 border-2`
                  : "bg-gray-800 border border-gray-700 hover:border-gray-600"
              }`}
            >
              <div className="text-3xl mb-2">{risk.emoji}</div>
              <div className="font-bold text-white">{risk.name}</div>
              <div className="text-xs text-gray-400 mt-1">{risk.desc}</div>
              <div className="text-xs text-gray-500 mt-2">Leverage: {risk.leverage}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Summary + Mint */}
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-2xl p-6 border border-purple-500/30">
        <h3 className="text-lg font-semibold text-white mb-4">Forge Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider">Name</div>
            <div className="text-white font-medium mt-1">{nfaName || "—"}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider">Model</div>
            <div className="text-white font-medium mt-1">{selectedModelData?.name || "—"}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider">Strategy</div>
            <div className="text-white font-medium mt-1">
              {FORGE_STRATEGIES.find(s => s.id === selectedStrategy)?.name || "—"}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider">Risk</div>
            <div className="text-white font-medium mt-1">
              {RISK_LEVELS.find(r => r.id === selectedRisk)?.name || "—"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="text-gray-400">
            Mint Fee: <span className="text-white font-bold">{selectedModel ? `${mintFee} BNB` : "Select model"}</span>
          </div>
          <div className="text-gray-500 text-sm">
            Tier: {selectedModelData?.tier === "gold" ? "🥇 Gold" : selectedModel ? "🥈 Silver" : "—"}
          </div>
        </div>

        {!address ? (
          <button
            onClick={connect}
            className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg transition-all"
          >
            Connect Wallet to Forge
          </button>
        ) : (
          <button
            onClick={handleForge}
            disabled={!canMint || minting}
            className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {minting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Forging NFA...
              </span>
            ) : (
              `🔧 Forge & Mint NFA — ${mintFee} BNB`
            )}
          </button>
        )}

        {result && (
          <div className={`mt-4 p-4 rounded-xl ${result.success ? "bg-green-900/20 border border-green-800" : "bg-red-900/20 border border-red-800"}`}>
            {result.success ? (
              <div>
                <p className="text-green-400 font-medium">NFA Forged Successfully!</p>
                {result.txHash && (
                  <a
                    href={`https://bscscan.com/tx/${result.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-300 text-sm underline mt-1 block"
                  >
                    View on BscScan →
                  </a>
                )}
              </div>
            ) : (
              <p className="text-red-400">{result.error}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Avatar Forge (existing)
// ============================================================================

function AvatarForge() {
  const [prompt, setPrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("cyberpunk");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setGeneratedImage(null);

    try {
      const res = await fetch("/api/ai/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${prompt}, ${selectedStyle} style` }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedImage(data.image);
      } else {
        setError(data.error || "Generation failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="grid md:grid-cols-2 gap-8"
    >
      <div className="space-y-6">
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold text-white mb-4">Describe your bot</h3>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A fierce dragon-themed robot with fire emanating from its joints, red and gold color scheme, battle-scarred armor..."
            className="w-full h-32 bg-gray-800 rounded-xl p-4 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
          />
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h3 className="text-lg font-semibold text-white mb-4">Choose style</h3>
          <div className="grid grid-cols-2 gap-3">
            {AVATAR_STYLES.map((style) => (
              <button
                key={style.id}
                onClick={() => setSelectedStyle(style.id)}
                className={`p-3 rounded-xl text-left transition-all ${
                  selectedStyle === style.id
                    ? "bg-purple-600/20 border-purple-500 border-2"
                    : "bg-gray-800 border border-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="font-medium text-white text-sm">{style.label}</div>
                <div className="text-xs text-gray-400 mt-1">{style.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={generate}
          disabled={generating || !prompt.trim()}
          className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating with AI...
            </span>
          ) : (
            "🎨 Generate Avatar"
          )}
        </button>
      </div>

      <div className="flex flex-col items-center justify-center">
        <div className="w-full aspect-square max-w-md bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden flex items-center justify-center">
          {generatedImage ? (
            <motion.img
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              src={generatedImage}
              alt="Generated bot avatar"
              className="w-full h-full object-cover"
            />
          ) : generating ? (
            <div className="text-center p-8">
              <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-400">AI is creating your bot...</p>
            </div>
          ) : (
            <div className="text-center p-8">
              <div className="text-6xl mb-4">🤖</div>
              <p className="text-gray-400">Your bot avatar will appear here</p>
            </div>
          )}
        </div>
        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
        {generatedImage && (
          <div className="flex gap-3 mt-4">
            <button onClick={generate} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 hover:text-white text-sm">
              🔄 Regenerate
            </button>
            <a href={generatedImage} download="gembots-avatar.jpg" className="px-4 py-2 bg-purple-600 rounded-lg text-white hover:bg-purple-500 text-sm">
              💾 Download
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Strategy Builder (existing)
// ============================================================================

function StrategyBuilder() {
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ contract: string; audit: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const res = await fetch("/api/ai/generate-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.success) {
        setResult({ contract: data.contract, audit: data.audit });
      } else {
        setError(data.error || "Generation failed");
      }
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError"
        ? "Generation is taking too long. Try a simpler strategy."
        : "Network error — please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold text-white mb-2">Describe your strategy</h3>
        <p className="text-gray-400 text-sm mb-4">
          Describe your trading approach in plain English. The AI creates a strategy profile that guides your bot&apos;s decisions.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A momentum trading bot that buys when RSI crosses above 30..."
          className="w-full h-32 bg-gray-800 rounded-xl p-4 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
        />
        <div className="mt-4">
          <p className="text-gray-500 text-xs mb-2">Quick examples:</p>
          <div className="flex flex-wrap gap-2">
            {STRATEGY_EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setDescription(ex)}
                className="px-3 py-1.5 bg-gray-800 rounded-lg text-gray-400 hover:text-white text-xs border border-gray-700"
              >
                {ex.slice(0, 50)}...
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={generate}
          disabled={generating || !description.trim()}
          className="w-full mt-6 py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:shadow-lg transition-all disabled:opacity-50"
        >
          {generating ? "⏳ Generating + Auto-Auditing..." : "⚡ Generate & Audit Strategy"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold text-white mb-4">📝 Generated Contract</h3>
            <pre className="bg-gray-950 rounded-xl p-4 overflow-x-auto text-sm text-green-400 font-mono max-h-96 overflow-y-auto border border-gray-800">
              {result.contract}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(result.contract)}
              className="mt-3 px-4 py-2 bg-gray-800 rounded-lg text-gray-300 hover:text-white text-sm"
            >
              📋 Copy Contract
            </button>
          </div>
          {result.audit && (
            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold text-white mb-4">🛡️ Security Audit</h3>
              <div className="bg-gray-950 rounded-xl p-4 text-sm text-gray-300 font-mono max-h-96 overflow-y-auto border border-gray-800 whitespace-pre-wrap">
                {result.audit}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
