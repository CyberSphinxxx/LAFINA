import {
  requestMeetingSummary,
  syncMeetingToCloud,
  fetchMeetingsFromCloud,
  revokeMeetingRecipient,
} from '../../src/cloud/meetingService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { initDatabase, meetingStore, seedLocalDemoAccounts, DEMO_IDS } from '../../src/storage';
import { LocalBusinessMeetingRow } from '../../src/storage/syncTypes';

jest.mock('../../src/cloud/cloudClient', () => ({
  cloudClient: {
    request: jest.fn(),
  },
}));

describe('meetingService - Cloud Summarization and Selective Sharing', () => {
  beforeEach(async () => {
    await initDatabase();
    await seedLocalDemoAccounts();
    jest.clearAllMocks();
  });

  it('requests AI meeting summary from DeepSeek via backend', async () => {
    const mockSummary = {
      key_points: ['Reviewed firmware v2.1'],
      decisions: ['Deploy by Friday'],
      open_questions: [],
      action_items: [
        {
          task: 'Deploy firmware',
          assignee: 'Alice',
          due: '2026-08-28T17:00:00Z',
          context: 'Deployment',
        },
      ],
    };

    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        requestId: 'req_123',
        summary: mockSummary,
        model: 'deepseek-chat',
        createdAt: '2026-08-25T10:00:00Z',
      },
    });

    const result = await requestMeetingSummary('Meeting speech transcript', 'Firmware Sync');
    expect(result).toEqual(mockSummary);
    expect(cloudClient.request).toHaveBeenCalledWith(
      '/v1/meetings/summary',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('syncs meeting to cloud with selective sharing recipients', async () => {
    const meetingRow: LocalBusinessMeetingRow = {
      id: 'meet_sync_1',
      business_id: DEMO_IDS.BIZ_ID,
      created_by: DEMO_IDS.MANAGER_ID,
      title: 'Design Sync',
      duration_seconds: 900,
      full_transcript: 'Design transcript',
      summary_json: null,
      summary_status: 'not_requested',
      keep_audio: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: {
        id: 'meet_sync_1',
        business_id: DEMO_IDS.BIZ_ID,
        title: 'Design Sync',
        recipients: [{ user_id: DEMO_IDS.ALICE_ID }],
      },
    });

    const res = await syncMeetingToCloud(DEMO_IDS.BIZ_ID, meetingRow, [DEMO_IDS.ALICE_ID]);
    expect(res).not.toBeNull();
    expect(cloudClient.request).toHaveBeenCalledWith(
      `/v1/businesses/${DEMO_IDS.BIZ_ID}/meetings`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('fetches meetings from cloud and reconciles local storage', async () => {
    const now = new Date().toISOString();
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: [
        {
          id: 'meet_remote_1',
          business_id: DEMO_IDS.BIZ_ID,
          created_by: DEMO_IDS.MANAGER_ID,
          title: 'Remote Architecture Sync',
          duration_seconds: 1200,
          full_transcript: 'Remote transcript',
          summary_json: { key_points: ['Cloud sync active'] },
          summary_status: 'completed',
          recipients: [{ user_id: DEMO_IDS.ALICE_ID }],
          created_at: now,
          updated_at: now,
        },
      ],
    });

    const meetings = await fetchMeetingsFromCloud(DEMO_IDS.BIZ_ID);
    expect(meetings.length).toBeGreaterThan(0);
    const saved = meetingStore.getMeetingById('meet_remote_1');
    expect(saved).not.toBeNull();
    expect(saved?.title).toBe('Remote Architecture Sync');
  });

  it('revokes recipient access via cloud', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValueOnce({
      status: 'success',
      data: { status: 'success' },
    });

    const success = await revokeMeetingRecipient(DEMO_IDS.BIZ_ID, 'meet_1', DEMO_IDS.ALICE_ID);
    expect(success).toBe(true);
    expect(cloudClient.request).toHaveBeenCalledWith(
      `/v1/businesses/${DEMO_IDS.BIZ_ID}/meetings/meet_1/recipients/${DEMO_IDS.ALICE_ID}`,
      { method: 'DELETE' }
    );
  });
});
