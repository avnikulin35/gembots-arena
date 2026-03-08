/**
 * @file providers/openrouter/index.js
 * @description OpenRouter AI Provider — access 200+ AI models through one API.
 * 
 * Setup:
 *   1. Get an API key at https://openrouter.ai/keys
 *   2. Set OPENROUTER_API_KEY in your .env.local
 *   3. Set AI_PROVIDER=openrouter in your .env.local
 *   4. Optionally set OPENROUTER_MODEL (default: openai/gpt-4o-mini)
 * 
 * Supported models: GPT-4, Claude, Gemini, Llama, Mistral, DeepSeek, Qwen, and 200+ more.
 * Full list: https://openrouter.ai/models
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

class OpenRouterProvider {
  constructor() {
    this.name = 'OpenRouter';
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    
    if (!this.apiKey) {
      console.warn('[OpenRouter] OPENROUTER_API_KEY not set — requests will fail');
    }
  }

  /**
   * Send a chat completion request to OpenRouter.
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async _complete(messages, options = {}) {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://gembots.space',
        'X-Title': 'GemBots Arena',
      },
      body: JSON.stringify({
        model: options.model || this.model,
        messages,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Generate a trading strategy from natural language description.
   * @param {string} prompt - Strategy description
   * @returns {Promise<string>} Generated strategy JSON or description
   */
  async generateStrategy(prompt) {
    const messages = [
      {
        role: 'system',
        content: `You are an expert crypto trading strategy designer. Given a description, generate a detailed trading strategy as JSON with these fields:
- name: strategy name
- description: what it does
- base_style: one of (momentum, mean_reversion, scalper, whale_watcher, contrarian, trend_follower)
- params: { risk_tolerance: 0-1, time_horizon: "short"|"medium"|"long", indicators: string[] }
Return ONLY valid JSON, no markdown.`
      },
      { role: 'user', content: prompt }
    ];
    return this._complete(messages, { temperature: 0.8 });
  }

  /**
   * Generate a unique avatar URL for a bot.
   * Falls back to DiceBear API (free, no AI needed).
   * @param {{ name: string, emoji: string, style?: string }} params
   * @returns {Promise<string>} Avatar URL
   */
  async generateAvatar({ name, emoji, style }) {
    // Use DiceBear for instant, free avatar generation
    // Styles: bottts, pixel-art, adventurer, fun-emoji, identicon
    const avatarStyle = style || 'bottts';
    const seed = encodeURIComponent(`${name}-${emoji}`);
    return `https://api.dicebear.com/7.x/${avatarStyle}/svg?seed=${seed}`;
  }

  /**
   * Chat with users about trading, strategies, and the arena.
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<string>}
   */
  async chat(messages) {
    const systemMsg = {
      role: 'system',
      content: 'You are GemBots Arena AI assistant. Help users understand AI trading strategies, battle mechanics, NFA tokens, and the arena leaderboard. Be concise and helpful.'
    };
    return this._complete([systemMsg, ...messages]);
  }

  /**
   * Audit a smart contract for vulnerabilities.
   * @param {string} code - Solidity source code
   * @returns {Promise<string>} Audit report
   */
  async auditContract(code) {
    const messages = [
      {
        role: 'system',
        content: 'You are a smart contract security auditor. Analyze the provided Solidity code for vulnerabilities, gas optimizations, and best practice violations. Be thorough but concise.'
      },
      { role: 'user', content: `Audit this contract:\n\n${code}` }
    ];
    return this._complete(messages, { maxTokens: 2048 });
  }
}

// Export an instance (GemBots provider system expects a module export)
module.exports = new OpenRouterProvider();
