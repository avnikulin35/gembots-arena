import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getModelDisplayName } from '@/lib/model-display';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    
    // Get all bots with at least 1 battle, sorted by wins
    const { data: bots, error } = await supabase
      .from('bots')
      .select('id, name, wins, losses, hp, league, avatar_state, telegram_id, elo, peak_elo, total_battles, win_streak, ai_model, model_id, trading_style')
      .order('elo', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Leaderboard fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
    }

    if (!bots || bots.length === 0) {
      return NextResponse.json({ 
        leaderboard: [],
        stats: {
          totalBots: 0,
          totalBattles: 0,
          topWinRate: 0,
        }
      });
    }

    // Calculate win rates and filter bots with minimum 5 battles
    const processedBots = bots
      .map((bot) => {
        const totalBattles = (bot.wins || 0) + (bot.losses || 0);
        const winRate = totalBattles > 0 
          ? Math.round((bot.wins / totalBattles) * 100) 
          : 0;
        
        return {
          id: bot.id,
          name: bot.name || 'Unknown Bot',
          wins: bot.wins || 0,
          losses: bot.losses || 0,
          totalBattles,
          winRate,
          league: bot.league || 'bronze',
          hp: bot.hp || 100,
          elo: bot.elo || 1000,
          peakElo: bot.peak_elo || 1000,
          winStreak: bot.win_streak || 0,
          telegram_id: bot.telegram_id,
          aiModel: bot.model_id ? getModelDisplayName(bot.model_id) : (bot.ai_model || null),
          tradingStyle: bot.trading_style || null,
        };
      })
      .filter((bot) => bot.totalBattles >= 5)
      .sort((a, b) => {
        // Sort by ELO, then by win rate as tiebreaker
        if (b.elo !== a.elo) {
          return b.elo - a.elo;
        }
        return b.winRate - a.winRate;
      })
      .slice(0, 20);

    // Calculate overall stats
    // Each battle has 1 winner and 1 loser, so sum of all wins = total battles
    const totalBots = bots.length;
    const totalBattles = bots.reduce((sum, bot) => sum + (bot.wins || 0), 0);
    const topWinRate = processedBots.length > 0 ? processedBots[0].winRate : 0;

    return NextResponse.json({
      leaderboard: processedBots,
      stats: {
        totalBots,
        totalBattles,
        topWinRate,
      }
    });
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
