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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

class AnthropicProvider {
  constructor() {
    this.name = 'Anthropic';
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    if (!this.apiKey) {
      console.warn('[Anthropic] ANTHROPIC_API_KEY not set — requests will fail');
    }
  }

  async _complete(messages, options = {}) {
    const systemMessage = messages.find(m => m.role === 'system');
    const filteredMessages = messages.filter(m => m.role !== 'system');
    
    
    const body = {
      model: options.model || this.model,
      messages: filteredMessages,
      max_tokens: options.maxTokens || 1000,
      temperature: options.temperature || 0.7,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': `${this.apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.content[0].text || '';
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
    return this._complete(messages, { temperature: 0.8 });
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
    const seed = encodeURIComponent(`${name}-${emoji}`);
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
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
    return this._complete([systemMsg, ...messages]);  }

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

module.exports = new AnthropicProvider();
