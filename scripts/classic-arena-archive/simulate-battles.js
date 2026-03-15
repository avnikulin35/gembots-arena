#!/usr/bin/env node
/**
 * GemBots Battle Simulation
 * Creates player bots and simulates full battle flow against NPCs
 */

const BASE_URL = process.env.GEMBOTS_URL || 'http://localhost:3005';
const SUPABASE_URL = 'process.env.SUPABASE_URL';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Player bots to create
const PLAYER_BOTS = [
  { name: '🎮 PlayerOne', league: 'bronze' },
  { name: '🕹️ GamerX', league: 'silver' },
  { name: '🏆 ChampBot', league: 'gold' },
  { name: '💰 RichieRich', league: 'silver' },
  { name: '🔮 OracleAI', league: 'bronze' },
];

// Simulated tokens for battles
const TOKENS = [
  { symbol: 'PEPE', address: 'pepe123...pump' },
  { symbol: 'DOGE', address: 'doge456...pump' },
  { symbol: 'SHIB', address: 'shib789...pump' },
  { symbol: 'BONK', address: 'bonk012...pump' },
  { symbol: 'WIF', address: 'wif345...pump' },
];

async function supabaseRequest(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers,
    },
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error: ${res.status} - ${text}`);
  }
  
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function apiRequest(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json();
}

// Step 1: Create player bots
async function createPlayerBots() {
  console.log('\n🤖 Creating player bots...\n');
  
  const createdBots = [];
  
  for (const bot of PLAYER_BOTS) {
    // Check if exists
    const existing = await supabaseRequest(`bots?name=eq.${encodeURIComponent(bot.name)}&limit=1`);
    
    if (existing.length > 0) {
      console.log(`  ✓ ${bot.name} already exists (id: ${existing[0].id})`);
      createdBots.push(existing[0]);
      continue;
    }
    
    // Create new
    const [created] = await supabaseRequest('bots', {
      method: 'POST',
      body: JSON.stringify({
        name: bot.name,
        telegram_id: `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        hp: 100,
        wins: Math.floor(Math.random() * 10),
        losses: Math.floor(Math.random() * 5),
        win_streak: 0,
        league: bot.league,
        is_npc: false,
        avatar_state: 'neutral',
      }),
    });
    
    console.log(`  ✓ Created ${bot.name} (id: ${created.id})`);
    createdBots.push(created);
  }
  
  return createdBots;
}

// Step 2: Get available rooms
async function getAvailableRooms() {
  console.log('\n🏟️ Fetching available rooms...\n');
  
  const data = await apiRequest('/api/arena/lobby');
  const waitingRooms = (data.rooms || []).filter(r => r.status === 'waiting');
  
  console.log(`  Found ${waitingRooms.length} waiting rooms`);
  waitingRooms.forEach(r => {
    console.log(`    - ${r.host_bot?.name || 'Unknown'} (${r.id.slice(0, 8)}...) ${r.stake_amount ? `💰 ${r.stake_amount} SOL` : ''}`);
  });
  
  return waitingRooms;
}

// Step 3: Player joins a room
async function joinRoom(playerBot, room) {
  console.log(`\n⚔️ ${playerBot.name} challenging ${room.host_bot?.name}...`);
  
  // Update room in Supabase directly
  const [updated] = await supabaseRequest(`rooms?id=eq.${room.id}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({
      challenger_bot_id: playerBot.id,
      status: 'in_battle',
      started_at: new Date().toISOString(),
    }),
  });
  
  console.log(`  ✓ Room status: in_battle`);
  return updated;
}

// Step 4: Create battle
async function createBattle(room, hostBot, challengerBot) {
  const token = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const entryPrice = (Math.random() * 0.001).toFixed(10);
  
  console.log(`\n🎯 Battle created for $${token.symbol}`);
  
  // Both bots make predictions (1x - 10x)
  const bot1Prediction = (1 + Math.random() * 9).toFixed(2);
  const bot2Prediction = (1 + Math.random() * 9).toFixed(2);
  
  console.log(`  ${hostBot.name} predicts: ${bot1Prediction}x`);
  console.log(`  ${challengerBot.name} predicts: ${bot2Prediction}x`);
  
  const [battle] = await supabaseRequest('battles', {
    method: 'POST',
    body: JSON.stringify({
      room_id: room.id,
      round_number: 1,
      bot1_id: hostBot.id,
      bot2_id: challengerBot.id,
      token_address: token.address,
      token_symbol: token.symbol,
      entry_price: parseFloat(entryPrice),
      bot1_prediction: parseFloat(bot1Prediction),
      bot2_prediction: parseFloat(bot2Prediction),
      status: 'active',
      resolves_at: new Date(Date.now() + 60000).toISOString(), // 1 min
    }),
  });
  
  console.log(`  ✓ Battle ID: ${battle.id.slice(0, 8)}...`);
  return battle;
}

// Step 5: Resolve battle
async function resolveBattle(battle, hostBot, challengerBot) {
  // Simulate actual price movement (0.1x to 10x)
  const actualX = (0.1 + Math.random() * 9.9).toFixed(2);
  
  console.log(`\n📊 Resolving battle... Actual: ${actualX}x`);
  
  // Calculate who won (closer prediction wins)
  const bot1Diff = Math.abs(battle.bot1_prediction - actualX);
  const bot2Diff = Math.abs(battle.bot2_prediction - actualX);
  
  const winnerId = bot1Diff < bot2Diff ? battle.bot1_id : battle.bot2_id;
  const loserId = winnerId === battle.bot1_id ? battle.bot2_id : battle.bot1_id;
  const winnerBot = winnerId === hostBot.id ? hostBot : challengerBot;
  const loserBot = loserId === hostBot.id ? hostBot : challengerBot;
  
  // Damage based on prediction accuracy (5-20 HP)
  const damage = Math.floor(5 + Math.random() * 15);
  
  console.log(`  🏆 Winner: ${winnerBot.name} (diff: ${winnerId === battle.bot1_id ? bot1Diff.toFixed(2) : bot2Diff.toFixed(2)})`);
  console.log(`  💔 ${loserBot.name} takes ${damage} damage`);
  
  // Update battle
  await supabaseRequest(`battles?id=eq.${battle.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      actual_x: parseFloat(actualX),
      winner_id: winnerId,
      damage_dealt: damage,
      status: 'resolved',
    }),
  });
  
  // Update winner stats
  await supabaseRequest(`bots?id=eq.${winnerId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      wins: winnerBot.wins + 1,
      win_streak: winnerBot.win_streak + 1,
      avatar_state: 'winning',
    }),
  });
  
  // Update loser stats
  const newHp = Math.max(0, loserBot.hp - damage);
  await supabaseRequest(`bots?id=eq.${loserId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      losses: loserBot.losses + 1,
      win_streak: 0,
      hp: newHp,
      avatar_state: newHp <= 20 ? 'critical' : 'losing',
    }),
  });
  
  // Update room
  await supabaseRequest(`rooms?id=eq.${battle.room_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'finished',
      finished_at: new Date().toISOString(),
    }),
  });
  
  // Record predictions
  await supabaseRequest('predictions', {
    method: 'POST',
    body: JSON.stringify([
      {
        bot_id: battle.bot1_id,
        battle_id: battle.id,
        token_symbol: battle.token_symbol,
        predicted_x: battle.bot1_prediction,
        actual_x: parseFloat(actualX),
        accuracy: (100 - bot1Diff * 10).toFixed(2),
        is_winner: winnerId === battle.bot1_id,
      },
      {
        bot_id: battle.bot2_id,
        battle_id: battle.id,
        token_symbol: battle.token_symbol,
        predicted_x: battle.bot2_prediction,
        actual_x: parseFloat(actualX),
        accuracy: (100 - bot2Diff * 10).toFixed(2),
        is_winner: winnerId === battle.bot2_id,
      },
    ]),
  });
  
  console.log(`  ✓ Battle resolved!`);
  
  return { winnerId, loserId, damage, actualX };
}

// Main simulation
async function runSimulation() {
  console.log('═══════════════════════════════════════════');
  console.log('       🎮 GemBots Battle Simulation 🎮     ');
  console.log('═══════════════════════════════════════════');
  
  try {
    // 1. Create player bots
    const players = await createPlayerBots();
    
    // 2. Get rooms
    const rooms = await getAvailableRooms();
    
    if (rooms.length === 0) {
      console.log('\n❌ No rooms available!');
      return;
    }
    
    // 3. Run battles (match players with rooms)
    const numBattles = Math.min(players.length, rooms.length, 3); // Max 3 battles
    
    console.log(`\n🔥 Starting ${numBattles} battles...\n`);
    console.log('───────────────────────────────────────────');
    
    for (let i = 0; i < numBattles; i++) {
      const player = players[i];
      const room = rooms[i];
      const hostBot = room.host_bot;
      
      // Join room
      await joinRoom(player, room);
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 500));
      
      // Create and run battle
      const battle = await createBattle(room, hostBot, player);
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 500));
      
      // Resolve
      await resolveBattle(battle, hostBot, player);
      
      console.log('───────────────────────────────────────────');
    }
    
    // 4. Show final stats
    console.log('\n📊 Final Leaderboard:\n');
    
    const allBots = await supabaseRequest('bots?order=wins.desc&limit=10');
    allBots.forEach((bot, i) => {
      const emoji = bot.is_npc ? '🤖' : '🎮';
      console.log(`  ${i + 1}. ${emoji} ${bot.name} - ${bot.wins}W/${bot.losses}L (HP: ${bot.hp}, Streak: ${bot.win_streak})`);
    });
    
    console.log('\n═══════════════════════════════════════════');
    console.log('         ✅ Simulation Complete!           ');
    console.log('═══════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ Simulation error:', error.message);
    console.error(error.stack);
  }
}

// Run
runSimulation();
