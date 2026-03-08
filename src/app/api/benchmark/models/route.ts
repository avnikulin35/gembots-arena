import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const rateLimited = checkRateLimit(request, 20, 60_000);
  if (rateLimited) return rateLimited;

  try {
    const supabase = getSupabase();

    const { data: bots, error } = await supabase
      .from('bots')
      .select('model_id, ai_model, elo, wins, losses, total_battles');

    if (error) throw error;

    // Group by model
    const modelMap = new Map<string, {
      bots_count: number;
      total_elo: number;
      total_wins: number;
      total_losses: number;
      total_battles: number;
    }>();

    (bots || []).forEach((b) => {
      const modelName = b.model_id || b.ai_model || 'unknown';
      const existing = modelMap.get(modelName) || {
        bots_count: 0,
        total_elo: 0,
        total_wins: 0,
        total_losses: 0,
        total_battles: 0,
      };

      existing.bots_count++;
      existing.total_elo += b.elo ?? 1000;
      existing.total_wins += b.wins ?? 0;
      existing.total_losses += b.losses ?? 0;
      existing.total_battles += b.total_battles ?? (b.wins ?? 0) + (b.losses ?? 0);

      modelMap.set(modelName, existing);
    });

    const data = Array.from(modelMap.entries())
      .map(([model_name, stats]) => {
        const totalGames = stats.total_wins + stats.total_losses;
        return {
          model_name,
          bots_count: stats.bots_count,
          avg_elo: Math.round(stats.total_elo / stats.bots_count),
          avg_win_rate: totalGames > 0
            ? parseFloat(((stats.total_wins / totalGames) * 100).toFixed(1))
            : 0,
          total_battles: stats.total_battles,
        };
      })
      .sort((a, b) => b.avg_elo - a.avg_elo);

    return NextResponse.json(
      {
        data,
        meta: { total: data.length },
      },
      { headers: CORS_HEADERS }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Models API error:', message);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
