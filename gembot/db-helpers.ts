import db from './db';
import crypto from 'crypto';

// === USERS ===

export function getOrCreateUser(userId: string, telegramId?: number, username?: string, firstName?: string): any {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (existing) return existing;

  db.prepare('INSERT INTO users (id, telegram_id, username, first_name) VALUES (?, ?, ?, ?)')
    .run(userId, telegramId || 0, username || null, firstName || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getUserRecord(userId: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
}

export function getCredits(userId: string): number {
  const user = getUserRecord(userId);
  if (user?.family_id) {
    const family = db.prepare('SELECT credits FROM families WHERE id = ?').get(user.family_id) as any;
    return family?.credits ?? 0;
  }
  return user?.credits ?? 50;
}

export function chargeCredits(userId: string, amount: number): boolean {
  const user = getUserRecord(userId);
  const credits = getCredits(userId);
  if (credits < amount) return false;

  if (user?.family_id) {
    db.prepare("UPDATE families SET credits = credits - ? WHERE id = ?").run(amount, user.family_id);
    db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?").run(userId);
    return true;
  }

  db.prepare("UPDATE users SET credits = credits - ?, updated_at = datetime('now') WHERE id = ?").run(amount, userId);
  return true;
}

export function addCredits(userId: string, amount: number) {
  const user = getUserRecord(userId);
  if (user?.family_id) {
    db.prepare("UPDATE families SET credits = credits + ? WHERE id = ?").run(amount, user.family_id);
    db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?").run(userId);
    return;
  }

  db.prepare("UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE id = ?").run(amount, userId);
}

export function setCredits(userId: string, amount: number) {
  const user = getUserRecord(userId);
  if (user?.family_id) {
    db.prepare("UPDATE families SET credits = ? WHERE id = ?").run(amount, user.family_id);
    return;
  }

  db.prepare("UPDATE users SET credits = ?, updated_at = datetime('now') WHERE id = ?").run(amount, userId);
}

// === DAILY BONUS ===

export function isDailyBonusAvailable(userId: string): boolean {
  const user = db.prepare('SELECT last_bonus_at FROM users WHERE id = ?').get(userId) as any;
  if (!user?.last_bonus_at) return true;
  const last = new Date(user.last_bonus_at + 'Z').getTime();
  return Date.now() - last >= 24 * 60 * 60 * 1000;
}

export function claimDailyBonus(userId: string, amount: number): boolean {
  if (!isDailyBonusAvailable(userId)) return false;
  addCredits(userId, amount);
  db.prepare("UPDATE users SET last_bonus_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(userId);
  return true;
}

export function getNextBonusAt(userId: string): number {
  const user = db.prepare('SELECT last_bonus_at FROM users WHERE id = ?').get(userId) as any;
  if (!user?.last_bonus_at) return Date.now();
  return new Date(user.last_bonus_at + 'Z').getTime() + 24 * 60 * 60 * 1000;
}

// === MEMORIES ===

interface MemoryRow {
  id: number;
  user_id: string;
  fact: string;
  category: string;
  created_at: string;
}

export function getMemories(userId: string) {
  return db.prepare('SELECT id, fact, category, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as MemoryRow[];
}

export function getMemoriesForPrompt(userId: string): Array<{ fact: string }> {
  const personal = db.prepare('SELECT fact FROM memories WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId) as Array<{ fact: string }>;
  const user = getUserRecord(userId);
  if (!user?.family_id) return personal;

  const family = db.prepare('SELECT fact FROM family_memories WHERE family_id = ? ORDER BY created_at ASC')
    .all(user.family_id) as Array<{ fact: string }>;

  return [
    ...personal,
    ...family.map((item) => ({ fact: `[Семья] ${item.fact}` })),
  ];
}

export function getMemoryCount(userId: string): number {
  return (db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?').get(userId) as any).cnt;
}

export function addMemory(userId: string, fact: string, category: string = 'other'): { success: boolean; id?: number } {
  // Лимит 50
  if (getMemoryCount(userId) >= 50) return { success: false };

  const stmt = db.prepare('INSERT INTO memories (user_id, fact, category) VALUES (?, ?, ?)');
  const result = stmt.run(userId, fact, category);
  return { success: true, id: result.lastInsertRowid as number };
}

export function deleteMemory(memoryId: number | string, userId: string) {
  db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(memoryId, userId);
}

// === SESSIONS ===

export function getOrCreateSession(userId: string, sessionId?: string): any {
  if (sessionId) {
    const existing = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
    if (existing) return existing;
  }
  const id = sessionId || crypto.randomUUID();
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(id, userId);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function getUserSessions(userId: string) {
  return db.prepare('SELECT id, title, model, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50')
    .all(userId);
}

export function updateSessionTitle(sessionId: string, title: string) {
  db.prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, sessionId);
}

export function getSessionTitle(sessionId: string): string | null {
  const row = db.prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId) as any;
  return row?.title || null;
}

// === MESSAGES ===

export function addMessage(userId: string, sessionId: string, role: string, content: string, model?: string, creditsCharged?: number) {
  db.prepare('INSERT INTO messages (session_id, user_id, role, content, model, credits_charged) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, userId, role, content, model || null, creditsCharged || 0);
  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
}

export function getRecentMessages(userId: string, sessionId: string, limit: number = 20): Array<{ role: string; content: string }> {
  return db.prepare('SELECT role, content FROM messages WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, sessionId, limit)
    .reverse() as Array<{ role: string; content: string }>;
}

export function searchMessages(userId: string, query: string, limit: number = 20): Array<{ session_id: string; title: string | null; content: string; role: string; created_at: string }> {
  return db.prepare(`
    SELECT m.session_id, s.title, m.content, m.role, m.created_at
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE m.user_id = ? AND m.content LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(userId, `%${query}%`, limit) as any[];
}

// === FILES ===

export function saveFile(userId: string, gigachatFileId: string, filename: string, mimeType: string, sizeBytes: number, data?: Buffer, textContent?: string) {
  db.prepare('INSERT INTO files (user_id, gigachat_file_id, filename, mime_type, size_bytes, data, text_content) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, gigachatFileId, filename, mimeType, sizeBytes, data || null, textContent || null);
  const result = db.prepare('SELECT last_insert_rowid() as id').get() as any;
  return result.id;
}

export function getUserFiles(userId: string) {
  return db.prepare('SELECT id, filename, mime_type, size_bytes, text_content, created_at FROM files WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
}

export function getFileById(fileId: number) {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
}

// === STATS ===

export function getUserStats(userId: string) {
  const user = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as any;
  const messageCount = (db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE user_id = ? AND role = 'user'").get(userId) as any).cnt;
  const memoryCount = getMemoryCount(userId);
  const sessionCount = (db.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?').get(userId) as any).cnt;

  const daysSince = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at + 'Z').getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  return {
    messagesSent: messageCount,
    memoriesStored: memoryCount,
    sessionsCreated: sessionCount,
    daysSinceRegistration: daysSince,
  };
}

// === CONVERSATION SUMMARIES ===

interface SummaryRow {
  id: number;
  session_id: string;
  summary_text: string;
  messages_covered: number;
  created_at: string;
}

export function getSessionSummary(sessionId: string): SummaryRow | null {
  return (db.prepare('SELECT * FROM conversation_summaries WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as SummaryRow) || null;
}

export function upsertSessionSummary(sessionId: string, summaryText: string, messagesCovered: number) {
  const existing = getSessionSummary(sessionId);
  if (existing) {
    db.prepare("UPDATE conversation_summaries SET summary_text = ?, messages_covered = ?, created_at = datetime('now') WHERE id = ?")
      .run(summaryText, messagesCovered, existing.id);
  } else {
    db.prepare('INSERT INTO conversation_summaries (session_id, summary_text, messages_covered) VALUES (?, ?, ?)')
      .run(sessionId, summaryText, messagesCovered);
  }
}

export function getSessionMessageCount(sessionId: string): number {
  return (db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?').get(sessionId) as any).cnt;
}

// === CLOUD CONNECTIONS ===

export function saveCloudConnection(userId: string, provider: string, accessToken: string, refreshToken?: string, expiresAt?: string, folderPath?: string) {
  db.prepare(`INSERT OR REPLACE INTO cloud_connections (user_id, provider, access_token, refresh_token, token_expires_at, folder_path, connected_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(userId, provider, accessToken, refreshToken || null, expiresAt || null, folderPath || '/');
}

export function getCloudConnection(userId: string, provider: string) {
  return db.prepare('SELECT * FROM cloud_connections WHERE user_id = ? AND provider = ?').get(userId, provider) as any;
}

export function getCloudConnections(userId: string) {
  return db.prepare('SELECT id, provider, folder_path, connected_at FROM cloud_connections WHERE user_id = ?').all(userId) as any[];
}

export function deleteCloudConnection(userId: string, provider: string) {
  db.prepare('DELETE FROM cloud_connections WHERE user_id = ? AND provider = ?').run(userId, provider);
}

// === REMINDERS ===

export function addReminder(userId: string, title: string, dueDate?: string, notes?: string): { success: boolean; id?: number } {
  const stmt = db.prepare("INSERT INTO reminders (user_id, title, due_date, notes, updated_at) VALUES (?, ?, ?, ?, datetime('now'))");
  const result = stmt.run(userId, title, dueDate || null, notes || null);
  return { success: true, id: result.lastInsertRowid as number };
}

export function getReminders(userId: string) {
  return db.prepare('SELECT id, title, due_date, notes, completed, notified, created_at, updated_at FROM reminders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(userId);
}

export function getReminderById(id: number, userId: string) {
  return db.prepare('SELECT id, title, due_date, notes, completed, notified, created_at, updated_at FROM reminders WHERE id = ? AND user_id = ?')
    .get(id, userId) as any;
}

export function updateReminder(id: number, userId: string, patch: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
  if (patch.due_date !== undefined) { fields.push('due_date = ?'); values.push(patch.due_date); }
  if (patch.notes !== undefined) { fields.push('notes = ?'); values.push(patch.notes); }
  if (patch.completed !== undefined) { fields.push('completed = ?'); values.push(patch.completed ? 1 : 0); }
  if (patch.notified !== undefined) { fields.push('notified = ?'); values.push(patch.notified ? 1 : 0); }
  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now')");
  const sql = `UPDATE reminders SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`;
  values.push(id, userId);
  const result = db.prepare(sql).run(...values);
  return result.changes > 0;
}

export function deleteReminder(id: number, userId: string): boolean {
  const result = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

export function getDueReminders() {
  return db.prepare(
    `SELECT r.id, r.user_id, r.title, r.due_date, r.notes
     FROM reminders r
     WHERE r.due_date IS NOT NULL
       AND r.due_date <= datetime('now')
       AND r.completed = 0
       AND r.notified = 0`
  ).all() as Array<{ id: number; user_id: string; title: string; due_date: string; notes: string | null }>;
}

export function markReminderNotified(id: number) {
  db.prepare("UPDATE reminders SET notified = 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

// === PUSH SUBSCRIPTIONS ===

export function savePushSubscription(userId: string, endpoint: string, p256dh: string, auth: string) {
  db.prepare(
    `INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(userId, endpoint, p256dh, auth);
}

export function deletePushSubscription(endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function getPushSubscriptions(userId: string) {
  return db.prepare('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as Array<{ endpoint: string; keys_p256dh: string; keys_auth: string }>;
}

// === BOOKMARKS ===

export function addBookmark(userId: string, sessionId: string | null, messageText: string): number {
  const result = db.prepare('INSERT INTO bookmarks (user_id, session_id, message_text) VALUES (?, ?, ?)')
    .run(userId, sessionId, messageText);
  return result.lastInsertRowid as number;
}

export function getBookmarks(userId: string) {
  return db.prepare('SELECT id, session_id, message_text, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Array<{ id: number; session_id: string | null; message_text: string; created_at: string }>;
}

export function deleteBookmark(bookmarkId: number, userId: string) {
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(bookmarkId, userId);
}

// === FEEDBACK ===

export function addFeedback(userId: string, sessionId: string | null, messageText: string, rating: 'up' | 'down'): number {
  const result = db.prepare('INSERT INTO feedback (user_id, session_id, message_text, rating) VALUES (?, ?, ?, ?)')
    .run(userId, sessionId, messageText, rating);
  return result.lastInsertRowid as number;
}

// === SHARED SESSIONS ===

export function createShareLink(sessionId: string): { token: string; expiresAt: string } {
  // Remove old share links for this session
  db.prepare('DELETE FROM shared_sessions WHERE session_id = ?').run(sessionId);

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO shared_sessions (session_id, token, expires_at) VALUES (?, ?, ?)').run(sessionId, token, expiresAt);
  return { token, expiresAt };
}

export function getShareByToken(token: string): { session_id: string; expires_at: string } | null {
  return db.prepare('SELECT session_id, expires_at FROM shared_sessions WHERE token = ?').get(token) as any || null;
}

export function revokeShareLink(sessionId: string): boolean {
  const result = db.prepare('DELETE FROM shared_sessions WHERE session_id = ?').run(sessionId);
  return result.changes > 0;
}

export function getSessionMessages(sessionId: string): Array<{ role: string; content: string; created_at: string }> {
  return db.prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId) as any[];
}

export function getSession(sessionId: string): { id: string; user_id: string; title: string; created_at: string } | null {
  return db.prepare('SELECT id, user_id, title, created_at FROM sessions WHERE id = ?').get(sessionId) as any || null;
}

// === FAMILY ACCESS ===

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export interface FamilyMember {
  userId: string;
  telegramId: number | null;
  username: string | null;
  firstName: string | null;
  role: 'admin' | 'member' | null;
}

export interface FamilyInfo {
  id: string;
  name: string;
  credits: number;
  role: 'admin' | 'member';
  inviteCode: string | null;
  admin: { telegramId: number | null; username: string | null; firstName: string | null } | null;
  members: FamilyMember[];
}

export function getFamilyInfo(userId: string): FamilyInfo | null {
  const user = getUserRecord(userId);
  if (!user?.family_id) return null;

  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(user.family_id) as any;
  if (!family) return null;

  const members = db.prepare(`
    SELECT id as userId, telegram_id as telegramId, username, first_name as firstName, family_role as role
    FROM users
    WHERE family_id = ?
    ORDER BY CASE WHEN family_role = 'admin' THEN 0 ELSE 1 END, COALESCE(first_name, username, id)
  `).all(user.family_id) as FamilyMember[];

  const admin = members.find((member) => member.role === 'admin') || null;

  return {
    id: family.id,
    name: family.name,
    credits: family.credits ?? 0,
    role: user.family_role,
    inviteCode: user.family_role === 'admin' ? (user.family_invite_code || null) : null,
    admin: admin ? { telegramId: admin.telegramId, username: admin.username, firstName: admin.firstName } : null,
    members,
  };
}

export function createFamily(userId: string, name: string): FamilyInfo {
  const user = getUserRecord(userId);
  if (!user) throw new Error('Пользователь не найден');
  if (user.family_id) throw new Error('Вы уже состоите в семье');
  // telegram_id check removed — userId is sufficient

  const familyId = crypto.randomUUID();
  const inviteCode = generateInviteCode();

  db.transaction(() => {
    db.prepare('INSERT INTO families (id, name, admin_id, credits, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(familyId, name.trim(), user.telegram_id, Date.now());
    db.prepare("UPDATE users SET family_id = ?, family_role = 'admin', family_invite_code = ?, updated_at = datetime('now') WHERE id = ?")
      .run(familyId, inviteCode, userId);
  })();

  return getFamilyInfo(userId)!;
}

export function joinFamily(userId: string, inviteCode: string): FamilyInfo {
  const user = getUserRecord(userId);
  if (!user) throw new Error('Пользователь не найден');
  if (user.family_id) throw new Error('Вы уже состоите в семье');

  const adminUser = db.prepare("SELECT id, family_id FROM users WHERE family_invite_code = ? AND family_role = 'admin' LIMIT 1")
    .get(inviteCode.trim().toUpperCase()) as any;
  if (!adminUser?.family_id) throw new Error('Инвайт-код недействителен');

  const family = db.prepare('SELECT id FROM families WHERE id = ? LIMIT 1').get(adminUser.family_id) as any;
  if (!family) throw new Error('Семья не найдена');

  db.prepare("UPDATE users SET family_id = ?, family_role = 'member', family_invite_code = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(adminUser.family_id, userId);

  return getFamilyInfo(userId)!;
}

export function refreshFamilyInvite(userId: string): string {
  const family = getFamilyInfo(userId);
  if (!family) throw new Error('Семья не найдена');
  if (family.role !== 'admin') throw new Error('Только админ может создавать invite code');

  const inviteCode = generateInviteCode();
  db.prepare("UPDATE users SET family_invite_code = ?, updated_at = datetime('now') WHERE id = ?").run(inviteCode, userId);
  return inviteCode;
}

export function leaveFamily(userId: string): { success: boolean; disbanded?: boolean } {
  const family = getFamilyInfo(userId);
  if (!family) throw new Error('Вы не состоите в семье');

  if (family.role === 'admin') {
    db.transaction(() => {
      db.prepare("UPDATE users SET family_id = NULL, family_role = NULL, family_invite_code = NULL, updated_at = datetime('now') WHERE family_id = ?")
        .run(family.id);
      db.prepare('DELETE FROM family_memories WHERE family_id = ?').run(family.id);
      db.prepare('DELETE FROM families WHERE id = ?').run(family.id);
    })();
    return { success: true, disbanded: true };
  }

  db.prepare("UPDATE users SET family_id = NULL, family_role = NULL, family_invite_code = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(userId);
  return { success: true };
}

export function removeFamilyMember(adminUserId: string, telegramId: number): boolean {
  const family = getFamilyInfo(adminUserId);
  if (!family) throw new Error('Семья не найдена');
  if (family.role !== 'admin') throw new Error('Только админ может исключать участников');
  if (family.admin?.telegramId === telegramId) throw new Error('Нельзя исключить администратора');

  const result = db.prepare("UPDATE users SET family_id = NULL, family_role = NULL, family_invite_code = NULL, updated_at = datetime('now') WHERE family_id = ? AND telegram_id = ?")
    .run(family.id, telegramId);
  return result.changes > 0;
}

export function getFamilyMemories(userId: string) {
  const family = getFamilyInfo(userId);
  if (!family) throw new Error('Семья не найдена');

  return db.prepare('SELECT id, fact, category, created_at FROM family_memories WHERE family_id = ? ORDER BY created_at DESC')
    .all(family.id) as Array<{ id: string; fact: string; category: string; created_at: number }>;
}

export function addFamilyMemory(userId: string, fact: string, category: string = 'other') {
  const family = getFamilyInfo(userId);
  if (!family) throw new Error('Семья не найдена');

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare('INSERT INTO family_memories (id, family_id, fact, category, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, family.id, fact, category, createdAt);

  return { id, fact, category, created_at: createdAt };
}

// === USER SETTINGS ===

export interface UserSettings {
  user_id: string;
  chat_style: string;
  language: string;
  tts_enabled: number;
  tts_voice: string;
  auto_memory: number;
  search_enabled: number;
  suggestions_enabled: number;
  font_size: string;
}

const DEFAULT_SETTINGS: Omit<UserSettings, 'user_id'> = {
  chat_style: 'friendly',
  language: 'auto',
  tts_enabled: 1,
  tts_voice: 'ru-RU-DmitryNeural',
  auto_memory: 1,
  search_enabled: 1,
  suggestions_enabled: 1,
  font_size: 'normal',
};

function normalizeUserSettings(userId: string, row?: Partial<UserSettings> | null): UserSettings {
  const language = row?.language === 'ru' || row?.language === 'en' || row?.language === 'auto'
    ? row.language
    : DEFAULT_SETTINGS.language;

  return {
    user_id: userId,
    chat_style: row?.chat_style || DEFAULT_SETTINGS.chat_style,
    language,
    tts_enabled: typeof row?.tts_enabled === 'number' ? row.tts_enabled : DEFAULT_SETTINGS.tts_enabled,
    tts_voice: row?.tts_voice || DEFAULT_SETTINGS.tts_voice,
    auto_memory: typeof row?.auto_memory === 'number' ? row.auto_memory : DEFAULT_SETTINGS.auto_memory,
    search_enabled: typeof row?.search_enabled === 'number' ? row.search_enabled : DEFAULT_SETTINGS.search_enabled,
    suggestions_enabled: typeof row?.suggestions_enabled === 'number' ? row.suggestions_enabled : DEFAULT_SETTINGS.suggestions_enabled,
    font_size: row?.font_size || DEFAULT_SETTINGS.font_size,
  };
}

export function getUserSettings(userId: string): UserSettings {
  db.prepare(
    'INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)'
  ).run(userId);

  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as UserSettings | undefined;
  const normalized = normalizeUserSettings(userId, row);

  if (!row || row.language !== normalized.language) {
    db.prepare('UPDATE user_settings SET language = ? WHERE user_id = ?').run(normalized.language, userId);
  }

  return normalized;
}

export function updateUserSettings(userId: string, patch: Partial<Omit<UserSettings, 'user_id'>>): UserSettings {
  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);

  const sanitizedPatch = { ...patch } as Record<string, any>;
  if (sanitizedPatch.language !== undefined && !['auto', 'ru', 'en'].includes(sanitizedPatch.language)) {
    delete sanitizedPatch.language;
  }

  const allowed = ['chat_style', 'language', 'tts_enabled', 'tts_voice', 'auto_memory', 'search_enabled', 'suggestions_enabled', 'font_size'];
  const fields = Object.keys(sanitizedPatch).filter(k => allowed.includes(k));
  if (fields.length > 0) {
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => sanitizedPatch[f]);
    db.prepare(`UPDATE user_settings SET ${setClause} WHERE user_id = ?`).run(...values, userId);
  }
  return getUserSettings(userId);
}

export function deleteAllUserData(userId: string): void {
  db.transaction(() => {
    try { leaveFamily(userId); } catch {}
    db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    db.prepare("DELETE FROM messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM files WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  })();
}

export function exportAllUserData(userId: string): object {
  const user = db.prepare('SELECT id, username, first_name, created_at FROM users WHERE id = ?').get(userId);
  const memories = db.prepare('SELECT * FROM memories WHERE user_id = ?').all(userId);
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(userId);
  const sessionIds = (sessions as any[]).map((s: any) => s.id);
  let messages: any[] = [];
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => '?').join(',');
    messages = db.prepare(`SELECT * FROM messages WHERE session_id IN (${placeholders})`).all(...sessionIds) as any[];
  }
  const reminders = db.prepare('SELECT * FROM reminders WHERE user_id = ?').all(userId);
  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(userId);
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);

  return {
    exported_at: new Date().toISOString(),
    user,
    settings: settings || { ...DEFAULT_SETTINGS },
    memories,
    sessions,
    messages,
    reminders,
    bookmarks,
  };
}
