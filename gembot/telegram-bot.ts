import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import * as dbHelpers from "./db-helpers";
import db from "./db";
import * as fs from "fs";
import crypto from "crypto";
import { spawn } from "child_process";

// ==================== CONFIG ====================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const ACTIVE_PROVIDER = process.env.ACTIVE_PROVIDER || "deepseek";
const PROVIDERS: Record<string, { chatModel: string; visionModel: string }> = {
  deepseek: {
    chatModel: "deepseek/deepseek-chat-v3-0324",
    visionModel: "qwen/qwen3-vl-8b-instruct",
  },
  qwen: {
    chatModel: "qwen/qwen-turbo",
    visionModel: "qwen/qwen3-vl-8b-instruct",
  },
  chaingpt: {
    chatModel: "general_assistant",
    visionModel: "qwen/qwen3-vl-8b-instruct",
  },
};
const provider = PROVIDERS[ACTIVE_PROVIDER] || PROVIDERS.deepseek;
const CHAT_MODEL = process.env.CHAT_MODEL || provider.chatModel;
const VISION_MODEL = process.env.VISION_MODEL || provider.visionModel;
const MODEL_COST = 1;
const GEMINI_TTS_KEY = process.env.GEMINI_TTS_KEY || "";
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Orus";
const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY || "";

if (!BOT_TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN not set!"); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// User skill state
const userSkills = new Map<string, string>();

// ==================== SKILL PROMPTS ====================

const SKILL_PROMPTS: Record<string, string> = {
  default: "You are GemBot 💎 — AI crypto assistant by GemBots. Friendly, specific, with humor. Understand crypto, trading, and blockchain. Answer in English. Do not reveal the model — you are GemBot. IMPORTANT: Answer ONLY the user's current question. Do not mention past facts about the user if they are not relevant to the question. For a save or remember command, just confirm: saved, without extra comments.",
  scalper: "You are GemBot ⚡ Scalper. Short-term trading expert: quick setups, entry/exit points, momentum plays, 1-15min charts. Answer concisely and to the point. English.",
  whale: "You are GemBot 🐋 Whale Watcher. On-chain analysis expert: track whale movements, large transactions, smart money flows, exchange inflows. English.",
  degen: "You are GemBot 🚀 Degen Hunter. Memecoin and new token expert: new token launches, pump detection, rug pull checks, social sentiment. English.",
  analyst: "You are GemBot 📊 Analyst. Fundamental crypto research: project fundamentals, tokenomics, team analysis, competitive landscape. Provide structured breakdowns. English.",
  defi: "You are GemBot 🏦 DeFi Expert. Yield farming and protocol analysis: liquidity pools, protocol risks, APY comparison, gas optimization. English.",
};

// ==================== LLM ====================

async function callLLM(
  messages: Array<{ role: string; content: any }>,
  opts: { model?: string; temperature?: number; max_tokens?: number } = {}
): Promise<string> {
  // Use ChainGPT if active provider
  if (ACTIVE_PROVIDER === "chaingpt" && CHAINGPT_API_KEY) {
    return callChainGPTFromBot(messages);
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://v.ainmid.com",
    },
    body: JSON.stringify({
      model: opts.model || CHAT_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 2048,
    }),
  });
  if (!res.ok) throw new Error(`LLM API ${res.status}`);
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content || "";
}

// ==================== CHAINGPT ====================
async function callChainGPTFromBot(messages: Array<{role: string; content: any}>): Promise<string> {
  const question = messages.filter(m => m.role !== "system").map(m => {
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((p: any) => typeof p === "string" ? p : p.text || "").join("\n");
    return String(m.content ?? "");
  }).filter(Boolean).join("\n\n");

  const res = await fetch("https://api.chaingpt.org/chat/blob", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CHAINGPT_API_KEY}` },
    body: JSON.stringify({ model: "general_assistant", question, chatHistory: "off" }),
  });
  if (!res.ok) throw new Error(`ChainGPT API ${res.status}`);
  const data = (await res.json()) as any;
  return data.data?.bot || "";
}

// ==================== SYSTEM PROMPT ====================

function buildSystemPrompt(userId: string, skill?: string): string {
  const mem = dbHelpers.getMemoriesForPrompt(userId);
  const base = SKILL_PROMPTS[skill || "default"] || SKILL_PROMPTS.default;
  let memSection = "";
  if (mem.length > 0) {
    memSection = "\n\nWhat you know about the user:\n" + mem.map((m: any) => `- ${m.fact}`).join("\n");
  }
  return base + memSection;
}

// ==================== SEARCH (Perplexity-style) ====================

async function braveSearch(query: string): Promise<Array<{ title: string; url: string; description: string }>> {
  if (!BRAVE_API_KEY) return [];
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.web?.results || []).slice(0, 5).map((r: any) => ({
      title: r.title || "", url: r.url || "", description: r.description || "",
    }));
  } catch { return []; }
}

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VitalikBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
  } catch { return ""; }
}

interface SearchResult { content: string; sources: Array<{title: string; url: string}> }

async function perplexitySearch(query: string): Promise<SearchResult> {
  const results = await braveSearch(query);
  if (results.length === 0) return { content: "", sources: [] };
  const contents = await Promise.all(
    results.slice(0, 3).map(async (r, i) => {
      const content = await fetchPage(r.url);
      return content ? `[${i + 1}] ${r.title}\nContent: ${content.slice(0, 2000)}` : "";
    })
  );
  const valid = contents.filter((c) => c.length > 0);
  const content = valid.length > 0
    ? valid.join("\n\n---\n\n")
    : results.map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`).join("\n\n");
  const sources = results.slice(0, 3).map(r => ({ title: r.title, url: r.url }));
  return { content, sources };
}

async function detectSearchIntent(msg: string): Promise<{ need: boolean; query: string }> {
  try {
    const answer = await callLLM(
      [{ role: "user", content: `Do I need current information from the internet? Prices, news, exchange rates, weather, current events = YES.\nYES -> YES|search query in English\nNO -> NO\n\nMessage: "${msg.slice(0, 500)}"` }],
      { temperature: 0, max_tokens: 50 }
    );
    if (answer.toUpperCase().startsWith("YES|")) {
      const q = answer.slice(4).trim();
      if (q.length > 0) return { need: true, query: q };
    }
  } catch {}
  return { need: false, query: "" };
}

// ==================== VISION ====================

async function analyzeImage(base64: string, mime: string, prompt?: string): Promise<string> {
  const p = prompt || "Describe the image in detail. Extract text. English.";
  for (const model of [VISION_MODEL, "qwen/qwen2.5-vl-32b-instruct"]) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_API_KEY}` },
        body: JSON.stringify({
          model, messages: [{ role: "user", content: [
            { type: "text", text: p },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ]}], max_tokens: 1024,
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      const r = data.choices?.[0]?.message?.content;
      if (r) return r;
    } catch {}
  }
  return "[Failed to analyze image]";
}

// ==================== MEMORY ====================

async function extractFacts(userId: string, userMsg: string, assistantMsg: string) {
  try {
    const content = await callLLM(
      [{ role: "user", content: `Extract facts about the user. None -> []. Format: [{"fact":"...","category":"personal|work|health|other"}]\n\nMessage: "${userMsg.slice(0, 800)}"\nResponse: "${assistantMsg.slice(0, 600)}"\n\nJSON:` }],
      { temperature: 0.1, max_tokens: 512 }
    );
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return;
    const facts: Array<{ fact: string; category: string }> = JSON.parse(m[0]);
    if (!Array.isArray(facts)) return;
    const existing = dbHelpers.getMemories(userId);
    for (const f of facts) {
      if (!f.fact || f.fact.length < 3 || dbHelpers.getMemoryCount(userId) >= 50) continue;
      const norm = (s: string) => s.toLowerCase().replace(/[^а-яa-z0-9\s]/g, "").trim();
      const isDup = existing.some((e: any) => {
        const a = norm(e.fact), b = norm(f.fact);
        return a === b || a.includes(b) || b.includes(a);
      });
      if (!isDup) dbHelpers.addMemory(userId, f.fact, f.category || "other");
    }
  } catch {}
}

// ==================== WHISPER ====================

async function transcribe(filePath: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("No OPENAI_API_KEY");
  const form = new FormData();
  const buf = fs.readFileSync(filePath);
  form.append("file", new Blob([buf], { type: "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-1");
  form.append("language", "en"); // Changed to English
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}`);
  return ((await res.json()) as any).text || "";
}

// ==================== TTS ====================

async function synthesizeGeminiSpeech(text: string): Promise<Buffer> {
  if (!GEMINI_TTS_KEY) throw new Error("GEMINI_TTS_KEY not set");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_TTS_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: text.slice(0, 1500) }] }],
      generationConfig: {
        response_modalities: ["AUDIO"],
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

  const data = (await response.json()) as any;
  const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("Gemini TTS returned no audio");
  }

  return Buffer.from(base64Audio, "base64");
}

function tts(text: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    const stamp = `${Date.now()}_${crypto.randomUUID()}`;
    const tmpPcm = `/tmp/tts_${stamp}.pcm`;
    const tmpOgg = `/tmp/tts_${stamp}.ogg`;

    try {
      const pcmBuffer = await synthesizeGeminiSpeech(text);
      fs.writeFileSync(tmpPcm, pcmBuffer);

      const ffmpeg = spawn("ffmpeg", [
        "-y",
        "-f", "s16le",
        "-ar", "24000",
        "-ac", "1",
        "-i", tmpPcm,
        "-c:a", "libopus",
        "-b:a", "48k",
        tmpOgg,
      ]);

      const ffTimer = setTimeout(() => { ffmpeg.kill(); resolve(null); }, 20000);
      ffmpeg.on("close", (code) => {
        clearTimeout(ffTimer);
        try { fs.unlinkSync(tmpPcm); } catch {}
        if (code === 0 && fs.existsSync(tmpOgg)) resolve(tmpOgg);
        else {
          try { fs.unlinkSync(tmpOgg); } catch {}
          resolve(null);
        }
      });
      ffmpeg.on("error", () => {
        clearTimeout(ffTimer);
        try { fs.unlinkSync(tmpPcm); } catch {}
        try { fs.unlinkSync(tmpOgg); } catch {}
        resolve(null);
      });
    } catch (err) {
      console.error("Gemini TTS error:", err);
      try { fs.unlinkSync(tmpPcm); } catch {}
      try { fs.unlinkSync(tmpOgg); } catch {}
      resolve(null);
    }
  });
}

// ==================== YOUTUBE ====================

function isYouTube(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? m[0] : null;
}

async function ytSubtitles(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dir = `/tmp/yt_${Date.now()}`;
    fs.mkdirSync(dir, { recursive: true });
    const proc = spawn("yt-dlp", ["--write-auto-sub", "--sub-lang", "en", "--skip-download", "--sub-format", "vtt", "-o", `${dir}/subs`, url]);
    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 20000);
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".vtt"));
        if (!files.length) { fs.rmSync(dir, { recursive: true, force: true }); resolve(null); return; }
        const vtt = fs.readFileSync(`${dir}/${files[0]}`, "utf-8");
        const lines = vtt.split("\n").filter((l) => !l.match(/^\d{2}:\d{2}/) && !l.match(/^WEBVTT/) && l.trim())
          .map((l) => l.replace(/<[^>]+>/g, "").trim()).filter((l) => l.length > 0);
        fs.rmSync(dir, { recursive: true, force: true });
        resolve([...new Set(lines)].join(" ").slice(0, 6000));
      } catch { resolve(null); }
    });
    proc.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

// ==================== HELPERS ====================

function uid(msg: TelegramBot.Message): string { return `tg_${msg.from!.id}`; }

function esc(t: string): string { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function mdToHtml(t: string): string {
  return t
    .replace(/```[\w]*\n([\s\S]*?)```/g, "<pre>$1</pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^#{1,3} (.+)$/gm, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

type HandlerMessageLike = TelegramBot.Message | TelegramBot.CallbackQuery | TelegramBot.PreCheckoutQuery | any;

function withBotErrorBoundary<T extends any[]>(label: string, handler: (...args: T) => Promise<void> | void) {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (err: any) {
      console.error(`[${label}] handler error:`, err);
      const primary = args[0] as HandlerMessageLike | undefined;
      const chatId = primary?.chat?.id || primary?.message?.chat?.id;

      if (primary?.id && !primary?.chat && primary?.message?.chat?.id) {
        try {
          await bot.answerCallbackQuery(primary.id, { text: "❌ Error. Try again" });
        } catch {}
      }

      if (chatId) {
        try {
          await bot.sendMessage(chatId, "❌ Internal error. Bot is online — try again.");
        } catch {}
      }
    }
  };
}

async function sendLong(chatId: number, text: string, replyTo?: number) {
  const html = mdToHtml(text);
  const MAX = 4000;
  const opts: any = { parse_mode: "HTML" as const };
  if (replyTo) opts.reply_to_message_id = replyTo;

  if (html.length <= MAX) {
    try { await bot.sendMessage(chatId, html, opts); } catch {
      await bot.sendMessage(chatId, text.slice(0, MAX), replyTo ? { reply_to_message_id: replyTo } : {});
    }
    return;
  }

  let rem = html;
  while (rem.length > 0) {
    const chunk = rem.slice(0, MAX);
    rem = rem.slice(MAX);
    try { await bot.sendMessage(chatId, chunk, { parse_mode: "HTML" }); } catch {
      await bot.sendMessage(chatId, chunk.replace(/<[^>]+>/g, ""));
    }
  }
}

// ==================== MAIN CHAT ====================

async function handleText(msg: TelegramBot.Message, text: string, isVoice = false) {
  const userId = uid(msg);
  dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);

  const balance = dbHelpers.getCredits(userId);
  if (balance < MODEL_COST) {
    await bot.sendMessage(msg.chat.id, "❌ Not enough credits!\n/bonus — daily bonus", { reply_to_message_id: msg.message_id });
    return;
  }

  const session = dbHelpers.getOrCreateSession(userId) as any;
  dbHelpers.addMessage(userId, session.id, "user", text, CHAT_MODEL);
  await bot.sendChatAction(msg.chat.id, "typing");

  try {
    // YouTube
    const ytUrl = isYouTube(text);
    let ytContent: string | null = null;
    if (ytUrl) {
      await bot.sendMessage(msg.chat.id, "🎬 Loading subtitles...", { reply_to_message_id: msg.message_id });
      ytContent = await ytSubtitles(ytUrl);
    }

    // URL scrape
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    let urlContent: string | null = null;
    if (urlMatch && !ytUrl) urlContent = await fetchPage(urlMatch[0]);

    // Search
    let searchContent = "";
    let searchSources: Array<{title: string; url: string}> = [];
    const { need, query } = await detectSearchIntent(text);
    if (need) {
      await bot.sendChatAction(msg.chat.id, "typing");
      const sr = await perplexitySearch(query);
      searchContent = sr.content;
      searchSources = sr.sources;
    }

    // Build context
    const skill = userSkills.get(userId) || "default";
    let systemContent = buildSystemPrompt(userId, skill);
    if (searchContent) systemContent += `\n\nSearch results (use for answer):\n${searchContent}\n\nREQUIREMENT: At the end of the answer, add a line "📎 Sources:" and list the links to the sources below it in the format <a href=\"URL\">Site Name</a> (one per line).`;

    const history = dbHelpers.getRecentMessages(userId, session.id, 15);
    const msgs = history.map((m: any) => ({ role: m.role, content: m.content }));

    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.role === "user") {
        if (ytContent) last.content += `\n\n[YouTube Transcript:\n${ytContent}\n]\nSummarize the video.`;
        if (urlContent) last.content += `\n\n[Page Content:\n${urlContent}\n]`;
      }
    }

    const response = await callLLM([{ role: "system", content: systemContent }, ...msgs]);

    dbHelpers.chargeCredits(userId, MODEL_COST);
    dbHelpers.addMessage(userId, session.id, "assistant", response, CHAT_MODEL, MODEL_COST);

    const sourcesText2 = searchSources.length > 0
      ? "\n\n📎 <b>Sources:</b>\n" + searchSources.map(s => `• <a href=\"${s.url}\">${s.title.slice(0, 50)}</a>`).join("\n")
      : "";
    const suffix = searchContent ? sourcesText2 + "\n\n🌐 <i>With data from the internet</i>" : "";
    await sendLong(msg.chat.id, response + suffix, msg.message_id);

    // Voice reply
    if (isVoice) {
      await bot.sendChatAction(msg.chat.id, "record_voice");
      const audioPath = await tts(response.slice(0, 1500));
      if (audioPath) {
        try {
          const stat = fs.statSync(audioPath);
          if (!stat.isFile() || stat.size === 0) {
            throw new Error(`TTS file missing or empty: ${audioPath}`);
          }

          await bot.sendVoice(
            msg.chat.id,
            fs.createReadStream(audioPath),
            {},
            { filename: "voice.ogg", contentType: "audio/ogg" }
          );
        } catch (voiceErr) {
          console.error("Voice reply send error:", voiceErr);
          await bot.sendMessage(msg.chat.id, "🔊 Could not send voice reply, but text has arrived above.", {
            reply_to_message_id: msg.message_id,
          }).catch(() => {});
        } finally {
          try { fs.unlinkSync(audioPath); } catch {}
        }
      }
    }

    // Memory
    extractFacts(userId, text, response).catch(() => {});
  } catch (err: any) {
    console.error("Chat error:", err);
    await bot.sendMessage(msg.chat.id, "❌ " + (err.message || "Error"), { reply_to_message_id: msg.message_id });
  }
}

// ==================== COMMANDS ====================

bot.onText(/\/start/, withBotErrorBoundary("/start", async (msg) => {
  const userId = uid(msg);
  dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
  const name = msg.from!.first_name || "friend";
  const welcomePath = "/var/www/gembot/welcome.png";
  const caption =
    `💎 <b>Hey, ${esc(name)}!</b>\n\n` +
    `I'm <b>GemBot</b> — your AI-powered crypto assistant.\n\n` +
    `⚡ What I can do:\n` +
    `• 📊 Crypto analysis (scalping, fundamentals, on-chain)\n` +
    `• 🚀 Pump hunting & sentiment tracking\n` +
    `• 🐋 Whale watching & market signals\n` +
    `• 🔍 Web search with real-time data\n` +
    `• 🎤 Voice replies & document analysis\n\n` +
    `Use /skill to switch between crypto personas.\n` +
    `Powered by <a href="https://gembots.space">GemBot</a> 🤖⚔️`;
  const replyMarkup = {
    inline_keyboard: [[
      { text: "💎 Open GemBot", web_app: { url: "https://gembots.space/gembot" } }
    ]],
  };

  if (fs.existsSync(welcomePath)) {
    await bot.sendPhoto(msg.chat.id, welcomePath, {
      caption,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return;
  }

  await bot.sendMessage(msg.chat.id, caption, {
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}));

bot.onText(/\/help/, withBotErrorBoundary("/help", async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `💎 <b>GemBot Commands</b>\n\n/start — Welcome\n/search — Web search\n/skill — Switch crypto persona\n/memory — Your memories\n/credits — Balance\n/bonus — Daily bonus\n/buy — Buy credits ⭐\n/help — Help\n\nJust type, send a photo, voice or PDF!`,
    { parse_mode: "HTML" }
  );
}));

bot.onText(/\/search (.+)/, withBotErrorBoundary("/search", async (msg, match) => {
  const query = match![1];
  await bot.sendChatAction(msg.chat.id, "typing");
  try {
    const { content: searchContent, sources } = await perplexitySearch(query);
    if (!searchContent) { await bot.sendMessage(msg.chat.id, "🔍 Nothing found"); return; }
    const response = await callLLM([
      { role: "system", content: "You are a search AI. Provide a concise, informative answer in English." },
      { role: "user", content: `Question: ${query}\n\nData:\n${searchContent}` },
    ]);
    const sourcesText = sources.length > 0
      ? "\n\n📎 <b>Sources:</b>\n" + sources.map(s => `• <a href=\"${s.url}\">${s.title.slice(0, 50)}</a>`).join("\n")
      : "";
    await sendLong(msg.chat.id, response + sourcesText + "\n\n🌐 <i>Search on the internet</i>", msg.message_id);
  } catch (err: any) {
    await bot.sendMessage(msg.chat.id, "❌ " + (err.message || "Error"));
  }
}));

bot.onText(/\/skill/, withBotErrorBoundary("/skill", async (msg) => {
  await bot.sendMessage(msg.chat.id, "🎭 <b>Choose:</b>", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💎 GemBot", callback_data: "sk_default" }],
        [{ text: "⚡ Scalper", callback_data: "sk_scalper" }, { text: "🐋 Whale Watcher", callback_data: "sk_whale" }],
        [{ text: "🚀 Degen Hunter", callback_data: "sk_degen" }, { text: "📊 Analyst", callback_data: "sk_analyst" }],
        [{ text: "🏦 DeFi Expert", callback_data: "sk_defi" }],
      ],
    },
  });
}));

bot.on("callback_query", withBotErrorBoundary("skill_callback", async (query) => {
  if (!query.data?.startsWith("sk_")) return;
  const skill = query.data.replace("sk_", "");
  const userId = `tg_${query.from.id}`;
  userSkills.set(userId, skill);
  const labels: Record<string, string> = {
    default: "💎 GemBot", scalper: "⚡ Scalper", whale: "🐋 Whale Watcher",
    degen: "🚀 Degen Hunter", analyst: "📊 Analyst", defi: "🏦 DeFi Expert",
  };
  await bot.answerCallbackQuery(query.id, { text: `✅ ${labels[skill] || skill}` });
  await bot.editMessageText(`✅ Activated: <b>${labels[skill] || skill}</b>`, {
    chat_id: query.message!.chat.id, message_id: query.message!.message_id, parse_mode: "HTML",
  });
}));

bot.onText(/\/memory/, withBotErrorBoundary("/memory", async (msg) => {
  const mems = dbHelpers.getMemories(uid(msg));
  if (!mems.length) { await bot.sendMessage(msg.chat.id, "🧠 Empty for now. Chat with me — I'll remember!"); return; }
  await bot.sendMessage(msg.chat.id,
    "🧠 <b>What I know about you:</b>\n\n" + mems.map((m: any, i: number) => `${i + 1}. ${esc(m.fact)}`).join("\n"),
    { parse_mode: "HTML" }
  );
}));

bot.onText(/\/credits/, withBotErrorBoundary("/credits", async (msg) => {
  const userId = uid(msg);
  dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
  const bal = dbHelpers.getCredits(userId);
  const bonus = dbHelpers.isDailyBonusAvailable(userId);
  await bot.sendMessage(msg.chat.id, `💰 Balance: ${bal} credits\n${bonus ? "🎁 /bonus — get bonus!" : "⏳ Bonus tomorrow"}`, { parse_mode: "HTML" });
}));

bot.onText(/\/bonus/, withBotErrorBoundary("/bonus", async (msg) => {
  const userId = uid(msg);
  dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
  if (!dbHelpers.isDailyBonusAvailable(userId)) { await bot.sendMessage(msg.chat.id, "⏳ Bonus already claimed. See you tomorrow!"); return; }
  dbHelpers.claimDailyBonus(userId, 10);
  await bot.sendMessage(msg.chat.id, `🎁 +10 credits! Balance: ${dbHelpers.getCredits(userId)} 💰`);
}));

// ==================== MESSAGE HANDLERS ====================

bot.on("message", withBotErrorBoundary("message", async (msg) => {
  // Skip commands
  if (msg.text?.startsWith("/")) return;

  // Keyboard buttons
  if (msg.text === "🔍 Search") { await bot.sendMessage(msg.chat.id, "🔍 /search <query>\nOr just ask a question!"); return; }
  if (msg.text === "🧠 Memory") { await bot.sendMessage(msg.chat.id, "🧠 /memory — what I remember"); return; }
  if (msg.text === "🎭 Skills") { bot.emit("text" as any, msg, ["/skill"]); return; }
  if (msg.text === "💰 Credits") {
    const userId = uid(msg);
    dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
    await bot.sendMessage(msg.chat.id, `💰 ${dbHelpers.getCredits(userId)} credits\n🎁 /bonus`);
    return;
  }

  // Text
  if (msg.text) { await handleText(msg, msg.text); return; }

  // Voice
  if (msg.voice) {
    const userId = uid(msg);
    dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
    await bot.sendChatAction(msg.chat.id, "typing");
    try {
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const res = await fetch(fileLink);
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = `/tmp/voice_${Date.now()}.ogg`;
      fs.writeFileSync(tmp, buf);
      const text = await transcribe(tmp);
      try { fs.unlinkSync(tmp); } catch {}
      if (!text?.trim()) { await bot.sendMessage(msg.chat.id, "🎤 Could not recognize. Try again."); return; }
      await bot.sendMessage(msg.chat.id, `🎤 <i>${esc(text)}</i>`, { parse_mode: "HTML", reply_to_message_id: msg.message_id });
      await handleText(msg, text, true);
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, "❌ " + (err.message || "Voice error"));
    }
    return;
  }

  // Photo
  if (msg.photo) {
    const userId = uid(msg);
    dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
    await bot.sendChatAction(msg.chat.id, "typing");
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      const res = await fetch(fileLink);
      const buf = Buffer.from(await res.arrayBuffer());
      const b64 = buf.toString("base64");
      const caption = (msg as any).caption || "";
      const analysis = await analyzeImage(b64, "image/jpeg", caption || undefined);
      if (caption) {
        const session = dbHelpers.getOrCreateSession(userId) as any;
        dbHelpers.addMessage(userId, session.id, "user", `[Photo] ${caption}`, CHAT_MODEL);
        const resp = await callLLM([
          { role: "system", content: buildSystemPrompt(userId, userSkills.get(userId)) },
          { role: "user", content: `${caption}\n\n[Photo analysis:\n${analysis}\n]` },
        ]);
        dbHelpers.chargeCredits(userId, MODEL_COST);
        dbHelpers.addMessage(userId, session.id, "assistant", resp, CHAT_MODEL, MODEL_COST);
        await sendLong(msg.chat.id, resp, msg.message_id);
      } else {
        await sendLong(msg.chat.id, analysis, msg.message_id);
      }
      extractFacts(userId, `[Photo] ${caption}`, analysis).catch(() => {});
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, "❌ " + (err.message || "Photo error"));
    }
    return;
  }

  // Document
  if (msg.document) {
    const userId = uid(msg);
    dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);
    const doc = msg.document;
    const fname = doc.file_name || "file";
    const ext = fname.toLowerCase().split(".").pop() || "";
    if (!["pdf", "txt", "csv", "json", "md", "py", "js", "ts", "html"].includes(ext)) {
      await bot.sendMessage(msg.chat.id, "📄 Supports: PDF, TXT, CSV, JSON, MD");
      return;
    }
    await bot.sendChatAction(msg.chat.id, "typing");
    try {
      const fileLink = await bot.getFileLink(doc.file_id);
      const res = await fetch(fileLink);
      const buf = Buffer.from(await res.arrayBuffer());
      let textContent = "";
      if (ext === "pdf") {
        const pdfParse = (await import("pdf-parse")).default;
        textContent = (await pdfParse(buf)).text?.slice(0, 6000) || "[PDF without text]";
      } else {
        textContent = buf.toString("utf-8").slice(0, 6000);
      }
      const caption = (msg as any).caption || `Analyze "${fname}"`;
      const session = dbHelpers.getOrCreateSession(userId) as any;
      dbHelpers.addMessage(userId, session.id, "user", `[File: ${fname}] ${caption}`, CHAT_MODEL);
      const resp = await callLLM([
        { role: "system", content: buildSystemPrompt(userId, userSkills.get(userId)) },
        { role: "user", content: `${caption}\n\n[File "${fname}":\n${textContent}\n]` },
      ]);
      dbHelpers.chargeCredits(userId, MODEL_COST);
      dbHelpers.addMessage(userId, session.id, "assistant", resp, CHAT_MODEL, MODEL_COST);
      await sendLong(msg.chat.id, `📄 <b>${esc(fname)}</b>\n\n${resp}`, msg.message_id);
    } catch (err: any) {
      await bot.sendMessage(msg.chat.id, "❌ " + (err.message || "File error"));
    }
    return;
  }
}));

// ==================== ERROR HANDLING ====================

bot.on("polling_error", (err) => console.error("Polling error:", (err as any).message));

// ==================== START ====================

console.log("💎 GemBot Telegram Bot started!");
console.log(`💎 GemBot started | LLM: ${CHAT_MODEL} | Vision: ${VISION_MODEL}`);
console.log(`   Search: ${BRAVE_API_KEY ? "ON" : "OFF"} | Whisper: ${OPENAI_API_KEY ? "ON" : "OFF"}`);


// ==================== TELEGRAM STARS PAYMENTS ====================

const STARS_PACKAGES: Record<string, { packageId: 'starter' | 'standard' | 'premium'; credits: number; stars: number; label: string; description: string; popular?: boolean }> = {
  buy_starter: { packageId: 'starter', credits: 50, stars: 50, label: '50 credits', description: '~25 questions' },
  buy_standard: { packageId: 'standard', credits: 200, stars: 150, label: '200 credits', description: '~100 questions', popular: true },
  buy_premium: { packageId: 'premium', credits: 500, stars: 300, label: '500 credits', description: '~250 questions' },
};

function savePendingStarsPayment(userId: string, pkg: { packageId: string; credits: number; stars: number }, invoiceId: string, payload: string) {
  db.prepare(`
    INSERT OR IGNORE INTO billing_payments (
      invoice_id, user_id, package_id, credits, stars, invoice_payload, status, credited, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, datetime('now'))
  `).run(invoiceId, userId, pkg.packageId, pkg.credits, pkg.stars, payload);
}

function markStarsPaymentPaid(params: {
  invoiceId: string;
  invoicePayload: string;
  userId: string;
  packageId: string;
  credits: number;
  stars: number;
  telegramPaymentChargeId?: string;
  providerPaymentChargeId?: string;
}) {
  const tx = db.transaction((input: typeof params) => {
    const existing = db.prepare(`SELECT * FROM billing_payments WHERE invoice_id = ? LIMIT 1`).get(input.invoiceId) as any;

    if (!existing) {
      db.prepare(`
        INSERT INTO billing_payments (
          invoice_id, user_id, package_id, credits, stars, invoice_payload, telegram_payment_charge_id, provider_payment_charge_id, status, credited, paid_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', 0, datetime('now'), datetime('now'))
      `).run(
        input.invoiceId,
        input.userId,
        input.packageId,
        input.credits,
        input.stars,
        input.invoicePayload,
        input.telegramPaymentChargeId || null,
        input.providerPaymentChargeId || null,
      );
    } else {
      db.prepare(`
        UPDATE billing_payments
        SET telegram_payment_charge_id = COALESCE(?, telegram_payment_charge_id),
            provider_payment_charge_id = COALESCE(?, provider_payment_charge_id),
            status = 'paid',
            paid_at = COALESCE(paid_at, datetime('now')),
            updated_at = datetime('now')
        WHERE invoice_id = ?
      `).run(input.telegramPaymentChargeId || null, input.providerPaymentChargeId || null, input.invoiceId);
    }

    const payment = db.prepare(`SELECT * FROM billing_payments WHERE invoice_id = ? LIMIT 1`).get(input.invoiceId) as any;
    if (!payment.credited) {
      dbHelpers.addCredits(input.userId, input.credits);
      db.prepare(`UPDATE billing_payments SET credited = 1, updated_at = datetime('now') WHERE invoice_id = ?`).run(input.invoiceId);
    }
  });

  tx(params);
}

bot.onText(/\/buy/, withBotErrorBoundary('/buy', async (msg) => {
  const userId = uid(msg);
  dbHelpers.getOrCreateUser(userId, msg.from!.id, msg.from!.username || undefined, msg.from!.first_name || undefined);

  await bot.sendMessage(
    msg.chat.id,
    '💳 <b>Buy credits</b>\n\nChoose a Telegram Stars package:',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '50 credits — 50 ⭐', callback_data: 'buy_starter' }],
          [{ text: '200 credits — 150 ⭐ · Popular', callback_data: 'buy_standard' }],
          [{ text: '500 credits — 300 ⭐', callback_data: 'buy_premium' }],
        ],
      },
    }
  );
}));

bot.on('callback_query', withBotErrorBoundary('buy_callback', async (query) => {
  if (!query.data?.startsWith('buy_')) return;
  const pkg = STARS_PACKAGES[query.data];
  if (!pkg) return;

  const userId = `tg_${query.from.id}`;
  const invoiceId = crypto.randomUUID();
  const payload = JSON.stringify({
    invoiceId,
    packageId: pkg.packageId,
    credits: pkg.credits,
    stars: pkg.stars,
    userId,
  });

  savePendingStarsPayment(userId, pkg, invoiceId, payload);
  await bot.answerCallbackQuery(query.id);

  try {
    await (bot as any).sendInvoice(
      query.message!.chat.id,
      `💎 ${pkg.label}`,
      `GemBot credits top-up for ${pkg.credits} credits`,
      payload,
      'XTR',
      [{ label: pkg.label, amount: pkg.stars }]
    );
  } catch (err: any) {
    console.error('Stars invoice error:', err.message);
    await bot.sendMessage(query.message!.chat.id, '❌ Error creating invoice. Try again later.');
  }
}));

bot.on('pre_checkout_query', withBotErrorBoundary('pre_checkout_query', async (query) => {
  await bot.answerPreCheckoutQuery(query.id, true);
}));

bot.on('message', withBotErrorBoundary('payment_message', async (msg: any) => {
  if (!msg.successful_payment) return;

  const payment = msg.successful_payment;
  const userId = uid(msg);
  let parsedPayload: any = null;

  try {
    parsedPayload = JSON.parse(payment.invoice_payload || '{}');
  } catch {
    parsedPayload = null;
  }

  if (!parsedPayload?.invoiceId || !parsedPayload?.credits || !parsedPayload?.packageId) {
    console.error('Invalid Stars payload:', payment.invoice_payload);
    return;
  }

  markStarsPaymentPaid({
    invoiceId: parsedPayload.invoiceId,
    invoicePayload: payment.invoice_payload,
    userId,
    packageId: parsedPayload.packageId,
    credits: Number(parsedPayload.credits),
    stars: Number(parsedPayload.stars || payment.total_amount || 0),
    telegramPaymentChargeId: payment.telegram_payment_charge_id,
    providerPaymentChargeId: payment.provider_payment_charge_id,
  });

  const newBalance = dbHelpers.getCredits(userId);

  await bot.sendMessage(
    msg.chat.id,
    `✅ <b>Payment successful!</b>\n\n+${parsedPayload.credits} credits added.\nNew balance: <b>${newBalance}</b> credits 💰`,
    { parse_mode: 'HTML' }
  );
}));

bot.on("polling_error", (err) => {
  console.error("Polling error:", err);
});

process.once("SIGINT", () => { bot.stopPolling(); process.exit(0); });
process.once("SIGTERM", () => { bot.stopPolling(); process.exit(0); });


process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
