const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/gembots.db');
const EVOLUTION_LOG_PATH = path.join(__dirname, '../data/evolution-log.json');

/**
 * Trading League Auto-Evolution
 * 1. Анализирует trading_elo за последние N часов
 * 2. Находит bottom 20% по ELO
 * 3. Мутирует стратегии — берёт стратегию от top бота
 * 4. Логирует мутации
 */
async function autoEvolve() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const hoursIndex = args.indexOf('--hours');
    const hours = hoursIndex !== -1 ? parseInt(args[hoursIndex + 1]) : 6;

    console.log(`Running auto-evolution for Trading League (dryRun: ${dryRun}, hours: ${hours})`);

    let db;
    try {
        db = new Database(DB_PATH);
    } catch (error) {
        console.error(`Error connecting to database: ${error.message}`);
        process.exit(1);
    }

    const log = [];
    const timestamp = new Date().toISOString();

    try {
        // 1. Анализирует trading_elo за последние N часов (хоть и ELO - это текущее, но для фильтрации активных)
        // Для простоты, берём всех активных ботов, которые участвовали в битвах за последние N часов
        const activeBotsQuery = db.prepare(`
            SELECT DISTINCT t.bot_id
            FROM trading_battles tb
            JOIN trading_elo t ON tb.bot1_id = t.bot_id OR tb.bot2_id = t.bot_id
            WHERE tb.started_at >= DATETIME('now', ? || ' hours');
        `);
        const activeBotIds = activeBotsQuery.all(`-${hours}`).map(row => row.bot_id);

        if (activeBotIds.length === 0) {
            console.log('No active bots found in the last N hours. Exiting.');
            db.close();
            return;
        }

        // 2. Находит bottom 20% по ELO
        const allBotsWithEloQuery = db.prepare(`
            SELECT t.bot_id, t.elo, ab.name, ab.strategy
            FROM trading_elo t
            JOIN api_bots ab ON t.bot_id = ab.id
            WHERE t.bot_id IN (${activeBotIds.map(() => '?').join(',')})
            ORDER BY t.elo ASC;
        `);
        const allBotsWithElo = allBotsWithEloQuery.all(...activeBotIds);

        const numBots = allBotsWithElo.length;
        const numBottomBots = Math.ceil(numBots * 0.20);
        const bottomBots = allBotsWithElo.slice(0, numBottomBots);

        console.log(`Total active bots: ${numBots}, Bottom 20% bots to mutate: ${bottomBots.length}`);
        console.log('Bottom bots (before mutation):', bottomBots.map(b => `${b.name} (ELO: ${b.elo}, Strategy: ${b.strategy})`));

        // 3. Мутирует стратегии — берёт стратегию от top бота
        const topBots = allBotsWithElo.slice(Math.max(0, numBots - Math.ceil(numBots * 0.20))).reverse(); // Top 20%
        const topStrategies = topBots.map(b => b.strategy);
        const availableStrategies = ['trend_follower', 'scalper', 'momentum', 'swing', 'contrarian', 'mean_reversion'];

        const getNewStrategy = () => {
            if (topStrategies.length > 0) {
                return topStrategies[Math.floor(Math.random() * topStrategies.length)];
            }
            return availableStrategies[Math.floor(Math.random() * availableStrategies.length)];
        };

        const updateStrategyStmt = db.prepare('UPDATE api_bots SET strategy = ? WHERE id = ?');

        for (const bot of bottomBots) {
            const oldStrategy = bot.strategy;
            const newStrategy = getNewStrategy();

            if (!dryRun) {
                updateStrategyStmt.run(newStrategy, bot.bot_id);
            }

            const mutationEntry = {
                timestamp,
                bot_id: bot.bot_id,
                bot_name: bot.name,
                old_elo: bot.elo,
                old_strategy: oldStrategy,
                new_strategy: newStrategy,
                dry_run: dryRun,
            };
            log.push(mutationEntry);
            console.log(`  Mutated bot "${bot.name}" (ELO: ${bot.elo}): ${oldStrategy} -> ${newStrategy}`);
        }

        // 4. Логирует мутации
        if (log.length > 0) {
            let existingLog = [];
            if (fs.existsSync(EVOLUTION_LOG_PATH)) {
                existingLog = JSON.parse(fs.readFileSync(EVOLUTION_LOG_PATH, 'utf8'));
            }
            const updatedLog = existingLog.concat(log);
            fs.writeFileSync(EVOLUTION_LOG_PATH, JSON.stringify(updatedLog, null, 2), 'utf8');
            console.log(`Evolution log updated at ${EVOLUTION_LOG_PATH}`);
        } else {
            console.log('No mutations occurred, log not updated.');
        }

    } catch (error) {
        console.error(`Error during auto-evolution: ${error.message}`);
        log.push({ timestamp, error: error.message, dry_run: dryRun });
        fs.writeFileSync(EVOLUTION_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
    } finally {
        db.close();
        console.log('Database connection closed.');
    }
}

autoEvolve();
