import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, getClientIP } from '@/lib/rate-limit';

/**
 * POST /api/nfa/forge
 *
 * Saves NFA forge configuration (model, strategy, risk) before mint.
 * Returns a config ID that the frontend uses during the on-chain mint.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const { allowed } = rateLimit(`nfa-forge:${ip}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { name, modelId, strategy, riskLevel, wallet } = body;

    if (!name || !modelId || !strategy || !riskLevel || !wallet) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name, modelId, strategy, riskLevel, wallet' },
        { status: 400 }
      );
    }

    const validStrategies = ['momentum', 'scalper', 'swing', 'mean_reversion', 'contrarian'];
    const validRisks = ['conservative', 'moderate', 'aggressive'];

    if (!validStrategies.includes(strategy)) {
      return NextResponse.json({ success: false, error: 'Invalid strategy' }, { status: 400 });
    }
    if (!validRisks.includes(riskLevel)) {
      return NextResponse.json({ success: false, error: 'Invalid risk level' }, { status: 400 });
    }
    if (name.length > 24) {
      return NextResponse.json({ success: false, error: 'Name too long (max 24)' }, { status: 400 });
    }

    // Save forge config to Supabase
    const { data, error } = await supabase
      .from('nfa_forge_configs')
      .insert({
        name: name.trim(),
        model_id: modelId,
        strategy,
        risk_level: riskLevel,
        wallet: wallet.toLowerCase(),
        status: 'pending_mint',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // If table doesn't exist, still return success (non-critical)
      if (error.code === '42P01') {
        console.warn('nfa_forge_configs table not ready — returning mock success');
        return NextResponse.json({ success: true, nfaId: null, warning: 'Table not ready' });
      }
      console.error('Forge config save error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    console.log(`🔧 Forge config saved: ${name} | ${modelId} | ${strategy} | ${riskLevel}`);

    return NextResponse.json({ success: true, nfaId: data?.id || null });
  } catch (error: unknown) {
    const e = error as Error;
    console.error('Forge API error:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
