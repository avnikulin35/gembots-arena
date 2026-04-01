import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/nfa/battles?nfaId=0
 * 
 * Returns recent battle history for an NFA-linked bot, plus strategy style.
 */
export async function GET(request: NextRequest) {
  try {
    const nfaIdStr = request.nextUrl.searchParams.get('nfaId');
    if (!nfaIdStr) {
      return NextResponse.json({ success: false, error: 'nfaId required' }, { status: 400 });
    }
    const nfaId = parseInt(nfaIdStr);

    // Find the bot linked to this NFA
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .select('id, name, strategy, trading_style')
      .eq('nfa_id', nfaId)
      .maybeSingle();

    if (botError || !bot) {
      return NextResponse.json({
        success: true,
        battles: [],
        strategy: null,
        message: 'No bot linked to this NFA',
      });
    }

    // Fetch recent battles for this bot
    const { data: battlesRaw, error: battlesError } = await supabase
      .from('battles')
      .select('id, bot1_id, bot2_id, bot1_prediction, bot2_prediction, token_symbol, winner_id, status, resolved_at, created_at')
      .or(`bot1_id.eq.${bot.id},bot2_id.eq.${bot.id}`)
      .eq('status', 'resolved')
      .order('resolved_at', { ascending: false })
      .limit(20);

    if (battlesError) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch battles: ' + battlesError.message },
        { status: 500 }
      );
    }

    // Get bot names for display
    const allBotIds = new Set<number>();
    (battlesRaw || []).forEach(b => {
      allBotIds.add(b.bot1_id);
      allBotIds.add(b.bot2_id);
    });

    const { data: allBots } = await supabase
      .from('bots')
      .select('id, name')
      .in('id', Array.from(allBotIds));

    const botNames: Record<number, string> = {};
    (allBots || []).forEach(b => { botNames[b.id] = b.name; });

    const battles = (battlesRaw || []).map(b => ({
      id: b.id,
      bot1_name: botNames[b.bot1_id] || `Bot #${b.bot1_id}`,
      bot2_name: botNames[b.bot2_id] || `Bot #${b.bot2_id}`,
      winner_name: b.winner_id ? (botNames[b.winner_id] || `Bot #${b.winner_id}`) : null,
      token_symbol: b.token_symbol,
      bot1_prediction: b.bot1_prediction,
      bot2_prediction: b.bot2_prediction,
      resolved_at: b.resolved_at || b.created_at,
      is_win: b.winner_id === bot.id,
    }));

    return NextResponse.json({
      success: true,
      battles,
      strategy: bot.strategy || bot.strategy || null,
      botName: bot.name,
    });
  } catch (error: unknown) {
    const e = error as Error;
    return NextResponse.json(
      { success: false, error: e.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
