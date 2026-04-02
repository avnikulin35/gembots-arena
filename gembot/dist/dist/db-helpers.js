import db from './db';
import crypto from 'crypto';
// === USERS ===
export function getOrCreateUser(userId, telegramId, username, firstName) {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (existing)
        return existing;
    db.prepare('INSERT INTO users (id, telegram_id, username, first_name) VALUES (?, ?, ?, ?)')
        .run(userId, telegramId || 0, username || null, firstName || null);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}
function getUserRecord(userId) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}
export function getCredits(userId) {
    const user = getUserRecord(userId);
    if (user?.family_id) {
        const family = db.prepare('SELECT credits FROM families WHERE id = ?').get(user.family_id);
        return family?.credits ?? 0;
    }
    return user?.credits ?? 50;
}
export function chargeCredits(userId, amount) {
    const user = getUserRecord(userId);
    const credits = getCredits(userId);
    if (credits < amount)
        return false;
    if (user?.family_id) {
        db.prepare("UPDATE families SET credits = credits - ? WHERE id = ?").run(amount, user.family_id);
        db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?").run(userId);
        return true;
    }
    db.prepare("UPDATE users SET credits = credits - ?, updated_at = datetime('now') WHERE id = ?").run(amount, userId);
    return true;
}
export function addCredits(userId, amount) {
    const user = getUserRecord(userId);
    if (user?.family_id) {
        db.prepare("UPDATE families SET credits = credits + ? WHERE id = ?").run(amount, user.family_id);
        db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?").run(userId);
        return;
    }
    db.prepare("UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE id = ?").run(amount, userId);
}
export function setCredits(userId, amount) {
    const user = getUserRecord(userId);
    if (user?.family_id) {
        db.prepare("UPDATE families SET credits = ? WHERE id = ?").run(amount, user.family_id);
        return;
    }
    db.prepare("UPDATE users SET credits = ?, updated_at = datetime('now') WHERE id = ?").run(amount, userId);
}
// === DAILY BONUS ===
export function isDailyBonusAvailable(userId) {
    const user = db.prepare('SELECT last_bonus_at FROM users WHERE id = ?').get(userId);
    if (!user?.last_bonus_at)
        return true;
    const last = new Date(user.last_bonus_at + 'Z').getTime();
    return Date.now() - last >= 24 * 60 * 60 * 1000;
}
export function claimDailyBonus(userId, amount) {
    if (!isDailyBonusAvailable(userId))
        return false;
    addCredits(userId, amount);
    db.prepare("UPDATE users SET last_bonus_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(userId);
    return true;
}
export function getNextBonusAt(userId) {
    const user = db.prepare('SELECT last_bonus_at FROM users WHERE id = ?').get(userId);
    if (!user?.last_bonus_at)
        return Date.now();
    return new Date(user.last_bonus_at + 'Z').getTime() + 24 * 60 * 60 * 1000;
}
export function getMemories(userId) {
    return db.prepare('SELECT id, fact, category, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId);
}
export function getMemoriesForPrompt(userId) {
    const personal = db.prepare('SELECT fact FROM memories WHERE user_id = ? ORDER BY created_at ASC')
        .all(userId);
    const user = getUserRecord(userId);
    if (!user?.family_id)
        return personal;
    const family = db.prepare('SELECT fact FROM family_memories WHERE family_id = ? ORDER BY created_at ASC')
        .all(user.family_id);
    return [
        ...personal,
        ...family.map((item) => ({ fact: `[Семья] ${item.fact}` })),
    ];
}
export function getMemoryCount(userId) {
    return db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?').get(userId).cnt;
}
export function addMemory(userId, fact, category = 'other') {
    // Лимит 50
    if (getMemoryCount(userId) >= 50)
        return { success: false };
    const stmt = db.prepare('INSERT INTO memories (user_id, fact, category) VALUES (?, ?, ?)');
    const result = stmt.run(userId, fact, category);
    return { success: true, id: result.lastInsertRowid };
}
export function deleteMemory(memoryId, userId) {
    db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(memoryId, userId);
}
// === SESSIONS ===
export function getOrCreateSession(userId, sessionId) {
    if (sessionId) {
        const existing = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
        if (existing)
            return existing;
    }
    const id = sessionId || crypto.randomUUID();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(id, userId);
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}
export function getUserSessions(userId) {
    return db.prepare('SELECT id, title, model, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50')
        .all(userId);
}
export function updateSessionTitle(sessionId, title) {
    db.prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, sessionId);
}
export function getSessionTitle(sessionId) {
    const row = db.prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId);
    return row?.title || null;
}
// === MESSAGES ===
export function addMessage(userId, sessionId, role, content, model, creditsCharged) {
    db.prepare('INSERT INTO messages (session_id, user_id, role, content, model, credits_charged) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sessionId, userId, role, content, model || null, creditsCharged || 0);
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
}
export function getRecentMessages(userId, sessionId, limit = 20) {
    return db.prepare('SELECT role, content FROM messages WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?')
        .all(userId, sessionId, limit)
        .reverse();
}
export function searchMessages(userId, query, limit = 20) {
    return db.prepare(`
    SELECT m.session_id, s.title, m.content, m.role, m.created_at
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE m.user_id = ? AND m.content LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(userId, `%${query}%`, limit);
}
// === FILES ===
export function saveFile(userId, gigachatFileId, filename, mimeType, sizeBytes, data, textContent) {
    db.prepare('INSERT INTO files (user_id, gigachat_file_id, filename, mime_type, size_bytes, data, text_content) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(userId, gigachatFileId, filename, mimeType, sizeBytes, data || null, textContent || null);
    const result = db.prepare('SELECT last_insert_rowid() as id').get();
    return result.id;
}
export function getUserFiles(userId) {
    return db.prepare('SELECT id, filename, mime_type, size_bytes, text_content, created_at FROM files WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
}
export function getFileById(fileId) {
    return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
}
// === STATS ===
export function getUserStats(userId) {
    const user = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
    const messageCount = db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE user_id = ? AND role = 'user'").get(userId).cnt;
    const memoryCount = getMemoryCount(userId);
    const sessionCount = db.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?').get(userId).cnt;
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
export function getSessionSummary(sessionId) {
    return db.prepare('SELECT * FROM conversation_summaries WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) || null;
}
export function upsertSessionSummary(sessionId, summaryText, messagesCovered) {
    const existing = getSessionSummary(sessionId);
    if (existing) {
        db.prepare("UPDATE conversation_summaries SET summary_text = ?, messages_covered = ?, created_at = datetime('now') WHERE id = ?")
            .run(summaryText, messagesCovered, existing.id);
    }
    else {
        db.prepare('INSERT INTO conversation_summaries (session_id, summary_text, messages_covered) VALUES (?, ?, ?)')
            .run(sessionId, summaryText, messagesCovered);
    }
}
export function getSessionMessageCount(sessionId) {
    return db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?').get(sessionId).cnt;
}
// === CLOUD CONNECTIONS ===
export function saveCloudConnection(userId, provider, accessToken, refreshToken, expiresAt, folderPath) {
    db.prepare(`INSERT OR REPLACE INTO cloud_connections (user_id, provider, access_token, refresh_token, token_expires_at, folder_path, connected_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(userId, provider, accessToken, refreshToken || null, expiresAt || null, folderPath || '/');
}
export function getCloudConnection(userId, provider) {
    return db.prepare('SELECT * FROM cloud_connections WHERE user_id = ? AND provider = ?').get(userId, provider);
}
export function getCloudConnections(userId) {
    return db.prepare('SELECT id, provider, folder_path, connected_at FROM cloud_connections WHERE user_id = ?').all(userId);
}
export function deleteCloudConnection(userId, provider) {
    db.prepare('DELETE FROM cloud_connections WHERE user_id = ? AND provider = ?').run(userId, provider);
}
// === REMINDERS ===
export function addReminder(userId, title, dueDate, notes) {
    const stmt = db.prepare("INSERT INTO reminders (user_id, title, due_date, notes, updated_at) VALUES (?, ?, ?, ?, datetime('now'))");
    const result = stmt.run(userId, title, dueDate || null, notes || null);
    return { success: true, id: result.lastInsertRowid };
}
export function getReminders(userId) {
    return db.prepare('SELECT id, title, due_date, notes, completed, notified, created_at, updated_at FROM reminders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(userId);
}
export function getReminderById(id, userId) {
    return db.prepare('SELECT id, title, due_date, notes, completed, notified, created_at, updated_at FROM reminders WHERE id = ? AND user_id = ?')
        .get(id, userId);
}
export function updateReminder(id, userId, patch) {
    const fields = [];
    const values = [];
    if (patch.title !== undefined) {
        fields.push('title = ?');
        values.push(patch.title);
    }
    if (patch.due_date !== undefined) {
        fields.push('due_date = ?');
        values.push(patch.due_date);
    }
    if (patch.notes !== undefined) {
        fields.push('notes = ?');
        values.push(patch.notes);
    }
    if (patch.completed !== undefined) {
        fields.push('completed = ?');
        values.push(patch.completed ? 1 : 0);
    }
    if (patch.notified !== undefined) {
        fields.push('notified = ?');
        values.push(patch.notified ? 1 : 0);
    }
    if (fields.length === 0)
        return false;
    fields.push("updated_at = datetime('now')");
    const sql = `UPDATE reminders SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`;
    values.push(id, userId);
    const result = db.prepare(sql).run(...values);
    return result.changes > 0;
}
export function deleteReminder(id, userId) {
    const result = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId);
    return result.changes > 0;
}
export function getDueReminders() {
    return db.prepare(`SELECT r.id, r.user_id, r.title, r.due_date, r.notes
     FROM reminders r
     WHERE r.due_date IS NOT NULL
       AND r.due_date <= datetime('now')
       AND r.completed = 0
       AND r.notified = 0`).all();
}
export function markReminderNotified(id) {
    db.prepare("UPDATE reminders SET notified = 1, updated_at = datetime('now') WHERE id = ?").run(id);
}
// === PUSH SUBSCRIPTIONS ===
export function savePushSubscription(userId, endpoint, p256dh, auth) {
    db.prepare(`INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`).run(userId, endpoint, p256dh, auth);
}
export function deletePushSubscription(endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}
export function getPushSubscriptions(userId) {
    return db.prepare('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?')
        .all(userId);
}
// === BOOKMARKS ===
export function addBookmark(userId, sessionId, messageText) {
    const result = db.prepare('INSERT INTO bookmarks (user_id, session_id, message_text) VALUES (?, ?, ?)')
        .run(userId, sessionId, messageText);
    return result.lastInsertRowid;
}
export function getBookmarks(userId) {
    return db.prepare('SELECT id, session_id, message_text, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId);
}
export function deleteBookmark(bookmarkId, userId) {
    db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(bookmarkId, userId);
}
// === FEEDBACK ===
export function addFeedback(userId, sessionId, messageText, rating) {
    const result = db.prepare('INSERT INTO feedback (user_id, session_id, message_text, rating) VALUES (?, ?, ?, ?)')
        .run(userId, sessionId, messageText, rating);
    return result.lastInsertRowid;
}
// === SHARED SESSIONS ===
export function createShareLink(sessionId) {
    // Remove old share links for this session
    db.prepare('DELETE FROM shared_sessions WHERE session_id = ?').run(sessionId);
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('INSERT INTO shared_sessions (session_id, token, expires_at) VALUES (?, ?, ?)').run(sessionId, token, expiresAt);
    return { token, expiresAt };
}
export function getShareByToken(token) {
    return db.prepare('SELECT session_id, expires_at FROM shared_sessions WHERE token = ?').get(token) || null;
}
export function revokeShareLink(sessionId) {
    const result = db.prepare('DELETE FROM shared_sessions WHERE session_id = ?').run(sessionId);
    return result.changes > 0;
}
export function getSessionMessages(sessionId) {
    return db.prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC')
        .all(sessionId);
}
export function getSession(sessionId) {
    return db.prepare('SELECT id, user_id, title, created_at FROM sessions WHERE id = ?').get(sessionId) || null;
}
// === FAMILY ACCESS ===
function generateInviteCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}
export function getFamilyInfo(userId) {
    const user = getUserRecord(userId);
    if (!user?.family_id)
        return null;
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(user.family_id);
    if (!family)
        return null;
    const members = db.prepare(`
    SELECT id as userId, telegram_id as telegramId, username, first_name as firstName, family_role as role
    FROM users
    WHERE family_id = ?
    ORDER BY CASE WHEN family_role = 'admin' THEN 0 ELSE 1 END, COALESCE(first_name, username, id)
  `).all(user.family_id);
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
export function createFamily(userId, name) {
    const user = getUserRecord(userId);
    if (!user)
        throw new Error('Пользователь не найден');
    if (user.family_id)
        throw new Error('Вы уже состоите в семье');
    // telegram_id check removed — userId is sufficient
    const familyId = crypto.randomUUID();
    const inviteCode = generateInviteCode();
    db.transaction(() => {
        db.prepare('INSERT INTO families (id, name, admin_id, credits, created_at) VALUES (?, ?, ?, 0, ?)')
            .run(familyId, name.trim(), user.telegram_id, Date.now());
        db.prepare("UPDATE users SET family_id = ?, family_role = 'admin', family_invite_code = ?, updated_at = datetime('now') WHERE id = ?")
            .run(familyId, inviteCode, userId);
    })();
    return getFamilyInfo(userId);
}
export function joinFamily(userId, inviteCode) {
    const user = getUserRecord(userId);
    if (!user)
        throw new Error('Пользователь не найден');
    if (user.family_id)
        throw new Error('Вы уже состоите в семье');
    const adminUser = db.prepare("SELECT id, family_id FROM users WHERE family_invite_code = ? AND family_role = 'admin' LIMIT 1")
        .get(inviteCode.trim().toUpperCase());
    if (!adminUser?.family_id)
        throw new Error('Инвайт-код недействителен');
    const family = db.prepare('SELECT id FROM families WHERE id = ? LIMIT 1').get(adminUser.family_id);
    if (!family)
        throw new Error('Семья не найдена');
    db.prepare("UPDATE users SET family_id = ?, family_role = 'member', family_invite_code = NULL, updated_at = datetime('now') WHERE id = ?")
        .run(adminUser.family_id, userId);
    return getFamilyInfo(userId);
}
export function refreshFamilyInvite(userId) {
    const family = getFamilyInfo(userId);
    if (!family)
        throw new Error('Семья не найдена');
    if (family.role !== 'admin')
        throw new Error('Только админ может создавать invite code');
    const inviteCode = generateInviteCode();
    db.prepare("UPDATE users SET family_invite_code = ?, updated_at = datetime('now') WHERE id = ?").run(inviteCode, userId);
    return inviteCode;
}
export function leaveFamily(userId) {
    const family = getFamilyInfo(userId);
    if (!family)
        throw new Error('Вы не состоите в семье');
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
export function removeFamilyMember(adminUserId, telegramId) {
    const family = getFamilyInfo(adminUserId);
    if (!family)
        throw new Error('Семья не найдена');
    if (family.role !== 'admin')
        throw new Error('Только админ может исключать участников');
    if (family.admin?.telegramId === telegramId)
        throw new Error('Нельзя исключить администратора');
    const result = db.prepare("UPDATE users SET family_id = NULL, family_role = NULL, family_invite_code = NULL, updated_at = datetime('now') WHERE family_id = ? AND telegram_id = ?")
        .run(family.id, telegramId);
    return result.changes > 0;
}
export function getFamilyMemories(userId) {
    const family = getFamilyInfo(userId);
    if (!family)
        throw new Error('Семья не найдена');
    return db.prepare('SELECT id, fact, category, created_at FROM family_memories WHERE family_id = ? ORDER BY created_at DESC')
        .all(family.id);
}
export function addFamilyMemory(userId, fact, category = 'other') {
    const family = getFamilyInfo(userId);
    if (!family)
        throw new Error('Семья не найдена');
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    db.prepare('INSERT INTO family_memories (id, family_id, fact, category, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, family.id, fact, category, createdAt);
    return { id, fact, category, created_at: createdAt };
}
const DEFAULT_SETTINGS = {
    chat_style: 'friendly',
    language: 'auto',
    tts_enabled: 1,
    tts_voice: 'ru-RU-DmitryNeural',
    auto_memory: 1,
    search_enabled: 1,
    suggestions_enabled: 1,
    font_size: 'normal',
};
function normalizeUserSettings(userId, row) {
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
export function getUserSettings(userId) {
    db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
    const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    const normalized = normalizeUserSettings(userId, row);
    if (!row || row.language !== normalized.language) {
        db.prepare('UPDATE user_settings SET language = ? WHERE user_id = ?').run(normalized.language, userId);
    }
    return normalized;
}
export function updateUserSettings(userId, patch) {
    db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
    const sanitizedPatch = { ...patch };
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
export function deleteAllUserData(userId) {
    db.transaction(() => {
        try {
            leaveFamily(userId);
        }
        catch { }
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
export function exportAllUserData(userId) {
    const user = db.prepare('SELECT id, username, first_name, created_at FROM users WHERE id = ?').get(userId);
    const memories = db.prepare('SELECT * FROM memories WHERE user_id = ?').all(userId);
    const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(userId);
    const sessionIds = sessions.map((s) => s.id);
    let messages = [];
    if (sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => '?').join(',');
        messages = db.prepare(`SELECT * FROM messages WHERE session_id IN (${placeholders})`).all(...sessionIds);
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
