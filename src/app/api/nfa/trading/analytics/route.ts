import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const TOURNAMENT_FILE = path.join(process.cwd(), 'data', 'tournament.json');

/**
 * GET /api/nfa/trading/analytics
 *
 * Returns aggregated platform stats.
 * Revenue/commissions: Supabase (real money).
 * Trading stats/active traders/tournament counts: SQLite (paper-trading source of truth).
 */
export async function GET(request: NextRequest) {
  let sqliteDb: Database.Database | null = null;
  try {
    const { searchParams } = new URL(request.url);
    const nfaId = searchParams.get('nfaId');

    // ─── Per-bot commission summary (Supabase — real money) ───
    if (nfaId) {
      const { data: commissions } = await supabase
        .from('trading_commissions')
        .select('amount_bnb, amount_usd, commission_type, created_at')
        .eq('nfa_id', parseInt(nfaId))
        .order('created_at', { ascending: false });

      const totalFeeBnb = (commissions || []).reduce((s, c) => s + (c.amount_bnb || 0), 0);
      const totalFeeUsd = (commissions || []).reduce((s, c) => s + (c.amount_usd || 0), 0);
      const tradeFees = (commissions || []).filter(c => c.commission_type === 'trade_fee');
      const tournamentFees = (commissions || []).filter(c => c.commission_type === 'tournament_entry');

      return NextResponse.json({
        nfaId: parseInt(nfaId),
        totalFeeBnb,
        totalFeeUsd,
        tradeFeesCount: tradeFees.length,
        tournamentFeesCount: tournamentFees.length,
        commissions: (commissions || []).slice(0, 50),
      });
    }

    // ─── Platform-wide analytics ───

    // Revenue from Supabase (real money tracking)
    const { data: revenueData } = await supabase
      .from('platform_revenue')
      .select('*')
      .order('date', { ascending: false });

    const totalRevenueBnb = (revenueData || []).reduce((s, r) => s + (r.total_commissions_bnb || 0), 0);
    const totalRevenueUsd = (revenueData || []).reduce((s, r) => s + (r.total_commissions_usd || 0), 0);
    const totalVolumeBnb = (revenueData || []).reduce((s, r) => s + (r.trade_volume_bnb || 0), 0);
    const totalVolumeUsd = (revenueData || []).reduce((s, r) => s + (r.trade_volume_usd || 0), 0);

    // Trading stats from SQLite (source of truth for paper-trading)
    sqliteDb = new Database(DB_PATH, { readonly: true });

    const battleStats = sqliteDb.prepare(`
      SELECT
        COUNT(*) as total_battles,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_battles
      FROM trading_battles
    `).get() as { total_battles: number; resolved_battles: number };

    const totalTrades = battleStats.resolved_battles * 2; // Each battle has 2 participants

    const activeTraderStats = sqliteDb.prepare(`
      SELECT COUNT(*) as count FROM trading_elo WHERE total_trades > 0
    `).get() as { count: number };
    const activeTraders = activeTraderStats.count;

    const avgTradeSize = totalTrades > 0 ? totalVolumeUsd / totalTrades : 0;

    // Tournament stats from tournament.json
    let tournamentsCompleted = 0;
    let avgParticipants = 0;
    let totalTournamentsRun = 0;
    const totalPrizeDistributed = 0;

    if (fs.existsSync(TOURNAMENT_FILE)) {
      try {
        const tournament = JSON.parse(fs.readFileSync(TOURNAMENT_FILE, 'utf8'));
        if (tournament) {
          totalTournamentsRun = parseInt(tournament.name?.match(/#(\d+)/)?.[1] || '1');
          tournamentsCompleted = tournament.status === 'finished' ? totalTournamentsRun : totalTournamentsRun - 1;
          avgParticipants = (tournament.participants || []).length;
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      totalRevenueBnb: parseFloat(totalRevenueBnb.toFixed(6)),
      totalRevenueUsd: parseFloat(totalRevenueUsd.toFixed(2)),
      totalTrades,
      totalVolumeBnb: parseFloat(totalVolumeBnb.toFixed(4)),
      totalVolumeUsd: parseFloat(totalVolumeUsd.toFixed(2)),
      activeTraders,
      avgTradeSize: parseFloat(avgTradeSize.toFixed(2)),
      tournamentsCompleted,
      totalTournamentsRun,
      avgParticipants: parseFloat(avgParticipants.toFixed(1)),
      totalPrizeDistributed: parseFloat(totalPrizeDistributed.toFixed(2)),
      daysTracked: (revenueData || []).length,
    });
  } catch (err) {
    console.error('GET /api/nfa/trading/analytics error:', err);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  } finally {
    sqliteDb?.close();
  }
}
