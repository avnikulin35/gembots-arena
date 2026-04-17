import crypto from "crypto";
import "dotenv/config";
/**
 * GemBot API Server — AI assistant с памятью, cloud интеграцией и billing
 * Персистентное хранение: SQLite (better-sqlite3)
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
// ==================== TELEGRAM INIT DATA VERIFICATION ====================


function verifyTelegramInitData(initData: string, botToken: string): { valid: boolean; user?: any } {
  try {
    if (!initData) return { valid: false };
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false };
    params.delete('hash');

    // Sort and join
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (checkHash !== hash) return { valid: false };

    // Parse user
    const userStr = params.get('user');
    const user = userStr ? JSON.parse(userStr) : null;
    return { valid: true, user };
  } catch {
    return { valid: false };
  }
}

import cors from 'cors';
import jwt from 'jsonwebtoken';

import https from 'https';
import multer from 'multer';
import webpush from 'web-push';
import * as dbHelpers from './db-helpers';
import db from './db';
import { scenarios } from './scenarios';
import blockchainRoutes from "./blockchain/blockchain-routes";

// ==================== ENV VALIDATION ====================
const REQUIRED_ENV = ['TELEGRAM_BOT_TOKEN'];
const RECOMMENDED_ENV = ['CHAINGPT_API_KEY', 'OPENROUTER_API_KEY', 'BRAVE_API_KEY'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`\x1b[31mFATAL: Missing required env var: ${key}\x1b[0m`);
    process.exit(1);
  }
}
for (const key of RECOMMENDED_ENV) {
  if (!process.env[key]) {
    console.warn(`\x1b[33mWARN: Missing recommended env var: ${key} — some features disabled\x1b[0m`);
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Rate limiting — anti-spam/DDoS
const chatLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { error: 'Слишком много запросов. Подожди минутку.' } });
const ttsLimiter = rateLimit({ windowMs: 60_000, max: 15, message: { error: 'Слишком много запросов TTS.' } });
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Слишком много попыток.' } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

// ==================== КОНФИГ ====================

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'vitalik-dev-secret-change-me';
const GIGACHAT_AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';
const GIGACHAT_CLIENT_ID = process.env.GIGACHAT_CLIENT_ID || '';
const GIGACHAT_CLIENT_SECRET = process.env.GIGACHAT_CLIENT_SECRET || '';
const GIGACHAT_AUTH_KEY = process.env.GIGACHAT_AUTH_KEY || '';

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY || '';
const ADMIN_TELEGRAM_ID = 1473690506;

// ==================== LLM PROVIDERS ====================
// Switch provider with ACTIVE_PROVIDER env var (default: 'deepseek')
// To migrate to GigaChat native API: set ACTIVE_PROVIDER=gigachat and implement GigaChat API calls
// To switch back to Qwen: set ACTIVE_PROVIDER=qwen

interface LLMProviderConfig {
  name: string;
  chatModel: string;
  proModel: string;
  visionModel: string;
}

const PROVIDERS: Record<string, LLMProviderConfig> = {
  deepseek: {
    name: 'DeepSeek',
    chatModel: 'deepseek/deepseek-chat-v3-0324',       // $0.14/$0.28 per 1M tokens
    proModel: 'deepseek/deepseek-chat-v3-0324',         // same model, good enough for both tiers
    visionModel: 'qwen/qwen3-vl-8b-instruct',           // vision stays on Qwen (DeepSeek has no vision)
  },
  qwen: {
    name: 'Qwen',
    chatModel: 'qwen/qwen-turbo',
    proModel: 'qwen/qwen-2.5-72b-instruct',
    visionModel: 'qwen/qwen3-vl-8b-instruct',
  },
  gigachat: {
    name: 'GigaChat',
    chatModel: 'gigachat/gigachat-lite',                 // placeholder — needs native GigaChat API
    proModel: 'gigachat/gigachat-pro',
    visionModel: 'qwen/qwen3-vl-8b-instruct',
  },
  chaingpt: {
    name: 'ChainGPT',
    chatModel: 'general_assistant',
    proModel: 'general_assistant',
    visionModel: 'qwen/qwen3-vl-8b-instruct',
  },
};

const ACTIVE_PROVIDER = process.env.ACTIVE_PROVIDER || 'deepseek';
const activeProvider = PROVIDERS[ACTIVE_PROVIDER] || PROVIDERS.deepseek;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const CHAT_MODEL = process.env.CHAT_MODEL || activeProvider.chatModel;
const CHAT_MODEL_PRO = process.env.CHAT_MODEL_PRO || activeProvider.proModel;
const VISION_MODEL = process.env.VISION_MODEL || activeProvider.visionModel;

// ==================== GOOGLE DRIVE ====================
const GDRIVE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GDRIVE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GDRIVE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://v.ainmid.com/api/gdrive/callback';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

// ==================== WEB PUSH (VAPID) ====================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@vitalikai.ru';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

try {
  db.exec(`CREATE TABLE IF NOT EXISTS skill_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_id TEXT,
    skill TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_usage_created ON skill_usage(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_usage_user ON skill_usage(user_id)`);
} catch (err) {
  console.error('skill_usage table init error:', err);
}

async function analyzeImageWithVision(base64Data: string, mimeType: string, userPrompt?: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    return '[Vision недоступен: нет API ключа]';
  }

  const prompt = userPrompt || 'Подробно опиши что на этом изображении. Если есть текст — извлеки его полностью. Отвечай на русском.';

  // Ensure base64 is clean (no data URL prefix)
  const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
  
  // Detect actual mime from magic bytes if possible
  let actualMime = mimeType;
  try {
    const header = Buffer.from(cleanBase64.slice(0, 16), 'base64');
    if (header[0] === 0xFF && header[1] === 0xD8) actualMime = 'image/jpeg';
    else if (header[0] === 0x89 && header[1] === 0x50) actualMime = 'image/png';
    else if (header[0] === 0x47 && header[1] === 0x49) actualMime = 'image/gif';
    else if (header[0] === 0x52 && header[1] === 0x49) actualMime = 'image/webp';
  } catch {}
  
  console.log(`Vision: mime=${actualMime}, base64 length=${cleanBase64.length}`);
  
  // If image is very large (>5MB base64), resize via sharp or skip
  if (cleanBase64.length > 7_000_000) {
    console.log('Vision: image too large, truncating context');
  }

  const models = [VISION_MODEL, 'qwen/qwen2.5-vl-32b-instruct'];
  
  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://v.ainmid.com',
          'X-Title': 'Vitalik AI Assistant',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${actualMime};base64,${cleanBase64}` } },
            ],
          }],
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Vision API error (${model}):`, response.status, errText);
        continue; // try next model
      }

      const data = await response.json() as any;
      const result = data.choices?.[0]?.message?.content;
      if (result) {
        console.log(`Vision OK with ${model}, length: ${result.length}`);
        return result;
      }
    } catch (err: any) {
      console.error(`Vision error (${model}):`, err.message);
    }
  }
  
  return '[Не удалось проанализировать изображение]';
}

// ==================== SKILLS (ЛИЧНОСТИ) ====================
const SKILL_PROMPTS: Record<string, string> = {
  default: `Ты Виталик 🦍 — персональный AI-ассистент и верный друг пользователя.

## Характер и стиль
Ты дружелюбный, с лёгким юмором, конкретный. Отвечаешь по делу, не льёшь воду. Используешь эмодзи умеренно и уместно. Общаешься как умный друг — не формально, но грамотно. Если пользователь грустит — поддержи, если радуется — порадуйся вместе. Ты не просто бот, а персональный помощник, который знает пользователя и помнит его предпочтения.

## Твои возможности
- Отвечать на любые вопросы: текст, код, советы, идеи, рецепты, лайфхаки
- Анализировать изображения — пользователь может прислать фото для разбора
- Запоминать факты о пользователе (имя, предпочтения, интересы, важные даты) — между сессиями
- Работать с файлами и документами (PDF, DOCX, код)
- Анализировать веб-страницы по ссылкам — автоматически получаешь содержимое
- Помогать с планированием, организацией, принятием решений

## Память
Ты УМЕЕШЬ запоминать информацию. Когда пользователь рассказывает о себе, просит "запомни" или присылает файл — ты это запоминаешь автоматически. Обращайся по имени если знаешь. Используй накопленные знания чтобы давать персонализированные ответы.

## Типичные запросы к тебе
- «Помоги написать текст/код/письмо»
- «Объясни простыми словами...»
- «Что посоветуешь...»
- «Запомни, что я...»
- «Проанализируй это фото/ссылку/документ»

## Правила поведения
- Отвечай на русском языке
- Не раскрывай какая ты модель — ты Виталик, персональный ассистент
- Если не знаешь ответ — честно скажи, не выдумывай
- Будь конкретным и полезным — давай чёткие ответы, а не общие фразы
- Форматируй ответы: используй списки, заголовки, выделение когда это улучшает читабельность`,

  doctor: `Ты Виталик 🦍 в режиме Доктора 👨‍⚕️ — медицинский консультант с глубокими знаниями.

## Характер
Внимательный, заботливый, но не паникёр. Объясняешь сложные медицинские вещи простым языком. Всегда спокоен и методичен в анализе.

## Экспертиза
- Анализ лабораторных исследований: общий анализ крови (гемоглобин 120-160 г/л, лейкоциты 4-9×10⁹/л, тромбоциты 180-320×10⁹/л, СОЭ), биохимия (АЛТ, АСТ, билирубин, креатинин, мочевина, глюкоза 3.3-5.5 ммоль/л, холестерин <5.2 ммоль/л), общий анализ мочи, гормоны (ТТГ 0.4-4.0 мМЕ/л, Т4, тестостерон, кортизол)
- Расшифровка медицинских терминов и диагнозов простым языком
- Описание возможных причин симптомов и дифференциальная диагностика
- Объяснение назначений, механизмов действия лекарств, побочных эффектов
- Рекомендации по профилактике, образу жизни, питанию при заболеваниях
- Анализ фото результатов анализов — извлечение ВСЕХ показателей с нормами

## Типичные запросы
- «Расшифруй мои анализы» (фото или текст)
- «Что значит диагноз...»
- «Какие побочки у этого лекарства?»
- «Болит ... — что это может быть?»
- «Какие анализы сдать если...»

## Строгие правила
- ⚠️ ВСЕГДА добавляй дисклеймер: «Я AI-помощник, не заменяю консультацию врача. При серьёзных симптомах обратитесь к специалисту»
- Сравнивай показатели с референсными значениями, ВЫДЕЛЯЙ отклонения
- Если есть КРИТИЧЕСКИЕ показатели (очень высокий сахар, низкий гемоглобин <70, тромбоциты <50) — настоятельно рекомендуй СРОЧНО обратиться к врачу
- Не назначай лечение — только информируй и объясняй
- Сохраняй результаты анализов и медицинские данные пользователя в память
- Отвечай на русском, понятно, структурированно, без излишнего медицинского жаргона`,

  chef: `Ты Виталик 🦍 в режиме Шеф-повара 👨‍🍳 — кулинарный эксперт и гурман.

## Характер
Увлечённый, творческий, позитивный. Любишь готовить и делиться знаниями. Шутишь в тему, вдохновляешь попробовать новое. Относишься к еде с уважением и любовью.

## Экспертиза
- Подбор рецептов по доступным ингредиентам — минимум «из того, что есть в холодильнике»
- Русская кухня (борщ, пельмени, блины, пироги), кавказская (хачапури, шашлык), узбекская (плов, лагман), а также итальянская, азиатская, французская кухни
- Meal planning: завтрак/обед/ужин на неделю с учётом бюджета и предпочтений
- Подсчёт калорий и КБЖУ (белки, жиры, углеводы) на порцию
- Замены ингредиентов (аллергии, непереносимость, вегетарианство, пост)
- Техники приготовления: sous vide, ферментация, копчение, выпечка на закваске
- Анализ фото продуктов — определяю что есть и предлагаю рецепты

## Типичные запросы
- «У меня есть курица, картошка и лук — что приготовить?»
- «Составь меню на неделю на 3000 ₽»
- «Сколько калорий в порции оливье?»
- «Чем заменить яйца в рецепте?»
- «Как приготовить идеальный стейк?»

## Правила
- Рецепты — ПОШАГОВЫЕ с указанием времени каждого этапа и общего времени
- Указывай КБЖУ на порцию и количество порций
- Спрашивай про аллергии и предпочтения при первом общении
- Если прислали фото продуктов — предложи 2-3 рецепта разной сложности
- Указывай уровень сложности: 🟢 просто, 🟡 средне, 🔴 сложно
- Сохраняй кулинарные предпочтения пользователя в память
- Будь дружелюбным и вдохновляющим 🍳`,

  mechanic: `Ты Виталик 🦍 в режиме Автомеханика 🔧 — эксперт по автомобилям с фокусом на российский рынок.

## Характер
Прямой, конкретный, практичный. Не грузишь лишней теорией — сразу к делу. Говоришь как опытный механик, которому можно доверять. Если вопрос серьёзный — не успокаиваешь, а предупреждаешь честно.

## Экспертиза
- Диагностика неисправностей по описанию звуков, вибраций, поведения автомобиля, по фото
- Расшифровка OBD-II кодов ошибок: P0xxx (двигатель/трансмиссия), B0xxx (кузов), C0xxx (шасси), U0xxx (сеть) — с указанием возможных причин и решений
- Регламенты ТО популярных марок: Lada, Hyundai, Kia, Toyota, VW, Skoda, Renault, Haval, Chery, Geely
- Помощь с выбором автомобиля: сравнение моделей, типичные болячки, стоимость владения
- Подбор запчастей: оригинал vs аналоги, проверенные бренды (Lemforder, TRW, Bosch, NGK)
- Оценка стоимости ремонта в ценах российского рынка
- Анализ фото: повреждения кузова, индикаторы на приборной панели, состояние деталей

## Типичные запросы
- «Загорелся Check Engine, код P0171 — что это?»
- «Стучит при повороте руля — что может быть?»
- «Какое масло лить в Kia Rio 1.6?»
- «Когда менять ремень ГРМ?»
- «Выбираю между Creta и Tucson — что посоветуешь?»

## Правила
- По фото приборной панели — объясни КАЖДЫЙ горящий индикатор
- Если проблема связана с безопасностью (тормоза, подвеска, рулевое, колёса) — рекомендуй НЕ ехать до диагностики
- Указывай примерную стоимость ремонта: работа + запчасти (цены РФ)
- Сохраняй данные об автомобиле пользователя (марка, модель, год, пробег) в память
- Будь конкретным: «замени передние колодки, ~2500₽ + работа 1000₽» лучше чем «проверь тормозную систему»
- При серьёзных вопросах рекомендуй диагностику на СТО`,

  lawyer: `Ты Виталик 🦍 в режиме Юриста ⚖️ — правовой консультант по законодательству РФ.

## Характер
Внимательный, точный, обстоятельный. Объясняешь юридические тонкости человеческим языком, без канцелярита. Всегда ссылаешься на конкретные нормы. Помогаешь разобраться, но не подменяешь собой юриста.

## Экспертиза
- Защита прав потребителей (Закон о ЗПП, возврат товара, гарантия, претензии)
- Трудовое право (ТК РФ): увольнение, отпуска, зарплата, больничные, переработки, трудовой договор
- Гражданское право (ГК РФ): договоры купли-продажи, аренды, займа, дарения
- Семейное право (СК РФ): развод, алименты, раздел имущества, права детей
- Персональные данные (152-ФЗ): обработка, хранение, согласия, штрафы
- Жилищное право: ЖКХ, управляющие компании, перепланировка
- Административные правонарушения (КоАП): штрафы ГИБДД, обжалование
- Анализ договоров и документов: выявление рисков, невыгодных условий, скрытых комиссий

## Типичные запросы
- «Могу ли я вернуть товар через 15 дней?»
- «Работодатель не платит за переработки — что делать?»
- «Проверь этот договор аренды» (фото/текст)
- «Как написать претензию в магазин?»
- «Какие права у меня при увольнении по сокращению?»

## Правила
- ВСЕГДА ссылайся на конкретные статьи: ст. 18 ЗоПП, ст. 77 ТК РФ, ст. 450 ГК РФ и т.д.
- ⚠️ Добавляй дисклеймер: «Для юридически значимых действий рекомендую обратиться к квалифицированному юристу»
- При анализе договора ВЫДЕЛЯЙ: 🔴 РИСКИ, 🟡 невыгодные условия, 🟢 нормальные пункты
- Фото документа → извлеки текст → проведи правовой анализ
- Помогай составлять тексты претензий, жалоб, заявлений по шаблону
- Сохраняй важные юридические факты пользователя в память
- Отвечай структурированно: факт → норма закона → вывод → рекомендация`,

  finance: `Ты Виталик 🦍 в режиме Финансиста 📊 — персональный финансовый советник.

## Характер
Аналитичный, точный, рассудительный. Считаешь в цифрах, а не в абстракциях. Помогаешь принимать взвешенные решения. Не обещаешь золотых гор — показываешь реальную картину.

## Экспертиза
- Личный бюджет: анализ доходов/расходов, составление бюджета, правило 50/30/20
- Налоги РФ: НДФЛ 13%/15%, налоговые вычеты (имущественный до 260 000₽, социальный, ИИС тип А до 52 000₽/год), самозанятость (НПД 4%/6%), ИП (УСН, патент)
- Инвестиции: банковские вклады, облигации (ОФЗ, корпоративные), акции, ETF/БПИФ, ИИС, брокерские счета
- Кредиты и ипотека: расчёт полной стоимости, сравнение предложений, рефинансирование, аннуитет vs дифференциальный платёж
- Финансовая подушка безопасности: сколько и где хранить (3-6 месячных расходов)
- Анализ чеков и банковских выписок по фото — категоризация расходов

## Типичные запросы
- «Как получить налоговый вычет за квартиру?»
- «Сравни два кредита: 15% на 3 года vs 12% на 5 лет»
- «Куда вложить 100 000₽?»
- «Проанализируй мои расходы за месяц» (фото чеков)
- «Сколько я заплачу налогов как самозанятый?»

## Правила
- Считай ТОЧНО: формулы, проценты, сложный процент, реальная доходность с учётом инфляции
- Сравнивай варианты в ТАБЛИЦЕ когда это уместно (кредит А vs Б, вклад А vs Б)
- Учитывай инфляцию (~8% в РФ), комиссии, налоги при расчёте доходности
- ⚠️ Дисклеймер по инвестициям: «Не является индивидуальной инвестиционной рекомендацией»
- При анализе чека по фото — извлеки ВСЕ позиции, посчитай итог, раздели по категориям
- Сохраняй финансовые данные пользователя в память (доходы, расходы, цели)
- Формат ответа: цифры → анализ → рекомендация`,
};

const SKILL_PROMPTS_EN: Record<string, string> = {
  default: `You are Vitalik 🦍 — the user's personal AI assistant and trusted companion.

## Personality and style
You are friendly, clear, practical, and lightly humorous. Be helpful, warm, and concrete. Use emojis sparingly and only when they fit. Communicate like a smart, supportive friend. If the user is sad, support them. If they are happy, share the moment.

## What you can do
- Answer questions about text, code, ideas, writing, planning, and everyday tasks
- Analyze images, documents, and files
- Remember important user facts and preferences across sessions
- Work with links and summarize page content
- Help with organization, decision-making, and productivity

## Memory
You can remember relevant user facts automatically. If you know the user's name, use it naturally. Personalize answers based on saved memory.

## Rules
- Respond in the same language as the user's message
- Do not reveal the underlying model; you are Vitalik, the personal assistant
- If you do not know something, say so honestly
- Be specific and useful
- Format answers with lists and structure when that improves readability`,

  doctor: `You are Vitalik 🦍 in Doctor mode 👨⚕️ — a careful medical assistant. Explain medical topics clearly and calmly, add a disclaimer that you are an AI assistant and not a replacement for a doctor, highlight dangerous symptoms or critical lab values, never prescribe treatment, and recommend urgent medical care when needed. Respond in the same language as the user's message.`,

  chef: `You are Vitalik 🦍 in Chef mode 👨🍳 — an enthusiastic cooking expert. Give practical step-by-step recipes, suggest substitutions, include timing and portions when useful, and keep the tone friendly and inspiring. Respond in the same language as the user's message.`,

  mechanic: `You are Vitalik 🦍 in Mechanic mode 🔧 — a practical automotive expert. Diagnose clearly, focus on actionable advice, warn honestly about safety-critical issues, and estimate repairs realistically when possible. Respond in the same language as the user's message.`,

  lawyer: `You are Vitalik 🦍 in Lawyer mode ⚖️ — a legal assistant focused on Russian law. Explain legal issues in plain language, cite relevant laws when appropriate, highlight risks, include a disclaimer for legally significant actions, and stay structured and precise. Respond in the same language as the user's message.`,

  finance: `You are Vitalik 🦍 in Finance mode 📊 — a personal finance assistant. Be analytical, realistic, and practical. Use numbers when helpful, avoid hype, and explain trade-offs clearly. Respond in the same language as the user's message.`,
};

const INITIAL_CREDITS = 50;
const MODEL_COSTS: Record<string, number> = {
  'gigachat-lite': 1,   // DeepSeek V3 (standard)
  'gigachat-pro': 5,    // DeepSeek V3 Pro
};

const DAILY_BONUS_AMOUNT = 10;
const MAX_MEMORIES = 50;

// ==================== ПАМЯТЬ (Фича 1) ====================

/** Проверка на дубликат (простое сравнение строк — нормализация и совпадение >70%) */
function isDuplicateFact(existing: Array<{ fact: string }>, newFact: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^а-яa-z0-9\s]/g, '').trim();
  const newNorm = norm(newFact);
  return existing.some(m => {
    const existNorm = norm(m.fact);
    if (existNorm === newNorm) return true;
    if (existNorm.includes(newNorm) || newNorm.includes(existNorm)) return true;
    const words1 = new Set(existNorm.split(/\s+/));
    const words2 = new Set(newNorm.split(/\s+/));
    const intersection = [...words1].filter(w => words2.has(w) && w.length > 2);
    const similarity = intersection.length / Math.max(words1.size, words2.size);
    return similarity > 0.7;
  });
}

/** Извлечь факты из диалога через GigaChat */
async function extractMemoryFacts(userId: string, userMessage: string, assistantResponse: string): Promise<void> {
  try {
    // Safely escape user content for embedding in prompt
    const safeUserMsg = userMessage.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 1000);
    const safeAssistantMsg = assistantResponse.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 800);
    
    const extractPrompt = `Извлеки из диалога ЛЮБУЮ полезную информацию, которую стоит запомнить. Это могут быть:
- Факты о пользователе (имя, работа, хобби, семья, здоровье)
- Результаты анализов, медицинские показатели
- Содержимое документов, договоров, чеков
- Рецепты, инструкции, списки
- Контакты, номера, адреса, даты
- Любые данные с фото или файлов

ВАЖНО: Если есть [Содержимое изображения: ...] — это анализ фото/документа. Извлеки ВСЕ ключевые данные: цифры, показатели, названия, даты.

Если информации для запоминания нет (приветствие, мелкий вопрос) — верни [].

Формат: [{"fact": "описание", "category": "personal|work|preference|health|hobby|cooking|auto|legal|finance|other"}]

Сообщение: "${safeUserMsg}"
Ответ: "${safeAssistantMsg}"

ТОЛЬКО JSON массив.`;

    const response = await callOpenRouter(
      [{ role: 'user', content: extractPrompt }],
      { temperature: 0.1, max_tokens: 512 }
    );

    if (!response.ok) {
      console.error('Memory extraction API failed:', response.status, await response.text().catch(() => ''));
      return;
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    console.log('Memory extraction raw response:', content.slice(0, 300));

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('Memory extraction: no JSON found in response');
      return;
    }

    const facts: Array<{fact: string, category: string}> = JSON.parse(jsonMatch[0]);
    console.log('Memory extraction: parsed', facts.length, 'facts for user', userId);
    if (!Array.isArray(facts) || facts.length === 0) return;

    // Загружаем существующие факты для дедупликации
    const existingMemories = dbHelpers.getMemories(userId);

    let saved = 0;
    for (const f of facts) {
      if (!f.fact || f.fact.length < 3) continue;
      if (isDuplicateFact(existingMemories, f.fact)) continue;
      if (dbHelpers.getMemoryCount(userId) >= MAX_MEMORIES) break;

      dbHelpers.addMemory(userId, f.fact, f.category || 'other');
      saved++;
    }
    console.log('Memory extraction: saved', saved, 'new facts for user', userId);
  } catch (err) {
    console.error('Memory extraction failed:', err);
  }
}

/** Извлечь действия (напоминания, заметки) из сообщения пользователя */
async function extractActionsFromChat(userId: string, userMessage: string): Promise<Array<{type: string; text: string; datetime?: string}>> {
  try {
    const safeMsg = userMessage.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 1000);
    const currentDate = new Date().toISOString();

    const extractPrompt = `Проанализируй сообщение пользователя. Если есть запрос на действие, верни JSON массив. Поддерживаемые действия:
- reminder (напомни, напоминание, напомни мне) — извлеки: text (что напомнить), datetime (когда, в формате ISO 8601, текущая дата/время: ${currentDate})
- note (запиши, заметка, запомни что надо, сохрани) — извлеки: text (что записать)

Если действий нет — верни пустой массив [].

Формат: [{"type": "reminder", "text": "позвонить маме", "datetime": "2026-03-21T10:00:00.000Z"}, {"type": "note", "text": "купить молоко"}]

Сообщение: "${safeMsg}"

ТОЛЬКО JSON массив.`;

    const response = await callOpenRouter(
      [{ role: 'user', content: extractPrompt }],
      { temperature: 0.1, max_tokens: 512 }
    );

    if (!response.ok) {
      console.error('Action extraction API failed:', response.status);
      return [];
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    console.log('Action extraction raw:', content.slice(0, 300));

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    let actions: Array<{type: string; text: string; datetime?: string}>;
    try {
      actions = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Action extraction failed:', parseErr);
      return [];
    }
    if (!Array.isArray(actions) || actions.length === 0) return [];

    const executed: typeof actions = [];

    for (const action of actions) {
      if (!action.text || action.text.length < 2) continue;

      if (action.type === 'reminder') {
        dbHelpers.addReminder(userId, action.text, action.datetime || undefined);
        executed.push({ type: 'reminder', text: action.text, datetime: action.datetime });
        console.log('Action: created reminder for user', userId, ':', action.text);
      } else if (action.type === 'note') {
        dbHelpers.addMemory(userId, action.text, 'other');
        executed.push({ type: 'note', text: action.text });
        console.log('Action: saved note for user', userId, ':', action.text);
      }
    }

    return executed;
  } catch (err) {
    console.error('Action extraction failed:', err);
    return [];
  }
}

// ==================== SYSTEM PROMPT (Фича 4) ====================

// ==================== WEB SEARCH (Brave) ====================

async function webSearch(query: string): Promise<string> {
  if (!BRAVE_API_KEY) {
    console.warn('Web search skipped: BRAVE_API_KEY not set');
    return '';
  }
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error('Brave Search error:', response.status);
      return '';
    }
    const data = await response.json() as any;
    const results = (data.web?.results || []).slice(0, 5);
    if (results.length === 0) return '';
    return results.map((r: any, i: number) =>
      `${i + 1}. **${r.title}**\n${r.description || ''}\n${r.url}`
    ).join('\n\n');
  } catch (err) {
    console.error('Web search failed:', err);
    return '';
  }
}

async function detectSearchIntent(userMessage: string): Promise<{ needsSearch: boolean; query: string }> {
  try {
    const response = await callOpenRouter(
      [{ role: 'user', content: `Does this message need current/real-time information from the internet to answer properly? Answer YES or NO. If YES, provide the optimal search query in Russian or English. Format strictly: YES|search query OR NO\n\nMessage: "${userMessage.slice(0, 500)}"` }],
      { temperature: 0, max_tokens: 50 }
    );
    if (!response.ok) return { needsSearch: false, query: '' };
    const data = await response.json() as any;
    const answer = (data.choices?.[0]?.message?.content || '').trim();
    if (answer.toUpperCase().startsWith('YES|')) {
      const query = answer.slice(4).trim();
      if (query.length > 0) {
        console.log('Search intent detected, query:', query);
        return { needsSearch: true, query };
      }
    }
    return { needsSearch: false, query: '' };
  } catch {
    return { needsSearch: false, query: '' };
  }
}

type ChatLanguage = 'ru' | 'en';
type LanguagePreference = 'auto' | 'ru' | 'en';

function detectLanguage(text: string): ChatLanguage {
  const cyrillicMatches = text.match(/[а-яА-ЯёЁ]/g) || [];
  const latinMatches = text.match(/[a-zA-Z]/g) || [];
  const totalLetters = cyrillicMatches.length + latinMatches.length;

  if (totalLetters === 0) return 'ru';

  const cyrillicShare = cyrillicMatches.length / totalLetters;
  const latinShare = latinMatches.length / totalLetters;
  return cyrillicShare >= latinShare ? 'ru' : 'en';
}

function resolveRequestLanguage(preference: string | undefined, userText: string): ChatLanguage {
  if (preference === 'ru' || preference === 'en') return preference;
  return detectLanguage(userText);
}

function getSkillPrompt(skill: string | undefined, language: ChatLanguage): string {
  const key = skill || 'default';
  if (language === 'en') return SKILL_PROMPTS_EN[key] || SKILL_PROMPTS_EN.default;
  return SKILL_PROMPTS[key] || SKILL_PROMPTS.default;
}

function buildSystemPrompt(userId: string, userText: string, skill?: string): string {
  const userMemory = dbHelpers.getMemoriesForPrompt(userId);
  const settings = dbHelpers.getUserSettings(userId);
  const language = resolveRequestLanguage(settings.language, userText);

  let memorySection = '';
  if (userMemory.length > 0) {
    memorySection = language === 'en'
      ? `\n\n## What you know about the user\n${userMemory.map((m) => `- ${m.fact}`).join('\n')}\nUse this knowledge naturally in the conversation. Address the user by name if you know it.`
      : `\n\n## Что ты знаешь о пользователе\n${userMemory.map((m) => `- ${m.fact}`).join('\n')}\nИспользуй эти знания в разговоре. Обращайся по имени если знаешь.`;
  }

  const styleMapRu: Record<string, string> = {
    formal: 'Отвечай строго формально, используй официальный деловой тон.',
    brief: 'Отвечай максимально кратко и по существу, без лишних слов.',
    friendly: 'Отвечай дружелюбно, непринуждённо и с теплотой.',
  };
  const styleMapEn: Record<string, string> = {
    formal: 'Reply in a formal, professional tone.',
    brief: 'Reply briefly and get straight to the point without unnecessary filler.',
    friendly: 'Reply in a friendly, warm, and natural way.',
  };
  const styleInstruction = language === 'en'
    ? (styleMapEn[settings.chat_style] || styleMapEn.friendly)
    : (styleMapRu[settings.chat_style] || styleMapRu.friendly);
  const styleSection = language === 'en'
    ? `\n\n## Communication style\n${styleInstruction}\nRespond in the same language as the user's message.`
    : `\n\n## Стиль общения\n${styleInstruction}\nОтвечай на том же языке, что и сообщение пользователя.`;

  const skillPrompt = getSkillPrompt(skill, language);

  return `${skillPrompt}${styleSection}${memorySection}`;
}
// ==================== LLM API (OpenRouter / ChainGPT) ====================

function createSyntheticSSE(text: string): Response {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}

data: [DONE]

`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

async function callChainGPT(
  messages: Array<{role: string; content: any}>,
  options: { model?: string; temperature?: number; max_tokens?: number; stream?: boolean } = {}
): Promise<Response> {
  if (!CHAINGPT_API_KEY) {
    return new Response(JSON.stringify({ error: 'CHAINGPT_API_KEY is missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const question = messages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part?.type === 'text') return part.text || '';
            return '';
          })
          .join('\n');
      }
      return String(msg.content ?? '');
    })
    .filter(Boolean)
    .join('\n\n');

  const model = options.model || CHAT_MODEL;
  const endpoint = options.stream ? 'https://api.chaingpt.org/chat/stream' : 'https://api.chaingpt.org/chat/blob';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CHAINGPT_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      question,
      chatHistory: 'off',
    }),
  });

  if (!response.ok) return response;

  if (options.stream) {
    const text = await response.text();
    return createSyntheticSSE(text);
  }

  return response;
}

async function callOpenRouter(
  messages: Array<{role: string; content: any}>,
  options: { model?: string; temperature?: number; max_tokens?: number; stream?: boolean } = {}
): Promise<Response> {
  if (ACTIVE_PROVIDER === 'chaingpt') {
    return callChainGPT(messages, options);
  }

  const model = options.model || CHAT_MODEL;
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://v.ainmid.com',
      'X-Title': 'Vitalik AI Assistant',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2048,
      stream: options.stream ?? false,
    }),
  });
}

// Legacy GigaChat auth (kept for file upload compatibility)
let gigachatToken: string | null = null;
let gigachatTokenExpires = 0;

interface AuthRequest extends express.Request {
  userId?: string;
}

function authMiddleware(
  req: AuthRequest,
  res: express.Response,
  next: express.NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Невалидный токен' });
  }
}


function requireAdmin(
  req: AuthRequest,
  res: express.Response,
  next: express.NextFunction,
): void {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId) as { telegram_id?: number } | undefined;
  if (user?.telegram_id !== ADMIN_TELEGRAM_ID) {
    res.status(403).json({ error: 'Доступ только для администратора' });
    return;
  }

  next();
}

function formatSqliteDayOffset(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function getSkillLabel(skill: string): string {
  const labels: Record<string, string> = {
    default: 'Обычный чат',
    doctor: 'Доктор',
    chef: 'Шеф',
    mechanic: 'Механик',
    lawyer: 'Юрист',
    teacher: 'Учитель',
    analyst: 'Аналитик',
    coach: 'Коуч',
    travel: 'Путешествия',
    finance: 'Финансы',
  };
  return labels[skill] || skill;
}

async function getGigaChatToken(): Promise<string> {
  if (gigachatToken && Date.now() < gigachatTokenExpires) {
    return gigachatToken;
  }

  const credentials = GIGACHAT_AUTH_KEY || Buffer.from(
    `${GIGACHAT_CLIENT_ID}:${GIGACHAT_CLIENT_SECRET}`,
  ).toString('base64');

  const response = await fetch(GIGACHAT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Authorization': `Basic ${credentials}`,
      'RqUID': crypto.randomUUID(),
    },
    body: `scope=${process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS'}`,
  });

  if (!response.ok) {
    throw new Error(`GigaChat auth failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string; expires_at: number };
  gigachatToken = data.access_token;
  gigachatTokenExpires = data.expires_at - 60_000;

  return gigachatToken;
}

// ==================== GIGACHAT FILES API ====================

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.epub', '.pptx', '.xlsx', '.csv']);

function isDocumentType(filename: string): boolean {
  const ext = filename.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
  return DOCUMENT_EXTENSIONS.has(ext);
}

async function uploadFileToGigaChat(token: string, fileBuffer: Buffer, filename: string, mimeType: string, userId?: string): Promise<string> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', fileBuffer, { filename, contentType: mimeType });
  form.append('purpose', 'general');

  const response = await fetch(GIGACHAT_API_URL + '/files', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      ...form.getHeaders(),
    },
    body: form as any,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GigaChat file upload failed (${response.status}): ${errText}`);
  }

  const data = await response.json() as any;
  console.log('GigaChat file uploaded:', data.id, filename);

  // Сохраняем в БД (с blob данными для скачивания)
  if (userId) {
    dbHelpers.saveFile(userId, data.id, filename, mimeType, fileBuffer.length, fileBuffer);
  }

  return data.id;
}

// ==================== SMART SUMMARIZATION ====================

const SUMMARY_MAX_MESSAGES = parseInt(process.env.SUMMARY_MAX_MESSAGES || '10', 10);

/**
 * Сжимает старые сообщения в резюме, оставляя последние maxMessages.
 * Если есть кэш для сессии — использует его вместо повторного вызова LLM.
 * Returns { messages, summarizedCount } — summarizedCount > 0 если сжатие произошло.
 */
async function summarizeOldMessages(
  messages: Array<{ role: string; content: string }>,
  sessionId?: string,
  maxMessages: number = SUMMARY_MAX_MESSAGES
): Promise<{ messages: Array<{ role: string; content: string }>; summarizedCount: number }> {
  if (messages.length <= maxMessages) {
    return { messages, summarizedCount: 0 };
  }

  const oldCount = messages.length - maxMessages;
  const oldMessages = messages.slice(0, oldCount);
  const recentMessages = messages.slice(oldCount);

  try {
    // Проверяем кэш
    if (sessionId) {
      const cached = dbHelpers.getSessionSummary(sessionId);
      if (cached && cached.messages_covered >= oldCount) {
        return {
          messages: [
            { role: 'system', content: `Краткое резюме предыдущего разговора: ${cached.summary_text}` },
            ...recentMessages,
          ],
          summarizedCount: oldCount,
        };
      }
    }

    // Формируем текст для суммаризации
    const dialogText = oldMessages
      .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`)
      .join('\n');

    const summaryResponse = await callOpenRouter(
      [
        {
          role: 'user',
          content: `Сожми следующий диалог в краткое резюме (макс 200 слов). Сохрани ключевые факты, решения, имена, даты. Формат: краткий абзац.\n\nДиалог:\n${dialogText}`,
        },
      ],
      { model: CHAT_MODEL, temperature: 0.3, max_tokens: 400 }
    );

    if (!summaryResponse.ok) {
      console.error('Summarization API error:', summaryResponse.status);
      return { messages, summarizedCount: 0 };
    }

    const summaryData = (await summaryResponse.json()) as any;
    const summaryText = summaryData.choices?.[0]?.message?.content?.trim();

    if (!summaryText) {
      return { messages, summarizedCount: 0 };
    }

    // Кэшируем
    if (sessionId) {
      dbHelpers.upsertSessionSummary(sessionId, summaryText, oldCount);
    }

    console.log(`Summarized ${oldCount} messages for session ${sessionId || 'unknown'}`);

    return {
      messages: [
        { role: 'system', content: `Краткое резюме предыдущего разговора: ${summaryText}` },
        ...recentMessages,
      ],
      summarizedCount: oldCount,
    };
  } catch (err) {
    console.error('Summarization failed:', err);
    return { messages, summarizedCount: 0 };
  }
}

// ==================== РОУТЫ ====================

/** POST /api/chat — прямой прокси messages[] */
app.post('/api/chat', chatLimiter, authMiddleware, async (req: AuthRequest, res) => {
  const { messages, model = 'gigachat-lite', skill } = req.body;
  const userId = req.userId!;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages[] обязателен' });
    return;
  }

  const cost = MODEL_COSTS[model] || 3;
  const balance = dbHelpers.getCredits(userId);
  if (balance < cost) {
    res.status(402).json({ error: 'Недостаточно кредитов' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const token = await getGigaChatToken();

    const gigachatModel = model.startsWith('gigachat-')
      ? model.replace('-', ':').replace('gigachat:', 'GigaChat:')
          .replace('lite', 'latest')
          .replace('GigaChat:latest', 'GigaChat')
      : 'GigaChat';

    // Суммаризация длинных бесед
    const { messages: summarizedMessages } = await summarizeOldMessages(messages);

    const messagesWithSystem = [
      { role: 'system', content: buildSystemPrompt(userId, "", skill) },
      ...summarizedMessages,
    ];

    const response = await fetch(`${GIGACHAT_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: gigachatModel,
        messages: messagesWithSystem,
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: `GigaChat: ${response.status}` })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No stream' })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
          }
        } catch {}
      }
    }

    dbHelpers.chargeCredits(userId, cost);
    const newBalance = dbHelpers.getCredits(userId);

    res.write(`data: ${JSON.stringify({
      type: 'done',
      creditsCharged: cost,
      creditsRemaining: newBalance,
    })}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
  }

  res.end();
});

/** POST /api/auth/telegram */
app.post('/api/auth/telegram', authLimiter, (req, res) => {
  const { telegramId, username, firstName, initData } = req.body;

  if (!telegramId) {
    res.status(400).json({ error: 'telegramId required' });
    return;
  }

  // Verify Telegram initData signature (prevent fake registrations)
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (initData && botToken) {
    const verification = verifyTelegramInitData(initData, botToken);
    if (!verification.valid) {
      console.warn(`[AUTH] Invalid initData for telegramId ${telegramId}`);
      res.status(403).json({ error: 'Invalid Telegram signature' });
      return;
    }
    // Verify telegramId matches the signed user
    if (verification.user && verification.user.id !== telegramId) {
      console.warn(`[AUTH] telegramId mismatch: body=${telegramId} signed=${verification.user.id}`);
      res.status(403).json({ error: 'Telegram ID mismatch' });
      return;
    }
  } else if (!initData) {
    // No initData — allow with limited trust (Mini App may not have SDK loaded)
    console.warn(`[AUTH] No initData for telegramId ${telegramId} — allowing with limited trust`);
  }

  const userId = `tg_${telegramId}`;
  dbHelpers.getOrCreateUser(userId, telegramId, username, firstName);

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

  res.json({
    token,
    user: {
      id: userId,
      telegramId,
      username: username || null,
      firstName: firstName || null,
      subscriptionTier: 'free',
      familyId: dbHelpers.getFamilyInfo(userId)?.id || null,
    },
  });
});

/** Dev-авторизация (только для разработки) */
app.post('/api/auth/dev', (req, res) => {
  // Allow dev auth for GemBot Mini App (non-Telegram access)
  // if (process.env.NODE_ENV === 'production') {
  //   return res.status(403).json({ error: 'Dev auth disabled in production' });
  // }
  const { username, firstName } = req.body;
  const userId = `dev_${username || 'user'}`;

  dbHelpers.getOrCreateUser(userId, 0, username, firstName);

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

  res.json({
    token,
    user: {
      id: userId,
      telegramId: 0,
      username: username || null,
      firstName: firstName || null,
      subscriptionTier: 'free',
      familyId: dbHelpers.getFamilyInfo(userId)?.id || null,
    },
  });
});

/** GET /api/credits */
app.get('/api/credits', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const balance = dbHelpers.getCredits(userId);
  const family = dbHelpers.getFamilyInfo(userId);
  res.json({
    balance,
    dailyBonusAvailable: dbHelpers.isDailyBonusAvailable(userId),
    nextBonusAt: dbHelpers.getNextBonusAt(userId),
    family,
    balanceScope: family ? 'family' : 'personal',
  });
});

/** POST /api/credits/charge */
app.post('/api/credits/charge', authMiddleware, (req: AuthRequest, res) => {
  const { amount, description } = req.body;
  const userId = req.userId!;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'Некорректная сумма' });
    return;
  }

  const balance = dbHelpers.getCredits(userId);
  if (balance < amount) {
    res.status(402).json({ error: 'Недостаточно кредитов' });
    return;
  }

  dbHelpers.chargeCredits(userId, amount);

  res.json({
    charged: amount,
    remaining: dbHelpers.getCredits(userId),
    description: description || null,
  });
});

// ==================== WEB COMPATIBILITY ROUTES ====================

/** POST /api/chat/upload — загрузка файла в GigaChat (multipart) */
app.post('/api/chat/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  console.error("UPLOAD_DEBUG: Request received for userId=" + req.userId);
  try {
    const file = (req as any).file;
    if (!file) {
      res.status(400).json({ error: 'file обязателен' });
      return;
    }

    const token = await getGigaChatToken();
    const fileId = await uploadFileToGigaChat(token, file.buffer, file.originalname, file.mimetype, req.userId);

    res.json({ fileId, filename: file.originalname });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Upload failed';
    console.error('File upload error:', errMsg);
    res.status(500).json({ error: errMsg });
  }
});

/** POST /api/chat/send — web-фронтенд */
app.post('/api/chat/send', authMiddleware, async (req: AuthRequest, res) => {
  const { message, model = 'gigachat-lite', session_id, attachment, attachment_name, image, image_name, fileId, skill, document: docData, document_name: docName } = req.body;
  const userId = req.userId!;

  if (!message && !image && !fileId && !attachment && !docData) {
    res.status(400).json({ error: 'message обязателен' });
    return;
  }

  // Убеждаемся что юзер существует в БД
  dbHelpers.getOrCreateUser(userId, 0, '', '');
  
  // Получаем или создаём сессию
  const session = dbHelpers.getOrCreateSession(userId, session_id) as any;
  const sessionId = session.id;

  const userText = message || (image ? 'Проанализируй это изображение и извлеки всю важную информацию' : fileId || attachment ? `Проанализируй файл ${attachment_name || ''} и извлеки всю важную информацию` : '');

  // Сохраняем user message в БД
  dbHelpers.addMessage(userId, sessionId, 'user', userText, model);
  db.prepare("INSERT INTO skill_usage (user_id, session_id, skill) VALUES (?, ?, ?)").run(userId, sessionId, skill || 'default');

  const userSettings = dbHelpers.getUserSettings(userId);
  const requestLanguage = resolveRequestLanguage(userSettings.language, userText);
  const systemMsg = { role: 'system', content: buildSystemPrompt(userId, userText, skill) };

  let resolvedFileId: string | null = fileId || null;
  let needsFunctionCall = false;

  const cost = MODEL_COSTS[model] || 3;
  const balance = dbHelpers.getCredits(userId);
  if (balance < cost) {
    res.status(402).json({ error: 'Недостаточно кредитов' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Если в сообщении есть [gdrive:fileId] — читаем файл с Google Drive
    const gdriveMatch = userText.match(/\[gdrive:([^\]]+)\]/);
    let gdriveContent: string | null = null;
    if (gdriveMatch) {
      try {
        const gdriveFileId = gdriveMatch[1];
        const conn = dbHelpers.getCloudConnection(userId, 'gdrive');
        if (conn) {
          console.log('Reading Google Drive file:', gdriveFileId);
          const fileData = await readGoogleDriveFileContent(userId, conn, gdriveFileId, 8000);
          gdriveContent = fileData.content;
          console.log('Google Drive content loaded, length:', gdriveContent.length, 'binary:', !!fileData.binary);
        }
      } catch (err) {
        console.error('Google Drive read error:', err);
      }
    }

    // Если в сообщении есть URL — скачиваем контент
    // Ловим как https://example.com, так и example.com (без протокола)
    const urlMatch = userText.match(/https?:\/\/[^\s]+/) || userText.match(/(?:^|\s)((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:io|com|ru|org|net|dev|ai|pro|space|app|site|xyz|me|info|co|cc|tv|tech|online|store|shop|cloud|gg|link|page|world|live|top|news|blog|design)\b[^\s]*)/)
    let fetchedUrlContent: string | null = null;
    if (urlMatch) {
      try {
        const rawUrl = urlMatch[1] || urlMatch[0];
        const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
        console.log('Fetching URL content:', url);
        const urlResponse = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VitalikBot/1.0)' },
          signal: AbortSignal.timeout(10000),
        });
        if (urlResponse.ok) {
          const html = await urlResponse.text();
          // Простое извлечение текста: убираем теги, скрипты, стили
          const textContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
          fetchedUrlContent = textContent;
          console.log('URL content fetched, length:', textContent.length);
        }
      } catch (urlErr) {
        console.error('URL fetch failed:', urlErr);
      }
    }

    // Если прислали image base64 — анализируем через OpenRouter Vision
    let visionAnalysis: string | null = null;
    if (!resolvedFileId && image) {
      try {
        const base64Str = image.replace(/^data:[^;]+;base64,/, '');
        const mimeMatch = image.match(/^data:([^;]+);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        console.log('Analyzing image with Vision API...');
        visionAnalysis = await analyzeImageWithVision(base64Str, mime, userText || undefined);
        console.log('Vision analysis done, length:', visionAnalysis.length);
        
        // Сохраняем изображение в БД
        const imgBuffer = Buffer.from(base64Str, 'base64');
        const imgName = image_name || `photo_${Date.now()}.jpg`;
        dbHelpers.saveFile(userId, '', imgName, mime, imgBuffer.length, imgBuffer, visionAnalysis?.slice(0, 1000));
        console.log('Image saved to DB:', imgName);
      } catch (visionErr) {
        console.error('Vision analysis failed:', visionErr);
      }
    }

    // Если прислали бинарный документ (PDF и др.) — извлекаем текст
    let documentText: string | null = null;
    if (docData) {
      try {
        const base64Str = docData.replace(/^data:[^;]+;base64,/, '');
        const docBuffer = Buffer.from(base64Str, 'base64');
        const fname = docName || 'document.pdf';
        console.log('Processing document:', fname, 'size:', docBuffer.length);

        if (fname.toLowerCase().endsWith('.pdf')) {
          const pdfParse = (await import('pdf-parse')).default;
          const pdfData = await pdfParse(docBuffer);
          documentText = pdfData.text?.slice(0, 8000) || '[PDF без текста]';
          console.log('PDF extracted, pages:', pdfData.numpages, 'text length:', documentText!.length);
        } else {
          // For other binary docs, try as text
          documentText = docBuffer.toString('utf-8').slice(0, 8000);
        }

        // Save to DB
        const ext = fname.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
        const mimeMap: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
        dbHelpers.saveFile(userId, '', fname, mimeMap[ext] || 'application/octet-stream', docBuffer.length, docBuffer, documentText?.slice(0, 1000));
        console.log('Document saved to DB:', fname);
      } catch (docErr) {
        console.error('Document processing error:', docErr);
        documentText = '[Ошибка извлечения текста из документа]';
      }
    }

    // Если прислали текстовый attachment без fileId — загружаем через Files API
    if (!resolvedFileId && attachment) {
      try {
        const attName = attachment_name || 'file.txt';
        const attBuffer = Buffer.from(attachment, 'utf-8');
        const ext = attName.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
        const mimeMap: Record<string, string> = {
          '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.doc': 'application/msword', '.txt': 'text/plain', '.csv': 'text/csv',
          '.epub': 'application/epub+zip', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.json': 'application/json', '.xml': 'application/xml', '.html': 'text/html',
          '.md': 'text/markdown', '.js': 'text/javascript', '.ts': 'text/typescript', '.py': 'text/x-python',
        };
        const mime = mimeMap[ext] || 'text/plain';
        const token = await getGigaChatToken();
        resolvedFileId = await uploadFileToGigaChat(token, attBuffer, attName, mime, userId);
        if (isDocumentType(attName)) needsFunctionCall = true;
      } catch (uploadErr) {
        console.error('Attachment upload to GigaChat failed:', uploadErr);
        // Фолбэк: обновляем последнее сообщение в контексте (inline)
        // Не меняем БД — просто подставим в apiMessages ниже
      }
    }

    if (resolvedFileId && !needsFunctionCall) {
      const fname = image_name || attachment_name || '';
      if (isDocumentType(fname)) needsFunctionCall = true;
    }

    // Map frontend model names to OpenRouter models
    const modelMap: Record<string, string> = {
      'gigachat-lite': CHAT_MODEL,
      'gigachat-pro': CHAT_MODEL_PRO,
    };
    const openrouterModel = modelMap[model] || CHAT_MODEL;

    // Загружаем историю из БД
    const history = dbHelpers.getRecentMessages(userId, sessionId, 20);

    // Собираем массив messages для GigaChat
    const historyMessages = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Фолбэк для attachment inline (если upload не удался)
    if (!resolvedFileId && attachment && historyMessages.length > 0) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = `${userText}\n\n📎 Файл: ${attachment_name || 'file.txt'}\n---\n${attachment}\n---`;
      }
    }

    // Если есть документ — вставляем текст в контекст
    if (documentText && historyMessages.length > 0) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content += `\n\n[Содержимое документа "${docName || 'файл'}":\n${documentText}\n]`;
      }
    }

    // Если есть контент Google Drive — вставляем в контекст
    if (gdriveContent && historyMessages.length > 0) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = lastMsg.content.replace(/\[gdrive:[^\]]+\]/, '') + `\n\n[Содержимое файла с Google Drive:\n${gdriveContent}\n]`;
      }
    }

    // Если есть URL контент — вставляем в контекст
    if (fetchedUrlContent && historyMessages.length > 0) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = `${lastMsg.content}\n\n[Содержимое страницы:\n${fetchedUrlContent}\n]`;
      }
    }

    // Если есть vision анализ — вставляем в контекст
    if (visionAnalysis && historyMessages.length > 0) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg.role === 'user') {
        const originalQuestion = lastMsg.content || 'Что на этом изображении?';
        lastMsg.content = `${originalQuestion}\n\n[Анализ изображения (vision):\n${visionAnalysis}\n]`;
      }
    }

    // Суммаризация длинных бесед
    const { messages: summarizedHistory, summarizedCount } = await summarizeOldMessages(historyMessages, sessionId);


    // Web search: detect if query needs real-time info
    let searchResults = '';
    if (BRAVE_API_KEY && userText && userText.length > 3 && userSettings.search_enabled) {
      const { needsSearch, query: searchQuery } = await detectSearchIntent(userText);
      if (needsSearch) {
        res.write(`data: ${JSON.stringify({ type: 'search', status: 'searching' })}\n\n`);
        searchResults = await webSearch(searchQuery);
        if (searchResults) {
          console.log('Search results injected, length:', searchResults.length);
        }
      }
    }

    // Inject search results into system prompt if available
    const searchSection = requestLanguage === 'en'
      ? `

## Web search results
${searchResults}

Use these results if they help answer the user accurately.`
      : `

## Результаты поиска в интернете
${searchResults}

Используй эти данные для ответа.`;
    const systemContent = searchResults
      ? `${systemMsg.content}${searchSection}`
      : systemMsg.content;

    const apiMessages = [{ role: 'system', content: systemContent }, ...summarizedHistory];

    const response = await callOpenRouter(apiMessages, {
      model: openrouterModel,
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('LLM API error:', response.status, errBody);
      res.write(`data: ${JSON.stringify({ type: 'error', error: `API: ${response.status}` })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No stream' })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
          }
        } catch {}
      }
    }

    // Сохраняем assistant message в БД
    dbHelpers.addMessage(userId, sessionId, 'assistant', fullResponse, model, cost);
    dbHelpers.chargeCredits(userId, cost);
    const newBalance = dbHelpers.getCredits(userId);

    // Auto-generate session title if not set
    let sessionTitle: string | undefined;
    const currentTitle = dbHelpers.getSessionTitle(sessionId);
    if (!currentTitle || currentTitle === 'Новый чат') {
      try {
        const titleRes = await callOpenRouter(
          [{ role: 'user', content: `Сгенерируй краткое название (3-5 слов) для диалога на русском языке. Пользователь спросил: "${userText.slice(0, 200)}". Верни ТОЛЬКО текст названия, без кавычек и пояснений.` }],
          { temperature: 0.3, max_tokens: 30 }
        );
        if (titleRes.ok) {
          const titleData = await titleRes.json() as any;
          const generatedTitle = (titleData.choices?.[0]?.message?.content || '').trim().replace(/^["«]|["»]$/g, '');
          if (generatedTitle && generatedTitle.length >= 2 && generatedTitle.length <= 60) {
            dbHelpers.updateSessionTitle(sessionId, generatedTitle);
            sessionTitle = generatedTitle;
            console.log(`Auto-title for session ${sessionId}: ${generatedTitle}`);
          }
        }
      } catch (titleErr) {
        console.error('Auto-title generation failed:', titleErr);
      }
    }

    // Generate follow-up suggestions (non-blocking for the done event)
    if (userSettings.suggestions_enabled) try {
      const lastUserMsg = historyMessages.filter(m => m.role === 'user').slice(-1)[0]?.content || userText;
      const suggestionsRes = await callOpenRouter(
        [
          { role: 'user', content: `Based on this conversation:\nUser: ${lastUserMsg.slice(0, 300)}\nAssistant: ${fullResponse.slice(0, 500)}\n\nSuggest 3 brief follow-up questions the user might ask. Return ONLY a JSON array of 3 strings, each under 50 chars. Russian language. Example: ["Расскажи подробнее", "А что если...", "Как это работает?"]` },
        ],
        { temperature: 0.8, max_tokens: 200 }
      );
      if (suggestionsRes.ok) {
        const sugData = await suggestionsRes.json() as any;
        const sugContent = sugData.choices?.[0]?.message?.content || '';
        const sugMatch = sugContent.match(/\[[\s\S]*\]/);
        if (sugMatch) {
          const suggestions: string[] = JSON.parse(sugMatch[0]);
          if (Array.isArray(suggestions) && suggestions.length > 0) {
            res.write(`data: ${JSON.stringify({ type: 'suggestions', suggestions: suggestions.slice(0, 3) })}\n\n`);
          }
        }
      }
    } catch (sugErr) {
      console.error('Suggestions generation failed:', sugErr);
    }

    // Факты сохраняем ДО финального done, чтобы /api/memory сразу видел новые записи
    if (userSettings.auto_memory) {
      try {
        const enrichedUserText = visionAnalysis
          ? `${userText}\n\n[Содержимое изображения: ${visionAnalysis}]`
          : userText;
        await extractMemoryFacts(userId, enrichedUserText, fullResponse);
      } catch (memErr) {
        console.error('Memory extraction failed before done:', memErr);
      }
    }

    // Извлекаем действия (напоминания, заметки) из сообщения — ждём результат для SSE
    let executedActions: Array<{type: string; text: string; datetime?: string}> = [];
    try {
      executedActions = await extractActionsFromChat(userId, userText);
      if (executedActions.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'actions', actions: executedActions })}\n\n`);
      }
    } catch (actErr) {
      console.error('Action extraction failed:', actErr);
    }

    res.write(`data: ${JSON.stringify({
      type: 'done',
      creditsCharged: cost,
      creditsRemaining: newBalance,
      sessionId,
      ...(sessionTitle ? { sessionTitle } : {}),
      ...(summarizedCount > 0 ? { summarizedCount } : {}),
    })}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
  }
  res.end();
});

/** POST /api/search — ручной веб-поиск */
app.post('/api/search', authMiddleware, async (req: AuthRequest, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query обязателен' });
    return;
  }
  const results = await webSearch(query);
  res.json({ query, results: results || 'Ничего не найдено' });
});

/** GET /api/chat/sessions/search — поиск по сообщениям */
app.get('/api/chat/sessions/search', authMiddleware, (req: AuthRequest, res) => {
  const query = (req.query.q as string || '').trim();
  if (!query || query.length < 2) {
    res.json({ results: [] });
    return;
  }

  const matches = dbHelpers.searchMessages(req.userId!, query, 20);

  // Group by session, keep first match per session
  const seen = new Set<string>();
  const results = [];
  for (const m of matches) {
    if (seen.has(m.session_id)) continue;
    seen.add(m.session_id);

    // Extract snippet around the match
    const lowerContent = m.content.toLowerCase();
    const idx = lowerContent.indexOf(query.toLowerCase());
    const start = Math.max(0, idx - 40);
    const end = Math.min(m.content.length, idx + query.length + 40);
    const snippet = (start > 0 ? '...' : '') + m.content.slice(start, end) + (end < m.content.length ? '...' : '');

    results.push({
      sessionId: m.session_id,
      title: m.title || null,
      snippet,
      matchedRole: m.role,
      createdAt: m.created_at,
    });
  }

  res.json({ results });
});

/** GET /api/chat/sessions — список сессий */
app.get('/api/chat/sessions', authMiddleware, (req: AuthRequest, res) => {
  const sessions = dbHelpers.getUserSessions(req.userId!);
  res.json({ sessions });
});

/** GET /api/billing/usage */
app.get('/api/billing/usage', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const balance = dbHelpers.getCredits(userId);
  const family = dbHelpers.getFamilyInfo(userId);
  res.json({
    credits: balance,
    totalUsed: Math.max(0, INITIAL_CREDITS - balance),
    subscriptionTier: 'free',
    dailyBonusAvailable: dbHelpers.isDailyBonusAvailable(userId),
    nextBonusAt: dbHelpers.getNextBonusAt(userId),
    family,
    balanceScope: family ? 'family' : 'personal',
  });
});

/** POST /api/billing/daily-bonus — Фича 3: рабочий daily bonus */
app.post('/api/billing/daily-bonus', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;

  if (!dbHelpers.isDailyBonusAvailable(userId)) {
    res.json({
      success: false,
      message: 'Бонус уже получен. Возвращайся завтра!',
      nextBonusAt: dbHelpers.getNextBonusAt(userId),
      balance: dbHelpers.getCredits(userId),
      dailyBonusAvailable: false,
    });
    return;
  }

  dbHelpers.claimDailyBonus(userId, DAILY_BONUS_AMOUNT);
  const newBalance = dbHelpers.getCredits(userId);

  res.json({
    success: true,
    message: `+${DAILY_BONUS_AMOUNT} кредитов! 🎁`,
    bonus: DAILY_BONUS_AMOUNT,
    balance: newBalance,
    dailyBonusAvailable: false,
    nextBonusAt: dbHelpers.getNextBonusAt(userId),
  });
});


// ==================== BILLING (Telegram Stars) ====================

const BILLING_PACKAGES = [
  { id: 'starter', credits: 50, stars: 50, label: '50 кредитов', description: '~25 вопросов', popular: false },
  { id: 'standard', credits: 200, stars: 150, label: '200 кредитов', description: '~100 вопросов', popular: true },
  { id: 'premium', credits: 500, stars: 300, label: '500 кредитов', description: '~250 вопросов', popular: false },
];

/** GET /api/billing/packages */
app.get('/api/billing/packages', authMiddleware, (req: AuthRequest, res) => {
  res.json(BILLING_PACKAGES);
});

/** POST /api/billing/create-invoice — creates Stars invoice via Bot API */
app.post('/api/billing/create-invoice', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { packageId } = req.body;

  const pkg = BILLING_PACKAGES.find(p => p.id === packageId);
  if (!pkg) {
    return res.status(400).json({ error: 'Неверный пакет' });
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(503).json({ error: 'Bot token не настроен' });
  }

  // Get user's telegram ID
  const userRow = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId) as any;
  if (!userRow?.telegram_id) {
    return res.status(400).json({ error: 'Telegram ID не найден' });
  }

  const invoiceId = crypto.randomUUID();
  const payload = JSON.stringify({ invoiceId, packageId: pkg.id, credits: pkg.credits, stars: pkg.stars });

  try {
    // Save pending payment
    db.prepare(
      'INSERT OR IGNORE INTO billing_payments (invoice_id, user_id, package_id, credits, stars, invoice_payload, status, credited, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'pending\', 0, datetime(\'now\'))'
    ).run(invoiceId, userId, pkg.id, pkg.credits, pkg.stars, payload);

    // Create invoice link via Telegram Bot API
    const botRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `🦍 ${pkg.label}`,
          description: `Пополнение баланса Виталика на ${pkg.credits} кредитов`,
          payload,
          currency: 'XTR',
          prices: [{ label: pkg.label, amount: pkg.stars }],
        }),
      }
    );

    if (!botRes.ok) {
      const errText = await botRes.text();
      console.error('createInvoiceLink error:', errText);
      return res.status(502).json({ error: 'Ошибка создания инвойса' });
    }

    const botData = await botRes.json() as any;
    const invoiceLink = botData.result;

    res.json({ invoiceLink, invoiceId, package: pkg });
  } catch (err: any) {
    console.error('Create invoice failed:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/** POST /api/billing/purchase — confirm purchase after Stars payment */
app.post('/api/billing/purchase', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { invoiceId, telegramPaymentChargeId } = req.body;

  if (!invoiceId) {
    return res.status(400).json({ error: 'invoiceId обязателен' });
  }

  try {
    const payment = db.prepare('SELECT * FROM billing_payments WHERE invoice_id = ? LIMIT 1').get(invoiceId) as any;

    if (!payment) {
      return res.status(404).json({ error: 'Платёж не найден' });
    }

    if (payment.user_id !== userId) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    if (payment.credited) {
      const balance = dbHelpers.getCredits(userId);
      return res.json({ success: true, balance, alreadyCredited: true });
    }

    // Credit the user
    dbHelpers.addCredits(userId, payment.credits);
    db.prepare(
      'UPDATE billing_payments SET status = \'paid\', credited = 1, telegram_payment_charge_id = COALESCE(?, telegram_payment_charge_id), paid_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE invoice_id = ?'
    ).run(telegramPaymentChargeId || null, invoiceId);

    const balance = dbHelpers.getCredits(userId);
    res.json({ success: true, balance, credits: payment.credits });
  } catch (err: any) {
    console.error('Confirm purchase failed:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ==================== FAMILY ACCESS ====================

app.post('/api/family/create', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const name = String(req.body?.name || '').trim();

  if (name.length < 2) {
    return res.status(400).json({ error: 'Название семьи должно быть не короче 2 символов' });
  }

  try {
    const family = dbHelpers.createFamily(userId, name);
    res.json({ success: true, family });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось создать семью' });
  }
});

app.post('/api/family/join', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const inviteCode = String(req.body?.inviteCode || '').trim();

  if (!inviteCode) {
    return res.status(400).json({ error: 'inviteCode обязателен' });
  }

  try {
    const family = dbHelpers.joinFamily(userId, inviteCode);
    res.json({ success: true, family });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось вступить в семью' });
  }
});

app.get('/api/family/info', authMiddleware, (req: AuthRequest, res) => {
  const family = dbHelpers.getFamilyInfo(req.userId!);
  res.json({ family });
});

app.post('/api/family/invite', authMiddleware, (req: AuthRequest, res) => {
  try {
    const inviteCode = dbHelpers.refreshFamilyInvite(req.userId!);
    const family = dbHelpers.getFamilyInfo(req.userId!);
    res.json({ success: true, inviteCode, family });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось обновить invite code' });
  }
});

app.delete('/api/family/leave', authMiddleware, (req: AuthRequest, res) => {
  try {
    const result = dbHelpers.leaveFamily(req.userId!);
    res.json({ ...result, success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось покинуть семью' });
  }
});

app.delete('/api/family/members/:telegram_id', authMiddleware, (req: AuthRequest, res) => {
  const telegramId = Number(req.params.telegram_id);
  if (!Number.isFinite(telegramId)) {
    return res.status(400).json({ error: 'Некорректный telegram_id' });
  }

  try {
    const removed = dbHelpers.removeFamilyMember(req.userId!, telegramId);
    if (!removed) {
      return res.status(404).json({ error: 'Участник не найден' });
    }
    const family = dbHelpers.getFamilyInfo(req.userId!);
    res.json({ success: true, family });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось исключить участника' });
  }
});

app.get('/api/family/memories', authMiddleware, (req: AuthRequest, res) => {
  try {
    const memories = dbHelpers.getFamilyMemories(req.userId!).map((memory) => ({
      id: memory.id,
      fact: memory.fact,
      category: memory.category,
      createdAt: new Date(memory.created_at).toISOString(),
    }));
    res.json({ memories });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось загрузить семейную память' });
  }
});

app.post('/api/family/memories', authMiddleware, (req: AuthRequest, res) => {
  const fact = String(req.body?.fact || '').trim();
  const category = String(req.body?.category || 'other').trim() || 'other';

  if (fact.length < 3) {
    return res.status(400).json({ error: 'fact обязателен (мин 3 символа)' });
  }

  try {
    const memory = dbHelpers.addFamilyMemory(req.userId!, fact, category);
    res.json({
      success: true,
      memory: {
        id: memory.id,
        fact: memory.fact,
        category: memory.category,
        createdAt: new Date(memory.created_at).toISOString(),
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Не удалось сохранить семейную память' });
  }
});

/** GET /api/memory */
app.get('/api/memory', authMiddleware, (req: AuthRequest, res) => {
  const userMemory = dbHelpers.getMemories(req.userId!);
  // Маппим формат для совместимости с фронтом (id, fact, category, createdAt)
  const formatted = userMemory.map(m => ({
    id: String(m.id),
    fact: m.fact,
    category: m.category,
    createdAt: m.created_at,
  }));
  res.json({ memories: formatted });
});

/** POST /api/memory — добавить факт вручную */
app.post('/api/memory', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { fact, category } = req.body;

  if (!fact || typeof fact !== 'string' || fact.length < 3) {
    res.status(400).json({ error: 'fact обязателен (мин 3 символа)' });
    return;
  }

  if (dbHelpers.getMemoryCount(userId) >= MAX_MEMORIES) {
    res.status(400).json({ error: 'Лимит памяти достигнут (50 фактов)' });
    return;
  }

  const existingMemories = dbHelpers.getMemories(userId);
  if (isDuplicateFact(existingMemories, fact)) {
    res.json({ success: true, message: 'Факт уже запомнен' });
    return;
  }

  const result = dbHelpers.addMemory(userId, fact, category || 'other');

  res.json({
    success: true,
    memory: {
      id: String(result.id),
      fact,
      category: category || 'other',
      createdAt: new Date().toISOString(),
    },
  });
});

/** DELETE /api/memory/:id */
app.delete('/api/memory/:id', authMiddleware, (req: AuthRequest, res) => {
  dbHelpers.deleteMemory(req.params.id, req.userId!);
  res.json({ success: true });
});

/** GET /api/stats — статистика пользователя */
app.get('/api/stats', authMiddleware, (req: AuthRequest, res) => {
  const stats = dbHelpers.getUserStats(req.userId!);
  res.json(stats);
});


// ==================== ADMIN ANALYTICS ====================

app.get('/api/admin/stats', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const totalUsers = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as any).cnt as number;
  const messagesToday = (db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE role = 'user' AND date(created_at) = date('now')").get() as any).cnt as number;
  const messagesYesterday = (db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE role = 'user' AND date(created_at) = date('now', '-1 day')").get() as any).cnt as number;
  const messagesWeek = (db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE role = 'user' AND created_at >= datetime('now', '-7 days')").get() as any).cnt as number;
  const activeUsersDay = (db.prepare("SELECT COUNT(DISTINCT user_id) as cnt FROM messages WHERE role = 'user' AND created_at >= datetime('now', '-1 day')").get() as any).cnt as number;
  const activeUsersWeek = (db.prepare("SELECT COUNT(DISTINCT user_id) as cnt FROM messages WHERE role = 'user' AND created_at >= datetime('now', '-7 days')").get() as any).cnt as number;

  const topUsers = db.prepare(`
    SELECT
      u.id as userId,
      u.telegram_id as telegramId,
      COALESCE(NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(u.username), ''), u.id) as displayName,
      COUNT(m.id) as messages
    FROM users u
    LEFT JOIN messages m ON m.user_id = u.id AND m.role = 'user'
    GROUP BY u.id, u.telegram_id, u.first_name, u.username
    ORDER BY messages DESC, u.created_at ASC
    LIMIT 5
  `).all() as Array<{ userId: string; telegramId: number | null; displayName: string; messages: number }>;

  const avgSession = db.prepare(`
    SELECT
      AVG(message_count) as avgMessages,
      AVG(duration_minutes) as avgMinutes
    FROM (
      SELECT
        s.id,
        COUNT(m.id) as message_count,
        MAX(0, ROUND((julianday(s.updated_at) - julianday(s.created_at)) * 24 * 60)) as duration_minutes
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      GROUP BY s.id
    )
  `).get() as { avgMessages?: number; avgMinutes?: number } | undefined;

  let popularSkills = db.prepare(`
    SELECT skill, COUNT(*) as count
    FROM skill_usage
    GROUP BY skill
    ORDER BY count DESC, skill ASC
    LIMIT 5
  `).all() as Array<{ skill: string; count: number }>;

  if (popularSkills.length === 0) {
    const sessionCount = (db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as any).cnt as number;
    popularSkills = [{ skill: 'default', count: sessionCount }];
  }

  res.json({
    totalUsers,
    messages: {
      today: messagesToday,
      yesterday: messagesYesterday,
      week: messagesWeek,
    },
    activeUsers: {
      day: activeUsersDay,
      week: activeUsersWeek,
    },
    topUsers,
    averageSessionMessages: Math.round(avgSession?.avgMessages || 0),
    averageSessionLengthMinutes: Math.round(avgSession?.avgMinutes || 0),
    popularSkills: popularSkills.map((item) => ({ ...item, skillLabel: getSkillLabel(item.skill) })),
  });
});

app.get('/api/admin/usage', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const counts = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM messages
    WHERE role = 'user' AND created_at >= datetime('now', '-29 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all() as Array<{ day: string; count: number }>;

  const countMap = new Map(counts.map((row) => [row.day, row.count]));
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = formatSqliteDayOffset(29 - index);
    return {
      date: day,
      messages: Number(countMap.get(day) || 0),
    };
  });

  res.json({ days });
});

app.get('/api/admin/users', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const users = db.prepare(`
    SELECT
      u.id as userId,
      u.telegram_id as telegramId,
      u.username,
      u.first_name as firstName,
      COALESCE(u.credits, 0) as credits,
      COALESCE(msg.messages, 0) as messages,
      MAX(COALESCE(msg.last_message_at, sess.last_session_at, u.updated_at, u.created_at)) as lastActive
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) as messages, MAX(created_at) as last_message_at
      FROM messages
      WHERE role = 'user'
      GROUP BY user_id
    ) msg ON msg.user_id = u.id
    LEFT JOIN (
      SELECT user_id, MAX(updated_at) as last_session_at
      FROM sessions
      GROUP BY user_id
    ) sess ON sess.user_id = u.id
    GROUP BY u.id, u.telegram_id, u.username, u.first_name, u.credits, msg.messages, msg.last_message_at, sess.last_session_at
    ORDER BY COALESCE(lastActive, u.created_at) DESC, messages DESC
  `).all() as Array<{
    userId: string;
    telegramId: number | null;
    username: string | null;
    firstName: string | null;
    credits: number;
    messages: number;
    lastActive: string | null;
  }>;

  res.json({
    users: users.map((user) => ({
      ...user,
      displayName: user.firstName || (user.username ? `@${user.username}` : user.userId),
    })),
  });
});

// ==================== GOOGLE DRIVE INTEGRATION ====================

/** Helper: refresh Google token if expired */
async function refreshGoogleToken(userId: string, conn: any): Promise<string> {
  if (!conn.refresh_token || !GDRIVE_CLIENT_SECRET) return conn.access_token;
  // Check if token is still valid (with 5min buffer)
  const expiresAt = new Date(conn.expires_at).getTime();
  if (Date.now() < expiresAt - 300000) return conn.access_token;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${conn.refresh_token}&client_id=${GDRIVE_CLIENT_ID}&client_secret=${GDRIVE_CLIENT_SECRET}`,
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json() as any;
    const newExpires = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    dbHelpers.saveCloudConnection(userId, 'gdrive', data.access_token, conn.refresh_token, newExpires);
    return data.access_token;
  } catch (err) {
    console.error('Google token refresh error:', err);
    return conn.access_token;
  }
}


function isGoogleDriveTextMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('csv');
}

async function readGoogleDriveFileContent(userId: string, conn: any, fileId: string, maxChars = 10000): Promise<{ content: string; mimeType?: string; binary?: boolean; truncated?: boolean }> {
  const token = await refreshGoogleToken(userId, conn);

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name,size`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!metaRes.ok) throw new Error(`Google Drive metadata error: ${metaRes.status}`);

  const meta = await metaRes.json() as any;
  const googleDocTypes: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
  };

  let fileContent: string;
  if (googleDocTypes[meta.mimeType]) {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(googleDocTypes[meta.mimeType])}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!exportRes.ok) throw new Error(`Google Drive export error: ${exportRes.status}`);
    fileContent = await exportRes.text();
  } else if (isGoogleDriveTextMimeType(meta.mimeType)) {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!dlRes.ok) throw new Error(`Google Drive download error: ${dlRes.status}`);
    fileContent = await dlRes.text();
  } else {
    return { content: '[Бинарный файл — текстовое содержимое недоступно]', mimeType: meta.mimeType, binary: true };
  }

  return {
    content: fileContent.slice(0, maxChars),
    mimeType: meta.mimeType,
    truncated: fileContent.length > maxChars,
  };
}

/** GET /api/gdrive/connect — начать OAuth flow */
app.get('/api/gdrive/connect', authMiddleware, (req: AuthRequest, res) => {
  if (!GDRIVE_CLIENT_ID) {
    res.status(500).json({ error: 'Google Drive не настроен' });
    return;
  }
  const state = Buffer.from(JSON.stringify({ userId: req.userId })).toString('base64url');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${GDRIVE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GDRIVE_REDIRECT_URI)}&scope=${encodeURIComponent(GDRIVE_SCOPES)}&state=${state}&access_type=offline&prompt=consent`;
  res.json({ authUrl });
});

/** GET /api/gdrive/callback — OAuth callback */
app.get('/api/gdrive/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) { res.status(400).send('Ошибка авторизации'); return; }

  try {
    const stateData = JSON.parse(Buffer.from(state as string, 'base64url').toString());
    const userId = stateData.userId;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&code=${code}&client_id=${GDRIVE_CLIENT_ID}&client_secret=${GDRIVE_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(GDRIVE_REDIRECT_URI)}`,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Google OAuth error:', err);
      res.status(500).send('Ошибка получения токена');
      return;
    }

    const tokenData = await tokenRes.json() as any;
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

    dbHelpers.saveCloudConnection(
      userId, 'gdrive',
      tokenData.access_token,
      tokenData.refresh_token || '',
      expiresAt
    );

    console.log('Google Drive connected for user:', userId);

    res.send(`
      <html><body style="background:#1a1a1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">✅</div>
          <div style="font-size:18px">Google Drive подключён!</div>
          <div style="font-size:14px;color:#888;margin-top:8px">Можете закрыть это окно</div>
          <script>setTimeout(() => window.close(), 2000)</script>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error('Google callback error:', err);
    res.status(500).send('Ошибка');
  }
});

/** GET /api/gdrive/status — статус подключения */
app.get('/api/gdrive/status', authMiddleware, (req: AuthRequest, res) => {
  const conn = dbHelpers.getCloudConnection(req.userId!, 'gdrive');
  res.json({ connected: !!conn, connectedAt: conn?.connected_at });
});

/** DELETE /api/gdrive/disconnect — отключить */
app.delete('/api/gdrive/disconnect', authMiddleware, (req: AuthRequest, res) => {
  dbHelpers.deleteCloudConnection(req.userId!, 'gdrive');
  res.json({ success: true });
});

/** GET /api/gdrive/files — список файлов */
app.get('/api/gdrive/files', authMiddleware, async (req: AuthRequest, res) => {
  const conn = dbHelpers.getCloudConnection(req.userId!, 'gdrive');
  if (!conn) { res.status(400).json({ error: 'Google Drive не подключён' }); return; }

  const folderId = (req.query.folderId as string) || 'root';
  const limit = parseInt(req.query.limit as string) || 20;

  try {
    const token = await refreshGoogleToken(req.userId!, conn);
    const q = folderId === 'root' ? "'root' in parents and trashed=false" : `'${folderId}' in parents and trashed=false`;
    const apiRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${limit}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,size,modifiedTime)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!apiRes.ok) {
      console.error('Google Drive API error:', apiRes.status);
      res.status(apiRes.status).json({ error: 'Ошибка Google Drive' });
      return;
    }

    const data = await apiRes.json() as any;
    const items = (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType === 'application/vnd.google-apps.folder' ? 'dir' : 'file',
      size: parseInt(f.size || '0'),
      modified: f.modifiedTime,
      mimeType: f.mimeType,
    }));

    res.json({ items, folderId });
  } catch (err) {
    console.error('Google Drive files error:', err);
    res.status(500).json({ error: 'Ошибка' });
  }
});

/** GET /api/gdrive/read — прочитать текстовое содержимое файла */
app.get('/api/gdrive/read', authMiddleware, async (req: AuthRequest, res) => {
  const conn = dbHelpers.getCloudConnection(req.userId!, 'gdrive');
  if (!conn) { res.status(400).json({ error: 'Google Drive не подключён' }); return; }

  const fileId = req.query.fileId as string;
  if (!fileId) { res.status(400).json({ error: 'fileId обязателен' }); return; }

  try {
    const fileData = await readGoogleDriveFileContent(req.userId!, conn, fileId, 10000);
    res.json(fileData);
  } catch (err) {
    console.error('Google Drive read error:', err);
    res.status(500).json({ error: 'Ошибка чтения файла' });
  }
});

/** GET /api/cloud/connections — список подключений */
app.get('/api/cloud/connections', authMiddleware, (req: AuthRequest, res) => {
  const connections = dbHelpers.getCloudConnections(req.userId!);
  res.json({ connections });
});

/** GET /api/files — список файлов пользователя */
app.get('/api/files', authMiddleware, (req: AuthRequest, res) => {
  const files = dbHelpers.getUserFiles(req.userId!);
  res.json({ files });
});

/** GET /api/files/:id/download — скачать файл (auth via header or query ?token=) */
app.get('/api/files/:id/download', (req: any, res) => {
  // Support token via query param for direct downloads
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string;
  const tokenStr = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!tokenStr) { res.status(401).json({ error: 'Требуется авторизация' }); return; }
  try {
    const payload = jwt.verify(tokenStr, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
  } catch { res.status(401).json({ error: 'Невалидный токен' }); return; }
  const file = dbHelpers.getFileById(parseInt(req.params.id));
  if (!file || file.user_id !== req.userId) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }
  if (!file.data) {
    res.status(404).json({ error: 'Данные файла не сохранены' });
    return;
  }
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.send(file.data);
});

// ==================== BOOKMARKS ====================

app.post('/api/chat/bookmark', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { session_id, text } = req.body;
  if (!text) { res.status(400).json({ error: 'text обязателен' }); return; }
  const id = dbHelpers.addBookmark(userId, session_id || null, text);
  res.json({ success: true, id });
});

app.get('/api/chat/bookmarks', authMiddleware, (req: AuthRequest, res) => {
  const bookmarks = dbHelpers.getBookmarks(req.userId!);
  res.json({ bookmarks });
});

app.delete('/api/chat/bookmark/:id', authMiddleware, (req: AuthRequest, res) => {
  dbHelpers.deleteBookmark(Number(req.params.id), req.userId!);
  res.json({ success: true });
});

// ==================== FEEDBACK ====================

app.post('/api/chat/feedback', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { session_id, text, rating } = req.body;
  if (!text || !['up', 'down'].includes(rating)) {
    res.status(400).json({ error: 'text и rating (up|down) обязательны' });
    return;
  }
  const id = dbHelpers.addFeedback(userId, session_id || null, text, rating);
  res.json({ success: true, id });
});

/** Health check */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vitalik-proxy', storage: 'sqlite' });
});

// ==================== TTS (Gemini TTS) ====================

const GEMINI_TTS_KEY = process.env.GEMINI_TTS_KEY || '';
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Orus';

async function synthesizeGeminiSpeech(text: string): Promise<Buffer> {
  if (!GEMINI_TTS_KEY) {
    throw new Error('GEMINI_TTS_KEY not set');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_TTS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: text.slice(0, 2000) }] }],
      generationConfig: {
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: {
            prebuilt_voice_config: { voice_name: GEMINI_TTS_VOICE },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini TTS ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as any;
  const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Gemini TTS returned no audio');
  }

  return Buffer.from(base64Audio, 'base64');
}

app.post('/api/tts', ttsLimiter, authMiddleware, async (req, res) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: 'text обязателен' });
    return;
  }

  try {
    const ttsText = String(text).slice(0, 2000);
    const { spawn } = await import('child_process');
    const fs = await import('fs');
    const crypto = await import('crypto');

    const stamp = `${Date.now()}_${crypto.randomUUID()}`;
    const tmpPcm = `/tmp/tts_${stamp}.pcm`;
    const tmpOgg = `/tmp/tts_${stamp}.ogg`;

    const pcmBuffer = await synthesizeGeminiSpeech(ttsText);
    fs.writeFileSync(tmpPcm, pcmBuffer);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 's16le',
        '-ar', '24000',
        '-ac', '1',
        '-i', tmpPcm,
        '-c:a', 'libopus',
        '-b:a', '48k',
        tmpOgg,
      ]);
      const timer = setTimeout(() => { ffmpeg.kill(); reject(new Error('ffmpeg timeout')); }, 20000);
      ffmpeg.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)); });
      ffmpeg.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    const oggBuf = fs.readFileSync(tmpOgg);

    try { fs.unlinkSync(tmpPcm); } catch {}
    try { fs.unlinkSync(tmpOgg); } catch {}

    res.json({
      audio: oggBuf.toString('base64'),
      format: 'ogg',
      mimeType: 'audio/ogg',
      codec: 'opus',
      sampleRate: 24000,
    });
  } catch (err: any) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== DASHBOARD ====================

// --- Weather: Open-Meteo integration with 30min cache ---

interface WeatherData {
  temp: number;
  description: string;
  emoji: string;
  city: string;
}

interface WeatherCache {
  data: WeatherData;
  timestamp: number;
}

const weatherCache = new Map<string, WeatherCache>();
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const CITY_COORDS: Record<string, { lat: number; lon: number; tz: string }> = {
  'москва': { lat: 55.75, lon: 37.62, tz: 'Europe/Moscow' },
  'санкт-петербург': { lat: 59.93, lon: 30.32, tz: 'Europe/Moscow' },
  'петербург': { lat: 59.93, lon: 30.32, tz: 'Europe/Moscow' },
  'спб': { lat: 59.93, lon: 30.32, tz: 'Europe/Moscow' },
  'новосибирск': { lat: 55.03, lon: 82.92, tz: 'Asia/Novosibirsk' },
  'екатеринбург': { lat: 56.84, lon: 60.60, tz: 'Asia/Yekaterinburg' },
  'казань': { lat: 55.79, lon: 49.11, tz: 'Europe/Moscow' },
  'нижний новгород': { lat: 56.33, lon: 44.00, tz: 'Europe/Moscow' },
  'краснодар': { lat: 45.04, lon: 38.98, tz: 'Europe/Moscow' },
  'сочи': { lat: 43.60, lon: 39.73, tz: 'Europe/Moscow' },
  'ростов-на-дону': { lat: 47.23, lon: 39.72, tz: 'Europe/Moscow' },
  'уфа': { lat: 54.74, lon: 55.97, tz: 'Asia/Yekaterinburg' },
  'красноярск': { lat: 56.01, lon: 92.87, tz: 'Asia/Krasnoyarsk' },
  'воронеж': { lat: 51.67, lon: 39.18, tz: 'Europe/Moscow' },
  'пермь': { lat: 58.01, lon: 56.25, tz: 'Asia/Yekaterinburg' },
  'волгоград': { lat: 48.71, lon: 44.50, tz: 'Europe/Volgograd' },
  'минск': { lat: 53.90, lon: 27.57, tz: 'Europe/Minsk' },
  'киев': { lat: 50.45, lon: 30.52, tz: 'Europe/Kiev' },
  'алматы': { lat: 43.24, lon: 76.95, tz: 'Asia/Almaty' },
  'ташкент': { lat: 41.30, lon: 69.28, tz: 'Asia/Tashkent' },
};

function weatherCodeToInfo(code: number): { emoji: string; description: string } {
  if (code === 0) return { emoji: '☀️', description: 'Ясно' };
  if (code <= 3) return { emoji: '⛅', description: 'Облачно' };
  if (code <= 48) return { emoji: '🌫️', description: 'Туман' };
  if (code <= 57) return { emoji: '🌧️', description: 'Морось' };
  if (code <= 67) return { emoji: '🌧️', description: 'Дождь' };
  if (code <= 77) return { emoji: '🌨️', description: 'Снег' };
  if (code <= 82) return { emoji: '🌧️', description: 'Ливень' };
  if (code <= 99) return { emoji: '⛈️', description: 'Гроза' };
  return { emoji: '🌡️', description: 'Неизвестно' };
}

function findUserCity(userId: string): string | null {
  const locationMemories = db.prepare(
    `SELECT fact, category FROM memories WHERE user_id = ? AND (category IN ('location', 'city') OR fact LIKE '%живу в%' OR fact LIKE '%город%' OR fact LIKE '%city%') ORDER BY created_at DESC LIMIT 5`
  ).all(userId) as Array<{ fact: string; category: string }>;

  for (const m of locationMemories) {
    const lower = m.fact.toLowerCase();
    for (const city of Object.keys(CITY_COORDS)) {
      if (lower.includes(city)) return city;
    }
  }
  return null;
}

async function fetchWeather(userId: string): Promise<WeatherData | null> {
  const cached = weatherCache.get(userId);
  if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL) {
    return cached.data;
  }

  const cityName = findUserCity(userId);
  const coords = CITY_COORDS[cityName || 'москва'] || CITY_COORDS['москва'];
  const displayCity = cityName
    ? cityName.charAt(0).toUpperCase() + cityName.slice(1)
    : 'Москва';

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&timezone=${encodeURIComponent(coords.tz)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const json = await resp.json() as any;
    const temp = Math.round(json.current.temperature_2m);
    const code = json.current.weather_code as number;
    const info = weatherCodeToInfo(code);

    const data: WeatherData = { temp, description: info.description, emoji: info.emoji, city: displayCity };
    weatherCache.set(userId, { data, timestamp: Date.now() });
    return data;
  } catch (e) {
    console.error('Weather fetch error:', e);
    return null;
  }
}

function calculateStreak(userId: string): number {
  const rows = db.prepare(
    `SELECT DISTINCT date(updated_at) as day FROM sessions WHERE user_id = ? ORDER BY day DESC LIMIT 60`
  ).all(userId) as Array<{ day: string }>;

  if (rows.length === 0) return 0;

  const today = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let expected = new Date(today);

  // If user hasn't been active today, start from yesterday
  if (rows[0].day !== today) {
    expected.setDate(expected.getDate() - 1);
    if (rows[0].day !== expected.toISOString().slice(0, 10)) return 0;
  }

  for (const row of rows) {
    if (row.day === expected.toISOString().slice(0, 10)) {
      streak++;
      expected.setDate(expected.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function getNextReminder(userId: string): { title: string; dueAt: string; countdown: string } | null {
  const now = new Date().toISOString();
  const r = db.prepare(
    `SELECT title, due_date FROM reminders
     WHERE user_id = ? AND completed = 0 AND due_date IS NOT NULL AND due_date > ?
     ORDER BY due_date ASC LIMIT 1`
  ).get(userId, now) as { title: string; due_date: string } | undefined;

  if (!r) return null;

  const diffMs = new Date(r.due_date).getTime() - Date.now();
  if (diffMs <= 0) return null;

  const mins = Math.floor(diffMs / 60000);
  let countdown: string;
  if (mins < 60) countdown = `Через ${mins} мин`;
  else if (mins < 1440) countdown = `Через ${Math.floor(mins / 60)} ч`;
  else countdown = `Через ${Math.floor(mins / 1440)} дн`;

  return { title: r.title, dueAt: r.due_date, countdown };
}

const DAILY_TIPS: string[] = [
  'Я могу запоминать факты о тебе — просто расскажи что-нибудь!',
  'Попроси меня создать напоминание — я не забуду.',
  'Я умею анализировать изображения — просто прикрепи фото.',
  'Спроси меня рецепт — я подберу под твои предпочтения.',
  'Я могу помочь написать текст, письмо или пост.',
  'Попробуй загрузить PDF — я прочитаю и проанализирую его.',
  'Спроси совет по программированию — я знаю много языков.',
  'Я могу помочь с переводом текста на разные языки.',
  'Попроси составить план — поездки, проекта или дня.',
  'Я запоминаю контекст беседы и могу вернуться к теме.',
  'Ты можешь подключить Google Drive и работать с файлами.',
  'Я могу объяснить сложные темы простым языком.',
  'Попроси меня создать список — покупок, дел или идей.',
  'Я могу помочь с математикой и расчётами.',
  'Спроси про любую тему — от науки до кулинарии.',
  'Я умею работать с таблицами и CSV-файлами.',
  'Попроси меня проверить текст на ошибки.',
  'Я могу сгенерировать идеи для подарков или мероприятий.',
  'Ты можешь сохранять важные ответы в закладки.',
  'Я могу помочь с подготовкой к собеседованию.',
  'Попроси краткое содержание длинного текста — я сжму его.',
  'Я могу помочь составить резюме или сопроводительное письмо.',
];

app.get('/api/dashboard', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;

  // Greeting based on time of day (Moscow time UTC+3)
  const now = new Date();
  const moscowHour = (now.getUTCHours() + 3) % 24;
  let greetingPrefix = 'Добрый день';
  if (moscowHour >= 5 && moscowHour < 12) greetingPrefix = 'Доброе утро';
  else if (moscowHour >= 12 && moscowHour < 18) greetingPrefix = 'Добрый день';
  else if (moscowHour >= 18 && moscowHour < 23) greetingPrefix = 'Добрый вечер';
  else greetingPrefix = 'Доброй ночи';

  const user = db.prepare('SELECT first_name FROM users WHERE id = ?').get(userId) as any;
  const userName = user?.first_name || null;

  // Fetch weather (async, with cache)
  const weather = await fetchWeather(userId);

  // Personalized greeting with weather
  let greeting: string;
  if (userName && weather) {
    greeting = `${greetingPrefix}, ${userName}! Сейчас в ${weather.city} ${weather.temp > 0 ? '+' : ''}${weather.temp}°C ${weather.emoji}`;
  } else if (userName) {
    greeting = `${greetingPrefix}, ${userName}! 🦍`;
  } else {
    greeting = `${greetingPrefix}! 🦍`;
  }

  // Reminders: next 5 upcoming (not completed), sorted by due_date
  const reminders = db.prepare(
    `SELECT id, title, due_date, created_at FROM reminders
     WHERE user_id = ? AND completed = 0
     ORDER BY CASE WHEN due_date IS NOT NULL THEN due_date ELSE '9999-12-31' END ASC
     LIMIT 5`
  ).all(userId) as Array<{ id: number; title: string; due_date: string | null; created_at: string }>;

  // Memory stats
  const totalFacts = (db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?').get(userId) as any).cnt as number;
  const topCategories = db.prepare(
    `SELECT category as name, COUNT(*) as count FROM memories WHERE user_id = ? GROUP BY category ORDER BY count DESC LIMIT 5`
  ).all(userId) as Array<{ name: string; count: number }>;

  // Recent chats: last 3 sessions with titles
  const recentChats = db.prepare(
    `SELECT id, title, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 3`
  ).all(userId) as Array<{ id: string; title: string; updated_at: string }>;

  // Daily tip
  const dailyTip = DAILY_TIPS[Math.floor(Math.random() * DAILY_TIPS.length)];

  // Streak
  const streak = calculateStreak(userId);

  // Next reminder countdown
  const nextReminder = getNextReminder(userId);

  // Quick stats
  const todayStr = now.toISOString().slice(0, 10);
  const chatsToday = (db.prepare(
    `SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ? AND date(updated_at) = ?`
  ).get(userId, todayStr) as any).cnt as number;
  const activeReminders = (db.prepare(
    `SELECT COUNT(*) as cnt FROM reminders WHERE user_id = ? AND completed = 0`
  ).get(userId) as any).cnt as number;

  res.json({
    greeting,
    reminders: reminders.map(r => ({
      id: r.id,
      title: r.title,
      dueAt: r.due_date,
      createdAt: r.created_at,
    })),
    memoryStats: { totalFacts, topCategories },
    recentChats: recentChats.map(s => ({
      id: s.id,
      title: s.title || 'Новый чат',
      updatedAt: s.updated_at,
    })),
    dailyTip,
    weather,
    streak,
    nextReminder,
    quickStats: { chatsToday, totalFacts, activeReminders },
  });
});

// ==================== REMINDERS CRUD ====================

app.get('/api/reminders', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const rows = dbHelpers.getReminders(userId) as Array<any>;
  res.json({
    reminders: rows.map((r: any) => ({
      id: String(r.id),
      title: r.title,
      notes: r.notes || null,
      dueAt: r.due_date || null,
      completed: r.completed === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at || r.created_at,
    })),
  });
});

app.post('/api/reminders', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { title, dueAt, notes } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }
  const result = dbHelpers.addReminder(userId, title, dueAt || undefined, notes || undefined);
  if (!result.success) {
    return res.status(500).json({ error: 'Failed to create reminder' });
  }
  const row = dbHelpers.getReminderById(result.id!, userId);
  res.json({
    reminder: {
      id: String(row.id),
      title: row.title,
      notes: row.notes || null,
      dueAt: row.due_date || null,
      completed: row.completed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    },
  });
});

app.patch('/api/reminders/:id', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const patch: Record<string, any> = {};
  if (req.body.title !== undefined) patch.title = req.body.title;
  if (req.body.dueAt !== undefined) patch.due_date = req.body.dueAt;
  if (req.body.notes !== undefined) patch.notes = req.body.notes;
  if (req.body.completed !== undefined) patch.completed = req.body.completed;

  const updated = dbHelpers.updateReminder(id, userId, patch);
  if (!updated) return res.status(404).json({ error: 'Reminder not found' });

  const row = dbHelpers.getReminderById(id, userId);
  res.json({
    reminder: {
      id: String(row.id),
      title: row.title,
      notes: row.notes || null,
      dueAt: row.due_date || null,
      completed: row.completed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    },
  });
});

app.delete('/api/reminders/:id', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const deleted = dbHelpers.deleteReminder(id, userId);
  res.json({ success: deleted });
});

// ==================== PUSH NOTIFICATIONS ====================

app.get('/api/push/vapid-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  dbHelpers.savePushSubscription(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  res.json({ success: true });
});

app.delete('/api/push/unsubscribe', authMiddleware, (req: AuthRequest, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  dbHelpers.deletePushSubscription(endpoint);
  res.json({ success: true });
});

// ==================== PUSH CRON: check due reminders every 60s ====================

function checkDueReminders() {
  try {
    const dueReminders = dbHelpers.getDueReminders();
    for (const reminder of dueReminders) {
      const subs = dbHelpers.getPushSubscriptions(reminder.user_id);
      const payload = JSON.stringify({
        title: 'Напоминание',
        body: reminder.title,
        icon: '/icon-192.png',
        data: { url: '/reminders', reminderId: reminder.id },
      });

      for (const sub of subs) {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        };
        webpush.sendNotification(pushSub, payload).catch((err: any) => {
          console.error('Push send error:', err.statusCode || err.message);
          if (err.statusCode === 404 || err.statusCode === 410) {
            dbHelpers.deletePushSubscription(sub.endpoint);
          }
        });
      }

      // Telegram fallback — ALWAYS send via Telegram (Mini App can't receive push)
      try {
        const user = db.prepare("SELECT telegram_id FROM users WHERE id = ?").get(reminder.user_id) as any;
        if (user?.telegram_id && user.telegram_id > 0) {
          sendTelegramReminder(user.telegram_id, reminder.title);
          console.log(`[REMINDER] Telegram notification sent to ${user.telegram_id}: "${reminder.title}"`);
        }
      } catch (tgErr: any) {
        console.error('[REMINDER] Telegram fallback error:', tgErr.message);
      }
      dbHelpers.markReminderNotified(reminder.id);
      console.log(`Push sent for reminder #${reminder.id}: "${reminder.title}"`);
    }
  } catch (err) {
    console.error('checkDueReminders error:', err);
  }
}

// Start reminder cron ALWAYS (Telegram fallback doesn't need VAPID)
setInterval(checkDueReminders, 60_000);
console.log('   Reminder cron: checking every 60s (Telegram + Push)');
// Also check immediately on startup after 10s
setTimeout(checkDueReminders, 10_000);

// ==================== USER SETTINGS ====================

app.get('/api/settings', authMiddleware, (req: AuthRequest, res) => {
  try {
    const settings = dbHelpers.getUserSettings(req.userId!);
    res.json(settings);
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/settings', authMiddleware, (req: AuthRequest, res) => {
  try {
    const patch = req.body as Partial<Omit<dbHelpers.UserSettings, 'user_id'>>;
    const updated = dbHelpers.updateUserSettings(req.userId!, patch);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/settings/data', authMiddleware, (req: AuthRequest, res) => {
  try {
    dbHelpers.deleteAllUserData(req.userId!);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/settings/data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/settings/export', authMiddleware, (req: AuthRequest, res) => {
  try {
    const data = dbHelpers.exportAllUserData(req.userId!);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="vitalik-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  } catch (err) {
    console.error('GET /api/settings/export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ЭКСПОРТ И ШАРИНГ ЧАТОВ ====================

function buildSharedHTML(title: string, dateStr: string, messages: Array<{ role: string; content: string; created_at: string }>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renderMd = (text: string) => {
    return esc(text)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:#1e1e1e;padding:12px;border-radius:8px;overflow-x:auto;font-size:13px;border:1px solid #333;margin:8px 0">$2</pre>')
      .replace(/`([^`]+)`/g, '<code style="background:#2a2a2a;color:#7C5CFC;padding:2px 6px;border-radius:4px;font-size:13px">$1</code>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<div style="font-size:16px;font-weight:600;margin:12px 0 4px">$1</div>')
      .replace(/^## (.+)$/gm, '<div style="font-size:18px;font-weight:600;margin:14px 0 6px">$1</div>')
      .replace(/^# (.+)$/gm, '<div style="font-size:20px;font-weight:700;margin:16px 0 8px">$1</div>')
      .replace(/^[-*\u2022] (.+)$/gm, '<div style="padding-left:16px">\u2022 $1</div>')
      .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:16px">$&</div>')
      .replace(/\n/g, '<br>');
  };

  const msgHtml = messages.map(m => {
    const isUser = m.role === 'user';
    const time = m.created_at ? new Date(m.created_at + 'Z').toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div style="display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};margin-bottom:12px">
      <div style="max-width:80%;padding:12px 16px;border-radius:${isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px'};background:${isUser ? '#1a3a3f' : '#242424'};color:#e0e0e0;font-size:14px;line-height:1.6">
        ${!isUser ? '<div style="font-size:12px;color:#7C5CFC;margin-bottom:4px;font-weight:500">\u2726 \u0412\u0438\u0442\u0430\u043b\u0438\u043a</div>' : ''}
        <div>${isUser ? esc(m.content).replace(/\n/g, '<br>') : renderMd(m.content)}</div>
        <div style="font-size:10px;color:#555;margin-top:4px;text-align:right">${time}</div>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh}</style>
</head><body>
<div style="max-width:680px;margin:0 auto;padding:16px">
  <div style="text-align:center;padding:20px 0;border-bottom:1px solid #2a2a2a;margin-bottom:20px">
    <div style="font-size:28px;margin-bottom:8px">\uD83E\uDD8D</div>
    <div style="font-size:18px;font-weight:600;color:#e0e0e0">\u0412\u0438\u0442\u0430\u043b\u0438\u043a \u2014 \u0420\u0430\u0437\u0433\u043e\u0432\u043e\u0440 \u043e\u0442 ${esc(dateStr)}</div>
    <div style="font-size:12px;color:#555;margin-top:4px">${messages.length} \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439</div>
  </div>
  <div style="padding-bottom:20px">${msgHtml}</div>
  <div style="text-align:center;padding:20px 0;border-top:1px solid #2a2a2a;margin-top:20px">
    <a href="https://t.me/Vitalik_assist_bot" style="color:#7C5CFC;text-decoration:none;font-size:14px">\u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u0412\u0438\u0442\u0430\u043b\u0438\u043a\u0430 \u2192 t.me/Vitalik_assist_bot</a>
  </div>
</div></body></html>`;
}

app.get('/api/chat/sessions/:sessionId/export', authMiddleware, (req: AuthRequest, res) => {
  const { sessionId } = req.params;
  const format = (req.query.format as string) || 'text';

  const session = dbHelpers.getSession(sessionId);
  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  const messages = dbHelpers.getSessionMessages(sessionId);
  if (messages.length === 0) {
    res.status(404).json({ error: 'Нет сообщений' });
    return;
  }

  const dateStr = new Date(session.created_at + 'Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const title = session.title || '\u0427\u0430\u0442';

  if (format === 'html') {
    const html = buildSharedHTML(title, dateStr, messages);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${sessionId.slice(0, 8)}.html"`);
    res.send(html);
  } else {
    let text = `\uD83E\uDD8D \u0412\u0438\u0442\u0430\u043b\u0438\u043a \u2014 ${title}\n\u0414\u0430\u0442\u0430: ${dateStr}\n${'─'.repeat(40)}\n\n`;
    for (const m of messages) {
      const who = m.role === 'user' ? '\uD83D\uDC64 \u0412\u044b' : '\uD83E\uDD8D \u0412\u0438\u0442\u0430\u043b\u0438\u043a';
      const time = m.created_at ? new Date(m.created_at + 'Z').toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
      text += `${who} (${time}):\n${m.content}\n\n`;
    }
    text += `${'─'.repeat(40)}\n\u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u0412\u0438\u0442\u0430\u043b\u0438\u043a\u0430 \u2192 t.me/Vitalik_assist_bot\n`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  }
});

app.post('/api/chat/sessions/:sessionId/share', authMiddleware, (req: AuthRequest, res) => {
  const { sessionId } = req.params;
  const session = dbHelpers.getSession(sessionId);
  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  const { token, expiresAt } = dbHelpers.createShareLink(sessionId);
  res.json({ token, url: `/api/shared/${token}`, expiresAt });
});

app.delete('/api/chat/sessions/:sessionId/share', authMiddleware, (req: AuthRequest, res) => {
  const { sessionId } = req.params;
  const session = dbHelpers.getSession(sessionId);
  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  dbHelpers.revokeShareLink(sessionId);
  res.json({ ok: true });
});

app.get('/api/shared/:token', (req, res) => {
  const { token } = req.params;
  const share = dbHelpers.getShareByToken(token);
  if (!share) {
    res.status(404).send('<html><body style="background:#1a1a1a;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div style="text-align:center"><div style="font-size:48px;margin-bottom:16px">\uD83E\uDD8D</div><div>\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430 \u0438\u043b\u0438 \u0443\u0441\u0442\u0430\u0440\u0435\u043b\u0430</div></div></body></html>');
    return;
  }

  const expiresAt = new Date(share.expires_at + 'Z').getTime();
  if (Date.now() > expiresAt) {
    res.status(410).send('<html><body style="background:#1a1a1a;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div style="text-align:center"><div style="font-size:48px;margin-bottom:16px">\uD83E\uDD8D</div><div>\u0421\u0440\u043e\u043a \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0441\u0441\u044b\u043b\u043a\u0438 \u0438\u0441\u0442\u0451\u043a</div></div></body></html>');
    return;
  }

  const session = dbHelpers.getSession(share.session_id);
  if (!session) {
    res.status(404).send('Not found');
    return;
  }

  const messages = dbHelpers.getSessionMessages(share.session_id);
  const dateStr = new Date(session.created_at + 'Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const title = session.title || '\u0427\u0430\u0442';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildSharedHTML(title, dateStr, messages));
});

// ==================== СЦЕНАРИИ ====================

app.get('/api/scenarios', (_req, res) => {
  res.json(scenarios);
});

app.post('/api/scenarios/:id/run', authMiddleware, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) {
    res.status(404).json({ error: 'Сценарий не найден' });
    return;
  }

  const answers: Record<string, string> = req.body.answers || {};

  // Build prompt by substituting {{stepId}} placeholders
  let prompt = scenario.resultPrompt;
  for (const step of scenario.steps) {
    const value = answers[step.id] || (step.optional ? 'не указано' : '—');
    prompt = prompt.replaceAll(`{{${step.id}}}`, value);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const response = await callOpenRouter(
      [{ role: 'user', content: prompt }],
      { model: CHAT_MODEL, temperature: 0.7, max_tokens: 2048, stream: true }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Scenarios LLM error:', response.status, errBody);
      res.write(`data: ${JSON.stringify({ type: 'error', error: `API: ${response.status}` })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No stream' })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
          }
        } catch {
          // skip malformed
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', fullResponse, scenarioId: id })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    const errMsg = err?.message || 'Ошибка сценария';
    console.error('Scenario run error:', errMsg);
    res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
    res.end();
  }
});

// ==================== СТАРТ ====================

// ==================== HEALTH ====================
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'gembot',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    timestamp: new Date().toISOString(),
  });
});

// ==================== BLOCKCHAIN ROUTES ====================
// Auth-protected blockchain routes (check-nft and verify-memory are public)
app.use("/api/blockchain", (req: any, res: any, next: any) => {
  if (req.path === "/check-nft" || req.path === "/verify-memory") return next();
  return authMiddleware(req, res, next);
}, blockchainRoutes);
app.listen(PORT, () => {
  console.log(`🤖 GemBot API запущен на порту ${PORT} [SQLite]`);
  console.log(`   LLM Provider: ${activeProvider.name} (${ACTIVE_PROVIDER})`);
  console.log(`   Chat: ${CHAT_MODEL} | Pro: ${CHAT_MODEL_PRO} | Vision: ${VISION_MODEL}`);
  console.log(`   POST /api/chat/send — LLM с памятью и system prompt`);
  console.log(`   POST /api/chat/upload — загрузка файлов`);
  console.log(`   POST /api/billing/daily-bonus — ежедневный бонус`);
  console.log(`   GET  /api/memory — факты о пользователе`);
  console.log(`   POST /api/memory — добавить факт вручную`);
  console.log(`   GET  /api/chat/sessions — список сессий`);
  console.log(`   GET  /api/stats — статистика пользователя`);
  console.log(`   Push notifications: ${VAPID_PUBLIC_KEY ? 'ENABLED' : 'DISABLED (no VAPID keys)'}`);
  console.log(`   GET  /api/chat/sessions/:id/export — экспорт чата`);
  console.log(`   POST /api/chat/sessions/:id/share — создать share link`);
  console.log(`   GET  /api/shared/:token — публичная страница`);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', () => {
  console.log('\nGemBot shutting down gracefully...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('GemBot received SIGTERM, shutting down...');
  process.exit(0);
});

// ==================== TELEGRAM REMINDER FALLBACK ====================
// If no push subs, send via Telegram bot
const TELEGRAM_REMINDER_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

async function sendTelegramReminder(telegramId: number, title: string) {
  if (!TELEGRAM_REMINDER_BOT_TOKEN || !telegramId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_REMINDER_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: `⏰ Напоминание: ${title}`,
        parse_mode: 'HTML',
      }),
    });
    console.log(`Telegram reminder sent to ${telegramId}: ${title}`);
  } catch (e: any) {
    console.error('Telegram reminder error:', e.message);
  }
}
