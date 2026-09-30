import { gmailService } from '../../src/cloud/gmailService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { gmailStore } from '../../src/storage/gmailStore';
import { initDatabase, seedLocalDemoAccounts, DEMO_IDS } from '../../src/storage';

jest.mock('../../src/cloud/cloudClient', () => ({
  cloudClient: {
    isOnline: jest.fn(),
    request: jest.fn(),
  },
}));

describe('gmailService - Cloud API & Offline Integration', () => {
  const userId = DEMO_IDS.MANAGER_ID;

  beforeEach(async () => {
    await initDatabase();
    await seedLocalDemoAccounts();
    gmailStore.clearCache(userId);
    gmailStore.deleteConnection(userId);
    jest.clearAllMocks();
  });

  it('starts OAuth connect flow when online', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
        state: 'oauth-state-123',
      },
    });

    const res = await gmailService.startConnect();
    expect(res?.state).toBe('oauth-state-123');
    expect(cloudClient.request).toHaveBeenCalledWith(
      '/v1/email/gmail/connect/start',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('fetches connection status from server and updates local SQLite', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        connected: true,
        email_address: 'business_owner@gmail.com',
        scopes: ['gmail.readonly', 'gmail.compose'],
        connected_at: '2026-08-25T12:00:00Z',
      },
    });

    const status = await gmailService.getConnectionStatus(userId);
    expect(status.connected).toBe(true);
    expect(status.email_address).toBe('business_owner@gmail.com');

    // Local SQLite should now have the saved connection
    const local = gmailStore.getConnection(userId);
    expect(local?.email_address).toBe('business_owner@gmail.com');
  });

  it('falls back to local connection status when offline', async () => {
    // Pre-save connection in SQLite
    gmailStore.saveConnection(userId, 'cached_offline@gmail.com', true);

    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);

    const status = await gmailService.getConnectionStatus(userId);
    expect(status.connected).toBe(true);
    expect(status.email_address).toBe('cached_offline@gmail.com');
    expect(cloudClient.request).not.toHaveBeenCalled();
  });

  it('fetches threads from server and caches in SQLite', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        threads: [
          {
            thread_id: 't_201',
            history_id: 'h_201',
            snippet: 'Q3 report summary',
          },
        ],
        next_page_token: 'page_2',
        result_size_estimate: 1,
      },
    });

    const res = await gmailService.fetchThreads(userId, { maxResults: 50 });
    expect(res.isOffline).toBe(false);
    expect(res.threads.length).toBe(1);
    expect(res.threads[0].thread_id).toBe('t_201');

    // SQLite should have cached this thread
    const cached = gmailStore.getCachedThreads(userId, 50);
    expect(cached.length).toBe(1);
    expect(cached[0].snippet).toBe('Q3 report summary');
  });

  it('falls back to SQLite thread cache when offline', async () => {
    gmailStore.cacheThreads(userId, [
      {
        thread_id: 't_offline_1',
        history_id: 'h_off',
        snippet: 'Offline cached snippet',
        subject: 'Offline Subject',
      },
    ]);

    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);

    const res = await gmailService.fetchThreads(userId);
    expect(res.isOffline).toBe(true);
    expect(res.threads.length).toBe(1);
    expect(res.threads[0].subject).toBe('Offline Subject');
    expect(cloudClient.request).not.toHaveBeenCalled();
  });

  it('creates draft online and syncs draft ID locally', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        draft_id: 'remote_d101',
        message_id: 'msg_d101',
        thread_id: 'th_101',
      },
    });

    const draft = await gmailService.createDraft(userId, {
      to: 'client@example.com',
      subject: 'Proposal',
      body: 'Here is our proposal.',
      thread_id: 'th_101',
    });

    expect(draft.remote_draft_id).toBe('remote_d101');
    expect(draft.subject).toBe('Proposal');

    // Draft is in SQLite
    const saved = gmailStore.getLocalDraft(userId, draft.id);
    expect(saved?.remote_draft_id).toBe('remote_d101');
  });

  it('creates draft locally only when offline', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);

    const draft = await gmailService.createDraft(userId, {
      to: 'offline_client@example.com',
      subject: 'Offline Draft',
      body: 'Created while offline.',
    });

    expect(draft.remote_draft_id).toBeNull();
    expect(draft.subject).toBe('Offline Draft');
    expect(cloudClient.request).not.toHaveBeenCalled();

    const saved = gmailStore.getLocalDraft(userId, draft.id);
    expect(saved?.body).toBe('Created while offline.');
  });

  it('strictly rejects sending drafts when offline and preserves local draft', async () => {
    const draft = gmailStore.saveLocalDraft({
      user_id: userId,
      to_address: 'recipient@example.com',
      subject: 'Urgent Message',
      body: 'Will send when connected.',
    });

    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);

    await expect(gmailService.sendDraft(userId, draft.id)).rejects.toThrow(
      /Cannot send email while offline/
    );

    // Draft should NOT be deleted from local SQLite
    expect(gmailStore.getLocalDraft(userId, draft.id)).not.toBeNull();
  });

  it('sends draft online and cleans up local draft after success', async () => {
    const draft = gmailStore.saveLocalDraft({
      user_id: userId,
      remote_draft_id: 'remote_d999',
      to_address: 'recipient@example.com',
      subject: 'Finalized Document',
      body: 'Sent online.',
    });

    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        status: 'sent',
        message_id: 'sent_msg_999',
      },
    });

    const res = await gmailService.sendDraft(userId, draft.id, 'idemp-key-999');
    expect(res.status).toBe('sent');
    expect(res.message_id).toBe('sent_msg_999');

    // Local draft is purged after successful send
    expect(gmailStore.getLocalDraft(userId, draft.id)).toBeNull();
  });
});
