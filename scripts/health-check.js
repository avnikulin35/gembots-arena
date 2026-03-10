#!/usr/bin/env node
// GemBots Health Check — run via: node scripts/health-check.js
// Checks: matchmaker alive, resolver alive, dead bots, entry_price coverage, battle flow

const { execSync } = require('child_process');

async function main() {
  const issues = [];
  
  // 1. PM2 processes
  try {
    const pm2 = execSync('pm2 jlist 2>/dev/null').toString();
    const procs = JSON.parse(pm2);
    for (const name of ['gembots-matchmaker', 'gembots-resolver']) {
      const p = procs.find(x => x.name === name);
      if (!p) issues.push(`🔴 ${name} not found in PM2`);
      else if (p.pm2_env.status !== 'online') issues.push(`🔴 ${name} status: ${p.pm2_env.status}`);
      else console.log(`✅ ${name}: online (pid ${p.pid}, uptime ${Math.round(p.pm2_env.pm_uptime ? (Date.now()-p.pm2_env.pm_uptime)/60000 : 0)}m)`);
    }
  } catch(e) { issues.push('🔴 PM2 check failed: ' + e.message); }

  // 2. Database checks via psql
  const PGCMD = 'PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -t -c';
  
  // Dead bots
  const deadBots = parseInt(execSync(`${PGCMD} "SELECT COUNT(*) FROM bots WHERE is_npc=true AND hp=0;"`).toString().trim());
  if (deadBots > 10) issues.push(`🟡 ${deadBots} dead NPC bots (hp=0)`);
  else console.log(`✅ Dead bots: ${deadBots}`);

  // Active battles
  const activeBattles = parseInt(execSync(`${PGCMD} "SELECT COUNT(*) FROM battles WHERE status='active';"`).toString().trim());
  console.log(`📊 Active battles: ${activeBattles}`);

  // Entry price coverage (last hour)
  const entryStats = execSync(`${PGCMD} "SELECT COUNT(*) FILTER (WHERE entry_price IS NOT NULL) || '/' || COUNT(*) FROM battles WHERE status='active';"`).toString().trim();
  console.log(`📊 Entry price coverage (active): ${entryStats}`);

  // Battles resolved in last hour
  const recentResolved = parseInt(execSync(`${PGCMD} "SELECT COUNT(*) FROM battles WHERE status='resolved' AND finished_at > NOW() - INTERVAL '1 hour';"`).toString().trim());
  if (recentResolved === 0) issues.push('🔴 No battles resolved in last hour!');
  else console.log(`✅ Resolved last hour: ${recentResolved}`);

  // Bot names in recent battles
  const noNames = parseInt(execSync(`${PGCMD} "SELECT COUNT(*) FROM battles WHERE created_at > NOW() - INTERVAL '1 hour' AND (bot1_name IS NULL OR bot1_name='');"`).toString().trim());
  if (noNames > 5) issues.push(`🟡 ${noNames} recent battles without bot names`);

  // Summary
  console.log('\n' + (issues.length === 0 ? '✅ All checks passed!' : '⚠️ Issues found:\n' + issues.join('\n')));
  process.exit(issues.some(i => i.startsWith('🔴')) ? 1 : 0);
}

main().catch(e => { console.error('Health check failed:', e); process.exit(1); });
