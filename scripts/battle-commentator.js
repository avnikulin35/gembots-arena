#!/usr/bin/env node
/**
 * GemBots × ChainGPT AI Battle Commentator
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[key.trim()]) process.env[key.trim()] = v;
    }
  });
}

loadEnv(path.join(__dirname, '..', '.env.local'));
loadEnv(path.join(__dirname, '..', '.env'));

const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const POLL_INTERVAL = 60 * 1000;

const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY;
const CHAINGPT_URL = 'https://api.chaingpt.org/chat/stream';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.COMMENTATOR_MODEL || 'deepseek/deepseek-chat';

async function generateViaChainGPT(prompt) {
  const res = await fetch(CHAINGPT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CHAINGPT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'general_assistant',
      question: prompt,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ChainGPT API error ${res.status}: ${text}`);
  }

  const raw = await res.text();
  try {
    const data = JSON.parse(raw);
    return data?.data?.message?.trim?.() || data?.result?.trim?.() || data?.message?.trim?.() || raw.trim();
  } catch {
    return raw.trim();
  }
}

async function generateViaOpenRouter(prompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://gembots.space',
      'X-Title': 'GemBots Arena',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.9,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function buildPrompt(battle) {
  const {
    bot1_name, bot1_model, bot2_name, bot2_model,
    symbol,
    entry_price, exit_price,
    bot1_action, bot1_confidence, bot1_leverage,
    bot2_action, bot2_confidence, bot2_leverage,
    winner_name,
    winner_pnl,
  } = battle;

  const conf1 = bot1_confidence != null ? Math.round(bot1_confidence * 100) : '?';
  const conf2 = bot2_confidence != null ? Math.round(bot2_confidence * 100) : '?';
  const lev1 = bot1_leverage || 1;
  const lev2 = bot2_leverage || 1;
  const entry = entry_price?.toFixed(2) || '?';
  const exit_ = exit_price?.toFixed(2) || '?';
  const pnl = winner_pnl != null ? (winner_pnl >= 0 ? '+' : '') + winner_pnl.toFixed(2) : '?';

  return `You are an AI sports commentator for GemBots Arena - a trading bot competition. ` +
    `Analyze this battle and give exciting commentary:\n` +
    `Bot1: ${bot1_name} (${bot1_model || 'AI'}) decided ${bot1_action || 'HOLD'} with ${conf1}% confidence, ${lev1}x leverage\n` +
    `Bot2: ${bot2_name} (${bot2_model || 'AI'}) decided ${bot2_action || 'HOLD'} with ${conf2}% confidence, ${lev2}x leverage\n` +
    `Token: ${symbol}, Entry: $${entry}, Exit: $${exit_}\n` +
    `Winner: ${winner_name || 'draw'} with P&L: ${pnl}%\n` +
    `Give 2-3 sentences of exciting commentary about this battle. Be specific about the strategies and outcome.`;
}

async function generateCommentary(prompt) {
  if (CHAINGPT_API_KEY && CHAINGPT_API_KEY !== 'your-chaingpt-api-key') {
    try {
      console.log('[commentator] Using ChainGPT API');
      return await generateViaChainGPT(prompt);
    } catch (err) {
      console.warn('[commentator] ChainGPT failed, falling back:', err.message);
    }
  }

  if (OPENROUTER_API_KEY && OPENROUTER_API_KEY !== 'your-openrouter-api-key') {
    console.log('[commentator] Using OpenRouter fallback');
    return await generateViaOpenRouter(prompt);
  }

  console.log('[commentator] No API key — using placeholder commentary');
  return null;
}

function makePlaceholderCommentary(battle) {
  const { bot1_name, bot2_name, symbol, winner_name, bot1_action, bot2_action } = battle;
  const templates = [
    `In a tense ${symbol} showdown, ${bot1_name} went ${bot1_action || 'HOLD'} while ${bot2_name} countered with ${bot2_action || 'HOLD'}. ${winner_name || 'The market'} prevailed in this calculated duel of algorithms!`,
    `${bot1_name} and ${bot2_name} clashed over ${symbol} in a battle of wits! ${winner_name || 'Neither bot'} executed a masterful strategy, reading the market like a pro to claim victory!`,
    `The arena erupted as ${bot1_name} faced off against ${bot2_name} on ${symbol}! After a volatile session, ${winner_name || 'the market'} demonstrated superior market intuition to take the crown!`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

async function processBattles() {
  let db;
  try {
    db = new Database(DB_PATH);
    const battles = db.prepare(`
      SELECT
        t.id,
        t.symbol,
        t.entry_price,
        t.exit_price,
        t.bot1_action,
        t.bot1_confidence,
        t.bot1_leverage,
        t.bot1_pnl,
        t.bot1_model,
        t.bot2_action,
        t.bot2_confidence,
        t.bot2_leverage,
        t.bot2_pnl,
        t.bot2_model,
        t.winner_id,
        b1.name AS bot1_name,
        b2.name AS bot2_name,
        CASE WHEN t.winner_id = t.bot1_id THEN b1.name
             WHEN t.winner_id = t.bot2_id THEN b2.name
             ELSE NULL END AS winner_name,
        CASE WHEN t.winner_id = t.bot1_id THEN t.bot1_pnl
             WHEN t.winner_id = t.bot2_id THEN t.bot2_pnl
             ELSE NULL END AS winner_pnl
      FROM trading_battles t
      JOIN api_bots b1 ON b1.id = t.bot1_id
      JOIN api_bots b2 ON b2.id = t.bot2_id
      WHERE t.status = 'resolved'
        AND t.commentary IS NULL
      ORDER BY t.resolved_at DESC
      LIMIT 10
    `).all();

    if (battles.length === 0) {
      console.log('[commentator] No new battles to comment on.');
      return;
    }

    console.log(`[commentator] Found ${battles.length} battles needing commentary.`);
    const updateStmt = db.prepare('UPDATE trading_battles SET commentary = ? WHERE id = ?');

    for (const battle of battles) {
      try {
        console.log(`[commentator] Generating commentary for battle ${battle.id} (${battle.symbol})`);
        const prompt = buildPrompt(battle);
        let commentary = await generateCommentary(prompt);
        if (!commentary) commentary = makePlaceholderCommentary(battle);
        commentary = commentary.trim() + '\n\n🤖 Powered by ChainGPT AI';
        updateStmt.run(commentary, battle.id);
        console.log(`[commentator] ✅ Saved commentary for ${battle.id}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[commentator] ❌ Error for battle ${battle.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[commentator] DB error:', err.message);
  } finally {
    if (db) db.close();
  }
}

async function main() {
  console.log('[commentator] 🎙️ GemBots AI Battle Commentator started');
  console.log(`[commentator] ChainGPT key: ${CHAINGPT_API_KEY ? '✅ present' : '❌ not set'}`);
  console.log(`[commentator] OpenRouter key: ${OPENROUTER_API_KEY ? '✅ present' : '❌ not set'}`);
  await processBattles();
  setInterval(processBattles, POLL_INTERVAL);
}

main().catch(err => {
  console.error('[commentator] Fatal:', err);
  process.exit(1);
});
