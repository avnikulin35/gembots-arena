const Database = require('better-sqlite3');
const db = new Database('data/gembots.db', {readonly: true});

console.log('=== Trading Portfolio (top 10 by PnL) ===');
const rows = db.prepare('SELECT bot_id, balance, total_trades, total_pnl_usd FROM trading_portfolio ORDER BY total_pnl_usd DESC LIMIT 10').all();
rows.forEach(r => console.log(`  bot=${r.bot_id} balance=${(r.balance||0).toFixed(2)} trades=${r.total_trades} pnl=$${(r.total_pnl_usd||0).toFixed(2)}`));

console.log('\n=== Total resolved trading battles ===');
const cnt = db.prepare("SELECT count(id) as c FROM trading_battles WHERE status = 'resolved'").get();
console.log(`  ${cnt.c} battles`);

console.log('\n=== Last 5 resolved battles ===');
const recent = db.prepare("SELECT id, bot1_id, bot2_id, winner_id, bot1_pnl, bot2_pnl, resolved_at FROM trading_battles WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT 5").all();
recent.forEach(r => console.log(`  winner=${r.winner_id} pnl1=${(r.bot1_pnl||0).toFixed(4)} pnl2=${(r.bot2_pnl||0).toFixed(4)} at=${r.resolved_at}`));

console.log('\n=== Battles today ===');
const today = db.prepare("SELECT count(id) as c FROM trading_battles WHERE status = 'resolved' AND date(resolved_at) = date('now')").get();
console.log(`  ${today.c} battles today`);

db.close();
