#!/usr/bin/env node
// GemBots Health Check — run via: node scripts/health-check.js
// Checks: PM2 processes, SQLite battle freshness, gembots.space HTTP 200

const { execSync } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const REQUIRED_PM2_PROCESSES = [
  'gembots-web',
  'trading-battles',
  'trading-tournament',
  'battle-commentator',
];

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function minutesSince(timestamp) {
  if (!timestamp) return null;
  const ms = Date.now() - new Date(timestamp.replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 60000);
}

async function main() {
  const issues = [];
  let db;

  // 1. PM2 processes
  try {
    const procs = JSON.parse(run('pm2 jlist 2>/dev/null'));

    for (const name of REQUIRED_PM2_PROCESSES) {
      const p = procs.find(x => x.name === name);
      if (!p) {
        issues.push(`🔴 ${name} not found in PM2`);
        continue;
      }

      const status = p.pm2_env?.status;
      if (status !== 'online') {
        issues.push(`🔴 ${name} status: ${status || 'unknown'}`);
        continue;
      }

      const uptimeMin = p.pm2_env?.pm_uptime
        ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 60000)
        : 0;

      console.log(`✅ ${name}: online (pid ${p.pid}, uptime ${uptimeMin}m)`);
    }
  } catch (e) {
    issues.push('🔴 PM2 check failed: ' + e.message);
  }

  // 2. SQLite battle freshness
  try {
    const dbPath = path.join(process.cwd(), 'data', 'gembots.db');
    db = new Database(dbPath, { readonly: true });

    const startedLastHour = db.prepare(`
      SELECT COUNT(*) AS count
      FROM trading_battles
      WHERE datetime(started_at) > datetime('now', '-1 hour')
    `).get().count;

    const resolvedLastHour = db.prepare(`
      SELECT COUNT(*) AS count
      FROM trading_battles
      WHERE resolved_at IS NOT NULL
        AND datetime(resolved_at) > datetime('now', '-1 hour')
    `).get().count;

    const latestBattle = db.prepare(`
      SELECT id, status, symbol, started_at, resolved_at
      FROM trading_battles
      ORDER BY datetime(COALESCE(resolved_at, started_at)) DESC
      LIMIT 1
    `).get();

    const latestTs = latestBattle?.resolved_at || latestBattle?.started_at;
    const latestAgeMin = minutesSince(latestTs);

    if ((startedLastHour + resolvedLastHour) === 0) {
      issues.push('🔴 No fresh trading_battles activity in SQLite for the last hour');
    } else {
      console.log(`✅ trading_battles freshness: started ${startedLastHour}/h, resolved ${resolvedLastHour}/h`);
      if (latestBattle) {
        console.log(
          `📊 Latest battle: ${latestBattle.id} | ${latestBattle.symbol || '?'} | ${latestBattle.status} | ${latestAgeMin ?? '?'}m ago`
        );
      }
    }
  } catch (e) {
    issues.push('🔴 SQLite check failed: ' + e.message);
  } finally {
    if (db) db.close();
  }

  // 3. Public site health
  try {
    const httpCode = run(`curl -L -s -o /dev/null -w "%{http_code}" https://gembots.space`);
    if (httpCode !== '200') {
      issues.push(`🔴 gembots.space returned HTTP ${httpCode}`);
    } else {
      console.log('✅ gembots.space: HTTP 200');
    }
  } catch (e) {
    issues.push('🔴 gembots.space check failed: ' + e.message);
  }

  // Summary
  console.log('\n' + (issues.length === 0 ? '✅ All checks passed!' : '⚠️ Issues found:\n' + issues.join('\n')));
  process.exit(issues.some(i => i.startsWith('🔴')) ? 1 : 0);
}

main().catch(e => {
  console.error('Health check failed:', e);
  process.exit(1);
});
