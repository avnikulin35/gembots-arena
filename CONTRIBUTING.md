# Contributing to GemBots Arena

Thanks for your interest in contributing! GemBots Arena is an open-source PvP AI trading bot arena, and we welcome contributions of all kinds.

## Code of Conduct

Be respectful. We're building something cool together. No harassment, discrimination, or toxic behavior. If someone's being a jerk, report it to the maintainers.

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/gembots.git
cd gembots

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials (free tier works)

# 4. Set up the database
# Go to your Supabase dashboard → SQL Editor
# Paste and run database/schema.sql

# 5. Start dev server
npm run dev
# → http://localhost:3000

# 6. Verify build
npm run build
```

## Project Structure

```
gembots/
├── src/
│   ├── app/           # Next.js pages and API routes
│   ├── components/    # React components
│   └── lib/           # Core logic (battle engine, ELO, strategies)
├── providers/         # AI provider plugins
├── contracts/         # Solidity smart contracts
├── database/          # SQL schema and migrations
├── docs/              # Documentation
└── public/            # Static assets
```

## Contribution Areas

### 🤖 AI Providers
Add new AI model integrations. See [docs/adding-models.md](docs/adding-models.md).
- Create `providers/your-provider/index.js`
- Implement the `AIProvider` interface
- Test with `npm run dev`

### 📊 Trading Strategies
Create new prediction strategies. See [docs/strategies.md](docs/strategies.md).
- Strategies live in `src/lib/strategies.ts`
- A strategy is a function: `(token: MarketToken) => number`
- Test your strategy against existing ones

### 🎨 Frontend
Improve the UI/UX:
- Components are in `src/components/`
- We use Tailwind CSS for styling
- Keep it responsive (mobile-first)

### 📜 Smart Contracts
Improve or audit on-chain components:
- Contracts are in `contracts/contracts/`
- We use Hardhat for development
- BSC mainnet deployment

### 📝 Documentation
Fix typos, improve guides, add examples. Always welcome.

## Pull Request Process

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature
   # or: fix/bug-description, docs/what-changed
   ```

2. **Make your changes** — keep commits focused and descriptive:
   ```bash
   git commit -m "feat: add OpenAI provider"
   git commit -m "fix: ELO calculation edge case at minimum"
   git commit -m "docs: add deployment troubleshooting section"
   ```

3. **Verify the build passes:**
   ```bash
   npm run build
   ```

4. **Push and open a PR:**
   ```bash
   git push origin feat/your-feature
   ```
   - Fill out the PR template
   - Link any related issues
   - Add screenshots for UI changes

5. **Code review** — maintainers will review within a few days. Address feedback, and we'll merge.

## Code Style

- **TypeScript** for all source code
- **ESLint** for linting (`npm run lint`)
- Use descriptive variable names
- Keep functions small and focused
- Add comments for complex logic (especially in strategies and battle engine)
- Use `async/await` over raw promises

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance

## Issue & PR Templates

- **Bug reports:** Use the bug report template (`.github/ISSUE_TEMPLATE/bug_report.md`)
- **Feature requests:** Use the feature request template (`.github/ISSUE_TEMPLATE/feature_request.md`)
- **Pull requests:** PR template is auto-loaded (`.github/pull_request_template.md`)

## Questions?

Open an issue or reach out on [Telegram](https://t.me/gembots_arena). We're happy to help you get started.
