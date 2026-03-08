# GemBots Arena — GitHub Issues

Pre-written issues for community contributions. Create with:
```bash
gh issue create --title "Title" --body "Body" --label "label1,label2"
```

---

### Issue #1: Add Mistral AI provider
**Labels:** good first issue, enhancement
**Description:**
Add Mistral AI as a new AI provider for GemBots Arena. Mistral models (mistral-large, mistral-medium, codestral) should be available for bot creation.

Follow the existing provider pattern in the codebase. The provider should:
- Accept a Mistral API key
- Support at least `mistral-large-latest` and `mistral-small-latest` models
- Handle rate limiting and error responses gracefully
- Return predictions in the standard GemBots format

**Acceptance Criteria:**
- [ ] Create provider implementation following existing patterns
- [ ] Add Mistral models to the model selection UI
- [ ] Handle API errors with proper fallback
- [ ] Add environment variable `MISTRAL_API_KEY` to `.env.example`
- [ ] Test with at least 5 prediction battles

---

### Issue #2: Add Anthropic Claude provider
**Labels:** good first issue, enhancement
**Description:**
Add Anthropic Claude as a new AI provider. Claude models (claude-sonnet, claude-haiku) are excellent at reasoning and should make competitive arena bots.

Follow the existing provider pattern. The provider should:
- Accept an Anthropic API key
- Support Claude Sonnet and Haiku models
- Use the Messages API format
- Handle rate limits with exponential backoff

**Acceptance Criteria:**
- [ ] Create provider implementation following existing patterns
- [ ] Add Claude models to the model selection UI
- [ ] Handle API errors and rate limits
- [ ] Add `ANTHROPIC_API_KEY` to `.env.example`
- [ ] Test with at least 5 prediction battles

---

### Issue #3: Improve mobile responsiveness of battle viewer
**Labels:** good first issue, ui
**Description:**
The battle viewer page works well on desktop but has layout issues on mobile devices:
- Battle cards overflow on small screens
- Prediction charts are too small to read
- Navigation is awkward on touch devices
- ELO history graph needs responsive sizing

This is a great first issue for anyone comfortable with CSS/Tailwind.

**Acceptance Criteria:**
- [ ] Battle cards stack vertically on mobile (< 768px)
- [ ] Charts resize properly on small screens
- [ ] Touch-friendly navigation (larger tap targets)
- [ ] Test on iPhone SE, iPhone 14, and common Android sizes
- [ ] No horizontal scroll on any mobile viewport

---

### Issue #4: Add dark/light mode toggle
**Labels:** good first issue, ui
**Description:**
Currently GemBots Arena is dark-mode only. Add a theme toggle so users can switch between dark and light modes.

Use `next-themes` or a simple CSS custom properties approach. The toggle should:
- Remember user preference in localStorage
- Respect system preference by default
- Transition smoothly between themes
- Be accessible (proper ARIA labels)

**Acceptance Criteria:**
- [ ] Theme toggle button in the header/navbar
- [ ] Light mode with readable contrast ratios (WCAG AA)
- [ ] Dark mode remains the default
- [ ] User preference persists across sessions
- [ ] All pages/components render correctly in both themes

---

### Issue #5: Add unit tests for strategies
**Labels:** good first issue, testing
**Description:**
The strategy functions in `src/lib/strategies.ts` and `strategies/` need unit tests. Each strategy should be tested with various market conditions to verify:
- Bullish tokens get predictions > 1.0
- Bearish tokens get predictions < 1.0
- Edge cases (all undefined fields, extreme values) don't crash
- Output is always clamped between 0.3 and 5.0

Use Jest or Vitest. This is a great way to understand how strategies work!

**Acceptance Criteria:**
- [ ] Test setup (Jest or Vitest config)
- [ ] Tests for all built-in strategies (trend_follower, whale_watcher, chaos, mean_reversion, smart_ai)
- [ ] Tests for community strategies (momentum, mean-reversion, sentiment)
- [ ] Edge case tests (empty token, extreme values)
- [ ] All predictions within valid range [0.3, 5.0]
- [ ] CI integration (tests run on PR)

---

### Issue #6: Strategy backtesting tool
**Labels:** enhancement, feature
**Description:**
Create a backtesting tool that lets users test their strategies against historical battle data. The tool should:
- Load historical token data from the battles database
- Run a strategy function against each historical token
- Calculate win rate, average prediction accuracy, and ELO trajectory
- Display results in a visual dashboard

This could be a new page `/backtest` or a CLI tool.

**Acceptance Criteria:**
- [ ] Load historical battle data (at least 30 days)
- [ ] Run any registered strategy against historical tokens
- [ ] Calculate: win rate, avg prediction error, Sharpe-like ratio
- [ ] Visual chart showing strategy performance over time
- [ ] Compare multiple strategies side-by-side
- [ ] Export results as JSON/CSV

---

### Issue #7: WebSocket real-time battle updates
**Labels:** enhancement, feature
**Description:**
Currently the battle viewer uses polling to check for updates. Replace this with WebSocket connections for real-time battle updates.

Benefits:
- Instant battle results (no 5-second polling delay)
- Lower server load
- Better UX with live animations
- Foundation for spectator mode

Consider using Socket.io or native WebSocket with Next.js API routes.

**Acceptance Criteria:**
- [ ] WebSocket server endpoint for battle events
- [ ] Client-side WebSocket connection with auto-reconnect
- [ ] Real-time battle start/progress/finish events
- [ ] Live ELO update animations
- [ ] Graceful fallback to polling if WebSocket fails
- [ ] Connection status indicator in UI

---

### Issue #8: Multi-chain support (Ethereum, Polygon, Arbitrum)
**Labels:** enhancement, feature
**Description:**
GemBots currently focuses on Solana/BSC tokens. Add support for tokens on other chains:
- **Ethereum** — major DeFi tokens, L1 ecosystem
- **Polygon** — fast and cheap, lots of activity
- **Arbitrum** — L2 with growing DeFi ecosystem

Each chain needs:
- Price feed integration (DEXScreener already supports multi-chain)
- Token data fetching (holders, liquidity, volume)
- Chain selector in the battle creation UI

**Acceptance Criteria:**
- [ ] Chain selector in battle/token picker UI
- [ ] Price feeds for ETH, Polygon, Arbitrum tokens
- [ ] Token metadata (holders, liquidity) for each chain
- [ ] Chain icon/badge on battle cards
- [ ] At least 3 test battles per new chain
- [ ] Documentation for adding new chains

---

### Issue #9: API documentation with OpenAPI/Swagger spec
**Labels:** documentation
**Description:**
Create comprehensive API documentation for GemBots public endpoints:
- `/api/benchmark` — overview stats
- `/api/benchmark/leaderboard` — model rankings
- `/api/benchmark/battles` — battle history
- `/api/benchmark/models` — model comparison
- `/api/benchmark/export` — CSV data export

Include:
- OpenAPI 3.0 spec file (`openapi.yaml`)
- Interactive docs page (Swagger UI or Redoc)
- Code examples in Python, JavaScript, and curl

**Acceptance Criteria:**
- [ ] OpenAPI 3.0 spec file covering all public endpoints
- [ ] Interactive API docs at `/api-docs` or `/docs`
- [ ] Request/response examples for each endpoint
- [ ] Rate limit documentation
- [ ] Code examples (Python, JS, curl)
- [ ] Link to docs from README

---

### Issue #10: Video tutorial — How to add your own AI model
**Labels:** documentation, content
**Description:**
Create a video tutorial (or detailed written guide with screenshots) showing how to:
1. Fork the repo and set up local dev environment
2. Choose an AI provider (OpenRouter, direct API)
3. Create a new bot with a custom model
4. Write a custom strategy
5. Test your bot in the arena
6. Submit a PR with your provider/strategy

Target audience: developers who want to contribute but haven't done it before. Keep it beginner-friendly!

**Acceptance Criteria:**
- [ ] Step-by-step written guide in `docs/` or wiki
- [ ] Screenshots of key steps (UI walkthrough)
- [ ] Video recording (optional, YouTube/Loom)
- [ ] Cover: fork → setup → create bot → test → PR
- [ ] Include troubleshooting section
- [ ] Link from main README
