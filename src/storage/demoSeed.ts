import { db } from './database';
import { hashPassword, normalizeEmail } from './authUtils';
import { businessStore } from './businessStore';

export const DEMO_IDS = {
  BIZ_ID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  MANAGER_ID: '11111111-1111-4111-a111-111111111111',
  ALICE_ID: '22222222-2222-4222-a222-222222222222',
  BOB_ID: '33333333-3333-4333-a333-333333333333',
};

export const DEMO_CREDENTIALS = {
  PASSWORD: 'Password123!',
  MANAGER_EMAIL: 'manager@lafina.ph',
  ALICE_EMAIL: 'alice@lafina.ph',
  BOB_EMAIL: 'bob@lafina.ph',
};

/**
 * Seeds or syncs the local SQLite database with demo accounts and collaboration state.
 */
export const seedLocalDemoAccounts = async (): Promise<void> => {
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(DEMO_CREDENTIALS.PASSWORD);

  // 1. Seed Users
  const demoUsers = [
    {
      id: DEMO_IDS.MANAGER_ID,
      username: 'Dr. Eleanor Vance (Manager)',
      email: DEMO_CREDENTIALS.MANAGER_EMAIL,
      role: 'student',
    },
    {
      id: DEMO_IDS.ALICE_ID,
      username: 'Alice Guo (Senior Researcher)',
      email: DEMO_CREDENTIALS.ALICE_EMAIL,
      role: 'student',
    },
    {
      id: DEMO_IDS.BOB_ID,
      username: 'Bob Santos (Hardware Specialist)',
      email: DEMO_CREDENTIALS.BOB_EMAIL,
      role: 'student',
    },
  ];

  for (const u of demoUsers) {
    const normalized = normalizeEmail(u.email);
    db.executeSync(
      `INSERT INTO users (
        id, username, email, password_hash, role, is_new_user,
        time_format_24h, week_starts_monday, dark_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        email = excluded.email,
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at`,
      [u.id, u.username, normalized, passwordHash, u.role, now, now]
    );
  }

  // 2. Seed Business
  db.executeSync(
    `INSERT INTO businesses (
      id, name, owner_id, timezone, subscription_plan, subscription_status,
      seat_limit, created_at, updated_at
    ) VALUES (?, 'USTP Innovators Lab', ?, 'Asia/Manila', 'business', 'active', 5, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      owner_id = excluded.owner_id,
      subscription_plan = excluded.subscription_plan,
      subscription_status = excluded.subscription_status,
      seat_limit = excluded.seat_limit,
      updated_at = excluded.updated_at`,
    [DEMO_IDS.BIZ_ID, DEMO_IDS.MANAGER_ID, now, now]
  );

  // 3. Seed Business Memberships
  const memberships = [
    { id: 'mem_mgr_01', userId: DEMO_IDS.MANAGER_ID, role: 'manager' as const },
    { id: 'mem_emp_01', userId: DEMO_IDS.ALICE_ID, role: 'employee' as const },
    { id: 'mem_emp_02', userId: DEMO_IDS.BOB_ID, role: 'employee' as const },
  ];

  for (const m of memberships) {
    db.executeSync(
      `INSERT INTO business_memberships (
        id, business_id, user_id, member_role, membership_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        member_role = excluded.member_role,
        membership_status = excluded.membership_status,
        updated_at = excluded.updated_at`,
      [m.id, DEMO_IDS.BIZ_ID, m.userId, m.role, now, now]
    );
  }

  const leaseExpiry = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  // 4. Seed Cached Capabilities for offline instant boot
  businessStore.saveCachedCapabilities(
    DEMO_IDS.MANAGER_ID,
    'business',
    'business',
    {
      business_id: DEMO_IDS.BIZ_ID,
      business_name: 'USTP Innovators Lab',
      member_role: 'manager',
      membership_status: 'active',
      lease_expires_at: leaseExpiry,
      capabilities: ['business_collaboration', 'work_blocks', 'task_assignments', 'manager_review'],
    }
  );

  businessStore.saveCachedCapabilities(
    DEMO_IDS.ALICE_ID,
    'student',
    'business',
    {
      business_id: DEMO_IDS.BIZ_ID,
      business_name: 'USTP Innovators Lab',
      member_role: 'employee',
      membership_status: 'active',
      lease_expires_at: leaseExpiry,
      capabilities: ['business_collaboration', 'work_blocks', 'task_assignments'],
    }
  );

  businessStore.saveCachedCapabilities(
    DEMO_IDS.BOB_ID,
    'student',
    'business',
    {
      business_id: DEMO_IDS.BIZ_ID,
      business_name: 'USTP Innovators Lab',
      member_role: 'employee',
      membership_status: 'active',
      lease_expires_at: leaseExpiry,
      capabilities: ['business_collaboration', 'work_blocks', 'task_assignments'],
    }
  );

  // 5. Seed Collaborative Tasks
  const task1Id = '44444444-4444-4444-a444-444444444441';
  const task2Id = '44444444-4444-4444-a444-444444444442';
  const task3Id = '44444444-4444-4444-a444-444444444443';

  const dueTask1 = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const dueTask2 = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
  const dueTask3 = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

  db.executeSync(
    `INSERT INTO business_tasks (
      id, business_id, created_by, title, instructions, priority,
      due_date, scheduled_at, recurrence_rule, reminder_lead_minutes,
      is_cancelled, version, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 30, 0, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      task1Id,
      DEMO_IDS.BIZ_ID,
      DEMO_IDS.MANAGER_ID,
      'Deploy Edge Server Firewall',
      'Update IPTables and verify port forwarding on edge nodes.',
      'high',
      dueTask1,
      now,
      now,
    ]
  );

  db.executeSync(
    `INSERT INTO business_task_assignments (
      id, business_task_id, business_id, user_id, status,
      manager_review_status, reopened_reason, submitted_at, approved_at,
      version, deleted_at, created_at, updated_at
    ) VALUES ('55555555-5555-5555-a555-555555555551', ?, ?, ?, 'in_progress', 'pending', NULL, NULL, NULL, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [task1Id, DEMO_IDS.BIZ_ID, DEMO_IDS.ALICE_ID, now, now]
  );

  db.executeSync(
    `INSERT INTO business_task_assignments (
      id, business_task_id, business_id, user_id, status,
      manager_review_status, reopened_reason, submitted_at, approved_at,
      version, deleted_at, created_at, updated_at
    ) VALUES ('55555555-5555-5555-a555-555555555552', ?, ?, ?, 'todo', 'pending', NULL, NULL, NULL, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [task1Id, DEMO_IDS.BIZ_ID, DEMO_IDS.BOB_ID, now, now]
  );

  db.executeSync(
    `INSERT INTO business_tasks (
      id, business_id, created_by, title, instructions, priority,
      due_date, scheduled_at, recurrence_rule, reminder_lead_minutes,
      is_cancelled, version, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 15, 0, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      task2Id,
      DEMO_IDS.BIZ_ID,
      DEMO_IDS.MANAGER_ID,
      'Calibrate Oscilloscopes & Signal Generators',
      'Check channel 1 & 2 waveforms across 100MHz bandwidth.',
      'medium',
      dueTask2,
      now,
      now,
    ]
  );

  db.executeSync(
    `INSERT INTO business_task_assignments (
      id, business_task_id, business_id, user_id, status,
      manager_review_status, reopened_reason, submitted_at, approved_at,
      version, deleted_at, created_at, updated_at
    ) VALUES ('55555555-5555-5555-a555-555555555553', ?, ?, ?, 'pending_review', 'pending', NULL, ?, NULL, 2, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [task2Id, DEMO_IDS.BIZ_ID, DEMO_IDS.ALICE_ID, now, now, now]
  );

  db.executeSync(
    `INSERT INTO business_tasks (
      id, business_id, created_by, title, instructions, priority,
      due_date, scheduled_at, recurrence_rule, reminder_lead_minutes,
      is_cancelled, version, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 60, 0, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      task3Id,
      DEMO_IDS.BIZ_ID,
      DEMO_IDS.MANAGER_ID,
      'Submit Q3 Hardware Inventory',
      'Log microcontroller and sensor inventory to lab sheet.',
      'low',
      dueTask3,
      now,
      now,
    ]
  );

  db.executeSync(
    `INSERT INTO business_task_assignments (
      id, business_task_id, business_id, user_id, status,
      manager_review_status, reopened_reason, submitted_at, approved_at,
      version, deleted_at, created_at, updated_at
    ) VALUES ('55555555-5555-5555-a555-555555555554', ?, ?, ?, 'todo', 'pending', NULL, NULL, NULL, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [task3Id, DEMO_IDS.BIZ_ID, DEMO_IDS.BOB_ID, now, now]
  );

  // 6. Seed Work Blocks
  const shift1Start = new Date(new Date().setHours(9, 0, 0, 0)).toISOString();
  const shift1End = new Date(new Date().setHours(13, 0, 0, 0)).toISOString();
  const shift2Start = new Date(new Date().setHours(13, 0, 0, 0)).toISOString();
  const shift2End = new Date(new Date().setHours(17, 0, 0, 0)).toISOString();

  db.executeSync(
    `INSERT INTO business_work_blocks (
      id, business_id, user_id, title, start_time, end_time,
      recurrence_rule, created_by, version, deleted_at, created_at, updated_at
    ) VALUES ('66666666-6666-6666-a666-666666666661', ?, ?, 'Morning Research Shift', ?, ?, NULL, ?, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [DEMO_IDS.BIZ_ID, DEMO_IDS.ALICE_ID, shift1Start, shift1End, DEMO_IDS.MANAGER_ID, now, now]
  );

  db.executeSync(
    `INSERT INTO business_work_blocks (
      id, business_id, user_id, title, start_time, end_time,
      recurrence_rule, created_by, version, deleted_at, created_at, updated_at
    ) VALUES ('66666666-6666-6666-a666-666666666662', ?, ?, 'Lab Hardware Maintenance', ?, ?, NULL, ?, 1, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [DEMO_IDS.BIZ_ID, DEMO_IDS.BOB_ID, shift2Start, shift2End, DEMO_IDS.MANAGER_ID, now, now]
  );

  // 7. Seed Chat Channels
  const defaultChannelId = '77777777-7777-7777-a777-777777777771';
  db.executeSync(
    `INSERT INTO business_chat_channels (
      id, business_id, name, channel_type, is_archived, created_at, updated_at
    ) VALUES (?, ?, 'general', 'general', 0, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [defaultChannelId, DEMO_IDS.BIZ_ID, now, now]
  );

  // 8. Seed Chat Messages
  db.executeSync(
    `INSERT INTO business_chat_messages (
      id, channel_id, business_id, sender_id, sender_name, client_message_id,
      content, task_link_id, task_title, delivery_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      '88888888-8888-8888-a888-888888888881',
      defaultChannelId,
      DEMO_IDS.BIZ_ID,
      DEMO_IDS.MANAGER_ID,
      'Dr. Eleanor Vance',
      'demo_msg_001',
      "Welcome team! Please review today's scheduled firmware and calibration tasks.",
      task1Id,
      'Prepare IoT Sensor Array Firmware v2.1',
      now,
      now,
    ]
  );

  db.executeSync(
    `INSERT INTO business_chat_messages (
      id, channel_id, business_id, sender_id, sender_name, client_message_id,
      content, task_link_id, task_title, delivery_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      '88888888-8888-8888-a888-888888888882',
      defaultChannelId,
      DEMO_IDS.BIZ_ID,
      DEMO_IDS.ALICE_ID,
      'Alice Guo',
      'demo_msg_002',
      'On it Dr. Vance! I submitted the oscilloscope calibration waveforms for review.',
      task2Id,
      'Calibrate Oscilloscopes & Signal Generators',
      now,
      now,
    ]
  );

  // 9. Seed Task Comments
  db.executeSync(
    `INSERT INTO business_task_comments (
      id, task_id, business_id, user_id, user_name, client_comment_id,
      content, delivery_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      '99999999-9999-9999-a999-999999999991',
      task2Id,
      DEMO_IDS.BIZ_ID,
      DEMO_IDS.ALICE_ID,
      'Alice Guo',
      'demo_comment_001',
      'All 4 channels calibrated at 100MHz with zero jitter.',
      now,
      now,
    ]
  );
};
