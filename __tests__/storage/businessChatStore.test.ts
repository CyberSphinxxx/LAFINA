import { initDatabase, businessChatStore } from '../../src/storage';
import { db } from '../../src/storage/database';

describe('businessChatStore (Local SQLite Chat & Comments)', () => {
  const businessId = 'test-biz-chat-123';
  const userId = 'test-user-chat-456';
  const taskId = 'test-task-chat-789';

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    const now = new Date().toISOString();
    db.executeSync('DELETE FROM business_chat_messages WHERE business_id = ?', [businessId]);
    db.executeSync('DELETE FROM business_task_comments WHERE business_id = ?', [businessId]);
    db.executeSync('DELETE FROM business_chat_channels WHERE business_id = ?', [businessId]);
    db.executeSync('DELETE FROM business_tasks WHERE id = ?', [taskId]);
    db.executeSync('DELETE FROM businesses WHERE id = ?', [businessId]);
    db.executeSync('DELETE FROM users WHERE id = ?', [userId]);

    db.executeSync(
      `INSERT INTO users (id, username, email, password_hash, role, is_new_user, created_at, updated_at)
       VALUES (?, 'Test User', 'test@ustp.edu.ph', 'hash', 'student', 0, ?, ?)`,
      [userId, now, now]
    );

    db.executeSync(
      `INSERT INTO businesses (id, name, owner_id, timezone, subscription_plan, subscription_status, seat_limit, created_at, updated_at)
       VALUES (?, 'Test Business', ?, 'Asia/Manila', 'business', 'active', 5, ?, ?)`,
      [businessId, userId, now, now]
    );

    db.executeSync(
      `INSERT INTO business_tasks (id, business_id, created_by, title, instructions, priority, reminder_lead_minutes, is_cancelled, version, created_at, updated_at)
       VALUES (?, ?, ?, 'Test Task', 'Instructions', 'medium', 15, 0, 1, ?, ?)`,
      [taskId, businessId, userId, now, now]
    );
  });

  it('ensures and returns the default general channel', async () => {
    const channel = await businessChatStore.ensureDefaultChannel(businessId);
    expect(channel.name).toBe('general');
    expect(channel.business_id).toBe(businessId);

    const channels = await businessChatStore.getChannels(businessId);
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe('general');
  });

  it('inserts and retrieves chat messages with delivery status', async () => {
    const channel = await businessChatStore.ensureDefaultChannel(businessId);

    const msg = await businessChatStore.insertMessage({
      id: 'msg-local-001',
      channel_id: channel.id,
      business_id: businessId,
      sender_id: userId,
      sender_name: 'Alice',
      client_message_id: 'cmsg-test-001',
      content: 'Hello Team!',
      task_link_id: null,
      task_title: null,
      delivery_status: 'pending',
    });

    expect(msg.delivery_status).toBe('pending');

    const pending = await businessChatStore.getPendingMessages(businessId);
    expect(pending.length).toBe(1);
    expect(pending[0].client_message_id).toBe('cmsg-test-001');

    await businessChatStore.updateMessageDeliveryStatus(
      'cmsg-test-001',
      'sent',
      'server-msg-uuid-999'
    );

    const messages = await businessChatStore.getMessages(businessId, channel.id);
    expect(messages.length).toBe(1);
    expect(messages[0].delivery_status).toBe('sent');
    expect(messages[0].id).toBe('server-msg-uuid-999');

    const pendingAfter = await businessChatStore.getPendingMessages(businessId);
    expect(pendingAfter.length).toBe(0);
  });

  it('inserts and retrieves task comments with delivery status', async () => {
    const comment = await businessChatStore.insertTaskComment({
      id: 'comment-local-001',
      task_id: taskId,
      business_id: businessId,
      user_id: userId,
      user_name: 'Bob',
      client_comment_id: 'ccom-test-001',
      content: 'Task progress: 80% complete',
      delivery_status: 'pending',
    });

    expect(comment.delivery_status).toBe('pending');

    const pendingComments = await businessChatStore.getPendingComments(businessId);
    expect(pendingComments.length).toBe(1);
    expect(pendingComments[0].client_comment_id).toBe('ccom-test-001');

    await businessChatStore.updateCommentDeliveryStatus(
      'ccom-test-001',
      'sent',
      'server-comment-uuid-888'
    );

    const comments = await businessChatStore.getTaskComments(taskId);
    expect(comments.length).toBe(1);
    expect(comments[0].delivery_status).toBe('sent');
    expect(comments[0].id).toBe('server-comment-uuid-888');

    const pendingAfter = await businessChatStore.getPendingComments(businessId);
    expect(pendingAfter.length).toBe(0);
  });
});
