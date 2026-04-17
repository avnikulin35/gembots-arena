/**
 * Shared model display name mapping.
 * model_id (OpenRouter format) → human-readable display name.
 * Used across all APIs and UI components to show correct model names.
 */

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // OpenAI
  'openai/gpt-5': 'GPT-5',
  'openai/gpt-5-nano': 'GPT-5 Nano',
  'openai/gpt-4.1-mini': 'GPT-4.1 Mini',
  'openai/gpt-4.1-nano': 'GPT-4.1 Nano',
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'openai/gpt-4o-mini': 'GPT-4o Mini',
  // DeepSeek
  'deepseek/deepseek-r1': 'DeepSeek R1',
  'deepseek/deepseek-r1-0528:free': 'DeepSeek R1',
  'deepseek/deepseek-chat-v3.1': 'DeepSeek V3.1',
  'deepseek/deepseek-v3.2': 'DeepSeek V3.2',
  // Google
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'google/gemini-2.0-flash-001': 'Gemini 2.0 Flash',
  'google/gemini-2.0-flash-lite-001': 'Gemini 2.0 Flash Lite',
  'google/gemma-3-27b-it': 'Gemma 3 27B',
  'google/gemma-3-27b-it:free': 'Gemma 3 27B',
  'google/gemma-3-12b-it': 'Gemma 3 12B',
  'google/gemma-3-4b-it': 'Gemma 3 4B',
  'google/gemma-4-31b-it:free': 'Gemma 4 31B',
  'google/gemma-4-26b-a4b-it:free': 'Gemma 4 26B',
  'qwen/qwen3-next-80b-a3b-instruct:free': 'Qwen3 Next 80B',
  // Anthropic
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5',
  'anthropic/claude-3.5-haiku': 'Claude Haiku 3.5',
  // Meta
  'meta-llama/llama-4-maverick': 'Llama 4 Maverick',
  'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
'meta-llama/llama-3.3-70b-instruct:free': 'Llama 3.3 70B',
  // Mistral
  'mistralai/mistral-large-2512': 'Mistral Large',
  'mistralai/mistral-large-2411': 'Mistral Large',
  'mistralai/mistral-small-24b-instruct-2501': 'Mistral Small 24B',
  'mistralai/mistral-small-3.1-24b-instruct:free': 'Mistral Small 3.1',
  'mistralai/mistral-small-3.2-24b-instruct': 'Mistral Small 3.2',
  'mistralai/mistral-nemo': 'Mistral Nemo',
  // Qwen
  'qwen/qwen3-235b-a22b-2507': 'Qwen3 235B',
  'qwen/qwen3-32b': 'Qwen3 32B',
  'qwen/qwen3.5-coder-32b': 'Qwen 3.5 Coder',
  // ChainGPT
  'chaingpt/general-assistant': 'ChainGPT',
  'chaingpt/general_assistant': 'ChainGPT',
  // Others
  'x-ai/grok-4.1-fast': 'Grok 4.1',
  'minimax/minimax-m2.5': 'MiniMax M2.5',
  'cohere/command-r-08-2024': 'Command R',
  'microsoft/phi-4': 'Phi-4',
  'stepfun/step-3.5-flash:free': 'Step 3.5 Flash',
  'nousresearch/hermes-3-llama-3.1-405b:free': 'Hermes 3 (Llama 405B)',
};

/**
 * Get human-readable display name for a model_id.
 * Falls back to the part after "/" if not in the map.
 */
export function getModelDisplayName(modelId: string | null | undefined): string {
  if (!modelId) return 'Unknown';
  return MODEL_DISPLAY_NAMES[modelId] || modelId.split('/').pop()?.replace(/:free$/, '') || modelId;
}

/**
 * Get provider emoji for a model_id.
 */
export function getProviderEmoji(modelId: string): string {
  if (modelId.startsWith('openai/')) return '🟢';
  if (modelId.startsWith('anthropic/')) return '🟠';
  if (modelId.startsWith('google/')) return '🔵';
  if (modelId.startsWith('deepseek/')) return '🐋';
  if (modelId.startsWith('meta-llama/')) return '🦙';
  if (modelId.startsWith('mistralai/')) return '🌬️';
  if (modelId.startsWith('x-ai/')) return '𝕏';
  if (modelId.startsWith('minimax/')) return '🔮';
  if (modelId.startsWith('qwen/')) return '⚡';
  if (modelId.startsWith('cohere/')) return '🔶';
  if (modelId.startsWith('microsoft/')) return '🔷';
  if (modelId.startsWith('stepfun/')) return '🚀';
  if (modelId.startsWith('nousresearch/')) return '🧬';
  // For AI Provider, it will be handled by the generic AIProvider when its `name` is accessed.
  // This file deals with model IDs, not directly with the AIProvider instance.
  return '🤖';
}

/**
 * Resolve the display name for a bot, preferring model_id over legacy ai_model.
 * Use this everywhere a bot's model name is shown to the user.
 */
export function getBotModelDisplay(bot: { model_id?: string | null; ai_model?: string | null }): string {
  if (bot.model_id) {
    return getModelDisplayName(bot.model_id);
  }
  // Fallback to legacy ai_model if model_id not available
  return bot.ai_model || 'Unknown';
}
