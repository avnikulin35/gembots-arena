export declare function getOrCreateUser(userId: string, telegramId?: number, username?: string, firstName?: string): any;
export declare function getCredits(userId: string): number;
export declare function chargeCredits(userId: string, amount: number): boolean;
export declare function addCredits(userId: string, amount: number): void;
export declare function setCredits(userId: string, amount: number): void;
export declare function isDailyBonusAvailable(userId: string): boolean;
export declare function claimDailyBonus(userId: string, amount: number): boolean;
export declare function getNextBonusAt(userId: string): number;
interface MemoryRow {
    id: number;
    user_id: string;
    fact: string;
    category: string;
    created_at: string;
}
export declare function getMemories(userId: string): MemoryRow[];
export declare function getMemoriesForPrompt(userId: string): Array<{
    fact: string;
}>;
export declare function getMemoryCount(userId: string): number;
export declare function addMemory(userId: string, fact: string, category?: string): {
    success: boolean;
    id?: number;
};
export declare function deleteMemory(memoryId: number | string, userId: string): void;
export declare function getOrCreateSession(userId: string, sessionId?: string): any;
export declare function getUserSessions(userId: string): unknown[];
export declare function updateSessionTitle(sessionId: string, title: string): void;
export declare function getSessionTitle(sessionId: string): string | null;
export declare function addMessage(userId: string, sessionId: string, role: string, content: string, model?: string, creditsCharged?: number): void;
export declare function getRecentMessages(userId: string, sessionId: string, limit?: number): Array<{
    role: string;
    content: string;
}>;
export declare function searchMessages(userId: string, query: string, limit?: number): Array<{
    session_id: string;
    title: string | null;
    content: string;
    role: string;
    created_at: string;
}>;
export declare function saveFile(userId: string, gigachatFileId: string, filename: string, mimeType: string, sizeBytes: number, data?: Buffer, textContent?: string): any;
export declare function getUserFiles(userId: string): unknown[];
export declare function getFileById(fileId: number): any;
export declare function getUserStats(userId: string): {
    messagesSent: any;
    memoriesStored: number;
    sessionsCreated: any;
    daysSinceRegistration: number;
};
interface SummaryRow {
    id: number;
    session_id: string;
    summary_text: string;
    messages_covered: number;
    created_at: string;
}
export declare function getSessionSummary(sessionId: string): SummaryRow | null;
export declare function upsertSessionSummary(sessionId: string, summaryText: string, messagesCovered: number): void;
export declare function getSessionMessageCount(sessionId: string): number;
export declare function saveCloudConnection(userId: string, provider: string, accessToken: string, refreshToken?: string, expiresAt?: string, folderPath?: string): void;
export declare function getCloudConnection(userId: string, provider: string): any;
export declare function getCloudConnections(userId: string): any[];
export declare function deleteCloudConnection(userId: string, provider: string): void;
export declare function addReminder(userId: string, title: string, dueDate?: string, notes?: string): {
    success: boolean;
    id?: number;
};
export declare function getReminders(userId: string): unknown[];
export declare function getReminderById(id: number, userId: string): any;
export declare function updateReminder(id: number, userId: string, patch: Record<string, any>): boolean;
export declare function deleteReminder(id: number, userId: string): boolean;
export declare function getDueReminders(): Array<{
    id: number;
    user_id: string;
    title: string;
    due_date: string;
    notes: string | null;
}>;
export declare function markReminderNotified(id: number): void;
export declare function savePushSubscription(userId: string, endpoint: string, p256dh: string, auth: string): void;
export declare function deletePushSubscription(endpoint: string): void;
export declare function getPushSubscriptions(userId: string): Array<{
    endpoint: string;
    keys_p256dh: string;
    keys_auth: string;
}>;
export declare function addBookmark(userId: string, sessionId: string | null, messageText: string): number;
export declare function getBookmarks(userId: string): Array<{
    id: number;
    session_id: string | null;
    message_text: string;
    created_at: string;
}>;
export declare function deleteBookmark(bookmarkId: number, userId: string): void;
export declare function addFeedback(userId: string, sessionId: string | null, messageText: string, rating: 'up' | 'down'): number;
export declare function createShareLink(sessionId: string): {
    token: string;
    expiresAt: string;
};
export declare function getShareByToken(token: string): {
    session_id: string;
    expires_at: string;
} | null;
export declare function revokeShareLink(sessionId: string): boolean;
export declare function getSessionMessages(sessionId: string): Array<{
    role: string;
    content: string;
    created_at: string;
}>;
export declare function getSession(sessionId: string): {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
} | null;
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
    admin: {
        telegramId: number | null;
        username: string | null;
        firstName: string | null;
    } | null;
    members: FamilyMember[];
}
export declare function getFamilyInfo(userId: string): FamilyInfo | null;
export declare function createFamily(userId: string, name: string): FamilyInfo;
export declare function joinFamily(userId: string, inviteCode: string): FamilyInfo;
export declare function refreshFamilyInvite(userId: string): string;
export declare function leaveFamily(userId: string): {
    success: boolean;
    disbanded?: boolean;
};
export declare function removeFamilyMember(adminUserId: string, telegramId: number): boolean;
export declare function getFamilyMemories(userId: string): Array<{
    id: string;
    fact: string;
    category: string;
    created_at: number;
}>;
export declare function addFamilyMemory(userId: string, fact: string, category?: string): {
    id: `${string}-${string}-${string}-${string}-${string}`;
    fact: string;
    category: string;
    created_at: number;
};
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
export declare function getUserSettings(userId: string): UserSettings;
export declare function updateUserSettings(userId: string, patch: Partial<Omit<UserSettings, 'user_id'>>): UserSettings;
export declare function deleteAllUserData(userId: string): void;
export declare function exportAllUserData(userId: string): object;
export {};
