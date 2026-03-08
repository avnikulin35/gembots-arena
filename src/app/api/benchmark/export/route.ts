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
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  // Stricter rate limit for CSV export: 2 per minute
  const rateLimited = checkRateLimit(request, 2, 60_000);
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 365);
    const format = searchParams.get('format') || 'csv';

    if (format !== 'csv') {
      return NextResponse.json(
        { error: 'Only CSV format is supported. Use ?format=csv' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const supabase = getSupabase();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch battles
    const { data: battles, error } = await supabase
      .from('battles')
      .select('id, bot1_id, bot2_id, winner_id, token_symbol, created_at, bot1_prediction, bot2_prediction, status')
      .eq('status', 'resolved')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) throw error;

    // Get bot names
    const botIds = new Set<number>();
    (battles || []).forEach((b) => {
      if (b.bot1_id) botIds.add(b.bot1_id);
      if (b.bot2_id) botIds.add(b.bot2_id);
      if (b.winner_id) botIds.add(b.winner_id);
    });

    const { data: botData } = botIds.size > 0
      ? await supabase.from('bots').select('id, name, strategy, ai_model, model_id').in('id', Array.from(botIds))
      : { data: [] };

    const botMap: Record<number, { name: string; strategy: string; model: string }> = {};
    (botData || []).forEach((b) => {
      botMap[b.id] = {
        name: b.name || `Bot #${b.id}`,
        strategy: b.strategy || 'unknown',
        model: b.model_id || b.ai_model || 'unknown',
      };
    });

    // Build CSV
    const header = 'id,created_at,bot1_name,bot1_strategy,bot1_model,bot1_prediction,bot2_name,bot2_strategy,bot2_model,bot2_prediction,winner,token_symbol';
    const rows = (battles || []).map((b) => {
      const bot1 = botMap[b.bot1_id] || { name: `Bot #${b.bot1_id}`, strategy: '', model: '' };
      const bot2 = botMap[b.bot2_id] || { name: `Bot #${b.bot2_id}`, strategy: '', model: '' };
      const winner = b.winner_id ? (botMap[b.winner_id]?.name || `Bot #${b.winner_id}`) : 'Draw';

      return [
        b.id,
        b.created_at,
        csvEscape(bot1.name),
        csvEscape(bot1.strategy),
        csvEscape(bot1.model),
        b.bot1_prediction ?? '',
        csvEscape(bot2.name),
        csvEscape(bot2.strategy),
        csvEscape(bot2.model),
        b.bot2_prediction ?? '',
        csvEscape(winner),
        csvEscape(b.token_symbol || ''),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="gembots-battles-${days}d.csv"`,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Export API error:', message);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
