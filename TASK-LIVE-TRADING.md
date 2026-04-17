# 🔧 ЗАДАЧА: Live Trading для NFA — Полная реализация

## Контекст
GemBots Arena (gembots.space) — платформа Non-Fungible Agents на BNB Chain. 
У нас уже работает paper trading (виртуальные $10K на бота), есть wallet generation, 
есть trading config с режимами off/paper/live. Нужно допилить LIVE режим — 
чтобы NFA реально торговали на PancakeSwap V3 на деньги пользователя.

## Проект: /home/clawdbot/Projects/gembots/
## Stack: Next.js, TypeScript, Supabase, SQLite, ethers.js, BSC mainnet

---

## 📋 ЗАДАЧИ ПО РОЛЯМ

### 🔐 СЕКЬЮРИТИ — Аудит безопасности кошельков

**Файлы:** 
- src/app/api/nfa/trading/wallet/route.ts — генерация и шифрование ключей
- src/app/api/nfa/trading/config/route.ts — переключение режимов
- src/app/api/nfa/trading/balance/route.ts — чтение балансов

**Задачи:**
1. Аудит encryptPrivateKey() — AES-256-GCM с NFA_WALLET_MASTER_KEY. Проверить:
   - Корректность IV generation (crypto.randomBytes(16))
   - AuthTag handling
   - Написать decryptPrivateKey() функцию (нужна для signing транзакций)
2. Проверить что private keys НИКОГДА не попадают в логи, responses, или client-side
3. Добавить rate limiting на POST /api/nfa/trading/wallet (защита от спама генерации)
4. Проверить ownership verification — что ownerAddress проверяется через on-chain данные, а не только Supabase
5. Env переменная NFA_WALLET_MASTER_KEY — сгенерировать если нет, добавить в .env.local

**Результат:** Отчёт по безопасности + исправления в коде

---

### 👨‍💻 КОДЕР — DEX интеграция и Trade Execution

**Новые файлы для создания:**
- src/lib/bsc/pancakeswap.ts — PancakeSwap V3 Router интеграция
- src/lib/bsc/trade-executor.ts — основной модуль исполнения сделок
- src/lib/bsc/risk-manager.ts — risk management и circuit breaker
- src/app/api/nfa/trading/execute/route.ts — API endpoint для исполнения

**Существующие файлы для изменений:**
- src/lib/trading-engine.ts — добавить интерфейс для live execution
- src/lib/usdc-payment.ts — уже есть USDC constants, переиспользовать
- scripts/trading-battles-engine.js — добавить live execution path

**Задачи:**

1. **PancakeSwap V3 интеграция** (src/lib/bsc/pancakeswap.ts):
   - PancakeSwap V3 SmartRouter на BSC
   - Router address: 0x13f4EA83D0bd40E75C8222255bc855a974568Dd4
   - Поддержка пар: BNB/USDT, ETH/USDT, CAKE/USDT, BTC/USDT (wrapped)
   - Функции: getQuote(), executeSwap(), getTokenPrice()
   - Slippage protection: default 0.5%, max 2%
   - Gas estimation перед каждой сделкой

2. **Trade Executor** (src/lib/bsc/trade-executor.ts):
   - Interface TradeOrder { nfaId, action, tokenIn, tokenOut, amountIn, minAmountOut, slippageBps }
   - async executeTrade(order: TradeOrder): Promise<TradeResult>
   - Decrypt private key -> create Wallet signer -> execute swap
   - Record trade in Supabase table nfa_trades
   - Emit event для WebSocket уведомлений

3. **Risk Manager** (src/lib/bsc/risk-manager.ts):
   - canTrade(nfaId) — проверяет все лимиты перед сделкой:
     - Max position size (из trading_config.max_position_pct)
     - Daily loss limit (trading_config.max_daily_loss_pct)
     - Max trades per day (trading_config.max_trades_per_day)
     - Минимальный баланс BNB для газа (0.005 BNB)
   - Circuit breaker: если потеря > daily_loss_limit -> автоматически переключить на paper mode
   - Logging всех rejected trades с причиной

4. **Live execution path в trading-battles-engine.js:**
   - После получения сигнала от LLM, проверить:
     - Есть ли NFA привязанный к этому боту?
     - Режим NFA = live?
     - Пройдены ли risk checks?
   - Если да -> вызвать trade-executor
   - Записать результат в nfa_trades таблицу

5. **Supabase schema** — новая таблица nfa_trades:
   - id UUID, nfa_id INT, bot_id INT, battle_id TEXT
   - action TEXT (BUY/SELL), token_in TEXT, token_out TEXT
   - amount_in NUMERIC, amount_out NUMERIC, price_at_entry NUMERIC
   - tx_hash TEXT, gas_used NUMERIC, gas_cost_bnb NUMERIC
   - status TEXT (pending/confirmed/failed), error_message TEXT
   - created_at TIMESTAMPTZ

**Результат:** Рабочий trade execution pipeline: сигнал -> risk check -> swap -> запись

---

### 🎨 ДИЗАЙНЕР — UI для Live Trading

**Файлы:**
- src/app/nfa/[id]/trading/page.tsx — НОВАЯ страница управления NFA trading
- src/components/NFATradingDashboard.tsx — НОВЫЙ компонент
- src/components/NFATradeHistory.tsx — НОВЫЙ компонент

**Задачи:**

1. **NFA Trading Dashboard** (/nfa/{id}/trading):
   - Wallet info: адрес, балансы (BNB + USDT + токены)
   - Mode switcher: OFF -> PAPER -> LIVE (с confirmation modal для LIVE)
   - Trading config editor (sliders и checkboxes)
   - Live P&L chart
   - Risk status indicator (green/yellow/red)

2. **Trade History** компонент:
   - Таблица: время, пара, action, amount, PnL, tx hash (BscScan link)
   - Фильтры: по паре, по дате, по статусу
   - Summary: total PnL, win rate, avg trade size

3. **Live Trading Warning Modal:**
   - Warning: Live trading uses REAL funds
   - Checklist: understand risks, funded wallet, set limits
   - Enable Live Trading button

4. **Стиль:** Dark theme (Tailwind CSS), reference: src/app/trading/page.tsx, src/components/BattleChart.tsx

---

### 📢 МАРКЕТОЛОГ — Контент и Landing

1. Landing секция Trade with AI на главной
2. Whitepaper секция про Live Trading
3. Twitter thread template для анонса

---

## ENV ПЕРЕМЕННЫЕ (добавить в .env.local)
- NFA_WALLET_MASTER_KEY=<64-char-hex>
- NFA_LIVE_TRADING_ENABLED=true
- PANCAKESWAP_V3_ROUTER=0x13f4EA83D0bd40E75C8222255bc855a974568Dd4
- BSC_RPC_URL=https://bsc-dataseed.binance.org/
- PLATFORM_FEE_PCT=10
- PLATFORM_FEE_WALLET=0x133C89BC9Dc375fBc46493A92f4Fd2486F8F0d76

## ПОРЯДОК ВЫПОЛНЕНИЯ
1. Секьюрити — аудит кошельков (первым, блокирует остальных)
2. Кодер — DEX интеграция + risk manager + trade executor
3. Дизайнер — UI (параллельно с кодером)
4. Маркетолог — контент (параллельно)

## КРИТЕРИИ ГОТОВНОСТИ
- [ ] Private keys безопасно шифруются/дешифруются
- [ ] Swap через PancakeSwap V3 работает на testnet (потом mainnet)
- [ ] Risk manager блокирует сделки при превышении лимитов
- [ ] Circuit breaker автоматически выключает live при большой потере
- [ ] UI позволяет управлять trading config и видеть историю
- [ ] Все транзакции записываются в nfa_trades
