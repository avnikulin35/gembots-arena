# GemBots Telegram Bot

Telegram бот для работы с GemBots API - делать predictions и получать уведомления.

## Установка

1. Установите зависимости:
```bash
cd bot
npm install
```

2. Создайте бота в BotFather:
- Напишите @BotFather в Telegram
- Отправьте `/newbot`
- Выберите имя и username для бота
- Получите токен

3. Установите токен бота:

**Вариант 1: Переменная окружения**
```bash
export BOT_TOKEN="your_bot_token_here"
```

**Вариант 2: .env файл**
```bash
cp .env.example .env
# Отредактируйте .env и установите BOT_TOKEN
```

**Вариант 3: Прямо в коде**
Отредактируйте `index.js` и замените `YOUR_BOT_TOKEN_HERE` на ваш токен.

## Запуск

### Разработка
```bash
npm start
```

### Продакшен (PM2)
```bash
pm2 start index.js --name gembots-bot
pm2 save
pm2 startup
```

## Команды бота

### `/start`
Приветственное сообщение с инструкциями.

### `/register`
Регистрация в системе GemBots:
- Создаёт бота через API `/api/v1/bots/register`
- Сохраняет API key локально
- Возвращает API key пользователю

### `/predict <mint> [confidence]`
Создаёт новый prediction:
- `mint` - обязательный параметр (адрес токена)
- `confidence` - опциональный (по умолчанию 70%)

Пример: `/predict So11111111111111111111111111111111111111112 85`

### `/trending`
Показывает топ 5 trending токенов с кнопками для быстрых predictions.

### `/stats`
Показывает статистику пользователя:
- Количество побед
- Количество поражений  
- Win rate
- Общее количество predictions

### `/history`
Показывает последние 5 predictions пользователя с их статусами.

## API Integration

Бот интегрируется с GemBots API:
- **Base URL:** `https://gembots.space`
- **Регистрация:** `POST /api/v1/bots/register`
- **Predictions:** `POST /api/v1/predictions`
- **Trending:** `GET /api/trending`
- **Stats:** `GET /api/v1/bots/me`

## Файлы

- `index.js` - основной файл бота
- `package.json` - зависимости
- `users.json` - хранение API ключей пользователей
- `README.md` - документация

## Архитектура

Бот использует:
- **Telegraf** - фреймворк для Telegram Bot API
- **Axios** - HTTP клиент для API запросов
- **fs-extra** - расширенная работа с файловой системой

API ключи хранятся в `users.json` по telegram user id:
```json
{
  "123456789": "api_key_here",
  "987654321": "another_api_key"
}
```

## Безопасность

- API ключи хранятся локально
- Бот работает только с авторизованными пользователями
- Все API запросы используют Bearer аутентификацию

## Мониторинг

Логи доступны через PM2:
```bash
pm2 logs gembots-bot
pm2 monit
```