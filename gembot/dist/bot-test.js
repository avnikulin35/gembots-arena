import "dotenv/config";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_MODEL = process.env.CHAT_MODEL || "deepseek/deepseek-chat-v3-0324";
const VISION_MODEL = process.env.VISION_MODEL || "google/gemini-2.0-flash-lite-001";
let passed = 0, failed = 0;
function ok(name, result, detail = "") {
    if (result) {
        console.log(`✅ ${name}`);
        passed++;
    }
    else {
        console.log(`❌ ${name}${detail ? ": " + detail : ""}`);
        failed++;
    }
}
async function test(name, fn) {
    try {
        await fn();
    }
    catch (e) {
        console.log(`❌ ${name}: ${e.message}`);
        failed++;
    }
}
async function main() {
    console.log("🧪 Виталик Bot — Full Test Suite\n");
    // 1. Bot API
    await test("1. Telegram Bot API (getMe)", async () => {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        const d = await r.json();
        ok("1. Telegram Bot API", d.ok && d.result.username === "Vitalik_assist_bot", d.result?.username);
    });
    // 2. LLM
    await test("2. LLM (DeepSeek)", async () => {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENROUTER_KEY}` },
            body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: "user", content: "Say 'OK' in one word" }], max_tokens: 10 })
        });
        const d = await r.json();
        const reply = d.choices?.[0]?.message?.content || "";
        ok("2. LLM response", reply.length > 0, reply);
    });
    // 3. Vision
    await test("3. Vision (Gemini Flash Lite)", async () => {
        // Small 1x1 red pixel PNG in base64
        const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENROUTER_KEY}` },
            body: JSON.stringify({
                model: VISION_MODEL,
                messages: [{ role: "user", content: [
                            { type: "text", text: "What color is this image? One word." },
                            { type: "image_url", image_url: { url: `data:image/png;base64,${pixel}` } }
                        ] }],
                max_tokens: 20
            })
        });
        const d = await r.json();
        const reply = d.choices?.[0]?.message?.content || "";
        ok("3. Vision response", reply.length > 0, reply);
    });
    // 4. Brave Search
    await test("4. Brave Search", async () => {
        const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=test&count=1`, {
            headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
            signal: AbortSignal.timeout(8000)
        });
        const d = await r.json();
        const results = d.web?.results || [];
        ok("4. Brave Search", results.length > 0, `${results.length} results`);
    });
    // 5. Whisper API
    await test("5. Whisper API (auth check)", async () => {
        const r = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${OPENAI_KEY}` }
        });
        ok("5. Whisper API auth", r.status === 200, `HTTP ${r.status}`);
    });
    // 6. Edge TTS
    await test("6. Edge TTS", async () => {
        const { spawn } = await import("child_process");
        const { existsSync, unlinkSync } = await import("fs");
        const tmp = `/tmp/tts_test_${Date.now()}.mp3`;
        await new Promise((resolve, reject) => {
            const proc = spawn("/home/clawdbot/.local/bin/edge-tts", [
                "--voice", "ru-RU-DmitryNeural", "--text", "тест", "--write-media", tmp
            ]);
            const timer = setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 15000);
            proc.on("close", (code) => {
                clearTimeout(timer);
                code === 0 ? resolve() : reject(new Error(`exit ${code}`));
            });
            proc.on("error", (e) => { clearTimeout(timer); reject(e); });
        });
        const exists = existsSync(tmp);
        try {
            unlinkSync(tmp);
        }
        catch { }
        ok("6. Edge TTS", exists, exists ? "file created" : "no file");
    });
    // 7. URL Scraping
    await test("7. URL Scraping", async () => {
        const r = await fetch("https://example.com", {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(8000)
        });
        const html = await r.text();
        const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        ok("7. URL Scraping", text.length > 50, `${text.length} chars`);
    });
    // 8. Search Intent Detection (Russian)
    await test("8. Search intent (RU)", async () => {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENROUTER_KEY}` },
            body: JSON.stringify({
                model: CHAT_MODEL,
                messages: [{ role: "user", content: `Нужна ли актуальная информация из интернета? Цены, новости, курсы валют, погода = ДА.\nДА -> YES|поисковый запрос на русском\nНЕТ -> NO\n\nСообщение: "цены iPhone 16 Россия"` }],
                temperature: 0, max_tokens: 60
            })
        });
        const d = await r.json();
        const answer = d.choices?.[0]?.message?.content || "";
        ok("8. Search intent detection", answer.toUpperCase().startsWith("YES|"), `Got: ${answer}`);
    });
    // 9. DB (sqlite)
    await test("9. DB (SQLite)", async () => {
        const db = (await import("better-sqlite3")).default("/home/clawdbot/Projects/vitalik-app/proxy/data/vitalik.db");
        const row = db.prepare("SELECT COUNT(*) as cnt FROM users").get();
        ok("9. SQLite DB", typeof row.cnt === "number", `${row.cnt} users`);
        db.close();
    });
    // 10. PM2 vitalik-bot status
    await test("10. PM2 vitalik-bot", async () => {
        const { execSync } = await import("child_process");
        const out = execSync("source ~/.nvm/nvm.sh && pm2 jlist 2>/dev/null", { shell: "/bin/bash" }).toString();
        const list = JSON.parse(out);
        const bot = list.find((p) => p.name === "vitalik-bot");
        ok("10. PM2 vitalik-bot online", bot?.pm2_env?.status === "online", `status: ${bot?.pm2_env?.status}`);
    });
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    if (failed === 0)
        console.log("🎉 All tests passed! Bot MVP is ready.");
    else
        console.log("⚠️ Some tests failed - needs attention.");
}
main().catch(console.error);
