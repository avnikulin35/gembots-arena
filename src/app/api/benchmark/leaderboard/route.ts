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
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const rateLimited = checkRateLimit(request, 20, 60_000);
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const supabase = getSupabase();

    // Total count
    const { count: total } = await supabase
      .from('bots')
      .select('id', { count: 'exact', head: true });

    // Leaderboard data
    const { data: bots, error } = await supabase
      .from('bots')
      .select('name, strategy, elo, wins, losses, total_battles, is_active')
      .order('elo', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const data = (bots || []).map((b) => ({
      bot_name: b.name,
      strategy: b.strategy,
      elo: b.elo ?? 1000,
      wins: b.wins ?? 0,
      losses: b.losses ?? 0,
      win_rate:
        (b.wins ?? 0) + (b.losses ?? 0) > 0
          ? parseFloat((((b.wins ?? 0) / ((b.wins ?? 0) + (b.losses ?? 0))) * 100).toFixed(1))
          : 0,
      total_battles: b.total_battles ?? (b.wins ?? 0) + (b.losses ?? 0),
    }));

    return NextResponse.json(
      {
        data,
        meta: {
          total: total ?? 0,
          limit,
          offset,
          has_more: offset + limit < (total ?? 0),
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Leaderboard API error:', message);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
