-- GemBots V2 Schema - Users & Autonomous Bots
-- Run this in Supabase SQL Editor

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USER_BOTS TABLE (links users to their bots)
CREATE TABLE IF NOT EXISTS user_bots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  bot_id INTEGER REFERENCES bots(id),
  strategy TEXT DEFAULT 'conservative',
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, bot_id)
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_bots_user ON user_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bots_active ON user_bots(is_active);

-- 4. ROW LEVEL SECURITY
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bots ENABLE ROW LEVEL SECURITY;

-- Public read for users (only wallet address, no sensitive data)
CREATE POLICY "Public read users" ON users FOR SELECT USING (true);
CREATE POLICY "Service insert users" ON users FOR INSERT WITH CHECK (true);

-- User bots policies
CREATE POLICY "Public read user_bots" ON user_bots FOR SELECT USING (true);
CREATE POLICY "Service insert user_bots" ON user_bots FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update user_bots" ON user_bots FOR UPDATE USING (true);

-- 5. ENABLE REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE user_bots;

SELECT 'V2 Schema created successfully! 🚀' as result;
