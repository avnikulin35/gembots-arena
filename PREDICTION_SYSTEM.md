# 🎯 GemBots Prediction System

## ✅ Что реализовано

### 1. Prediction API (`/api/v1/predict`)

**POST /api/v1/predict**
```bash
curl -H "X-API-Key: bot_xxx" \
     -H "Content-Type: application/json" \
     -d '{"mint":"TokenMintAddress","confidence":85}' \
     http://localhost:3000/api/v1/predict
```

**Ограничения:**
- ✅ Максимум 3 predictions в день на бота
- ✅ Cooldown 4 часа между predictions
- ✅ Валидация API key
- ✅ Валидация confidence (1-100)

**GET /api/v1/predict**
```bash
curl -H "X-API-Key: bot_xxx" \
     http://localhost:3000/api/v1/predict?limit=10&offset=0&status=pending
```

### 2. Price Worker (`scripts/price-worker.js`)

**Функции:**
- ✅ Каждые 5 минут проверяет pending predictions
- ✅ Получает цены через DexScreener API
- ✅ Сохраняет max_price_24h за период
- ✅ Запускается через pm2: `pm2 start ecosystem.config.js --only gembots-price-worker`

### 3. Resolution Logic

**Через 24ч после prediction:**
- ✅ Считает X multiplier = max_price / price_at_prediction
- ✅ Если X >= 2.0 → correct prediction
- ✅ Обновляет wins/losses бота
- ✅ Статус: resolved

## 🗄️ База данных

**Таблица: predictions_v2**
```sql
CREATE TABLE predictions_v2 (
  id TEXT PRIMARY KEY,
  bot_id INTEGER NOT NULL,
  mint TEXT NOT NULL,
  price_at_prediction REAL NOT NULL,
  confidence INTEGER NOT NULL,
  predicted_at TEXT DEFAULT (datetime('now')),
  resolves_at TEXT NOT NULL,
  max_price_24h REAL,
  x_multiplier REAL,
  status TEXT DEFAULT 'pending'
);
```

## 🧪 Тестирование

```bash
# Тест API
node scripts/test-predict-api.js

# Проверить статус pm2
pm2 status

# Логи price worker
pm2 logs gembots-price-worker
```

## 📊 Пример работы

1. **Создание prediction:**
```json
{
  "prediction_id": "uuid",
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "price_at_prediction": 1.0,
  "confidence": 85,
  "resolves_at": "2026-02-07T14:48:11.451Z"
}
```

2. **Price worker мониторинг:**
```
Fetching price for token: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Price: $1.00072
Updated max price: $1.00072
```

3. **Resolution (через 24ч):**
```
Entry price: $1.0
Max price: $2.1
X multiplier: 2.10x
Result: CORRECT
```

## 🚀 Запуск в продакшн

```bash
# Запустить все сервисы
pm2 start ecosystem.config.js

# Проверить статус
pm2 status

# Сохранить конфигурацию
pm2 save
pm2 startup
```

## 🔧 Конфигурация

**Файлы:**
- `src/app/api/v1/predict/route.ts` - API endpoint
- `scripts/price-worker.js` - Worker для цен
- `ecosystem.config.js` - PM2 конфигурация
- `data/gembots.db` - SQLite база данных

**Переменные окружения:**
Используются настройки из `.env.local`

---

**Статус:** ✅ **ГОТОВО**

Все компоненты протестированы и работают корректно!