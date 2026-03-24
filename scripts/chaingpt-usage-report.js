#!/usr/bin/env node
/**
 * ChainGPT Usage Report — Full API usage across all integrations
 * 
 * Tracks: Trading Battles, Battle Commentator, Website Chatbot, Strategy Factory
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const BOT_ID = 38;
const BOT_NAME = 'ChainGPT';
const TOTAL_CREDITS = 1_500_000;

const ROOT_DIR = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT_DIR, 'data', 'gembots.db');
const REPORT_PATH = path.join(ROOT_DIR, 'data', 'chaingpt-report.json');
const CREDITS_PATH = path.join(ROOT_DIR, 'data', 'chaingpt-credits.json');

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function makeRow(label, value, width = 56) {
  const safeLabel = String(label);
  const safeValue = String(value);
  const dots = '.'.repeat(Math.max(2, width - safeLabel.length - safeValue.length));
  return `│ ${safeLabel} ${dots} ${safeValue} │`;
}

function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // === 1. Trading Battles (ChainGPT bot decisions) ===
    const eloRow = db.prepare('SELECT elo FROM trading_elo WHERE bot_id = ? LIMIT 1').get(BOT_ID);
    const elo = Number(eloRow?.elo ?? 1500);

    const battleStats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN winner_id = @botId THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN winner_id IS NOT NULL AND winner_id != @botId THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN winner_id IS NULL AND status = 'resolved' THEN 1 ELSE 0 END) AS draws,
        SUM(CASE WHEN started_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last24h
      FROM trading_battles
      WHERE bot1_id = @botId OR bot2_id = @botId
    `).get({ botId: BOT_ID });

    const totalBattles = Number(battleStats?.total || 0);
    const wins = Number(battleStats?.wins || 0);
    const losses = Number(battleStats?.losses || 0);
    const draws = Number(battleStats?.draws || 0);
    const last24h = Number(battleStats?.last24h || 0);
    const winRate = totalBattles > 0 ? round1((wins / totalBattles) * 100) : 0;

    // === 2. Battle Commentator (ALL commentaries use ChainGPT as primary) ===
    let commentatorTotal = 0;
    let commentatorLast24h = 0;
    if (hasColumn(db, 'trading_battles', 'commentary')) {
      const commStats = db.prepare(`
        SELECT
          SUM(CASE WHEN commentary IS NOT NULL AND LENGTH(commentary) > 10 THEN 1 ELSE 0 END) AS total,
          SUM(CASE WHEN commentary IS NOT NULL AND LENGTH(commentary) > 10 
               AND resolved_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last24h
        FROM trading_battles
      `).get();
      commentatorTotal = Number(commStats?.total || 0);
      commentatorLast24h = Number(commStats?.last24h || 0);
    }

    // === 3. Website Chatbot (AI_PROVIDER=chaingpt) ===
    // No direct DB tracking — estimate from rate limit (5 req/min/IP)
    // Conservative estimate: ~50 chats/day based on traffic
    const chatbotNote = 'AI_PROVIDER=chaingpt (no DB tracking, estimated)';
    const chatbotEstimate = 50; // per day estimate — will be refined with logging

    // === 4. Strategy Factory (one-time calls for creating strategies) ===
    const strategyFactoryNote = 'One-time calls via chaingpt-strategy-factory.js';
    const strategyFactoryCalls = 10; // approximate historical

    // === Totals ===
    const totalApiCalls = totalBattles + commentatorTotal + strategyFactoryCalls;
    const totalApiCallsLast24h = last24h + commentatorLast24h;
    const remainingCredits = Math.max(0, TOTAL_CREDITS - totalApiCalls);
    const usagePercent = round1((totalApiCalls / TOTAL_CREDITS) * 100);
    const reportDate = new Date().toISOString().slice(0, 10);

    // === Print Report ===
    const lines = [
      '┌──────────────────────────────────────────────────────────────┐',
      '│            ChainGPT Full Usage Report                       │',
      '├──────────────────────────────────────────────────────────────┤',
      makeRow('Date', reportDate),
      makeRow('Bot', `${BOT_NAME} (#${BOT_ID})`),
      makeRow('Current ELO', formatNumber(elo)),
      '├──────────────────── TRADING BATTLES ─────────────────────────┤',
      makeRow('Battles Total', formatNumber(totalBattles)),
      makeRow('Battles Last 24h', formatNumber(last24h)),
      makeRow('Wins / Losses / Draws', `${wins} / ${losses} / ${draws}`),
      makeRow('Win Rate', `${formatNumber(winRate, 1)}%`),
      makeRow('API Calls (1 per battle)', formatNumber(totalBattles)),
      '├──────────────────── BATTLE COMMENTATOR ──────────────────────┤',
      makeRow('Commentaries Generated', formatNumber(commentatorTotal)),
      makeRow('Commentaries Last 24h', formatNumber(commentatorLast24h)),
      makeRow('API Calls (1 per commentary)', formatNumber(commentatorTotal)),
      '├──────────────────── WEBSITE CHATBOT ─────────────────────────┤',
      makeRow('Status', 'Active (AI_PROVIDER=chaingpt)'),
      makeRow('Note', 'No DB tracking yet'),
      '├──────────────────── STRATEGY FACTORY ────────────────────────┤',
      makeRow('Historical Calls', formatNumber(strategyFactoryCalls)),
      '├──────────────────── TOTALS ──────────────────────────────────┤',
      makeRow('Total API Calls (tracked)', formatNumber(totalApiCalls)),
      makeRow('Last 24h API Calls', formatNumber(totalApiCallsLast24h)),
      makeRow('Estimated Credits Used', formatNumber(totalApiCalls)),
      makeRow('Credits Remaining', formatNumber(remainingCredits)),
      makeRow('Credits Total', formatNumber(TOTAL_CREDITS)),
      makeRow('Usage', `${formatNumber(usagePercent, 2)}%`),
      '└──────────────────────────────────────────────────────────────┘',
    ];

    console.log(lines.join('\n'));

    // === Save JSON ===
    const report = {
      date: reportDate,
      bot: { name: BOT_NAME, id: BOT_ID, elo: Math.round(elo) },
      battles: { total: totalBattles, last24h, wins, losses, draws, winRate },
      commentator: { total: commentatorTotal, last24h: commentatorLast24h },
      chatbot: { status: 'active', provider: 'chaingpt', note: chatbotNote },
      strategyFactory: { historicalCalls: strategyFactoryCalls },
      apiCalls: {
        battles: totalBattles,
        commentator: commentatorTotal,
        strategyFactory: strategyFactoryCalls,
        total: totalApiCalls,
        last24h: totalApiCallsLast24h,
      },
      credits: {
        estimated_used: totalApiCalls,
        total: TOTAL_CREDITS,
        remaining: remainingCredits,
        usagePercent,
      },
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

    // Update credits file
    const currentCredits = fs.existsSync(CREDITS_PATH)
      ? JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf8'))
      : {};
    const updatedCredits = {
      ...currentCredits,
      limit: TOTAL_CREDITS,
      used: totalApiCalls,
      requests: totalApiCalls,
      remaining: remainingCredits,
      last_report_date: reportDate,
      breakdown: {
        battles: totalBattles,
        commentator: commentatorTotal,
        strategyFactory: strategyFactoryCalls,
      },
    };
    fs.writeFileSync(CREDITS_PATH, JSON.stringify(updatedCredits, null, 2) + '\n');

    console.log(`\nSaved: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
    console.log(`Updated: ${path.relative(ROOT_DIR, CREDITS_PATH)}`);
  } finally {
    db.close();
  }
}

main();
