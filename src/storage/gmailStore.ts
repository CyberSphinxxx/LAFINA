import { db } from './database';
import type {
  LocalGmailConnectionRow,
  LocalGmailThreadCacheRow,
  LocalGmailMessageCacheRow,
  LocalGmailDraftRow,
  GmailAttachmentInfo,
} from './syncTypes';
import { generateId } from '../utils';

export interface CacheThreadInput {
  thread_id: string;
  history_id?: string;
  snippet?: string;
  subject?: string;
  from_address?: string;
  to_address?: string;
  date?: string;
  unread?: boolean;
  message_count?: number;
  has_attachments?: boolean;
}

export interface CacheMessageInput {
  message_id: string;
  thread_id: string;
  subject: string;
  from_address: string;
  to_address: string;
  cc_address?: string | null;
  bcc_address?: string | null;
  date: string;
  snippet?: string;
  body_plain: string;
  body_html?: string | null;
  attachments?: GmailAttachmentInfo[];
  is_read?: boolean;
}

export interface SaveDraftInput {
  id?: string;
  user_id: string;
  remote_draft_id?: string | null;
  thread_id?: string | null;
  to_address: string;
  cc_address?: string | null;
  bcc_address?: string | null;
  subject: string;
  body: string;
  status?: 'draft' | 'sending' | 'failed';
}

export const gmailStore = {
  /**
   * Saves or updates the local Gmail connection status for a user.
   */
  saveConnection: (
    userId: string,
    emailAddress: string,
    isConnected: boolean = true
  ): void => {
    if (!userId) return;
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO gmail_connections (user_id, email_address, is_connected, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email_address = excluded.email_address,
         is_connected = excluded.is_connected,
         last_synced_at = excluded.last_synced_at,
         updated_at = excluded.updated_at`,
      [userId, emailAddress, isConnected ? 1 : 0, now, now, now]
    );
  },

  /**
   * Retrieves the local Gmail connection status for a user.
   */
  getConnection: (userId: string): LocalGmailConnectionRow | null => {
    if (!userId) return null;
    const res = db.executeSync(
      `SELECT user_id, email_address, is_connected, last_synced_at, created_at, updated_at
       FROM gmail_connections
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    const row = res.rows?.[0] as Record<string, any> | undefined;
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      email_address: String(row.email_address),
      is_connected: Number(row.is_connected),
      last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  },

  /**
   * Deletes local connection record and clears local cache when user disconnects.
   */
  deleteConnection: (userId: string): void => {
    if (!userId) return;
    db.executeSync('DELETE FROM gmail_connections WHERE user_id = ?', [userId]);
    gmailStore.clearCache(userId);
  },

  /**
   * Caches thread summaries, keeping at most the 50 most recent threads in SQLite.
   */
  cacheThreads: (userId: string, threads: CacheThreadInput[]): void => {
    if (!userId || !threads || threads.length === 0) return;
    const now = new Date().toISOString();

    for (const thread of threads) {
      db.executeSync(
        `INSERT INTO gmail_threads_cache (
           user_id, thread_id, history_id, snippet, subject,
           from_address, to_address, date, unread, message_count,
           has_attachments, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, thread_id) DO UPDATE SET
           history_id = excluded.history_id,
           snippet = excluded.snippet,
           subject = CASE WHEN excluded.subject != '' THEN excluded.subject ELSE gmail_threads_cache.subject END,
           from_address = CASE WHEN excluded.from_address != '' THEN excluded.from_address ELSE gmail_threads_cache.from_address END,
           to_address = CASE WHEN excluded.to_address != '' THEN excluded.to_address ELSE gmail_threads_cache.to_address END,
           date = CASE WHEN excluded.date != '' THEN excluded.date ELSE gmail_threads_cache.date END,
           unread = excluded.unread,
           message_count = excluded.message_count,
           has_attachments = excluded.has_attachments,
           updated_at = excluded.updated_at`,
        [
          userId,
          thread.thread_id,
          thread.history_id || '',
          thread.snippet || '',
          thread.subject || '',
          thread.from_address || '',
          thread.to_address || '',
          thread.date || '',
          thread.unread ? 1 : 0,
          thread.message_count || 1,
          thread.has_attachments ? 1 : 0,
          now,
          now,
        ]
      );
    }

    // Prune cache to keep only latest 50 threads
    db.executeSync(
      `DELETE FROM gmail_threads_cache
       WHERE user_id = ? AND thread_id NOT IN (
         SELECT thread_id FROM gmail_threads_cache
         WHERE user_id = ?
         ORDER BY updated_at DESC, date DESC
         LIMIT 50
       )`,
      [userId, userId]
    );
  },

  /**
   * Retrieves cached thread summaries for offline browsing.
   */
  getCachedThreads: (userId: string, limit: number = 50): LocalGmailThreadCacheRow[] => {
    if (!userId) return [];
    const res = db.executeSync(
      `SELECT user_id, thread_id, history_id, snippet, subject,
              from_address, to_address, date, unread, message_count,
              has_attachments, created_at, updated_at
       FROM gmail_threads_cache
       WHERE user_id = ?
       ORDER BY updated_at DESC, date DESC
       LIMIT ?`,
      [userId, limit]
    );

    return (res.rows || []).map((row: any) => ({
      user_id: String(row.user_id),
      thread_id: String(row.thread_id),
      history_id: String(row.history_id),
      snippet: String(row.snippet),
      subject: String(row.subject),
      from_address: String(row.from_address),
      to_address: String(row.to_address),
      date: String(row.date),
      unread: Number(row.unread),
      message_count: Number(row.message_count),
      has_attachments: Number(row.has_attachments),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }));
  },

  /**
   * Caches an opened message body and attachment metadata in SQLite.
   */
  cacheMessage: (userId: string, message: CacheMessageInput): void => {
    if (!userId || !message.message_id) return;
    const now = new Date().toISOString();
    const attachmentsJson = message.attachments && message.attachments.length > 0
      ? JSON.stringify(message.attachments)
      : null;

    db.executeSync(
      `INSERT INTO gmail_messages_cache (
         user_id, message_id, thread_id, subject, from_address,
         to_address, cc_address, bcc_address, date, snippet,
         body_plain, body_html, attachments_json, is_read, cached_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, message_id) DO UPDATE SET
         subject = excluded.subject,
         from_address = excluded.from_address,
         to_address = excluded.to_address,
         cc_address = excluded.cc_address,
         bcc_address = excluded.bcc_address,
         date = excluded.date,
         snippet = excluded.snippet,
         body_plain = excluded.body_plain,
         body_html = excluded.body_html,
         attachments_json = excluded.attachments_json,
         is_read = excluded.is_read,
         cached_at = excluded.cached_at`,
      [
        userId,
        message.message_id,
        message.thread_id,
        message.subject || '',
        message.from_address || '',
        message.to_address || '',
        message.cc_address || null,
        message.bcc_address || null,
        message.date || '',
        message.snippet || '',
        message.body_plain || '',
        message.body_html || null,
        attachmentsJson,
        message.is_read ? 1 : 0,
        now,
      ]
    );
  },

  /**
   * Retrieves cached message bodies for a given thread.
   */
  getCachedMessages: (userId: string, threadId: string): LocalGmailMessageCacheRow[] => {
    if (!userId || !threadId) return [];
    const res = db.executeSync(
      `SELECT user_id, message_id, thread_id, subject, from_address,
              to_address, cc_address, bcc_address, date, snippet,
              body_plain, body_html, attachments_json, is_read, cached_at
       FROM gmail_messages_cache
       WHERE user_id = ? AND thread_id = ?
       ORDER BY date ASC, cached_at ASC`,
      [userId, threadId]
    );

    return (res.rows || []).map((row: any) => ({
      user_id: String(row.user_id),
      message_id: String(row.message_id),
      thread_id: String(row.thread_id),
      subject: String(row.subject),
      from_address: String(row.from_address),
      to_address: String(row.to_address),
      cc_address: row.cc_address ? String(row.cc_address) : null,
      bcc_address: row.bcc_address ? String(row.bcc_address) : null,
      date: String(row.date),
      snippet: String(row.snippet),
      body_plain: String(row.body_plain),
      body_html: row.body_html ? String(row.body_html) : null,
      attachments_json: row.attachments_json ? String(row.attachments_json) : null,
      is_read: Number(row.is_read),
      cached_at: String(row.cached_at),
    }));
  },

  /**
   * Purges cached message bodies older than 30 days.
   */
  purgeExpiredCache: (userId: string, maxAgeDays: number = 30): void => {
    if (!userId) return;
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    db.executeSync(
      'DELETE FROM gmail_messages_cache WHERE user_id = ? AND cached_at < ?',
      [userId, cutoff]
    );
  },

  /**
   * Clears all cached threads and messages for a user.
   */
  clearCache: (userId: string): void => {
    if (!userId) return;
    db.executeSync('DELETE FROM gmail_threads_cache WHERE user_id = ?', [userId]);
    db.executeSync('DELETE FROM gmail_messages_cache WHERE user_id = ?', [userId]);
  },

  /**
   * Saves or updates a local draft in SQLite.
   */
  saveLocalDraft: (input: SaveDraftInput): LocalGmailDraftRow => {
    const id = input.id || generateId();
    const now = new Date().toISOString();
    const status = input.status || 'draft';

    db.executeSync(
      `INSERT INTO gmail_local_drafts (
         id, user_id, remote_draft_id, thread_id, to_address,
         cc_address, bcc_address, subject, body, status, updated_at, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         remote_draft_id = excluded.remote_draft_id,
         thread_id = excluded.thread_id,
         to_address = excluded.to_address,
         cc_address = excluded.cc_address,
         bcc_address = excluded.bcc_address,
         subject = excluded.subject,
         body = excluded.body,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        id,
        input.user_id,
        input.remote_draft_id || null,
        input.thread_id || null,
        input.to_address || '',
        input.cc_address || null,
        input.bcc_address || null,
        input.subject || '',
        input.body || '',
        status,
        now,
        now,
      ]
    );

    return {
      id,
      user_id: input.user_id,
      remote_draft_id: input.remote_draft_id || null,
      thread_id: input.thread_id || null,
      to_address: input.to_address || '',
      cc_address: input.cc_address || null,
      bcc_address: input.bcc_address || null,
      subject: input.subject || '',
      body: input.body || '',
      status,
      updated_at: now,
      created_at: now,
    };
  },

  /**
   * Retrieves all local drafts for a user.
   */
  getLocalDrafts: (userId: string): LocalGmailDraftRow[] => {
    if (!userId) return [];
    const res = db.executeSync(
      `SELECT id, user_id, remote_draft_id, thread_id, to_address,
              cc_address, bcc_address, subject, body, status, updated_at, created_at
       FROM gmail_local_drafts
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
      [userId]
    );

    return (res.rows || []).map((row: any) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      remote_draft_id: row.remote_draft_id ? String(row.remote_draft_id) : null,
      thread_id: row.thread_id ? String(row.thread_id) : null,
      to_address: String(row.to_address),
      cc_address: row.cc_address ? String(row.cc_address) : null,
      bcc_address: row.bcc_address ? String(row.bcc_address) : null,
      subject: String(row.subject),
      body: String(row.body),
      status: row.status as 'draft' | 'sending' | 'failed',
      updated_at: String(row.updated_at),
      created_at: String(row.created_at),
    }));
  },

  /**
   * Retrieves a single local draft by ID.
   */
  getLocalDraft: (userId: string, draftId: string): LocalGmailDraftRow | null => {
    if (!userId || !draftId) return null;
    const res = db.executeSync(
      `SELECT id, user_id, remote_draft_id, thread_id, to_address,
              cc_address, bcc_address, subject, body, status, updated_at, created_at
       FROM gmail_local_drafts
       WHERE user_id = ? AND id = ?
       LIMIT 1`,
      [userId, draftId]
    );
    const row = res.rows?.[0] as Record<string, any> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      remote_draft_id: row.remote_draft_id ? String(row.remote_draft_id) : null,
      thread_id: row.thread_id ? String(row.thread_id) : null,
      to_address: String(row.to_address),
      cc_address: row.cc_address ? String(row.cc_address) : null,
      bcc_address: row.bcc_address ? String(row.bcc_address) : null,
      subject: String(row.subject),
      body: String(row.body),
      status: row.status as 'draft' | 'sending' | 'failed',
      updated_at: String(row.updated_at),
      created_at: String(row.created_at),
    };
  },

  /**
   * Deletes a local draft by ID.
   */
  deleteLocalDraft: (userId: string, draftId: string): void => {
    if (!userId || !draftId) return;
    db.executeSync('DELETE FROM gmail_local_drafts WHERE user_id = ? AND id = ?', [userId, draftId]);
  },
};
