import { cloudClient } from './cloudClient';
import { businessChatStore } from '../storage/businessChatStore';
import {
  BusinessChatChannelRow,
  BusinessChatMessageRow,
  BusinessTaskCommentRow,
} from '../storage/syncTypes';

export type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'offline';

export type ChatWsEvent =
  | { type: 'new_message'; message: BusinessChatMessageRow }
  | { type: 'new_comment'; comment: BusinessTaskCommentRow }
  | { type: 'connection_change'; status: WsConnectionStatus };

type EventListener = (event: ChatWsEvent) => void;

interface TicketResponse {
  ticket: string;
  expires_in: number;
  ws_url: string;
}

interface ServerChatMessage {
  id: string;
  channel_id: string;
  business_id: string;
  sender_id: string;
  sender_email?: string;
  client_message_id: string;
  content: string;
  task_link_id?: string | null;
  task_title?: string | null;
  created_at: string;
  updated_at: string;
}

interface ServerTaskComment {
  id: string;
  task_id: string;
  business_id: string;
  user_id: string;
  user_email?: string;
  client_comment_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

class BusinessChatWsManager {
  private socket: WebSocket | null = null;
  private currentBusinessId: string | null = null;
  private status: WsConnectionStatus = 'disconnected';
  private listeners: Set<EventListener> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoffDelayMs: number = 1000;
  private isManuallyClosed: boolean = false;

  public getStatus(): WsConnectionStatus {
    return this.status;
  }

  public addListener(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: ChatWsEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.warn('Error in chat listener:', err);
      }
    });
  }

  private setStatus(newStatus: WsConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.notifyListeners({ type: 'connection_change', status: newStatus });
    }
  }

  public async connect(businessId: string): Promise<void> {
    this.isManuallyClosed = false;
    this.currentBusinessId = businessId;

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const online = await cloudClient.isOnline();
    if (!online) {
      this.setStatus('offline');
      return;
    }

    this.setStatus('connecting');

    try {
      // 1. Request short-lived ticket from FastAPI
      const ticketRes = await cloudClient.request<TicketResponse>(
        `/v1/businesses/${businessId}/chat/ticket`,
        { method: 'POST' }
      );

      if (ticketRes.status !== 'success' || !ticketRes.data?.ticket) {
        this.setStatus('disconnected');
        this.scheduleReconnect();
        return;
      }

      const ticket = ticketRes.data.ticket;
      const baseUrl = cloudClient.getBaseUrl();
      const wsScheme = baseUrl.startsWith('https') ? 'wss://' : 'ws://';
      const host = baseUrl.replace(/^https?:\/\//, '');
      const wsUrl = `${wsScheme}${host}/v1/businesses/${businessId}/chat/ws?ticket=${encodeURIComponent(ticket)}`;

      // 2. Open WebSocket
      const ws = new WebSocket(wsUrl);
      this.socket = ws;

      ws.onopen = () => {
        this.setStatus('connected');
        this.backoffDelayMs = 1000;
        this.startHeartbeat();

        // Catch up on missed delta and flush pending queue
        if (this.currentBusinessId) {
          businessChatService.flushPendingMessages(this.currentBusinessId);
          businessChatService.flushPendingComments(this.currentBusinessId);
        }
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'new_message' && data.message) {
            const msg: ServerChatMessage = data.message;
            const row: BusinessChatMessageRow = {
              id: msg.id,
              channel_id: msg.channel_id,
              business_id: msg.business_id,
              sender_id: msg.sender_id,
              sender_name: msg.sender_email || null,
              client_message_id: msg.client_message_id,
              content: msg.content,
              task_link_id: msg.task_link_id || null,
              task_title: msg.task_title || null,
              delivery_status: 'sent',
              created_at: msg.created_at,
              updated_at: msg.updated_at,
            };
            await businessChatStore.insertMessage(row);
            this.notifyListeners({ type: 'new_message', message: row });
          } else if (data.type === 'new_comment' && data.comment) {
            const c: ServerTaskComment = data.comment;
            const row: BusinessTaskCommentRow = {
              id: c.id,
              task_id: c.task_id,
              business_id: c.business_id,
              user_id: c.user_id,
              user_name: c.user_email || null,
              client_comment_id: c.client_comment_id,
              content: c.content,
              delivery_status: 'sent',
              created_at: c.created_at,
              updated_at: c.updated_at,
            };
            await businessChatStore.insertTaskComment(row);
            this.notifyListeners({ type: 'new_comment', comment: row });
          }
        } catch (err) {
          console.warn('Error parsing incoming chat WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        this.setStatus('disconnected');
      };

      ws.onclose = () => {
        this.cleanupSocket();
        this.setStatus('disconnected');
        if (!this.isManuallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.warn('Failed to initiate chat WebSocket connection:', err);
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isManuallyClosed = true;
    this.cleanupSocket();
    this.setStatus('disconnected');
  }

  private cleanupSocket(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
  }

  private startHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send('ping');
        } catch {}
      }
    }, 25000);
  }

  private scheduleReconnect(): void {
    if (this.isManuallyClosed || !this.currentBusinessId) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(() => {
      if (this.currentBusinessId && !this.isManuallyClosed) {
        this.connect(this.currentBusinessId);
      }
    }, this.backoffDelayMs);

    // Exponential backoff capped at 30 seconds
    this.backoffDelayMs = Math.min(this.backoffDelayMs * 1.5, 30000);
  }
}

export const businessChatWsManager = new BusinessChatWsManager();

export const businessChatService = {
  /**
   * Fetches channels from REST API and caches to local SQLite.
   */
  async syncChannels(businessId: string): Promise<BusinessChatChannelRow[]> {
    const res = await cloudClient.request<BusinessChatChannelRow[]>(
      `/v1/businesses/${businessId}/chat/channels`,
      { method: 'GET' }
    );
    if (res.status === 'success' && res.data) {
      await businessChatStore.saveChannels(res.data);
      return res.data;
    }
    return businessChatStore.getChannels(businessId);
  },

  /**
   * Fetches latest 50 messages from REST API for initial load or catch-up sync.
   */
  async syncChannelMessages(
    businessId: string,
    channelId: string,
    limit: number = 50
  ): Promise<BusinessChatMessageRow[]> {
    const res = await cloudClient.request<ServerChatMessage[]>(
      `/v1/businesses/${businessId}/chat/channels/${channelId}/messages?limit=${limit}`,
      { method: 'GET' }
    );

    if (res.status === 'success' && res.data) {
      const rows: BusinessChatMessageRow[] = res.data.map((m) => ({
        id: m.id,
        channel_id: m.channel_id,
        business_id: m.business_id,
        sender_id: m.sender_id,
        sender_name: m.sender_email || null,
        client_message_id: m.client_message_id,
        content: m.content,
        task_link_id: m.task_link_id || null,
        task_title: m.task_title || null,
        delivery_status: 'sent',
        created_at: m.created_at,
        updated_at: m.updated_at,
      }));
      await businessChatStore.saveServerMessages(rows);
    }

    return businessChatStore.getMessages(businessId, channelId);
  },

  /**
   * Sends a chat message with optimistic local storage and REST push.
   */
  async sendMessage(params: {
    businessId: string;
    channelId: string;
    senderId: string;
    senderName?: string;
    content: string;
    taskLinkId?: string;
    taskTitle?: string;
  }): Promise<BusinessChatMessageRow> {
    const clientMessageId = `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const localId = `local_msg_${clientMessageId}`;
    const now = new Date().toISOString();

    const localRow: BusinessChatMessageRow = {
      id: localId,
      channel_id: params.channelId,
      business_id: params.businessId,
      sender_id: params.senderId,
      sender_name: params.senderName || null,
      client_message_id: clientMessageId,
      content: params.content.trim(),
      task_link_id: params.taskLinkId || null,
      task_title: params.taskTitle || null,
      delivery_status: 'pending',
      created_at: now,
      updated_at: now,
    };

    // 1. Save optimistic row locally
    await businessChatStore.insertMessage(localRow);

    // 2. Attempt push to backend
    try {
      const res = await cloudClient.request<ServerChatMessage>(
        `/v1/businesses/${params.businessId}/chat/channels/${params.channelId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            client_message_id: clientMessageId,
            content: params.content.trim(),
            task_link_id: params.taskLinkId || null,
          }),
        }
      );

      if (res.status === 'success' && res.data) {
        await businessChatStore.updateMessageDeliveryStatus(
          clientMessageId,
          'sent',
          res.data.id,
          res.data.updated_at
        );
        localRow.id = res.data.id;
        localRow.delivery_status = 'sent';
      } else {
        await businessChatStore.updateMessageDeliveryStatus(clientMessageId, 'failed');
        localRow.delivery_status = 'failed';
      }
    } catch {
      await businessChatStore.updateMessageDeliveryStatus(clientMessageId, 'failed');
      localRow.delivery_status = 'failed';
    }

    return localRow;
  },

  /**
   * Flushes all pending messages to REST backend.
   */
  async flushPendingMessages(businessId: string): Promise<void> {
    const pending = await businessChatStore.getPendingMessages(businessId);
    for (const msg of pending) {
      try {
        const res = await cloudClient.request<ServerChatMessage>(
          `/v1/businesses/${businessId}/chat/channels/${msg.channel_id}/messages`,
          {
            method: 'POST',
            body: JSON.stringify({
              client_message_id: msg.client_message_id,
              content: msg.content,
              task_link_id: msg.task_link_id,
            }),
          }
        );
        if (res.status === 'success' && res.data) {
          await businessChatStore.updateMessageDeliveryStatus(
            msg.client_message_id,
            'sent',
            res.data.id,
            res.data.updated_at
          );
        }
      } catch {}
    }
  },

  /**
   * Syncs task comments from REST API.
   */
  async syncTaskComments(businessId: string, taskId: string): Promise<BusinessTaskCommentRow[]> {
    const res = await cloudClient.request<ServerTaskComment[]>(
      `/v1/businesses/${businessId}/tasks/${taskId}/comments`,
      { method: 'GET' }
    );

    if (res.status === 'success' && res.data) {
      const rows: BusinessTaskCommentRow[] = res.data.map((c) => ({
        id: c.id,
        task_id: c.task_id,
        business_id: c.business_id,
        user_id: c.user_id,
        user_name: c.user_email || null,
        client_comment_id: c.client_comment_id,
        content: c.content,
        delivery_status: 'sent',
        created_at: c.created_at,
        updated_at: c.updated_at,
      }));
      await businessChatStore.saveServerComments(rows);
    }

    return businessChatStore.getTaskComments(taskId);
  },

  /**
   * Sends a task comment with optimistic local insertion.
   */
  async sendTaskComment(params: {
    businessId: string;
    taskId: string;
    userId: string;
    userName?: string;
    content: string;
  }): Promise<BusinessTaskCommentRow> {
    const clientCommentId = `ccom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const localId = `local_com_${clientCommentId}`;
    const now = new Date().toISOString();

    const localRow: BusinessTaskCommentRow = {
      id: localId,
      task_id: params.taskId,
      business_id: params.businessId,
      user_id: params.userId,
      user_name: params.userName || null,
      client_comment_id: clientCommentId,
      content: params.content.trim(),
      delivery_status: 'pending',
      created_at: now,
      updated_at: now,
    };

    // 1. Save optimistic row locally
    await businessChatStore.insertTaskComment(localRow);

    // 2. Push to backend
    try {
      const res = await cloudClient.request<ServerTaskComment>(
        `/v1/businesses/${params.businessId}/tasks/${params.taskId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            client_comment_id: clientCommentId,
            content: params.content.trim(),
          }),
        }
      );

      if (res.status === 'success' && res.data) {
        await businessChatStore.updateCommentDeliveryStatus(
          clientCommentId,
          'sent',
          res.data.id,
          res.data.updated_at
        );
        localRow.id = res.data.id;
        localRow.delivery_status = 'sent';
      } else {
        await businessChatStore.updateCommentDeliveryStatus(clientCommentId, 'failed');
        localRow.delivery_status = 'failed';
      }
    } catch {
      await businessChatStore.updateCommentDeliveryStatus(clientCommentId, 'failed');
      localRow.delivery_status = 'failed';
    }

    return localRow;
  },

  /**
   * Flushes pending comments to REST backend.
   */
  async flushPendingComments(businessId: string): Promise<void> {
    const pending = await businessChatStore.getPendingComments(businessId);
    for (const c of pending) {
      try {
        const res = await cloudClient.request<ServerTaskComment>(
          `/v1/businesses/${businessId}/tasks/${c.task_id}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              client_comment_id: c.client_comment_id,
              content: c.content,
            }),
          }
        );
        if (res.status === 'success' && res.data) {
          await businessChatStore.updateCommentDeliveryStatus(
            c.client_comment_id,
            'sent',
            res.data.id,
            res.data.updated_at
          );
        }
      } catch {}
    }
  },
};
