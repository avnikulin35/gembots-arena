// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIP } from '@/lib/rate-limit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

// POST /api/user/bot/activate - Activate/deactivate bot
export async function POST(request: NextRequest) {
  // Rate limit
  const ip = getClientIP(request);
  const { allowed } = rateLimit(`user-bot-activate:${ip}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const body = await request.json();
  const { botId, active = true } = body;
  
  if (!botId) {
    return NextResponse.json({ error: 'Bot ID required' }, { status: 400 });
  }
  
  try {
    // Update user_bots
    const { error } = await supabase
      .from('user_bots')
      .update({ is_active: active })
      .eq('bot_id', botId);
    
    if (error) {
      console.error('Activate error:', error);
      return NextResponse.json({ error: 'Failed to activate bot' }, { status: 500 });
    }
    
    // If activating, try to find or create a battle
    if (active) {
      // Find a waiting room to join or create one
      const { data: waitingRoom } = await supabase
        .from('rooms')
        .select('*')
        .eq('status', 'waiting')
        .neq('host_bot_id', botId)
        .limit(1)
        .single();
      
      if (waitingRoom) {
        // Join the room
        await supabase
          .from('rooms')
          .update({
            challenger_bot_id: botId,
            status: 'in_battle',
            started_at: new Date().toISOString(),
          })
          .eq('id', waitingRoom.id);
        
        console.log(`Bot ${botId} joined room ${waitingRoom.id}`);
      } else {
        // Create a new room
        await supabase
          .from('rooms')
          .insert({
            host_bot_id: botId,
            status: 'waiting',
            spectators: 0,
          });
        
        console.log(`Bot ${botId} created a new room`);
      }
    }
    
    return NextResponse.json({ success: true, active });
    
  } catch (error) {
    console.error('Activate bot error:', error);
    return NextResponse.json({ error: 'Failed to activate bot' }, { status: 500 });
  }
}
