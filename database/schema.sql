-- GemBots Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. BOTS TABLE
CREATE TABLE bots (
  id SERIAL PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  name TEXT NOT NULL,
  public_key TEXT,
  hp INTEGER DEFAULT 100,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_streak INTEGER DEFAULT 0,
  league TEXT DEFAULT 'bronze' CHECK (league IN ('bronze', 'silver', 'gold', 'diamond')),
  avatar_state TEXT DEFAULT 'neutral',
  is_npc BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ROOMS TABLE (Lobby)
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_bot_id INTEGER REFERENCES bots(id),
  challenger_bot_id INTEGER REFERENCES bots(id),
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready', 'in_battle', 'finished')),
  stake_amount DECIMAL(10, 4),
  spectators INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- 3. BATTLES TABLE
CREATE TABLE battles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id),
  round_number INTEGER DEFAULT 1,
  bot1_id INTEGER REFERENCES bots(id),
  bot2_id INTEGER REFERENCES bots(id),
  token_address TEXT,
  token_symbol TEXT,
  entry_price DECIMAL(20, 10),
  bot1_prediction DECIMAL(5, 2),
  bot2_prediction DECIMAL(5, 2),
  actual_x DECIMAL(10, 4),
  winner_id INTEGER REFERENCES bots(id),
  damage_dealt INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'resolved')),
  resolves_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PREDICTIONS TABLE (History)
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  bot_id INTEGER REFERENCES bots(id),
  battle_id UUID REFERENCES battles(id),
  token_address TEXT,
  token_symbol TEXT,
  predicted_x DECIMAL(5, 2),
  actual_x DECIMAL(10, 4),
  accuracy DECIMAL(5, 2),
  is_winner BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. INDEXES
CREATE INDEX idx_bots_telegram_id ON bots(telegram_id);
CREATE INDEX idx_bots_league ON bots(league);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_battles_status ON battles(status);
CREATE INDEX idx_predictions_bot_id ON predictions(bot_id);

-- 6. INSERT NPC BOTS
INSERT INTO bots (name, hp, wins, losses, win_streak, league, is_npc, avatar_state) VALUES
  ('🔥 PyroBot', 100, 15, 8, 3, 'gold', true, 'neutral'),
  ('❄️ FrostMaster', 85, 22, 12, 0, 'gold', true, 'neutral'),
  ('⚡ VoltageKing', 95, 8, 4, 5, 'silver', true, 'neutral'),
  ('🌊 TsunamiX', 70, 30, 25, 2, 'diamond', true, 'neutral'),
  ('🌙 LunarPredator', 100, 5, 2, 4, 'bronze', true, 'neutral'),
  ('☀️ SolarFlare', 90, 18, 10, 1, 'gold', true, 'neutral'),
  ('🎯 TargetLock', 100, 12, 6, 0, 'silver', true, 'neutral'),
  ('💎 DiamondHands', 65, 45, 35, 0, 'diamond', true, 'neutral'),
  ('🚀 MoonShot', 100, 3, 1, 2, 'bronze', true, 'neutral'),
  ('🐋 WhaleWatch', 80, 28, 15, 3, 'gold', true, 'neutral');

-- 7. ENABLE REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE bots;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE battles;

-- 8. ROW LEVEL SECURITY (basic - allow all for now)
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read bots" ON bots FOR SELECT USING (true);
CREATE POLICY "Public read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Public read battles" ON battles FOR SELECT USING (true);
CREATE POLICY "Public read predictions" ON predictions FOR SELECT USING (true);

-- Service role can do everything (via service_role key)
CREATE POLICY "Service insert bots" ON bots FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update bots" ON bots FOR UPDATE USING (true);
CREATE POLICY "Service insert rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update rooms" ON rooms FOR UPDATE USING (true);
CREATE POLICY "Service insert battles" ON battles FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update battles" ON battles FOR UPDATE USING (true);
CREATE POLICY "Service insert predictions" ON predictions FOR INSERT WITH CHECK (true);

SELECT 'Schema created successfully! 🚀' as result;
