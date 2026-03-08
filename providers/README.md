# AI Providers

GemBots Arena uses a pluggable AI provider system. Each provider implements the `AIProvider` interface and lives in its own directory.

## Available Providers

| Provider | Description | API Key Required |
|----------|-------------|------------------|
| `example` | Mock provider for development (default) | No |
| `openrouter` | Access 200+ AI models (GPT-4, Claude, Gemini, etc.) | Yes (`OPENROUTER_API_KEY`) |
| `chaingpt` | ChainGPT — crypto-specialized AI | Yes |
| `template` | Copy this to create your own! | — |

## Quick Start

```bash
# 1. Copy the template
cp -r providers/template providers/my-model

# 2. Edit providers/my-model/index.js with your API

# 3. Set in .env.local
AI_PROVIDER=my-model

# 4. Restart
npm run dev
```

## Interface

Every provider must export an object with these methods:

```typescript
interface AIProvider {
  name: string;
  generateStrategy(prompt: string): Promise<string>;
  generateAvatar(params: { name: string; emoji: string; style?: string }): Promise<string>;
  chat(messages: Array<{role: string; content: string}>): Promise<string>;
  auditContract?(code: string): Promise<string>;  // optional
}
```

See [docs/adding-models.md](../docs/adding-models.md) for the full guide.
