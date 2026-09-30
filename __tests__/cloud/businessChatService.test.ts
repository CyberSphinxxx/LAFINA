import { businessChatService } from '../../src/cloud/businessChatService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { businessChatStore } from '../../src/storage/businessChatStore';

jest.mock('../../src/cloud/cloudClient');
jest.mock('../../src/storage/businessChatStore');

describe('businessChatService (REST & WS Chat Manager)', () => {
  const businessId = 'biz-chat-service-123';
  const channelId = 'chan-chat-service-456';
  const taskId = 'task-chat-service-789';
  const userId = 'user-chat-service-001';

  beforeEach(() => {
    jest.clearAllMocks();
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (cloudClient.getBaseUrl as jest.Mock).mockReturnValue('http://10.0.2.2:8000');
  });

  it('syncs channels from REST API and caches locally', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: [
        {
          id: channelId,
          business_id: businessId,
          name: 'general',
          channel_type: 'general',
          is_archived: 0,
          created_at: '2026-08-25T00:00:00Z',
          updated_at: '2026-08-25T00:00:00Z',
        },
      ],
    });

    const channels = await businessChatService.syncChannels(businessId);
    expect(cloudClient.request).toHaveBeenCalledWith(
      `/v1/businesses/${businessId}/chat/channels`,
      { method: 'GET' }
    );
    expect(businessChatStore.saveChannels).toHaveBeenCalledTimes(1);
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe('general');
  });

  it('sends chat message with optimistic write and marks sent on REST success', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: {
        id: 'server-msg-123',
        channel_id: channelId,
        business_id: businessId,
        sender_id: userId,
        client_message_id: 'cmsg-123',
        content: 'Testing message send',
        task_link_id: taskId,
        task_title: 'Test Task',
        created_at: '2026-08-25T00:00:00Z',
        updated_at: '2026-08-25T00:00:00Z',
      },
    });

    const result = await businessChatService.sendMessage({
      businessId,
      channelId,
      senderId: userId,
      senderName: 'Alice',
      content: 'Testing message send',
      taskLinkId: taskId,
      taskTitle: 'Test Task',
    });

    expect(businessChatStore.insertMessage).toHaveBeenCalledTimes(1);
    expect(businessChatStore.updateMessageDeliveryStatus).toHaveBeenCalledWith(
      expect.stringContaining('cmsg_'),
      'sent',
      'server-msg-123',
      '2026-08-25T00:00:00Z'
    );
    expect(result.delivery_status).toBe('sent');
  });

  it('marks chat message failed when REST push fails', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'server_error',
      error: 'Network timeout',
    });

    const result = await businessChatService.sendMessage({
      businessId,
      channelId,
      senderId: userId,
      content: 'Offline message',
    });

    expect(businessChatStore.insertMessage).toHaveBeenCalledTimes(1);
    expect(businessChatStore.updateMessageDeliveryStatus).toHaveBeenCalledWith(
      expect.stringContaining('cmsg_'),
      'failed'
    );
    expect(result.delivery_status).toBe('failed');
  });

  it('sends task comment with optimistic write and updates status', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: {
        id: 'server-comment-456',
        task_id: taskId,
        business_id: businessId,
        user_id: userId,
        client_comment_id: 'ccom-456',
        content: 'Review complete',
        created_at: '2026-08-25T00:00:00Z',
        updated_at: '2026-08-25T00:00:00Z',
      },
    });

    const result = await businessChatService.sendTaskComment({
      businessId,
      taskId,
      userId,
      userName: 'Dr. Eleanor',
      content: 'Review complete',
    });

    expect(businessChatStore.insertTaskComment).toHaveBeenCalledTimes(1);
    expect(businessChatStore.updateCommentDeliveryStatus).toHaveBeenCalledWith(
      expect.stringContaining('ccom_'),
      'sent',
      'server-comment-456',
      '2026-08-25T00:00:00Z'
    );
    expect(result.delivery_status).toBe('sent');
  });
});
