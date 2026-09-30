import { initDatabase, seedLocalDemoAccounts, DEMO_IDS } from '../../src/storage';
import { gmailStore } from '../../src/storage/gmailStore';
import { db } from '../../src/storage/database';

describe('gmailStore - Local SQLite Storage & Cache', () => {
  const userId = DEMO_IDS.MANAGER_ID;

  beforeEach(async () => {
    await initDatabase();
    await seedLocalDemoAccounts();
    gmailStore.clearCache(userId);
    gmailStore.deleteConnection(userId);
  });

  it('saves, retrieves, and deletes Gmail connection info', () => {
    // Initially null
    expect(gmailStore.getConnection(userId)).toBeNull();

    // Save connection
    gmailStore.saveConnection(userId, 'manager_demo@gmail.com', true);
    const conn = gmailStore.getConnection(userId);
    expect(conn).not.toBeNull();
    expect(conn?.email_address).toBe('manager_demo@gmail.com');
    expect(conn?.is_connected).toBe(1);

    // Delete connection
    gmailStore.deleteConnection(userId);
    expect(gmailStore.getConnection(userId)).toBeNull();
  });

  it('caches threads and enforces the 50-thread cache limit', () => {
    // Generate 55 threads
    const threads = Array.from({ length: 55 }, (_, i) => ({
      thread_id: `thread_${i + 1}`,
      history_id: `hist_${i + 1}`,
      snippet: `Snippet for email ${i + 1}`,
      subject: `Subject ${i + 1}`,
      from_address: `sender${i + 1}@example.com`,
      to_address: 'manager_demo@gmail.com',
      date: new Date(Date.now() + i * 1000).toISOString(),
      unread: i % 2 === 0,
      message_count: 1,
      has_attachments: i % 5 === 0,
    }));

    gmailStore.cacheThreads(userId, threads);

    const cached = gmailStore.getCachedThreads(userId, 100);
    // Should be strictly capped at 50
    expect(cached.length).toBe(50);
    // Latest thread should be present
    expect(cached[0].thread_id).toBe('thread_55');
  });

  it('caches message details, handles attachments, and retrieves by thread ID', () => {
    const msg = {
      message_id: 'msg_101',
      thread_id: 'thread_101',
      subject: 'Quarterly Financials',
      from_address: 'finance@company.com',
      to_address: 'manager@gmail.com',
      cc_address: 'audit@company.com',
      bcc_address: null,
      date: '2026-08-25T10:00:00Z',
      snippet: 'Please find attached the Q3 financial report.',
      body_plain: 'Please find attached the Q3 financial report in PDF format.',
      body_html: '<p>Please find attached the Q3 financial report in PDF format.</p>',
      attachments: [
        {
          id: 'att_financials_pdf',
          filename: 'Q3_Report.pdf',
          mime_type: 'application/pdf',
          size: 2048576,
        },
      ],
      is_read: true,
    };

    gmailStore.cacheMessage(userId, msg);

    const cached = gmailStore.getCachedMessages(userId, 'thread_101');
    expect(cached.length).toBe(1);
    expect(cached[0].subject).toBe('Quarterly Financials');
    expect(cached[0].body_plain).toContain('Q3 financial report');
    expect(cached[0].is_read).toBe(1);
    expect(cached[0].attachments_json).toContain('Q3_Report.pdf');
  });

  it('purges expired message bodies older than 30 days', () => {
    // Insert a fresh message and a stale message (40 days old)
    const freshMsg = {
      message_id: 'fresh_msg',
      thread_id: 'thread_fresh',
      subject: 'Fresh Email',
      from_address: 'fresh@example.com',
      to_address: 'manager@gmail.com',
      date: new Date().toISOString(),
      body_plain: 'Fresh content',
    };

    gmailStore.cacheMessage(userId, freshMsg);

    // Insert an old message directly with past timestamp
    const oldTimestamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    db.executeSync(
      `INSERT INTO gmail_messages_cache (
         user_id, message_id, thread_id, subject, from_address, to_address,
         date, snippet, body_plain, is_read, cached_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'old_msg',
        'thread_old',
        'Old Email',
        'old@example.com',
        'manager@gmail.com',
        oldTimestamp,
        'Old snippet',
        'Old content',
        1,
        oldTimestamp,
      ]
    );

    // Verify both exist before purge
    expect(gmailStore.getCachedMessages(userId, 'thread_fresh').length).toBe(1);
    expect(gmailStore.getCachedMessages(userId, 'thread_old').length).toBe(1);

    // Purge expired cache (30 days threshold)
    gmailStore.purgeExpiredCache(userId, 30);

    // Fresh should remain, old should be removed
    expect(gmailStore.getCachedMessages(userId, 'thread_fresh').length).toBe(1);
    expect(gmailStore.getCachedMessages(userId, 'thread_old').length).toBe(0);
  });

  it('manages local drafts CRUD operations', () => {
    // Create draft
    const draft = gmailStore.saveLocalDraft({
      user_id: userId,
      to_address: 'partner@corp.com',
      subject: 'Partnership Agreement',
      body: 'Attached are the agreed terms.',
    });

    expect(draft.id).toBeDefined();
    expect(draft.status).toBe('draft');

    // Retrieve drafts list
    const drafts = gmailStore.getLocalDrafts(userId);
    expect(drafts.length).toBe(1);
    expect(drafts[0].subject).toBe('Partnership Agreement');

    // Retrieve single draft
    const fetched = gmailStore.getLocalDraft(userId, draft.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.body).toBe('Attached are the agreed terms.');

    // Update draft
    gmailStore.saveLocalDraft({
      id: draft.id,
      user_id: userId,
      to_address: 'partner@corp.com',
      subject: 'Partnership Agreement v2',
      body: 'Updated terms attached.',
    });

    const updated = gmailStore.getLocalDraft(userId, draft.id);
    expect(updated?.subject).toBe('Partnership Agreement v2');

    // Delete draft
    gmailStore.deleteLocalDraft(userId, draft.id);
    expect(gmailStore.getLocalDraft(userId, draft.id)).toBeNull();
    expect(gmailStore.getLocalDrafts(userId).length).toBe(0);
  });
});
