import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { timeBlocksStore } from '../../src/storage/timeBlocksStore';
import { tasksStore } from '../../src/storage/tasksStore';
import { notesStore } from '../../src/storage/notesStore';
import { userStore } from '../../src/storage/userStore';
import { behaviorStore } from '../../src/storage/behaviorStore';
import { hashPassword, normalizeEmail, validatePassword, verifyPassword } from '../../src/storage/authUtils';

describe('Storage Layer', () => {
  beforeAll(async () => {
    // Initialize DB schema
    await initDatabase();
  });

  afterEach(async () => {
    // Clean up tables
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM events');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM job_queue_items');
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM users');
    db.executeSync('DELETE FROM user_preferences');
  });

  it('initializes without errors and creates tables', async () => {
    // We already initialized in beforeAll
    // Let's verify tables exist by querying sqlite_master
    const result = db.executeSync("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = result.rows.map((row: any) => row.name);
    
    expect(tables).toContain('users');
    expect(tables).toContain('reminders');
    expect(tables).toContain('job_queue_items');
    expect(tables).toContain('time_blocks');
    expect(tables).toContain('tasks');
    expect(tables).toContain('events');
    expect(tables).toContain('notes');
    expect(tables).toContain('user_preferences');
  });

  it('can insert and retrieve a reminder', async () => {
    // Create user first due to foreign key
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()]
    );

    const reminderId = 'rem1';
    db.executeSync(
      `INSERT INTO reminders (id, user_id, task, scheduled_at, trigger_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reminderId, 'user1', 'Test task', new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
    );

    const result = db.executeSync(`SELECT * FROM reminders WHERE id = ?`, [reminderId]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].task).toBe('Test task');
  });

  it('can soft delete a reminder', async () => {
    // Create user first
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['user2', 'testuser2', new Date().toISOString(), new Date().toISOString()]
    );

    const reminderId = 'rem2';
    db.executeSync(
      `INSERT INTO reminders (id, user_id, task, scheduled_at, trigger_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reminderId, 'user2', 'Task to delete', new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
    );

    // Soft delete
    const deletedAt = new Date().toISOString();
    db.executeSync(
      `UPDATE reminders SET deleted_at = ? WHERE id = ?`,
      [deletedAt, reminderId]
    );

    const result = db.executeSync(`SELECT * FROM reminders WHERE id = ?`, [reminderId]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].deleted_at).toBe(deletedAt);
    expect(result.rows[0].task).toBe('Task to delete'); // row still exists
  });

  describe('timeBlocksStore', () => {
    it('performs CRUD operations correctly', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()]
      );

      // Create
      timeBlocksStore.insert({
        id: 'block1',
        userId: 'user1',
        title: 'Deep Work',
        date: '2026-06-20',
        startTime: '09:00',
        endTime: '11:00',
        color: '#E6003A',
        category: 'Work',
        notes: 'Coding session',
      });

      // Read
      let blocks = timeBlocksStore.getAll('user1');
      expect(blocks.length).toBe(1);
      expect(blocks[0].title).toBe('Deep Work');

      // Update
      timeBlocksStore.update({
        id: 'block1',
        title: 'Shallow Work',
        notes: 'Updated notes',
      });
      blocks = timeBlocksStore.getAll('user1');
      expect(blocks[0].title).toBe('Shallow Work');
      expect(blocks[0].notes).toBe('Updated notes');

      // Delete
      timeBlocksStore.delete('block1');
      blocks = timeBlocksStore.getAll('user1');
      expect(blocks.length).toBe(0);
    });

    it('deletes corresponding reminders on time block deletion', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['user_block_del', 'testuser', new Date().toISOString(), new Date().toISOString()]
      );

      // Insert block
      timeBlocksStore.insert({
        id: 'block_del',
        userId: 'user_block_del',
        title: 'Delete test block',
        date: '2026-06-20',
        startTime: '09:00',
        endTime: '11:00',
        color: '#E6003A',
        category: 'Work',
      });

      // Insert matching pending reminder
      db.executeSync(
        `INSERT INTO reminders (id, user_id, task, scheduled_at, trigger_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rem_block_del', 'user_block_del', 'Delete test block', new Date().toISOString(), new Date().toISOString(), 'pending', new Date().toISOString(), new Date().toISOString()]
      );

      // Delete block
      timeBlocksStore.delete('block_del');

      // Verify block is deleted
      expect(timeBlocksStore.getAll('user_block_del').length).toBe(0);

      // Verify reminder is soft-deleted
      const rBlock = db.executeSync(`SELECT * FROM reminders WHERE id = 'rem_block_del'`).rows[0];
      expect(rBlock).toBeDefined();
      expect(rBlock.deleted_at).not.toBeNull();
    });
  });

  describe('tasksStore', () => {
    it('performs task and event CRUD correctly', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()]
      );

      // Task insert
      tasksStore.insertTask({
        id: 'task1',
        userId: 'user1',
        title: 'Submit report',
        dueDate: '2026-06-20',
        dueTime: '17:00',
        isCompleted: false,
        priority: 'High',
        category: 'Work',
        notes: 'Must be on time',
      });

      let tasks = tasksStore.getAllTasks('user1');
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe('Submit report');
      expect(tasks[0].isCompleted).toBe(false);

      // Task update
      tasksStore.updateTask({
        id: 'task1',
        isCompleted: true,
      });
      tasks = tasksStore.getAllTasks('user1');
      expect(tasks[0].isCompleted).toBe(true);

      // Task delete
      tasksStore.deleteTask('task1');
      expect(tasksStore.getAllTasks('user1').length).toBe(0);

      // Event insert
      tasksStore.insertEvent({
        id: 'event1',
        userId: 'user1',
        title: 'Class scheduling meeting',
        date: '2026-06-21',
        startTime: '10:00',
        endTime: '11:00',
        location: 'Building 4, USTP',
      });

      let events = tasksStore.getAllEvents('user1');
      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Class scheduling meeting');

      // Event update
      tasksStore.updateEvent({
        id: 'event1',
        location: 'Online Zoom',
      });
      events = tasksStore.getAllEvents('user1');
      expect(events[0].location).toBe('Online Zoom');

      // Event delete
      tasksStore.deleteEvent('event1');
      expect(tasksStore.getAllEvents('user1').length).toBe(0);
    });

    it('deletes corresponding reminders on task and event deletion', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['user_del_test', 'testuser', new Date().toISOString(), new Date().toISOString()]
      );

      // Insert task
      tasksStore.insertTask({
        id: 'task_del',
        userId: 'user_del_test',
        title: 'Delete test task',
        dueDate: '2026-06-20',
        dueTime: '17:00',
        isCompleted: false,
        priority: 'High',
        category: 'Work',
        notes: 'Testing deletion',
      });

      // Insert matching pending reminder
      db.executeSync(
        `INSERT INTO reminders (id, user_id, task, scheduled_at, trigger_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rem_task_del', 'user_del_test', 'Delete test task', new Date().toISOString(), new Date().toISOString(), 'pending', new Date().toISOString(), new Date().toISOString()]
      );

      // Delete task
      tasksStore.deleteTask('task_del');

      // Verify task is deleted
      expect(tasksStore.getAllTasks('user_del_test').length).toBe(0);

      // Verify reminder is soft-deleted
      const rTask = db.executeSync(`SELECT * FROM reminders WHERE id = 'rem_task_del'`).rows[0];
      expect(rTask).toBeDefined();
      expect(rTask.deleted_at).not.toBeNull();

      // Insert event
      tasksStore.insertEvent({
        id: 'event_del',
        userId: 'user_del_test',
        title: 'Delete test event',
        date: '2026-06-21',
        startTime: '10:00',
        endTime: '11:00',
      });

      // Insert matching pending reminder
      db.executeSync(
        `INSERT INTO reminders (id, user_id, task, scheduled_at, trigger_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rem_event_del', 'user_del_test', 'Delete test event', new Date().toISOString(), new Date().toISOString(), 'pending', new Date().toISOString(), new Date().toISOString()]
      );

      // Delete event
      tasksStore.deleteEvent('event_del');

      // Verify event is deleted
      expect(tasksStore.getAllEvents('user_del_test').length).toBe(0);

      // Verify reminder is soft-deleted
      const rEvent = db.executeSync(`SELECT * FROM reminders WHERE id = 'rem_event_del'`).rows[0];
      expect(rEvent).toBeDefined();
      expect(rEvent.deleted_at).not.toBeNull();
    });
  });

  describe('notesStore', () => {
    it('performs CRUD operations correctly', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()]
      );

      // Create
      notesStore.insert({
        id: 'note1',
        userId: 'user1',
        title: 'Idea list',
        body: 'Write more code',
        isPinned: false,
        tags: ['coding', 'productivity'],
        category: 'Personal',
        isVoiceTranscribed: true,
      });

      // Read
      let notes = notesStore.getAll('user1');
      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe('Idea list');
      expect(notes[0].tags).toEqual(['coding', 'productivity']);
      expect(notes[0].isVoiceTranscribed).toBe(true);

      // Update
      notesStore.update({
        id: 'note1',
        isPinned: true,
        tags: ['ideas'],
      });
      notes = notesStore.getAll('user1');
      expect(notes[0].isPinned).toBe(true);
      expect(notes[0].tags).toEqual(['ideas']);

      // Delete
      notesStore.delete('note1');
      expect(notesStore.getAll('user1').length).toBe(0);
    });

    it('can set imageUri and batch update sort order', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()]
      );

      notesStore.insert({
        id: 'note1',
        userId: 'user1',
        title: 'Note 1',
        body: 'Body 1',
        isPinned: false,
        tags: [],
        category: 'Work',
        isVoiceTranscribed: false,
        imageUri: 'lafina_default_logo',
      });

      notesStore.insert({
        id: 'note2',
        userId: 'user1',
        title: 'Note 2',
        body: 'Body 2',
        isPinned: false,
        tags: [],
        category: 'Personal',
        isVoiceTranscribed: false,
      });

      let notes = notesStore.getAll('user1');
      expect(notes.length).toBe(2);
      expect(notes.find(n => n.id === 'note1')?.imageUri).toBe('lafina_default_logo');
      expect(notes.find(n => n.id === 'note2')?.imageUri).toBeNull();

      // Batch update sort order
      notesStore.updateOrder([
        { id: 'note1', sortOrder: 10 },
        { id: 'note2', sortOrder: 5 }
      ]);

      notes = notesStore.getAll('user1');
      // note2 should come first now because sort_order is 5 < 10
      expect(notes[0].id).toBe('note2');
      expect(notes[1].id).toBe('note1');
    });
  });

  describe('authUtils', () => {
    it('should hash a password and verify it correctly', async () => {
      const password = 'mySecretPassword123';
      const hash = await hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 is 64 hex characters
      
      const isMatch = await verifyPassword(password, hash);
      expect(isMatch).toBe(true);
      
      const isNotMatch = await verifyPassword('wrongpassword', hash);
      expect(isNotMatch).toBe(false);
    });

    it('enforces the shared 6-128 character mobile password policy', () => {
      expect(validatePassword('12345')).toEqual({
        isValid: false,
        error: 'Passwords must contain at least 6 characters.',
      });
      expect(validatePassword('123456')).toEqual({
        isValid: true,
        error: null,
      });
      expect(validatePassword('x'.repeat(128))).toEqual({
        isValid: true,
        error: null,
      });
      expect(validatePassword('x'.repeat(129))).toEqual({
        isValid: false,
        error: 'Passwords must contain no more than 128 characters.',
      });
    });

    it('normalizes email case and surrounding whitespace', () => {
      expect(normalizeEmail('  Student@USTP.EDU.PH ')).toBe('student@ustp.edu.ph');
    });
  });

  describe('userStore', () => {
    it('defaults to 12-hour format and can update preference', () => {
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        ['pref_user', 'prefuser', new Date().toISOString(), new Date().toISOString()]
      );

      expect(userStore.get24HourFormat('pref_user')).toBe(false);

      userStore.set24HourFormat('pref_user', true);
      expect(userStore.get24HourFormat('pref_user')).toBe(true);

      userStore.set24HourFormat('pref_user', false);
      expect(userStore.get24HourFormat('pref_user')).toBe(false);
    });

    it('can register a user and handle duplicate emails', async () => {
      const userId = await userStore.register('Test User', 'test@ustp.edu.ph', 'password123');
      expect(userId).toBeDefined();
      
      const user = userStore.getUserById(userId);
      expect(user).not.toBeNull();
      expect(user?.username).toBe('Test User');
      expect(user?.email).toBe('test@ustp.edu.ph');
      expect(user?.isNewUser).toBe(true);

      // Registering same email should fail
      await expect(
        userStore.register('Another User', 'test@ustp.edu.ph', 'password456')
      ).rejects.toThrow('Email already registered');
    });

    it('accepts a six-character password and rejects over 128 characters', async () => {
      const userId = await userStore.register(
        'Six Character User', 'six-local@ustp.edu.ph', 'abc123'
      );
      expect(await userStore.login('SIX-LOCAL@USTP.EDU.PH', 'abc123')).toMatchObject({
        id: userId,
      });
      await expect(userStore.register(
        'Long Password User', 'long-local@ustp.edu.ph', 'x'.repeat(129)
      )).rejects.toThrow('no more than 128 characters');
    });

    it('can authenticate a user on login', async () => {
      await userStore.register('Login User', 'login@ustp.edu.ph', 'securepass');
      
      // Success case
      const user = await userStore.login('login@ustp.edu.ph', 'securepass');
      expect(user).not.toBeNull();
      expect(user?.username).toBe('Login User');
      
      // Wrong password
      const wrongPass = await userStore.login('login@ustp.edu.ph', 'wrongpass');
      expect(wrongPass).toBeNull();
      
      // Wrong email
      const wrongEmail = await userStore.login('nonexistent@ustp.edu.ph', 'securepass');
      expect(wrongEmail).toBeNull();
    });

    it('updates the role on the matching local SQLite user', async () => {
      const localUserId = await userStore.register(
        'Student Pro User',
        'student-pro@ustp.edu.ph',
        'securepass'
      );
      const unrelatedCloudAccountId = '3ce7cc43-e4da-4b82-b4cd-070dbf7b8369';

      userStore.updateUserRole(localUserId, 'student_pro');

      expect(userStore.getUserById(localUserId)?.role).toBe('student_pro');
      expect(userStore.getUserById(unrelatedCloudAccountId)).toBeNull();
    });

    it('can manage user sessions', async () => {
      const userId = await userStore.register('Session User', 'session@ustp.edu.ph', 'password');
      
      // No active session initially
      expect(userStore.getCurrentUser()).toBeNull();
      
      // Set session
      userStore.setCurrentUser(userId);
      const current = userStore.getCurrentUser();
      expect(current).not.toBeNull();
      expect(current?.id).toBe(userId);
      
      // Logout
      userStore.logout();
      expect(userStore.getCurrentUser()).toBeNull();
    });

    it('can manage onboarding status', async () => {
      const userId = await userStore.register('Onboard User', 'onboard@ustp.edu.ph', 'password');
      expect(userStore.isOnboardingComplete(userId)).toBe(false);
      
      userStore.markOnboardingComplete(userId);
      expect(userStore.isOnboardingComplete(userId)).toBe(true);
    });
  });

  describe('behaviorStore', () => {
    it('can log and retrieve behavioral events', () => {
      const userId = 'user_behavior_test';
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        [userId, 'behaviorUser', new Date().toISOString(), new Date().toISOString()]
      );

      behaviorStore.logBehaviorEvent(userId, 'onboarding_response', 'typical_wake_time', '07:00');
      behaviorStore.logBehaviorEvent(userId, 'onboarding_response', 'busiest_day', 'Monday');
      behaviorStore.logBehaviorEvent(userId, 'task_event', 'snooze_reminder', 'rem1');

      // Fetch all onboarding responses
      const onboardingLogs = behaviorStore.getBehaviorLogs(userId, 'onboarding_response');
      expect(onboardingLogs.length).toBe(2);
      expect(onboardingLogs.find(l => l.eventKey === 'typical_wake_time')?.eventValue).toBe('07:00');
      expect(onboardingLogs.find(l => l.eventKey === 'busiest_day')?.eventValue).toBe('Monday');

      // Fetch all logs
      const allLogs = behaviorStore.getBehaviorLogs(userId);
      expect(allLogs.length).toBe(3);
    });

    it('can save and retrieve ML feature snapshots', async () => {
      const userId = 'user_feature_test';
      db.executeSync(
        `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        [userId, 'featureUser', new Date().toISOString(), new Date().toISOString()]
      );

      const vector1 = JSON.stringify({ hours: 4, pref: 'morning' });
      const vector2 = JSON.stringify({ hours: 6, pref: 'evening' });

      behaviorStore.saveFeatureSnapshot(userId, 'schedule_preference', vector1);
      
      // Fast forward time slightly to test ordering
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      behaviorStore.saveFeatureSnapshot(userId, 'schedule_preference', vector2);

      const latest = behaviorStore.getLatestFeatureSnapshot(userId, 'schedule_preference');
      expect(latest).not.toBeNull();
      expect(latest?.featureVector).toBe(vector2);
    });
  });

  describe('database configuration', () => {
    it('requests WAL, foreign key enforcement, and a busy timeout at startup', async () => {
      const executeSpy = jest.spyOn(db, 'executeSync');
      await initDatabase();

      const appliedStatements = executeSpy.mock.calls.map(call => call[0]);
      expect(appliedStatements).toContain('PRAGMA journal_mode = WAL');
      expect(appliedStatements).toContain('PRAGMA foreign_keys = ON');
      expect(appliedStatements).toContain('PRAGMA busy_timeout = 5000');

      executeSpy.mockRestore();

      // The pragmas must actually take effect on the live connection.
      expect(db.executeSync('PRAGMA foreign_keys').rows[0].foreign_keys).toBe(1);
      expect(db.executeSync('PRAGMA busy_timeout').rows[0].timeout).toBe(5000);
    });

    it('creates indexes for the hot query paths', async () => {
      await initDatabase();

      const result = db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'index'"
      );
      const indexNames = result.rows.map((row: any) => row.name);

      expect(indexNames).toContain('idx_reminders_user_status_trigger');
      expect(indexNames).toContain('idx_tasks_user_completed_due');
      expect(indexNames).toContain('idx_job_queue_items_status_created');
      expect(indexNames).toContain('idx_messages_session_created');
      expect(indexNames).toContain('idx_user_behavior_logs_user_created');
      expect(indexNames).toContain('idx_sync_outbox_status_created');
    });

    it('enforces foreign keys so orphaned rows cannot be written', async () => {
      expect(() =>
        db.executeSync(
          `INSERT INTO reminders (id, user_id, task, scheduled_at, trigger_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            'orphan_reminder',
            'user_that_does_not_exist',
            'Orphan',
            new Date().toISOString(),
            new Date().toISOString(),
            new Date().toISOString(),
            new Date().toISOString(),
          ]
        )
      ).toThrow(/FOREIGN KEY/i);
    });
  });
});
