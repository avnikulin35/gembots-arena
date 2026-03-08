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
    const supabase = getSupabase();

    // Total bots
    const { count: totalBots } = await supabase
      .from('bots')
      .select('id', { count: 'exact', head: true });

    // Total battles
    const { count: totalBattles } = await supabase
      .from('battles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'resolved');

    // Distinct models
    const { data: modelsData } = await supabase
      .from('bots')
      .select('model_id, ai_model');
    const uniqueModels = new Set(
      (modelsData || []).map((b) => b.model_id || b.ai_model).filter(Boolean)
    );

    // First and last battle
    const { data: firstBattle } = await supabase
      .from('battles')
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1);

    const { data: lastBattle } = await supabase
      .from('battles')
      .select('created_at')
      .eq('status', 'resolved')
      .order('created_at', { ascending: false })
      .limit(1);

    const startDate = firstBattle?.[0]?.created_at;
    const uptimeDays = startDate
      ? Math.ceil((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return NextResponse.json(
      {
        data: {
          total_battles: totalBattles ?? 0,
          total_bots: totalBots ?? 0,
          models_count: uniqueModels.size,
          uptime_days: uptimeDays,
          last_battle_at: lastBattle?.[0]?.created_at ?? null,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Benchmark API error:', message);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
