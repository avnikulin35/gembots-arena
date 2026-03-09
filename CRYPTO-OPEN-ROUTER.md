# 🔮 Crypto Open Router — Plan

**Codename:** Crypto Open Router
**Mission:** Тренировать специализированные крипто-модели, доказывать их перформанс через GemBots Arena, и продавать доступ через API.

## 💡 Суть

OpenRouter продаёт доступ к general-purpose моделям. Мы делаем то же самое, но для **крипто-трейдинга**:
- Файнтюним open-source модели на реальных рыночных данных
- Доказываем перформанс через прозрачные соревнования на GemBots Arena
- Продаём API доступ к лучшим моделям

**Ключевое отличие от конкурентов:** Перформанс не на словах, а **доказан on-chain** через GemBots Trading League.

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────┐
│                 CRYPTO OPEN ROUTER              │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ GemTrader│  │ CryptoSage│ │ MoonShot │ ... │
│  │ Mistral  │  │ Qwen 14B │  │ Gemma 12B│     │
│  │ 12B ft   │  │ ft       │  │ ft       │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │              │              │           │
│       └──────────────┼──────────────┘           │
│                      │                          │
│              ┌───────┴───────┐                  │
│              │  Router API   │                  │
│              │  /v1/predict  │                  │
│              │  /v1/chat     │                  │
│              └───────┬───────┘                  │
│                      │                          │
│              ┌───────┴───────┐                  │
│              │  Leaderboard  │                  │
│              │  (GemBots     │                  │
│              │   Arena data) │                  │
│              └───────────────┘                  │
└─────────────────────────────────────────────────┘

Data Pipeline:
  Bybit/Binance → Raw Candles → Feature Engineering → Training Datasets
                                                          ↓
  GemBots Arena ← Evaluation ← Fine-tuned Models ← Training (Vast.ai/RunPod)
       ↓
  Leaderboard + On-chain Proof → Marketing → API Sales
```

---

## 📊 Data Pipeline (GemBots = Data Donor)

### Источники данных
1. **Bybit/Binance 1-min candles** — BTC, ETH, SOL + топ-50 альтов
2. **GemBots Arena battles** — реальные предсказания vs outcomes
3. **On-chain data** — DEX volumes, whale movements, funding rates
4. **Sentiment** — Twitter/Reddit crypto sentiment (last30days skill)

### Feature Engineering
- OHLCV + технические индикаторы (RSI, MACD, BB, VWAP)
- Multi-timeframe: 1m, 5m, 15m, 1h, 4h
- Volume profile, order flow proxies
- Cross-asset correlations (BTC dominance, ETH/BTC ratio)
- Macro features (DXY, S&P500 futures)

### Dataset Versions
- **v1 (текущий):** BTC/ETH/SOL 1-min candles, 15-min prediction, 29K examples
- **v2:** + альткоины (топ-20), multi-timeframe, 200K+ examples
- **v3:** + on-chain + sentiment, 500K+ examples
- **v4:** + order book data, 1M+ examples

---

## 🤖 Model Zoo

### Tier 1: Flagship Models
| Model | Base | Size | Specialization | Target Perf |
|-------|------|------|----------------|-------------|
| **GemTrader-Nemo** | Mistral Nemo 12B | 7GB GGUF | General crypto prediction | >55% accuracy |
| **GemTrader-Qwen** | Qwen 2.5 14B | 8GB GGUF | BTC/ETH focused | >58% accuracy |
| **GemTrader-Gemma** | Gemma 3 12B | 7GB GGUF | Altcoin specialist | >53% accuracy |

### Tier 2: Specialist Models (Phase 2)
| Model | Specialization |
|-------|----------------|
| **MoonShot** | Meme coin pumps (high risk, high reward) |
| **WhaleWatch** | Whale movement prediction |
| **FundingArb** | Funding rate direction |
| **SentimentAlpha** | News/sentiment-driven trades |

### Training Infrastructure
- **Vast.ai / RunPod:** RTX 4090 / A100 для тренировки
- **Unsloth QLoRA:** 2x ускорение, вмещается на 24GB
- **Auto-pipeline:** Новые данные → retrain → evaluate → deploy (еженедельно)

---

## 🏆 Proof of Performance (ключевое преимущество!)

### GemBots Arena как Proving Ground
1. Каждая модель **участвует в Trading League** на GemBots Arena
2. Все предсказания записаны **on-chain** (BSC)
3. P&L трекается публично
4. Leaderboard показывает **реальный** win rate, profit factor, Sharpe ratio

### Metrics Dashboard (публичный)
- Win Rate (%) — последние 7/30/90 дней
- Average Return per Trade
- Max Drawdown
- Sharpe Ratio
- Total P&L (paper trading → real trading)
- Comparison vs buy-and-hold BTC

**Это то, чего нет ни у кого:** Доказанный перформанс, а не маркетинговые обещания.

---

## 💰 Monetization

### Pricing Tiers

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0/mo | 100 predictions/day, delayed data, top-1 model only |
| **Pro** | $29/mo | 5,000 predictions/day, real-time, all models, webhooks |
| **Trader** | $99/mo | Unlimited, streaming, priority, custom timeframes |
| **Enterprise** | $499/mo | Dedicated instance, custom fine-tuning, SLA |

### Additional Revenue
- **Model Marketplace:** Community trains models → we host → rev share (70/30)
- **Fine-tuning as a Service:** Upload your strategy data → we train → $200-500 per model
- **Data API:** Raw training datasets, $49/mo
- **Consulting:** Custom model development, $5K+

### Revenue Projections (Conservative)
| Month | Users | MRR |
|-------|-------|-----|
| M1-3 | 50 Free, 5 Pro | $145 |
| M4-6 | 200 Free, 20 Pro, 5 Trader | $1,075 |
| M7-12 | 500 Free, 50 Pro, 15 Trader, 2 Enterprise | $3,933 |
| Y2 | 2000 Free, 200 Pro, 50 Trader, 10 Enterprise | $15,770 |

---

## 🛠️ Tech Stack

### API Server
- **Runtime:** Node.js + Fastify (or Python FastAPI)
- **Inference:** Ollama / vLLM behind load balancer
- **Auth:** API keys + JWT
- **Rate limiting:** Redis-based per-tier
- **Hosting:** VPS cluster (Hetzner) + GPU servers (Vast.ai for inference)

### Frontend
- **Landing:** Next.js (leaderboard, pricing, docs)
- **Dashboard:** Model performance, usage stats, API keys
- **Docs:** OpenAPI/Swagger auto-generated

### Infrastructure
- **Training:** Vast.ai/RunPod (on-demand GPUs)
- **Inference:** 
  - Small: Ollama on Alpha-Machine (dev/free tier)
  - Scale: vLLM on dedicated GPU servers
- **Data:** PostgreSQL + TimescaleDB (candles), Redis (cache)
- **Monitoring:** Grafana + Prometheus

---

## 🗺️ Roadmap

### Phase 1: Foundation (Weeks 1-2) ← МЫ ЗДЕСЬ
- [x] Собрать dataset из Bybit candles
- [x] Запустить первый fine-tuning (Mistral Nemo 12B)
- [ ] Оценить модель на held-out data
- [ ] Задеплоить в GemBots Trading League
- [ ] Сравнить с базовыми моделями (GPT-4, Claude, etc.)

### Phase 2: Multi-Model (Weeks 3-4)
- [ ] Fine-tune Qwen 14B и Gemma 12B
- [ ] Расширить dataset (больше альтов, multi-timeframe)
- [ ] A/B тестирование моделей в Trading League
- [ ] Выбрать лучшую модель для flagship

### Phase 3: API Launch (Weeks 5-8)
- [ ] API сервер (FastAPI + Ollama backend)
- [ ] Landing page с leaderboard
- [ ] Stripe интеграция (подписки)
- [ ] Документация + SDK (Python, JS)
- [ ] Beta launch (invite-only)

### Phase 4: Scale (Months 3-6)
- [ ] Public launch
- [ ] Model Marketplace (community uploads)
- [ ] Fine-tuning as a Service
- [ ] Multi-GPU inference (vLLM)
- [ ] Mobile app (push alerts)

### Phase 5: Ecosystem (Months 6-12)
- [ ] Token ($GEM?) — stake for access, governance
- [ ] Decentralized model registry (IPFS + on-chain metadata)
- [ ] Integration with DEXs (auto-trade based on predictions)
- [ ] Partnerships (TradingView, 3Commas, etc.)

---

## 🎯 Competitive Advantage

| Us | Competitors |
|----|-------------|
| **Proven on-chain performance** | Marketing claims |
| **Specialized crypto models** | General-purpose LLMs |
| **Multiple models, transparent comparison** | Single black-box |
| **GemBots Arena = live testing ground** | Backtests only |
| **Open source base + proprietary fine-tuning** | Fully closed |
| **Community model marketplace** | Single vendor |

### Why This Works
1. **Data moat:** GemBots Arena generates unique training data nobody else has
2. **Proof moat:** On-chain verified performance is unkillable marketing
3. **Network effects:** More users → more data → better models → more users
4. **Low CAC:** Leaderboard + on-chain proof = organic growth in crypto Twitter

---

## ⚡ Quick Wins (This Week)

1. **Evaluate first model** — после файнтюнинга, прогнать на test set
2. **Deploy in Trading League** — пусть торгует рядом с GPT-4 и Claude
3. **Tweet results** — "@gembotsbsc: Our fine-tuned 12B model vs GPT-4 on crypto prediction 👀"
4. **Landing page** — simple Next.js page на crypto-router.gembots.space

---

*Created: 2026-03-09 | Author: Виталик 🦍*
*Status: Phase 1 — First model training on Vast.ai*
