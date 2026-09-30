import { db } from './database';
import {
  BusinessChatChannelRow,
  BusinessChatMessageRow,
  BusinessTaskCommentRow,
  DeliveryStatus,
} from './syncTypes';

export const businessChatStore = {
  /**
   * Ensures default "general" channel exists locally in SQLite and returns it.
   */
  async ensureDefaultChannel(businessId: string): Promise<BusinessChatChannelRow> {
    const existing = db.executeSync(
      `SELECT * FROM business_chat_channels WHERE business_id = ? AND name = 'general' LIMIT 1`,
      [businessId]
    ).rows?.[0] as BusinessChatChannelRow | undefined;

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const defaultChannel: BusinessChatChannelRow = {
      id: `chan_${businessId}_general`,
      business_id: businessId,
      name: 'general',
      channel_type: 'general',
      is_archived: 0,
      created_at: now,
      updated_at: now,
    };

    db.executeSync(
      `INSERT OR IGNORE INTO business_chat_channels (
        id, business_id, name, channel_type, is_archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        defaultChannel.id,
        defaultChannel.business_id,
        defaultChannel.name,
        defaultChannel.channel_type,
        defaultChannel.is_archived,
        defaultChannel.created_at,
        defaultChannel.updated_at,
      ]
    );

    return defaultChannel;
  },

  /**
   * Gets all active channels for a business.
   */
  async getChannels(businessId: string): Promise<BusinessChatChannelRow[]> {
    const rows = db.executeSync(
      `SELECT * FROM business_chat_channels WHERE business_id = ? AND is_archived = 0 ORDER BY created_at ASC`,
      [businessId]
    ).rows as BusinessChatChannelRow[] | undefined;

    if (!rows || rows.length === 0) {
      const defaultChan = await this.ensureDefaultChannel(businessId);
      return [defaultChan];
    }
    return rows;
  },

  /**
   * Saves or updates channels from server sync.
   */
  async saveChannels(channels: BusinessChatChannelRow[]): Promise<void> {
    for (const ch of channels) {
      db.executeSync(
        `INSERT INTO business_chat_channels (
          id, business_id, name, channel_type, is_archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          channel_type = excluded.channel_type,
          is_archived = excluded.is_archived,
          updated_at = excluded.updated_at`,
        [ch.id, ch.business_id, ch.name, ch.channel_type, ch.is_archived, ch.created_at, ch.updated_at]
      );
    }
  },

  /**
   * Fetches messages for a channel in chronological order.
   */
  async getMessages(
    businessId: string,
    channelId: string,
    limit: number = 100
  ): Promise<BusinessChatMessageRow[]> {
    const rows = db.executeSync(
      `SELECT * FROM business_chat_messages
       WHERE business_id = ? AND channel_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [businessId, channelId, limit]
    ).rows as BusinessChatMessageRow[] | undefined;

    return rows ?? [];
  },

  /**
   * Inserts an outgoing or incoming chat message.
   */
  async insertMessage(
    message: Omit<BusinessChatMessageRow, 'created_at' | 'updated_at'> & {
      created_at?: string;
      updated_at?: string;
    }
  ): Promise<BusinessChatMessageRow> {
    const now = new Date().toISOString();
    const fullMessage: BusinessChatMessageRow = {
      ...message,
      created_at: message.created_at || now,
      updated_at: message.updated_at || now,
    };

    db.executeSync(
      `INSERT INTO business_chat_messages (
        id, channel_id, business_id, sender_id, sender_name, client_message_id,
        content, task_link_id, task_title, delivery_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(business_id, client_message_id) DO UPDATE SET
        content = excluded.content,
        task_link_id = excluded.task_link_id,
        task_title = excluded.task_title,
        delivery_status = excluded.delivery_status,
        updated_at = excluded.updated_at`,
      [
        fullMessage.id,
        fullMessage.channel_id,
        fullMessage.business_id,
        fullMessage.sender_id,
        fullMessage.sender_name,
        fullMessage.client_message_id,
        fullMessage.content,
        fullMessage.task_link_id,
        fullMessage.task_title,
        fullMessage.delivery_status,
        fullMessage.created_at,
        fullMessage.updated_at,
      ]
    );

    return fullMessage;
  },

  /**
   * Updates delivery status for a message by client_message_id.
   */
  async updateMessageDeliveryStatus(
    clientMessageId: string,
    status: DeliveryStatus,
    serverId?: string,
    updatedAt?: string
  ): Promise<void> {
    const now = updatedAt || new Date().toISOString();
    if (serverId) {
      db.executeSync(
        `UPDATE business_chat_messages
         SET delivery_status = ?, id = ?, updated_at = ?
         WHERE client_message_id = ?`,
        [status, serverId, now, clientMessageId]
      );
    } else {
      db.executeSync(
        `UPDATE business_chat_messages
         SET delivery_status = ?, updated_at = ?
         WHERE client_message_id = ?`,
        [status, now, clientMessageId]
      );
    }
  },

  /**
   * Batch saves server messages from REST catch-up or WebSocket.
   */
  async saveServerMessages(messages: BusinessChatMessageRow[]): Promise<void> {
    for (const msg of messages) {
      await this.insertMessage({
        ...msg,
        delivery_status: 'sent',
      });
    }
  },

  /**
   * Gets pending messages that need to be flushed to backend.
   */
  async getPendingMessages(businessId: string): Promise<BusinessChatMessageRow[]> {
    const rows = db.executeSync(
      `SELECT * FROM business_chat_messages
       WHERE business_id = ? AND delivery_status = 'pending'
       ORDER BY created_at ASC`,
      [businessId]
    ).rows as BusinessChatMessageRow[] | undefined;

    return rows ?? [];
  },

  /**
   * Gets all comments for a specific task ordered chronologically.
   */
  async getTaskComments(taskId: string): Promise<BusinessTaskCommentRow[]> {
    const rows = db.executeSync(
      `SELECT * FROM business_task_comments
       WHERE task_id = ?
       ORDER BY created_at ASC`,
      [taskId]
    ).rows as BusinessTaskCommentRow[] | undefined;

    return rows ?? [];
  },

  /**
   * Inserts a task comment.
   */
  async insertTaskComment(
    comment: Omit<BusinessTaskCommentRow, 'created_at' | 'updated_at'> & {
      created_at?: string;
      updated_at?: string;
    }
  ): Promise<BusinessTaskCommentRow> {
    const now = new Date().toISOString();
    const fullComment: BusinessTaskCommentRow = {
      ...comment,
      created_at: comment.created_at || now,
      updated_at: comment.updated_at || now,
    };

    db.executeSync(
      `INSERT INTO business_task_comments (
        id, task_id, business_id, user_id, user_name, client_comment_id,
        content, delivery_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, client_comment_id) DO UPDATE SET
        content = excluded.content,
        delivery_status = excluded.delivery_status,
        updated_at = excluded.updated_at`,
      [
        fullComment.id,
        fullComment.task_id,
        fullComment.business_id,
        fullComment.user_id,
        fullComment.user_name,
        fullComment.client_comment_id,
        fullComment.content,
        fullComment.delivery_status,
        fullComment.created_at,
        fullComment.updated_at,
      ]
    );

    return fullComment;
  },

  /**
   * Updates delivery status for a task comment by client_comment_id.
   */
  async updateCommentDeliveryStatus(
    clientCommentId: string,
    status: DeliveryStatus,
    serverId?: string,
    updatedAt?: string
  ): Promise<void> {
    const now = updatedAt || new Date().toISOString();
    if (serverId) {
      db.executeSync(
        `UPDATE business_task_comments
         SET delivery_status = ?, id = ?, updated_at = ?
         WHERE client_comment_id = ?`,
        [status, serverId, now, clientCommentId]
      );
    } else {
      db.executeSync(
        `UPDATE business_task_comments
         SET delivery_status = ?, updated_at = ?
         WHERE client_comment_id = ?`,
        [status, now, clientCommentId]
      );
    }
  },

  /**
   * Batch saves server comments from REST catch-up or WebSocket.
   */
  async saveServerComments(comments: BusinessTaskCommentRow[]): Promise<void> {
    for (const c of comments) {
      await this.insertTaskComment({
        ...c,
        delivery_status: 'sent',
      });
    }
  },

  /**
   * Gets pending comments that need to be sent to backend.
   */
  async getPendingComments(businessId: string): Promise<BusinessTaskCommentRow[]> {
    const rows = db.executeSync(
      `SELECT * FROM business_task_comments
       WHERE business_id = ? AND delivery_status = 'pending'
       ORDER BY created_at ASC`,
      [businessId]
    ).rows as BusinessTaskCommentRow[] | undefined;

    return rows ?? [];
  },
};
