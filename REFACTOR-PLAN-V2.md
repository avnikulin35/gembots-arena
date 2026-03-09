# GemBots Arena V2 — Trading Battles Refactor Plan

## 🎯 Цель
Перейти от "кто ближе угадал мультипликатор" к "кто больше заработал".
Сохранить 400K+ боёв как историю. Новые бои — по новой логике.

---

## 📊 Что было (V1 — Arena Classic)
- Модели предсказывают **мультипликатор цены** (1.02x, 0.98x)
- Победитель = кто **ближе к actual** (proximity scoring)
- Таймфрейм: 3 минуты
- Данные: из Solana мемкоинов (pump tracker)
- 97% реальных движений: 0.95-1.05x (почти ноль)
- Direction accuracy: **~50%** (монетка)

## 🚀 Что будет (V2 — Trading League)

### Новая механика боя
1. **Модель получает real market data:**
   - Текущая цена (BTC, ETH, SOL — Bybit perpetuals)
   - 1h/24h change
   - Orderbook imbalance (bid/ask ratio)
   - Funding rate
   - Open interest
   - RSI, EMA, MACD
   - Volume vs average

2. **Модель принимает решение:**
   ```json
   {
     "action": "BUY" | "SELL" | "HOLD",
     "size": 0.1,        // 0-1 (% от виртуального баланса)
     "leverage": 5,       // 1-20x
     "confidence": 0.8,   // 0-1
     "take_profit": 0.5,  // % price move
     "stop_loss": 0.3,    // % price move
     "reasoning": "..."
   }
   ```

3. **Разрешение боя (через 15 минут):**
   - Проверяем реальную цену
   - Считаем P&L каждого бота
   - Побеждает бот с **большим P&L**
   - Если оба HOLD — ничья
   - Если один HOLD, другой в минусе — HOLD побеждает

### Скоринг
- **P&L за бой** = (price_change * leverage * size) - fees
- **Win** = положительный P&L + больше чем оппонент
- **ELO** обновляется как раньше
- **Новые метрики на профиле:**
  - Total P&L (cumulative)
  - Sharpe Ratio
  - Max Drawdown
  - Win Rate (direction)
  - Avg Profit / Avg Loss ratio

---

## 🗂️ Миграция данных

### Что сохраняем:
- Таблица `battles` (400K+ записей) — НЕ ТРОГАЕМ
- ELO рейтинг боёв V1 — сохраняем как "Arena Classic"
- Страница `/arena` — показывает оба рейтинга

### Что добавляем:
- Новая таблица `trading_battles`:
  ```sql
  CREATE TABLE trading_battles (
    id TEXT PRIMARY KEY,
    bot1_id INTEGER,
    bot2_id INTEGER,
    symbol TEXT,            -- BTCUSDT, ETHUSDT, SOLUSDT
    entry_price REAL,
    exit_price REAL,
    started_at TEXT,
    resolved_at TEXT,
    timeframe_minutes INTEGER DEFAULT 15,
    
    -- Bot 1 decision
    bot1_action TEXT,       -- BUY/SELL/HOLD
    bot1_size REAL,
    bot1_leverage INTEGER,
    bot1_tp REAL,
    bot1_sl REAL,
    bot1_pnl REAL,
    
    -- Bot 2 decision
    bot2_action TEXT,
    bot2_size REAL,
    bot2_leverage INTEGER,
    bot2_tp REAL,
    bot2_sl REAL,
    bot2_pnl REAL,
    
    -- Market context snapshot
    market_data JSON,       -- orderbook, funding, indicators
    
    winner_id INTEGER,
    status TEXT DEFAULT 'active'
  );
  ```

- Новая таблица `trading_elo`:
  ```sql
  CREATE TABLE trading_elo (
    bot_id INTEGER PRIMARY KEY,
    elo REAL DEFAULT 1500,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    sharpe_ratio REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    avg_profit REAL DEFAULT 0,
    avg_loss REAL DEFAULT 0
  );
  ```

---

## 📐 Частота боёв

### V1 (текущая):
- 1 бой каждые 3 минуты
- ~480 боёв/день
- ~14,400 боёв/месяц

### V2 (предложение):
- 1 бой каждые 15 минут
- ~96 боёв/день
- ~2,880 боёв/месяц
- Но каждый бой **значимый** — реальные P&L решения

### Альтернатива — гибрид:
- 3 токена × 1 бой/15мин = **288 боёв/день**
- Round-robin: каждая пара моделей встречается ~3 раза/день
- За месяц: ~8,640 боёв (меньше чем V1, но данные богаче)

---

## 🔧 Технические изменения

### Backend (src/lib/):
1. **Новый arena engine** (`trading-arena.js`):
   - Получает market data из data collector
   - Отправляет модели market snapshot
   - Парсит trading decision
   - Через 15 мин — resolve & score

2. **Обновить API prompts:**
   - Текущий: "predict multiplier for TOKEN that pumped X%"
   - Новый: "Given this market data, make a trading decision: BUY/SELL/HOLD"

3. **Добавить market data endpoint:**
   - GET /api/market-data → текущие данные для фронтенда
   - WebSocket → live market feed

### Frontend (src/app/):
1. **Обновить Arena page:**
   - Показывать live market data
   - Trading decision каждого бота (BUY/SELL/HOLD)
   - Real-time P&L
   - Новый leaderboard: by P&L, Sharpe, Win Rate

2. **Новый раздел "Trading League":**
   - Отдельный от Arena Classic
   - P&L график для каждого бота
   - Equity curve

3. **Bot Profile обновить:**
   - Trading stats: win rate, P&L, Sharpe
   - Trade history
   - Decision patterns (% BUY/SELL/HOLD)

### Модели:
- Тот же набор через OpenRouter
- Новый system prompt для trading decisions
- JSON schema validation для ответов

---

## 📅 Roadmap

### Неделя 1 (9-15 марта):
- [x] Data collector запущен (собираем маркет-данные)
- [ ] Label updater работает (direction_15m/30m)
- [ ] Создать таблицы trading_battles, trading_elo
- [ ] Написать trading-arena engine
- [ ] Обновить API prompts

### Неделя 2 (16-22 марта):
- [ ] Frontend: Trading League page
- [ ] Frontend: обновить Bot Profile
- [ ] Запустить первые Trading Battles (beta)
- [ ] Тестировать 3 дня

### Неделя 3 (23-29 марта):
- [ ] Собрать 10K+ market snapshots с direction labels
- [ ] Fine-tune Gemma 12B V2 на новых данных (direction prediction)
- [ ] Добавить fine-tuned модель на арену
- [ ] Публичный запуск Trading League

---

## 💡 Синергия с другими проектами

### WhatToInfer:
- Используем данные арены для бенчмарков AI моделей в трейдинге
- "Which model is best at crypto trading?" → WhatToInfer shows GemBots data

### NeuralRing:
- Trading category в NeuralRing = GemBots Trading League
- Один рейтинг, разные фронтенды

### Fine-tuning:
- Новые данные (market features + direction) → лучший файнтюнинг
- DPO: winner decision = preferred, loser decision = rejected
- Цикл: арена генерирует данные → файнтюним → модель на арену → repeat
