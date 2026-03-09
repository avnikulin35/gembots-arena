import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { getModelDisplayName } from '@/lib/model-display';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function supaCount(table: string, filter?: string): Promise<number> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=id&${filter || ''}&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
    },
    cache: 'no-store',
  });
  const range = res.headers.get('content-range');
  if (range) {
    const match = range.match(/\/(\d+)/);
    if (match) return parseInt(match[1]);
  }
  return 0;
}

// Read recent matches from perpetual tournament state
function getRecentTournamentMatches(): any[] {
  try {
    const tournamentPath = path.join(process.cwd(), 'data', 'tournament.json');
    const data = JSON.parse(fs.readFileSync(tournamentPath, 'utf8'));
    
    // Collect all finished matches from rounds
    const allMatches: any[] = [];
    const rounds = data.rounds || {};
    for (const [roundNum, matches] of Object.entries(rounds)) {
      for (const m of matches as any[]) {
        if (m.status === 'finished' && m.winnerId) {
          allMatches.push({
            id: `pt-${m.battleId || m.matchOrder}`,
            bot1: m.bot1Name || 'Unknown',
            bot2: m.bot2Name || 'Unknown',
            winner: m.winnerId === m.bot1Id ? (m.bot1Name || 'Unknown') : (m.bot2Name || 'Unknown'),
            token: data.currentMatch?.token || 'BTC',
            resolvedAt: new Date().toISOString(), // perpetual matches are recent
          });
        }
      }
    }
    
    // Return last 5
    return allMatches.slice(-5).reverse();
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const supabase = getSupabase();

    // Total battles — sum wins+losses from top bot divided by 2, or sum all bot wins
    // More accurate: sum all wins from bots table (each battle has exactly 1 winner)
    const { data: totalWinsData } = await supabase
      .from('bots')
      .select('wins');
    const totalFromBots = (totalWinsData || []).reduce((sum, b) => sum + (b.wins || 0), 0);
    
    // Also get supabase battles count for comparison
    const supabaseBattles = await supaCount('battles', 'status=eq.resolved');
    
    // Count Trading League battles (new P&L-based system)
    let tradingLeagueBattles = 0;
    try {
      const Database = require('better-sqlite3');
      const sqliteDb = new Database(path.join(process.cwd(), 'data', 'gembots.db'));
      const row = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM trading_battles").get() as any;
      tradingLeagueBattles = row?.cnt || 0;
      sqliteDb.close();
    } catch {}

    // Use the higher number (bots table includes perpetual tournament battles) + Trading League
    const classicBattles = Math.max(totalFromBots, supabaseBattles);
    const totalBattles = classicBattles + tradingLeagueBattles;

    // Total bots
    const totalBots = await supaCount('bots');
    const activeBots = totalBots;

    // Top 3 bots by ELO
    const { data: topBots } = await supabase
      .from('bots')
      .select('id, name, elo, wins, losses, league, win_streak, peak_elo, model_id')
      .order('elo', { ascending: false })
      .limit(3);

    // Recent battles — prefer perpetual tournament (live), fallback to supabase
    let enrichedBattles = getRecentTournamentMatches();
    
    if (enrichedBattles.length === 0) {
      // Fallback: last 5 from supabase
      const { data: recentBattles } = await supabase
        .from('battles')
        .select('id, bot1_id, bot2_id, winner_id, token_symbol, created_at, finished_at, status')
        .eq('status', 'resolved')
        .order('finished_at', { ascending: false })
        .limit(5);

      if (recentBattles && recentBattles.length > 0) {
        const botIds = new Set<number>();
        recentBattles.forEach((b) => {
          if (b.bot1_id) botIds.add(b.bot1_id);
          if (b.bot2_id) botIds.add(b.bot2_id);
          if (b.winner_id) botIds.add(b.winner_id);
        });

        const { data: botNames } = await supabase
          .from('bots')
          .select('id, name')
          .in('id', Array.from(botIds));

        const nameMap: Record<number, string> = {};
        botNames?.forEach((b) => (nameMap[b.id] = b.name));

        enrichedBattles = recentBattles.map((b) => ({
          id: b.id,
          bot1: nameMap[b.bot1_id] || `Bot #${b.bot1_id}`,
          bot2: nameMap[b.bot2_id] || `Bot #${b.bot2_id}`,
          winner: b.winner_id ? (nameMap[b.winner_id] || `Bot #${b.winner_id}`) : 'Draw',
          token: b.token_symbol || '???',
          resolvedAt: b.finished_at || b.created_at,
        }));
      }
    }

    // Arena start date
    const { data: firstBattle } = await supabase
      .from('battles')
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1);

    const arenaStartDate = firstBattle?.[0]?.created_at || null;

    // Avg battles per day
    let avgBattlesPerDay = 0;
    if (arenaStartDate && totalBattles > 0) {
      const start = new Date(arenaStartDate);
      const now = new Date();
      const daysDiff = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      avgBattlesPerDay = Math.round((totalBattles / daysDiff) * 10) / 10;
    }

    // Perpetual tournaments — count from tournament ID pattern
    let totalTournaments = 6; // legacy tournaments
    try {
      const tournamentPath = path.join(process.cwd(), 'data', 'tournament.json');
      const tData = JSON.parse(fs.readFileSync(tournamentPath, 'utf8'));
      const match = tData.id?.match(/perpetual-(\d+)-/);
      if (match) {
        totalTournaments = 6 + parseInt(match[1]); // legacy + perpetual
      }
    } catch {}

    // Trading League leaderboard (top 3)
    let tradingLeagueTop: any[] = [];
    try {
      const Database = require('better-sqlite3');
      const sqliteDb = new Database(path.join(process.cwd(), 'data', 'gembots.db'));
      tradingLeagueTop = sqliteDb.prepare(`
        SELECT te.*, ab.name FROM trading_elo te
        JOIN api_bots ab ON ab.id = te.bot_id
        ORDER BY te.elo DESC LIMIT 3
      `).all();
      sqliteDb.close();
    } catch {}

    return NextResponse.json({
      totalBattles,
      classicBattles,
      tradingLeagueBattles,
      totalBots,
      activeBots,
      totalTournaments,
      avgBattlesPerDay,
      arenaStartDate,
      topBots: (topBots || []).map((b) => ({
        id: b.id,
        name: b.name || 'Unknown',
        elo: b.elo || 1000,
        wins: b.wins || 0,
        losses: b.losses || 0,
        league: b.league || 'bronze',
        winStreak: b.win_streak || 0,
        peakElo: b.peak_elo || 1000,
        aiModel: b.model_id ? getModelDisplayName(b.model_id) : null,
      })),
      recentBattles: enrichedBattles,
      tradingLeague: {
        totalBattles: tradingLeagueBattles,
        topBots: tradingLeagueTop,
      },
    });
  } catch (e: any) {
    console.error('Stats API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
