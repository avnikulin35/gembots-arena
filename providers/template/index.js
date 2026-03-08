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

class TemplateProvider {
  constructor() {
    this.name = 'My Custom Model';
    // Initialize your API client here
    // this.apiKey = process.env.MY_MODEL_API_KEY;
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
    // TODO: Replace with your API call
    // const response = await fetch('https://your-api.com/generate', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    //   body: JSON.stringify({ prompt })
    // });
    // return (await response.json()).strategy;
    
    return JSON.stringify({
      name: 'Custom Strategy',
      description: `Strategy based on: ${prompt}`,
      base_style: 'momentum',
      params: { risk_tolerance: 0.5, time_horizon: 'medium', indicators: ['RSI', 'MACD'] }
    });
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
    // TODO: Replace with your image generation API
    // Option 1: AI image generation (DALL-E, Stable Diffusion, etc.)
    // Option 2: Free deterministic avatars (DiceBear)
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
    // TODO: Replace with your chat API
    const lastMessage = messages[messages.length - 1]?.content || '';
    return `Template provider received: "${lastMessage}". Implement your AI model here!`;
  }

  /**
   * Audit a smart contract (optional method).
   * 
   * @param {string} code - Solidity source code
   * @returns {Promise<string>} Audit report
   */
  async auditContract(code) {
    return 'Contract audit not implemented in template provider. Add your security analysis API here.';
  }
}

module.exports = new TemplateProvider();
