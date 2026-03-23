const Database = require('better-sqlite3');
const db = new Database('data/gembots.db', {readonly:true});
for (const t of ['api_bots','trading_portfolio','trading_elo','trading_battles']) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${t})`).all();
    console.log('\nTABLE', t);
    rows.forEach(r=>console.log(`  ${r.name} ${r.type}`));
  } catch(e) { console.log('ERR', t, e.message); }
}
db.close();
