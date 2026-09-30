import { cloudClient } from './cloudClient';
import { gmailStore } from '../storage/gmailStore';
import type {
  LocalGmailThreadCacheRow,
  LocalGmailDraftRow,
  GmailAttachmentInfo,
} from '../storage/syncTypes';

export interface GmailThreadSummary {
  thread_id: string;
  history_id: string;
  snippet: string;
  subject?: string;
  from_address?: string;
  to_address?: string;
  date?: string;
  unread?: boolean;
  message_count?: number;
  has_attachments?: boolean;
}

export interface GmailMessageDetailData {
  message_id: string;
  thread_id: string;
  subject: string;
  from_address: string;
  to_address: string;
  cc_address: string;
  bcc_address: string;
  date: string;
  internal_date: string;
  snippet: string;
  body_plain: string;
  body_html: string;
  is_unread: boolean;
  attachments: GmailAttachmentInfo[];
}

export interface GmailThreadDetailData {
  thread_id: string;
  history_id: string;
  subject: string;
  messages: GmailMessageDetailData[];
  has_attachments: boolean;
  is_unread: boolean;
  message_count: number;
}

export interface GmailConnectionStatus {
  connected: boolean;
  email_address?: string | null;
  scopes?: string[];
  connected_at?: string | null;
}

export const gmailService = {
  /**
   * Starts OAuth2 PKCE connection flow and returns Google authorization URL.
   */
  startConnect: async (): Promise<{ auth_url: string; state: string } | null> => {
    const res = await cloudClient.request<{ auth_url: string; state: string }>(
      '/v1/email/gmail/connect/start',
      { method: 'POST' }
    );
    if (res.status === 'success' && res.data) {
      return res.data;
    }
    throw new Error(res.error || 'Failed to start Gmail connection.');
  },

  /**
   * Retrieves Gmail connection status, syncing with local SQLite store.
   */
  getConnectionStatus: async (userId: string): Promise<GmailConnectionStatus> => {
    const isOnline = await cloudClient.isOnline();
    if (!isOnline) {
      const local = gmailStore.getConnection(userId);
      if (local && local.is_connected) {
        return {
          connected: true,
          email_address: local.email_address,
          connected_at: local.created_at,
        };
      }
      return { connected: false };
    }

    const res = await cloudClient.request<GmailConnectionStatus>('/v1/email/gmail/connection');
    if (res.status === 'success' && res.data) {
      if (res.data.connected && res.data.email_address) {
        gmailStore.saveConnection(userId, res.data.email_address, true);
      } else {
        gmailStore.deleteConnection(userId);
      }
      return res.data;
    }

    // Fallback to local SQLite
    const local = gmailStore.getConnection(userId);
    if (local && local.is_connected) {
      return {
        connected: true,
        email_address: local.email_address,
        connected_at: local.created_at,
      };
    }
    return { connected: false };
  },

  /**
   * Disconnects Gmail account, revokes tokens, and clears local cache.
   */
  disconnect: async (userId: string): Promise<boolean> => {
    try {
      const isOnline = await cloudClient.isOnline();
      if (isOnline) {
        await cloudClient.request('/v1/email/gmail/connection', {
          method: 'DELETE',
        });
      }
    } finally {
      gmailStore.deleteConnection(userId);
    }
    return true;
  },

  /**
   * Fetches thread list from Gmail API or SQLite cache if offline.
   */
  fetchThreads: async (
    userId: string,
    options?: { q?: string; pageToken?: string; maxResults?: number }
  ): Promise<{
    threads: LocalGmailThreadCacheRow[];
    nextPageToken?: string;
    isOffline: boolean;
  }> => {
    const isOnline = await cloudClient.isOnline();
    if (!isOnline) {
      const cached = gmailStore.getCachedThreads(userId, options?.maxResults || 50);
      return { threads: cached, isOffline: true };
    }

    const params = new URLSearchParams();
    if (options?.q) params.append('q', options.q);
    if (options?.pageToken) params.append('pageToken', options.pageToken);
    if (options?.maxResults) params.append('maxResults', String(options.maxResults));

    const endpoint = `/v1/email/gmail/threads${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await cloudClient.request<{
      threads: GmailThreadSummary[];
      next_page_token?: string;
      result_size_estimate: number;
    }>(endpoint);

    if (res.status === 'success' && res.data) {
      // Cache returned threads in SQLite
      gmailStore.cacheThreads(userId, res.data.threads);
      const cached = gmailStore.getCachedThreads(userId, options?.maxResults || 50);
      return {
        threads: cached,
        nextPageToken: res.data.next_page_token,
        isOffline: false,
      };
    }

    // On error, fallback to SQLite cache
    const cached = gmailStore.getCachedThreads(userId, options?.maxResults || 50);
    return { threads: cached, isOffline: true };
  },

  /**
   * Fetches full thread messages and attachments, falling back to local SQLite cache.
   */
  fetchThreadDetail: async (
    userId: string,
    threadId: string
  ): Promise<{ detail: GmailThreadDetailData | null; isOffline: boolean }> => {
    const isOnline = await cloudClient.isOnline();
    if (!isOnline) {
      const cachedMsgs = gmailStore.getCachedMessages(userId, threadId);
      if (cachedMsgs.length > 0) {
        const first = cachedMsgs[0];
        const messages: GmailMessageDetailData[] = cachedMsgs.map((m) => ({
          message_id: m.message_id,
          thread_id: m.thread_id,
          subject: m.subject,
          from_address: m.from_address,
          to_address: m.to_address,
          cc_address: m.cc_address || '',
          bcc_address: m.bcc_address || '',
          date: m.date,
          internal_date: '',
          snippet: m.snippet,
          body_plain: m.body_plain,
          body_html: m.body_html || '',
          is_unread: m.is_read === 0,
          attachments: m.attachments_json ? JSON.parse(m.attachments_json) : [],
        }));

        return {
          detail: {
            thread_id: threadId,
            history_id: '',
            subject: first.subject,
            messages,
            has_attachments: messages.some((m) => m.attachments.length > 0),
            is_unread: messages.some((m) => m.is_unread),
            message_count: messages.length,
          },
          isOffline: true,
        };
      }
      return { detail: null, isOffline: true };
    }

    const res = await cloudClient.request<GmailThreadDetailData>(
      `/v1/email/gmail/threads/${threadId}`
    );

    if (res.status === 'success' && res.data) {
      // Cache each message and attachment metadata in SQLite
      for (const msg of res.data.messages) {
        gmailStore.cacheMessage(userId, {
          message_id: msg.message_id,
          thread_id: msg.thread_id,
          subject: msg.subject,
          from_address: msg.from_address,
          to_address: msg.to_address,
          cc_address: msg.cc_address,
          bcc_address: msg.bcc_address,
          date: msg.date,
          snippet: msg.snippet,
          body_plain: msg.body_plain,
          body_html: msg.body_html,
          attachments: msg.attachments,
          is_read: !msg.is_unread,
        });
      }
      // Clean expired messages older than 30 days
      gmailStore.purgeExpiredCache(userId, 30);

      return { detail: res.data, isOffline: false };
    }

    // Fallback on request failure
    const cachedMsgs = gmailStore.getCachedMessages(userId, threadId);
    if (cachedMsgs.length > 0) {
      const first = cachedMsgs[0];
      const messages: GmailMessageDetailData[] = cachedMsgs.map((m) => ({
        message_id: m.message_id,
        thread_id: m.thread_id,
        subject: m.subject,
        from_address: m.from_address,
        to_address: m.to_address,
        cc_address: m.cc_address || '',
        bcc_address: m.bcc_address || '',
        date: m.date,
        internal_date: '',
        snippet: m.snippet,
        body_plain: m.body_plain,
        body_html: m.body_html || '',
        is_unread: m.is_read === 0,
        attachments: m.attachments_json ? JSON.parse(m.attachments_json) : [],
      }));

      return {
        detail: {
          thread_id: threadId,
          history_id: '',
          subject: first.subject,
          messages,
          has_attachments: messages.some((m) => m.attachments.length > 0),
          is_unread: messages.some((m) => m.is_unread),
          message_count: messages.length,
        },
        isOffline: true,
      };
    }

    return { detail: null, isOffline: false };
  },

  /**
   * Creates a draft message in Gmail (or saves locally if offline).
   */
  createDraft: async (
    userId: string,
    draft: {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      thread_id?: string;
    }
  ): Promise<LocalGmailDraftRow> => {
    const isOnline = await cloudClient.isOnline();
    let remoteDraftId: string | null = null;

    if (isOnline) {
      try {
        const res = await cloudClient.request<{
          draft_id: string;
          message_id?: string;
          thread_id?: string;
        }>('/v1/email/gmail/drafts', {
          method: 'POST',
          body: JSON.stringify({
            to: draft.to,
            subject: draft.subject,
            body: draft.body,
            cc: draft.cc,
            bcc: draft.bcc,
            thread_id: draft.thread_id,
          }),
        });
        if (res.status === 'success' && res.data) {
          remoteDraftId = res.data.draft_id;
        }
      } catch (e) {
        console.warn('Could not sync draft to cloud Gmail, saving locally:', e);
      }
    }

    return gmailStore.saveLocalDraft({
      user_id: userId,
      remote_draft_id: remoteDraftId,
      thread_id: draft.thread_id,
      to_address: draft.to,
      cc_address: draft.cc,
      bcc_address: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      status: 'draft',
    });
  },

  /**
   * Updates an existing draft message.
   */
  updateDraft: async (
    userId: string,
    draftId: string,
    draft: {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      thread_id?: string;
    }
  ): Promise<LocalGmailDraftRow> => {
    const local = gmailStore.getLocalDraft(userId, draftId);
    const remoteId = local?.remote_draft_id || (draftId.startsWith('draft_') ? null : draftId);

    const isOnline = await cloudClient.isOnline();
    if (isOnline && remoteId) {
      try {
        await cloudClient.request(`/v1/email/gmail/drafts/${remoteId}`, {
          method: 'PUT',
          body: JSON.stringify({
            to: draft.to,
            subject: draft.subject,
            body: draft.body,
            cc: draft.cc,
            bcc: draft.bcc,
            thread_id: draft.thread_id,
          }),
        });
      } catch (e) {
        console.warn('Could not update draft on Gmail server:', e);
      }
    }

    return gmailStore.saveLocalDraft({
      id: draftId,
      user_id: userId,
      remote_draft_id: remoteId,
      thread_id: draft.thread_id,
      to_address: draft.to,
      cc_address: draft.cc,
      bcc_address: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      status: 'draft',
    });
  },

  /**
   * Sends a draft email via Gmail API with explicit confirmation and idempotency.
   * STRICT RULE: Never sends if offline. Keeps draft and rejects immediately.
   */
  sendDraft: async (
    userId: string,
    draftId: string,
    idempotencyKey?: string
  ): Promise<{ status: string; message_id?: string }> => {
    const isOnline = await cloudClient.isOnline();
    if (!isOnline) {
      throw new Error(
        'Cannot send email while offline. Your message is preserved as a draft. Please reconnect and try again.'
      );
    }

    const local = gmailStore.getLocalDraft(userId, draftId);
    const targetDraftId = local?.remote_draft_id || draftId;

    const res = await cloudClient.request<{
      status: string;
      message_id?: string;
      thread_id?: string;
      idempotent_replay?: boolean;
    }>(`/v1/email/gmail/drafts/${targetDraftId}/send`, {
      method: 'POST',
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    });

    if (res.status === 'success' && res.data) {
      // Remove local draft upon successful send
      gmailStore.deleteLocalDraft(userId, draftId);
      return { status: 'sent', message_id: res.data.message_id };
    }

    throw new Error(res.error || 'Failed to send email.');
  },
};
