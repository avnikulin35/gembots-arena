#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[key.trim()] = v;
    }
  });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function check() {
  // 1. Tournament entries
  const entriesRes = await fetch(`${SUPABASE_URL}/rest/v1/trading_tournament_entries?tournament_id=eq.4&order=rank.asc&limit=5`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const entries = await entriesRes.json();
  console.log('=== Tournament 4 entries (top 5) ===');
  entries.forEach(e => console.log(`  bot=${e.bot_id} snapshot=${e.snapshot_pnl_usd} current=${e.current_pnl_usd} tournament_pnl=${e.tournament_pnl_usd} trades=${e.trades_count}`));

  // 2. Check nfa_trading_stats for a few bots
  const botIds = entries.slice(0, 3).map(e => e.bot_id);
  console.log('\n=== Trading stats for first 3 bots ===');
  for (const id of botIds) {
    const statsRes = await fetch(`${SUPABASE_URL}/rest/v1/nfa_trading_stats?nfa_id=eq.${id}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const stats = await statsRes.json();
    console.log(`  bot ${id}: ${JSON.stringify(stats)}`);
  }

  // 3. Check recent trades
  console.log('\n=== Recent nfa_trades (last 5) ===');
  const tradesRes = await fetch(`${SUPABASE_URL}/rest/v1/nfa_trades?order=created_at.desc&limit=5`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const trades = await tradesRes.json();
  trades.forEach(t => console.log(`  id=${t.id} bot=${t.bot_id} pnl=${t.pnl_usd} status=${t.status} open=${t.open_at}`));

  // 4. Check how many trades total exist
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/nfa_trades?select=id&order=id.desc&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact' }
  });
  const countHeader = countRes.headers.get('content-range');
  console.log(`\n=== Total trades: content-range: ${countHeader} ===`);

  // 5. Check bots trading config
  console.log('\n=== Bots with trading_mode != off (first 5) ===');
  const botsRes = await fetch(`${SUPABASE_URL}/rest/v1/bots?trading_mode=neq.off&select=id,name,trading_mode&limit=5`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const bots = await botsRes.json();
  bots.forEach(b => console.log(`  id=${b.id} name=${b.name} mode=${b.trading_mode}`));
}

check().catch(console.error);
