// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIP } from '@/lib/rate-limit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

// GET /api/user/bot - Get user's bot
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet');
  
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet required' }, { status: 400 });
  }
  
  try {
    // Check if user exists (works for both wallet addresses and guest IDs)
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('wallet_address', wallet)
      .single();
    
    if (!user) {
      // For GET, don't auto-create user — just return null
      return NextResponse.json({ bot: null });
    }
    
    // Get user's bot
    const { data: userBot } = await supabase
      .from('user_bots')
      .select('*, bot:bots(*)')
      .eq('user_id', user.id)
      .single();
    
    if (!userBot || !userBot.bot) {
      return NextResponse.json({ bot: null });
    }
    
    return NextResponse.json({
      bot: {
        id: userBot.bot.id,
        name: userBot.bot.name,
        strategy: userBot.strategy,
        hp: userBot.bot.hp,
        wins: userBot.bot.wins,
        losses: userBot.bot.losses,
        is_active: userBot.is_active,
      },
    });
    
  } catch (error) {
    console.error('Get user bot error:', error);
    return NextResponse.json({ bot: null });
  }
}

// POST /api/user/bot - Create bot for user
export async function POST(request: NextRequest) {
  // Rate limit
  const ip = getClientIP(request);
  const { allowed } = rateLimit(`user-bot:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const body = await request.json();
  const { wallet, name, strategy } = body;
  
  if (!wallet || !name) {
    return NextResponse.json({ error: 'Wallet and name required' }, { status: 400 });
  }
  
  try {
    // Get or create user
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('wallet_address', wallet)
      .single();
    
    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({ wallet_address: wallet })
        .select()
        .single();
      user = newUser;
    }
    
    if (!user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
    
    // Create bot
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .insert({
        name,
        telegram_id: `wallet_${wallet.slice(0, 8)}`,
        hp: 100,
        wins: 0,
        losses: 0,
        win_streak: 0,
        league: 'bronze',
        is_npc: false,
        avatar_state: 'neutral',
      })
      .select()
      .single();
    
    if (botError || !bot) {
      console.error('Bot creation error:', botError);
      return NextResponse.json({ error: 'Failed to create bot' }, { status: 500 });
    }
    
    // Link bot to user
    const { error: linkError } = await supabase
      .from('user_bots')
      .insert({
        user_id: user.id,
        bot_id: bot.id,
        strategy: strategy || 'conservative',
        is_active: false,
      });
    
    if (linkError) {
      console.error('Link error:', linkError);
    }
    
    return NextResponse.json({
      bot: {
        id: bot.id,
        name: bot.name,
        strategy: strategy || 'conservative',
        hp: bot.hp,
        wins: bot.wins,
        losses: bot.losses,
        is_active: false,
      },
    });
    
  } catch (error) {
    console.error('Create bot error:', error);
    return NextResponse.json({ error: 'Failed to create bot' }, { status: 500 });
  }
}
