"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

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
  const [activeTab, setActiveTab] = useState<"avatar" | "strategy">("avatar");

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
            Create unique bot avatars and custom trading strategies using AI — all from natural language
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="flex justify-center gap-4 mb-8">
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
          {activeTab === "avatar" ? (
            <AvatarForge key="avatar" />
          ) : (
            <StrategyBuilder key="strategy" />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

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
      {/* Left: Controls */}
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

      {/* Right: Preview */}
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
              <p className="text-gray-500 text-sm mt-1">Powered by AI Image Generator</p>
            </div>
          ) : (
            <div className="text-center p-8">
              <div className="text-6xl mb-4">🤖</div>
              <p className="text-gray-400">Your bot avatar will appear here</p>
              <p className="text-gray-500 text-sm mt-1">Describe it and click Generate</p>
            </div>
          )}
        </div>
        {error && (
          <p className="text-red-400 text-sm mt-4">{error}</p>
        )}
        {generatedImage && (
          <div className="flex gap-3 mt-4">
            <button
              onClick={generate}
              className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 hover:text-white transition-colors text-sm"
            >
              🔄 Regenerate
            </button>
            <a
              href={generatedImage}
              download="gembots-avatar.jpg"
              className="px-4 py-2 bg-purple-600 rounded-lg text-white hover:bg-purple-500 transition-colors text-sm"
            >
              💾 Download
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}

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
        ? "Generation is taking too long. Try a simpler strategy description." 
        : "Network error — the AI is thinking hard. Please try again.");
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
          Describe your trading approach in plain English. The AI Forge creates a strategy profile that guides your bot's decisions in the Trading League — when to buy, sell, and at what leverage.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A momentum trading bot that buys when RSI crosses above 30 and sells when it crosses below 70..."
          className="w-full h-32 bg-gray-800 rounded-xl p-4 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
        />

        <div className="mt-4">
          <p className="text-gray-500 text-xs mb-2">Quick examples:</p>
          <div className="flex flex-wrap gap-2">
            {STRATEGY_EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setDescription(ex)}
                className="px-3 py-1.5 bg-gray-800 rounded-lg text-gray-400 hover:text-white text-xs transition-colors border border-gray-700 hover:border-gray-600"
              >
                {ex.slice(0, 50)}...
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={generate}
          disabled={generating || !description.trim()}
          className="w-full mt-6 py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating + Auto-Auditing...
            </span>
          ) : (
            "⚡ Generate & Audit Strategy"
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Generated Contract */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">📝 Generated Contract</h3>
              <span className="text-xs text-purple-400 bg-purple-500/10 px-3 py-1 rounded-full">
                by AI Auditor
              </span>
            </div>
            <pre className="bg-gray-950 rounded-xl p-4 overflow-x-auto text-sm text-green-400 font-mono max-h-96 overflow-y-auto border border-gray-800">
              {result.contract}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(result.contract)}
              className="mt-3 px-4 py-2 bg-gray-800 rounded-lg text-gray-300 hover:text-white text-sm transition-colors"
            >
              📋 Copy Contract
            </button>
          </div>

          {/* Auto-Audit Result */}
          {result.audit && (
            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">🛡️ Security Audit</h3>
                <span className="text-xs text-green-400 bg-green-500/10 px-3 py-1 rounded-full">
                  Auto-audited by AI
                </span>
              </div>
              <div className="bg-gray-950 rounded-xl p-4 overflow-x-auto text-sm text-gray-300 font-mono max-h-96 overflow-y-auto border border-gray-800 whitespace-pre-wrap">
                {result.audit}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
