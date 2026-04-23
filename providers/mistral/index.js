/**
 * @file providers/template/index.js
 * @description Template AI Provider — copy this to create your own!
 * 
 * Steps:
 *   1. Copy this folder: cp -r providers/template providers/my-model
 *   2. Implement the methods below with your AI API
 *   3. Set AI_PROVIDER=my-model in .env.local
 *   4. Restart the app
 * 
 * The AIProvider interface requires these methods:
 *   - generateStrategy(prompt) → string
 *   - generateAvatar({ name, emoji, style? }) → string (URL)
 *   - chat(messages[]) → string
 *   - auditContract(code) → string (optional)
 */

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

class MistralProvider {
  constructor() {
    this.name = 'Mistral';
    this.apiKey = process.env.MISTRAL_API_KEY;
    this.model = process.env.MISTRAL_MODEL || 'mistral-large-latest';

    if (!this.apiKey) {
      console.warn('[Mistral] MISTRAL_API_KEY not set — requests will fail');
    }
  }

  /**
   * Send a chat completion request to OpenRouter.
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async _complete(messages, options = {}) {
    const response = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
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
      throw new Error(`Mistral API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
  /**
   * Generate a trading strategy from natural language.
   * 
   * @param {string} prompt - User's strategy description (max 200 chars)
   * @returns {Promise<string>} Strategy as JSON string or text description
   * 
   * @example
   * const strategy = await provider.generateStrategy("aggressive momentum on BTC");
   * // Returns: '{"name":"BTC Momentum","base_style":"momentum","params":{...}}'
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
    return this._complete(messages, { temperature: 0.7 });
  }


  /**
   * Generate a unique avatar for a bot.
   * 
   * @param {{ name: string, emoji: string, style?: string }} params
   * @returns {Promise<string>} URL to the avatar image
   * 
   * @example
   * const url = await provider.generateAvatar({ name: 'FrostBot', emoji: '❄️', style: 'cyberpunk' });
   */
  async generateAvatar({ name, emoji, style }) {
    // Use DiceBear for instant, free avatar generation
    // Styles: bottts, pixel-art, adventurer, fun-emoji, identicon
    const avatarStyle = style || 'bottts';
    const seed = encodeURIComponent(`${name}-${emoji}`);
    return `https://api.dicebear.com/7.x/${avatarStyle}/svg?seed=${seed}`;
  }

  /**
   * Chat with users about the arena, strategies, and trading.
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat history
   * @returns {Promise<string>} AI response
   * 
   * @example
   * const reply = await provider.chat([
   *   { role: 'user', content: 'What strategy is best for volatile markets?' }
   * ]);
   */
  async chat(messages) {
    const systemMsg = {
      role: 'system',
      content: 'You are GemBots Arena AI assistant. Help users understand AI trading strategies, battle mechanics, NFA tokens, and the arena leaderboard. Be concise and helpful.'
    };
    return this._complete([systemMsg, ...messages]);
  }

  /**
   * Audit a smart contract (optional method).
   * 
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

module.exports = new MistralProvider();
