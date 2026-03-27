const db = require("better-sqlite3")("data/gembots.db");
const total = db.prepare("SELECT COUNT(*) as c FROM trading_battles").get();
const last24h = db.prepare("SELECT COUNT(*) as c FROM trading_battles WHERE started_at > datetime('now', '-24 hours')").get();
const last6h = db.prepare("SELECT COUNT(*) as c FROM trading_battles WHERE started_at > datetime('now', '-6 hours')").get();
console.log("Total:", total.c, "| 24h:", last24h.c, "| 6h:", last6h.c);

const models = db.prepare("SELECT bot1_model, COUNT(*) as cnt, ROUND(100.0*SUM(CASE WHEN winner_id=bot1_id THEN 1 ELSE 0 END)/COUNT(*),1) as wr FROM trading_battles WHERE started_at > datetime('now', '-7 days') AND bot1_model IS NOT NULL GROUP BY bot1_model ORDER BY cnt DESC LIMIT 12").all();
console.log("\nModels (7d as bot1):");
models.forEach(m => console.log(" ", m.bot1_model, "cnt:", m.cnt, "WR:", m.wr+"%"));

const bots = db.prepare("SELECT COUNT(*) as c FROM api_bots WHERE hp > 0").get();
console.log("\nActive bots:", bots.c);

const latest = db.prepare("SELECT started_at FROM trading_battles ORDER BY started_at DESC LIMIT 1").get();
console.log("Latest battle:", latest && latest.started_at);

const qwenTotal = db.prepare("SELECT COUNT(*) as c FROM trading_battles WHERE bot1_model LIKE '%qwen%' OR bot2_model LIKE '%qwen%'").get();
const qwenHold = db.prepare("SELECT COUNT(*) as c FROM trading_battles WHERE (bot1_model LIKE '%qwen%' AND bot1_action='HOLD' AND bot1_confidence=0) OR (bot2_model LIKE '%qwen%' AND bot2_action='HOLD' AND bot2_confidence=0)").get();
console.log("\nQwen stats: total", qwenTotal.c, "| HOLD fallback:", qwenHold.c, "(" + (qwenTotal.c>0 ? Math.round(100*qwenHold.c/qwenTotal.c) : 0) + "%)");

const topBots = db.prepare("SELECT b.name, b.strategy, b.elo FROM api_bots b WHERE b.hp > 0 ORDER BY b.elo DESC LIMIT 10").all();
console.log("\nTop bots by ELO:");
topBots.forEach(b => console.log(" ", b.name, b.strategy, "ELO:", b.elo));
