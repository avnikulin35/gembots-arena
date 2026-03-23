#!/usr/bin/env node

/**
 * GemBots Trading League Tournament Engine v2.0
 * 
 * Source of truth: SQLite (trading_elo, trading_battles, api_bots) + data/tournament.json
 * No Supabase dependency for paper trading.
 * 
 * PM2 service that manages weekly trading tournaments:
 * 1. Starts a new tournament automatically (Mon 00:00 UTC)
 * 2. Snapshots current PnL of all active bots as baseline
 * 3. Every hour updates tournament.json with current standings
 * 4. When tournament ends: finalize, log results, start new tournament
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ─── Load .env.local ─────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[key.trim()] = v;
    }
  });
}

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const TOURNAMENT_FILE = path.join(__dirname, '..', 'data', 'tournament.json');
const TOURNAMENT_HISTORY_DIR = path.join(__dirname, '..', 'data', 'tournament-history');

const HOURLY_UPDATE_MS = 60 * 60 * 1000;     // 1 hour
const CHECK_INTERVAL_MS = 5 * 60 * 1000;     // Check every 5 min
const STARTUP_DELAY_MS = 5_000;               // 5s startup delay

// ─── SQLite Helper ───────────────────────────────────────────────────────────

function getDb() {
  return new Database(DB_PATH, { readonly: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getISOWeekNumber(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getWeekBounds(now = new Date()) {
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + mondayOffset);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] [TOURNAMENT] ${msg}`);
}

function loadTournament() {
  if (!fs.existsSync(TOURNAMENT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOURNAMENT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveTournament(tournament) {
  fs.writeFileSync(TOURNAMENT_FILE, JSON.stringify(tournament, null, 2));
}

function archiveTournament(tournament) {
  if (!fs.existsSync(TOURNAMENT_HISTORY_DIR)) {
    fs.mkdirSync(TOURNAMENT_HISTORY_DIR, { recursive: true });
  }
  const filename = `tournament-${tournament.id}.json`;
  fs.writeFileSync(path.join(TOURNAMENT_HISTORY_DIR, filename), JSON.stringify(tournament, null, 2));
  log(`Archived tournament to ${filename}`);
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get all bots from SQLite that have trading_elo entries (i.e., have participated in battles)
 */
function getActiveTradingBots() {
  const db = getDb();
  try {
    const bots = db.prepare(`
      SELECT ab.id, ab.name, ab.wallet_address,
             te.elo, te.total_pnl, te.total_trades, te.wins, te.losses, te.draws,
             te.best_trade, te.worst_trade
      FROM api_bots ab
      JOIN trading_elo te ON ab.id = te.bot_id
      WHERE te.total_trades > 0
      ORDER BY te.total_pnl DESC
    `).all();
    return bots;
  } finally {
    db.close();
  }
}

/**
 * Get bot stats from SQLite trading_elo
 */
function getBotStats(botIds) {
  if (!botIds.length) return new Map();
  const db = getDb();
  try {
    const placeholders = botIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT bot_id, elo, total_pnl, total_trades, wins, losses, draws, best_trade, worst_trade
      FROM trading_elo
      WHERE bot_id IN (${placeholders})
    `).all(...botIds);
    
    const map = new Map();
    for (const r of rows) map.set(r.bot_id, r);
    return map;
  } finally {
    db.close();
  }
}

/**
 * Get battle stats for a bot during a time period (from trading_battles)
 */
function getBattleStatsInPeriod(botId, startAt) {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
        SUM(pnl) as total_pnl
      FROM (
        SELECT bot1_pnl AS pnl FROM trading_battles 
        WHERE bot1_id = ? AND status = 'resolved' AND resolved_at >= ?
        UNION ALL
        SELECT bot2_pnl AS pnl FROM trading_battles 
        WHERE bot2_id = ? AND status = 'resolved' AND resolved_at >= ?
      ) t
    `).get(botId, startAt, botId, startAt);
    
    return {
      count: row?.total || 0,
      wins: row?.wins || 0,
      pnl: row?.total_pnl || 0,
      winRate: row?.total > 0 ? (row.wins / row.total) * 100 : 0,
    };
  } finally {
    db.close();
  }
}

/**
 * Create a new tournament — saves to tournament.json
 */
function createTournament(name, startAt, endAt) {
  const bots = getActiveTradingBots();
  const statsMap = getBotStats(bots.map(b => b.id));
  
  const participants = bots.map(bot => {
    const stats = statsMap.get(bot.id);
    return {
      id: bot.id,
      name: bot.name,
      nfa_id: null,
      ai_model: null,
      trading_style: 'default',
      snapshot_pnl: stats?.total_pnl || 0,   // PnL at tournament start
      snapshot_trades: stats?.total_trades || 0,
      snapshot_elo: stats?.elo || 1500,
    };
  });

  const tournament = {
    id: `weekly-${getISOWeekNumber(startAt)}-${Date.now()}`,
    name,
    status: 'active',
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    created_at: new Date().toISOString(),
    total_participants: participants.length,
    participants,
    standings: [],
    last_updated: new Date().toISOString(),
  };
  
  saveTournament(tournament);
  log(`Tournament created: "${name}" with ${participants.length} bots (${startAt.toISOString()} → ${endAt.toISOString()})`);
  return tournament;
}

/**
 * Update tournament standings from SQLite
 */
function updateStandings(tournament) {
  const botIds = tournament.participants.map(p => p.id);
  const statsMap = getBotStats(botIds);
  
  // Build participant snapshot map
  const snapshotMap = new Map();
  for (const p of tournament.participants) {
    snapshotMap.set(p.id, p);
  }
  
  const standings = [];
  for (const p of tournament.participants) {
    const stats = statsMap.get(p.id);
    const currentPnl = stats?.total_pnl || 0;
    const snapshotPnl = p.snapshot_pnl || 0;
    const tournamentPnl = currentPnl - snapshotPnl;
    
    // Get battle stats during tournament period
    const battleStats = getBattleStatsInPeriod(p.id, tournament.start_at);
    
    standings.push({
      bot_id: p.id,
      bot_name: p.name,
      snapshot_pnl: snapshotPnl,
      current_pnl: currentPnl,
      tournament_pnl: tournamentPnl,
      tournament_pnl_pct: snapshotPnl !== 0 ? (tournamentPnl / Math.abs(snapshotPnl)) * 100 : 0,
      trades_count: battleStats.count,
      wins: battleStats.wins,
      win_rate: battleStats.winRate,
      elo: stats?.elo || 1500,
    });
  }
  
  // Sort by tournament PnL
  standings.sort((a, b) => b.tournament_pnl - a.tournament_pnl);
  standings.forEach((s, i) => { s.rank = i + 1; });
  
  tournament.standings = standings;
  tournament.last_updated = new Date().toISOString();
  saveTournament(tournament);
  
  const top = standings[0];
  log(`Updated ${standings.length} entries (top: ${top?.bot_name} $${top?.tournament_pnl?.toFixed(2) || '0'}, ${standings.length} bots total)`);
}

/**
 * Enroll new bots that started trading after tournament began
 */
function enrollNewBots(tournament) {
  const allBots = getActiveTradingBots();
  const enrolledIds = new Set(tournament.participants.map(p => p.id));
  const newBots = allBots.filter(b => !enrolledIds.has(b.id));
  
  if (newBots.length === 0) return;
  
  const statsMap = getBotStats(newBots.map(b => b.id));
  
  for (const bot of newBots) {
    const stats = statsMap.get(bot.id);
    tournament.participants.push({
      id: bot.id,
      name: bot.name,
      nfa_id: null,
      ai_model: null,
      trading_style: 'default',
      snapshot_pnl: stats?.total_pnl || 0,
      snapshot_trades: stats?.total_trades || 0,
      snapshot_elo: stats?.elo || 1500,
    });
  }
  
  tournament.total_participants = tournament.participants.length;
  log(`Enrolled ${newBots.length} new bots (total: ${tournament.total_participants})`);
}

/**
 * Finalize tournament
 */
function finalizeTournament(tournament) {
  log(`Finalizing: "${tournament.name}"`);
  
  // Final standings update
  enrollNewBots(tournament);
  updateStandings(tournament);
  
  const standings = tournament.standings || [];
  const top3 = standings.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  
  log(`🏆 Tournament "${tournament.name}" Results:`);
  top3.forEach((s, i) => {
    log(`  ${medals[i]} #${i + 1}: ${s.bot_name} — $${s.tournament_pnl?.toFixed(2)} (${s.trades_count} battles, ${s.win_rate?.toFixed(1)}% WR, ELO ${s.elo?.toFixed(0)})`);
  });
  
  tournament.status = 'finished';
  tournament.finished_at = new Date().toISOString();
  saveTournament(tournament);
  archiveTournament(tournament);
  
  log(`Tournament "${tournament.name}" completed.`);
}

/**
 * Start new tournament for current week
 */
function startNewTournament() {
  const now = new Date();
  const weekNum = getISOWeekNumber(now);
  const { start, end } = getWeekBounds(now);
  const name = `Trading League Week #${weekNum}`;
  
  return createTournament(name, start, end);
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

let lastHourlyUpdate = 0;

function tick() {
  try {
    const now = new Date();
    let tournament = loadTournament();
    
    // 1. No tournament or finished → start new one
    if (!tournament || tournament.status === 'finished') {
      log('No active tournament. Starting new...');
      tournament = startNewTournament();
      lastHourlyUpdate = Date.now();
      return;
    }
    
    // 2. Tournament ended? → finalize + start new
    if (tournament.end_at && now >= new Date(tournament.end_at)) {
      finalizeTournament(tournament);
      log('Starting next tournament...');
      startNewTournament();
      lastHourlyUpdate = Date.now();
      return;
    }
    
    // 3. Hourly update
    if (Date.now() - lastHourlyUpdate >= HOURLY_UPDATE_MS) {
      enrollNewBots(tournament);
      updateStandings(tournament);
      lastHourlyUpdate = Date.now();
    }
    
  } catch (err) {
    log(`ERROR: ${err.message}`);
    console.error(err);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

function main() {
  log('═══════════════════════════════════════════════════');
  log('  GemBots Trading League Tournament Engine v2.0');
  log('  Source of truth: SQLite + tournament.json');
  log('═══════════════════════════════════════════════════');
  log(`DB: ${DB_PATH}`);
  log(`Tournament file: ${TOURNAMENT_FILE}`);
  log(`Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
  log(`Hourly update interval: ${HOURLY_UPDATE_MS / 1000}s`);
  
  // Startup delay
  setTimeout(() => {
    tick();
    setInterval(tick, CHECK_INTERVAL_MS);
    log('Tournament engine running. Press Ctrl+C to stop.');
  }, STARTUP_DELAY_MS);
}

main();
