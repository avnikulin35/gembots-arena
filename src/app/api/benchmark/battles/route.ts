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
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const botId = searchParams.get('bot_id');

    const supabase = getSupabase();

    // Build query
    let countQuery = supabase
      .from('battles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'resolved');

    let dataQuery = supabase
      .from('battles')
      .select('id, bot1_id, bot2_id, winner_id, token_symbol, created_at, bot1_prediction, bot2_prediction')
      .eq('status', 'resolved')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (botId) {
      const id = parseInt(botId, 10);
      countQuery = countQuery.or(`bot1_id.eq.${id},bot2_id.eq.${id}`);
      dataQuery = dataQuery.or(`bot1_id.eq.${id},bot2_id.eq.${id}`);
    }

    const [{ count: total }, { data: battles, error }] = await Promise.all([
      countQuery,
      dataQuery,
    ]);

    if (error) throw error;

    // Collect bot IDs for name lookup
    const botIds = new Set<number>();
    (battles || []).forEach((b) => {
      if (b.bot1_id) botIds.add(b.bot1_id);
      if (b.bot2_id) botIds.add(b.bot2_id);
      if (b.winner_id) botIds.add(b.winner_id);
    });

    const { data: botNames } = botIds.size > 0
      ? await supabase.from('bots').select('id, name').in('id', Array.from(botIds))
      : { data: [] };

    const nameMap: Record<number, string> = {};
    (botNames || []).forEach((b) => { nameMap[b.id] = b.name; });

    const data = (battles || []).map((b) => ({
      id: b.id,
      bot1_name: nameMap[b.bot1_id] || `Bot #${b.bot1_id}`,
      bot2_name: nameMap[b.bot2_id] || `Bot #${b.bot2_id}`,
      winner: b.winner_id ? (nameMap[b.winner_id] || `Bot #${b.winner_id}`) : 'Draw',
      token_symbol: b.token_symbol ?? null,
      created_at: b.created_at,
      bot1_prediction: b.bot1_prediction ?? null,
      bot2_prediction: b.bot2_prediction ?? null,
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
    console.error('Battles API error:', message);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
