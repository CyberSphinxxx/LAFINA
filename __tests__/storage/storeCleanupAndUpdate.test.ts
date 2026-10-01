/**
 * Unit tests for the update, cascade-cleanup and failure paths of the notes,
 * tasks, events and time-block stores.
 *
 * Deleting a task, event or time block must also retire the reminders scheduled
 * for it; a failing write must surface as an error instead of a silent no-op;
 * and read failures must degrade to an empty list so the UI still renders.
 */
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { notesStore } from '../../src/storage/notesStore';
import { tasksStore } from '../../src/storage/tasksStore';
import { timeBlocksStore } from '../../src/storage/timeBlocksStore';
import { remindersStore } from '../../src/storage/remindersStore';

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const insertUser = (id: string): void => {
  db.executeSync(
    'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, id, iso(), iso()]
  );
};

const insertTask = (id: string, title = 'Study session'): void => {
  tasksStore.insertTask({
    id,
    userId: 'user1',
    title,
    dueDate: '2026-07-20',
    dueTime: '14:00',
    isCompleted: false,
    priority: 'Medium',
    category: 'Academics',
    notes: null,
    recurrenceRule: null,
  });
};

const insertEvent = (id: string, title = 'Lecture'): void => {
  tasksStore.insertEvent({
    id,
    userId: 'user1',
    title,
    date: '2026-07-20',
    startTime: '09:00',
    endTime: '10:00',
    location: 'Room 204',
    linkedCalendarBlock: null,
    recurrenceRule: null,
  });
};

const insertBlock = (id: string, title = 'Deep work'): void => {
  timeBlocksStore.insert({
    id,
    userId: 'user1',
    title,
    date: '2026-07-20',
    startTime: '13:00',
    endTime: '15:00',
    color: '#4F46E5',
    category: 'Study',
    notes: 'Focus block',
    recurrenceRule: null,
  });
};

const insertReminder = (id: string, task: string, preCastAudioPath: string | null): void => {
  remindersStore.insertReminder({
    id,
    userId: 'user1',
    task,
    description: null,
    scheduledAt: iso(60 * 60 * 1000),
    triggerAt: iso(50 * 60 * 1000),
    status: 'pending',
    preCastAudioPath,
  });
};

const insertNote = (id: string, title = 'Lecture notes'): void => {
  notesStore.insert({
    id,
    userId: 'user1',
    title,
    body: 'Body',
    isPinned: false,
    tags: [],
    category: 'Academics',
    isVoiceTranscribed: false,
    imageUri: null,
  });
};

describe('store cleanup and update paths', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM events');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM custom_categories');
    db.executeSync('DELETE FROM users');
    insertUser('user1');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const breakDatabase = () => {
    jest.spyOn(db, 'executeSync').mockImplementation(() => {
      throw new Error('database is locked');
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  };

  describe('notesStore', () => {
    it('appends new notes with an incrementing sort order', () => {
      insertNote('note_1');
      insertNote('note_2');

      const notes = notesStore.getAll('user1');
      const sortOrders = Object.fromEntries(notes.map((note) => [note.id, note.sortOrder]));

      expect(sortOrders).toEqual({ note_1: 0, note_2: 1 });
    });

    it('honours an explicit sort order and parses tags back into an array', () => {
      notesStore.insert({
        id: 'note_tags',
        userId: 'user1',
        title: 'Tagged',
        body: 'Body',
        isPinned: true,
        tags: ['exam', 'urgent'],
        category: 'Academics',
        isVoiceTranscribed: true,
        imageUri: '/images/receipt.png',
        sortOrder: 7,
      });

      const note = notesStore.getAll('user1')[0];
      expect(note.sortOrder).toBe(7);
      expect(note.tags).toEqual(['exam', 'urgent']);
      expect(note.isPinned).toBe(true);
      expect(note.isVoiceTranscribed).toBe(true);
      expect(note.imageUri).toBe('/images/receipt.png');
    });

    it('falls back to comma splitting when stored tags are not valid JSON', () => {
      insertNote('note_bad_tags');
      db.executeSync('UPDATE notes SET tags = ? WHERE id = ?', ['exam,urgent', 'note_bad_tags']);

      expect(notesStore.getAll('user1')[0].tags).toEqual(['exam', 'urgent']);
    });

    it('still inserts the note when the sort-order lookup fails', () => {
      jest.spyOn(db, 'executeSync').mockImplementationOnce(() => {
        throw new Error('database is locked');
      });

      insertNote('note_rescue');

      expect(notesStore.getAll('user1')[0].sortOrder).toBe(0);
    });

    it('updates only the provided fields', () => {
      insertNote('note_update');

      notesStore.update({
        id: 'note_update',
        title: 'Renamed',
        isPinned: true,
        tags: ['updated'],
        imageUri: null,
      });

      const note = notesStore.getAll('user1')[0];
      expect(note.title).toBe('Renamed');
      expect(note.isPinned).toBe(true);
      expect(note.tags).toEqual(['updated']);
      expect(note.imageUri).toBeNull();
      expect(note.body).toBe('Body');
    });

    it('ignores an update that carries no fields', () => {
      insertNote('note_noop');
      const executeSync = jest.spyOn(db, 'executeSync');

      notesStore.update({ id: 'note_noop' });

      expect(executeSync).not.toHaveBeenCalled();
    });

    it('reorders notes through the batch update', () => {
      insertNote('note_a');
      insertNote('note_b');

      notesStore.updateOrder([
        { id: 'note_a', sortOrder: 5 },
        { id: 'note_b', sortOrder: 2 },
      ]);

      expect(notesStore.getAll('user1').map((note) => note.id)).toEqual(['note_b', 'note_a']);
    });

    it('logs instead of throwing when the batch reorder fails', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      breakDatabase();

      expect(() => notesStore.updateOrder([{ id: 'note_a', sortOrder: 1 }])).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('soft deletes a note through an explicit transaction executor', () => {
      insertNote('note_tx');

      notesStore.delete('note_tx', db);

      expect(notesStore.getAll('user1')).toEqual([]);
    });

    it('manages custom categories and renames their notes', async () => {
      notesStore.addCustomCategory('user1', 'Thesis', '#123456');
      insertNote('note_thesis');
      notesStore.update({ id: 'note_thesis', category: 'Thesis' });

      expect(notesStore.getCustomCategories('user1')).toEqual([
        { name: 'Thesis', color: '#123456' },
      ]);

      notesStore.updateCustomCategory('user1', 'Thesis', 'Capstone', '#654321');
      await Promise.resolve();

      expect(notesStore.getCustomCategories('user1')).toEqual([
        { name: 'Capstone', color: '#654321' },
      ]);
      expect(notesStore.getAll('user1')[0].category).toBe('Capstone');

      notesStore.deleteCustomCategory('user1', 'Capstone');
      expect(notesStore.getCustomCategories('user1')).toEqual([]);
    });

    it('degrades read failures to empty results', () => {
      breakDatabase();

      expect(notesStore.getAll('user1')).toEqual([]);
      expect(notesStore.getCustomCategories('user1')).toEqual([]);
    });

    it('rethrows failed note and category writes', () => {
      breakDatabase();

      expect(() => insertNote('note_fail')).toThrow('database is locked');
      expect(() => notesStore.update({ id: 'note_1', title: 'x' })).toThrow('database is locked');
      expect(() => notesStore.delete('note_1')).toThrow('database is locked');
      expect(() => notesStore.addCustomCategory('user1', 'Thesis', '#fff')).toThrow(
        'database is locked'
      );
      expect(() => notesStore.deleteCustomCategory('user1', 'Thesis')).toThrow(
        'database is locked'
      );
    });
  });

  describe('tasksStore', () => {
    it('soft deletes a task and retires its pending reminders', () => {
      insertTask('task_1', 'Study session');
      insertReminder('rem_task', 'Study session', '/cache/study.wav');
      insertReminder('rem_unrelated', 'Other task', null);

      tasksStore.deleteTask('task_1');

      expect(tasksStore.getAllTasks('user1')).toEqual([]);
      expect(remindersStore.getReminderById('rem_task')).toBeNull();
      expect(remindersStore.getReminderById('rem_unrelated')).not.toBeNull();
    });

    it('deletes a task that no longer exists without touching reminders', () => {
      insertReminder('rem_untouched', 'Ghost task', null);

      expect(() => tasksStore.deleteTask('missing_task')).not.toThrow();
      expect(remindersStore.getReminderById('rem_untouched')).not.toBeNull();
    });

    it('updates only the provided task fields', () => {
      insertTask('task_update');

      tasksStore.updateTask({
        id: 'task_update',
        title: 'Renamed task',
        isCompleted: true,
        dueDate: null,
        notes: 'Bring calculator',
      });

      const task = tasksStore.getAllTasks('user1')[0];
      expect(task.title).toBe('Renamed task');
      expect(task.isCompleted).toBe(true);
      expect(task.dueDate).toBeNull();
      expect(task.notes).toBe('Bring calculator');
      expect(task.priority).toBe('Medium');
    });

    it('ignores a task update that carries no fields', () => {
      insertTask('task_noop');
      const executeSync = jest.spyOn(db, 'executeSync');

      tasksStore.updateTask({ id: 'task_noop' });

      expect(executeSync).not.toHaveBeenCalled();
    });

    it('soft deletes an event and retires its pending reminders', () => {
      insertEvent('event_1', 'Physics lecture');
      insertReminder('rem_event', 'Physics lecture', '/cache/physics.wav');

      tasksStore.deleteEvent('event_1');

      expect(tasksStore.getAllEvents('user1')).toEqual([]);
      expect(remindersStore.getReminderById('rem_event')).toBeNull();
    });

    it('deletes an event that no longer exists without touching reminders', () => {
      insertReminder('rem_untouched', 'Ghost event', null);

      expect(() => tasksStore.deleteEvent('missing_event')).not.toThrow();
      expect(remindersStore.getReminderById('rem_untouched')).not.toBeNull();
    });

    it('updates event fields including a linked calendar block', () => {
      insertEvent('event_update');

      tasksStore.updateEvent({
        id: 'event_update',
        location: 'Lab 3',
        linkedCalendarBlock: 'block_9',
        recurrenceRule: 'FREQ=WEEKLY',
      });

      const event = tasksStore.getAllEvents('user1')[0];
      expect(event.location).toBe('Lab 3');
      expect(event.linkedCalendarBlock).toBe('block_9');
      expect(event.recurrenceRule).toBe('FREQ=WEEKLY');
      expect(event.title).toBe('Lecture');
    });

    it('ignores an event update that carries no fields', () => {
      insertEvent('event_noop');
      const executeSync = jest.spyOn(db, 'executeSync');

      tasksStore.updateEvent({ id: 'event_noop' });

      expect(executeSync).not.toHaveBeenCalled();
    });

    it('degrades task and event read failures to empty results', () => {
      breakDatabase();

      expect(tasksStore.getAllTasks('user1')).toEqual([]);
      expect(tasksStore.getAllEvents('user1')).toEqual([]);
    });

    it('rethrows failed task and event writes', () => {
      breakDatabase();

      expect(() => insertTask('task_fail')).toThrow('database is locked');
      expect(() => tasksStore.updateTask({ id: 'task_1', title: 'x' })).toThrow(
        'database is locked'
      );
      expect(() => tasksStore.deleteTask('task_1')).toThrow('database is locked');
      expect(() => insertEvent('event_fail')).toThrow('database is locked');
      expect(() => tasksStore.updateEvent({ id: 'event_1', title: 'x' })).toThrow(
        'database is locked'
      );
      expect(() => tasksStore.deleteEvent('event_1')).toThrow('database is locked');
    });
  });

  describe('timeBlocksStore', () => {
    it('updates only the provided block fields', () => {
      insertBlock('block_update');

      timeBlocksStore.update({
        id: 'block_update',
        title: 'Renamed block',
        color: '#000000',
        notes: 'Switched to a quiet room',
        recurrenceRule: null,
      });

      const block = timeBlocksStore.getAll('user1')[0];
      expect(block.title).toBe('Renamed block');
      expect(block.color).toBe('#000000');
      expect(block.notes).toBe('Switched to a quiet room');
      expect(block.recurrenceRule).toBeNull();
      expect(block.category).toBe('Study');
    });

    it('ignores a block update that carries no fields', () => {
      insertBlock('block_noop');
      const executeSync = jest.spyOn(db, 'executeSync');

      timeBlocksStore.update({ id: 'block_noop' });

      expect(executeSync).not.toHaveBeenCalled();
    });

    it('soft deletes a block and retires its pending reminders', () => {
      insertBlock('block_1', 'Deep work');
      insertReminder('rem_block', 'Deep work', '/cache/deep.wav');

      timeBlocksStore.delete('block_1');

      expect(timeBlocksStore.getAll('user1')).toEqual([]);
      expect(remindersStore.getReminderById('rem_block')).toBeNull();
    });

    it('deletes a block that no longer exists without touching reminders', () => {
      insertReminder('rem_untouched', 'Ghost block', null);

      expect(() => timeBlocksStore.delete('missing_block')).not.toThrow();
      expect(remindersStore.getReminderById('rem_untouched')).not.toBeNull();
    });

    it('degrades read failures to an empty result', () => {
      breakDatabase();

      expect(timeBlocksStore.getAll('user1')).toEqual([]);
    });

    it('rethrows failed block writes', () => {
      breakDatabase();

      expect(() => insertBlock('block_fail')).toThrow('database is locked');
      expect(() => timeBlocksStore.update({ id: 'block_1', title: 'x' })).toThrow(
        'database is locked'
      );
      expect(() => timeBlocksStore.delete('block_1')).toThrow('database is locked');
    });
  });
});
