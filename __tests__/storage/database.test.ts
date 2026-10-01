/**
 * Unit tests for the SQLite access layer in `src/storage/database.ts`.
 *
 * The module chooses its engine once, at import time: it uses the native
 * `@op-engineering/op-sqlite` bridge when that module loads, and falls back to
 * the in-memory JS engine when it does not. Because the choice is cached per
 * module registry, each test loads a fresh copy of the module inside
 * `jest.isolateModules` with a stubbed native bridge so that both engines are
 * reachable through the public `db` API.
 */

type DatabaseModule = typeof import('../../src/storage/database');

/** Creates a fake `@op-engineering/op-sqlite` module for the native-bridge tests. */
const nativeBridgeWith = (executeSync: jest.Mock) => () => ({
  open: () => ({ executeSync, transaction: jest.fn() }),
});

/** Creates a fake `@op-engineering/op-sqlite` module whose bridge failed to link. */
const nativeBridgeUnavailable = () => ({
  open: () => {
    throw new Error('native bridge unavailable');
  },
});

/** Loads a fresh copy of the database module against the supplied bridge stub. */
const createDatabaseModule = (bridgeFactory: () => unknown): DatabaseModule => {
  const holder: { module?: DatabaseModule } = {};
  jest.isolateModules(() => {
    jest.doMock('@op-engineering/op-sqlite', bridgeFactory);
    holder.module = require('../../src/storage/database') as DatabaseModule;
  });
  if (!holder.module) {
    throw new Error('Failed to load the database module.');
  }
  return holder.module;
};

describe('database native engine', () => {
  it('forwards executeSync queries and params to the native bridge', () => {
    const nativeExecuteSync = jest.fn().mockReturnValue({ rows: [{ id: 'rem_1' }] });
    const { db } = createDatabaseModule(nativeBridgeWith(nativeExecuteSync));

    const result = db.executeSync('SELECT * FROM reminders WHERE id = ?', ['rem_1']);

    expect(nativeExecuteSync).toHaveBeenCalledWith('SELECT * FROM reminders WHERE id = ?', [
      'rem_1',
    ]);
    expect(result).toEqual({ rows: [{ id: 'rem_1' }] });
  });

  it('wraps a successful transaction in BEGIN and COMMIT', async () => {
    const nativeExecuteSync = jest.fn().mockReturnValue({ rows: [] });
    const { db } = createDatabaseModule(nativeBridgeWith(nativeExecuteSync));

    await db.transaction(async (tx) => {
      tx.executeSync('INSERT INTO notes (id) VALUES (?)', ['note_1']);
    });

    expect(nativeExecuteSync.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN TRANSACTION;',
      'INSERT INTO notes (id) VALUES (?)',
      'COMMIT;',
    ]);
  });

  it('rolls back and rethrows when a statement inside the transaction fails', async () => {
    const nativeExecuteSync = jest.fn((query: string) => {
      if (query.startsWith('INSERT')) {
        throw new Error('disk full');
      }
      return { rows: [] };
    });
    const { db } = createDatabaseModule(nativeBridgeWith(nativeExecuteSync));

    await expect(
      db.transaction(async (tx) => {
        tx.executeSync('INSERT INTO notes (id) VALUES (?)', ['note_1']);
      })
    ).rejects.toThrow('disk full');

    expect(nativeExecuteSync.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN TRANSACTION;',
      'INSERT INTO notes (id) VALUES (?)',
      'ROLLBACK;',
    ]);
  });

  it('rolls back even when the transaction body fails before running any statement', async () => {
    const nativeExecuteSync = jest.fn().mockReturnValue({ rows: [] });
    const { db } = createDatabaseModule(nativeBridgeWith(nativeExecuteSync));

    await expect(
      db.transaction(async () => {
        throw new Error('validation failed');
      })
    ).rejects.toThrow('validation failed');

    expect(nativeExecuteSync.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN TRANSACTION;',
      'ROLLBACK;',
    ]);
  });
});

describe('database JS fallback engine', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Loads a fresh fallback database so each test starts with empty tables. */
  const createFallbackDatabase = (): DatabaseModule => {
    const loaded = createDatabaseModule(nativeBridgeUnavailable);
    expect(warnSpy).toHaveBeenCalled();
    return loaded;
  };

  it('creates tables and reports the fallback warning', () => {
    const { db } = createFallbackDatabase();

    const created = db.executeSync(
      'CREATE TABLE IF NOT EXISTS demo (id TEXT PRIMARY KEY, user_id TEXT, deleted_at TEXT)'
    );
    // Creating the same table twice must stay a no-op instead of wiping data.
    db.executeSync('CREATE TABLE IF NOT EXISTS demo (id TEXT PRIMARY KEY)');

    expect(created).toEqual({ rows: [], rowsAffected: 0 });
    expect(db.executeSync("SELECT name FROM sqlite_master WHERE type = 'table'").rows).toEqual([
      { name: 'demo' },
    ]);
  });

  it('inserts rows and deduplicates INSERT OR IGNORE primary keys', () => {
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE reminders (id TEXT, user_id TEXT, task TEXT, deleted_at TEXT)');

    const first = db.executeSync(
      'INSERT INTO reminders (id, user_id, task, deleted_at) VALUES (?, ?, ?, ?)',
      ['rem_1', 'user_1', 'Study', null]
    );
    const duplicate = db.executeSync(
      `INSERT OR IGNORE INTO reminders (id, user_id, task, deleted_at) VALUES (?, ?, ?, ?)`,
      ['rem_1', 'user_1', 'Study', null]
    );
    const second = db.executeSync(
      `INSERT OR IGNORE INTO reminders (id, user_id, task, deleted_at) VALUES (?, ?, ?, ?)`,
      ['rem_2', 'user_1', 'Sleep', null]
    );

    expect(first).toEqual({ rows: [], rowsAffected: 1, insertId: 1 });
    expect(duplicate).toEqual({ rows: [], rowsAffected: 0 });
    expect(second.rowsAffected).toBe(1);
    expect(db.executeSync('SELECT * FROM reminders').rows).toHaveLength(2);
  });

  it('filters selects by soft-delete, user and id', () => {
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE reminders (id TEXT, user_id TEXT, deleted_at TEXT)');
    db.executeSync('INSERT INTO reminders (id, user_id, deleted_at) VALUES (?, ?, ?)', [
      'rem_1',
      'user_1',
      null,
    ]);
    db.executeSync('INSERT INTO reminders (id, user_id, deleted_at) VALUES (?, ?, ?)', [
      'rem_2',
      'user_2',
      null,
    ]);
    db.executeSync('INSERT INTO reminders (id, user_id, deleted_at) VALUES (?, ?, ?)', [
      'rem_3',
      'user_1',
      '2026-01-01T00:00:00.000Z',
    ]);

    const active = db.executeSync(
      'SELECT * FROM reminders WHERE deleted_at IS NULL ORDER BY id ASC'
    );
    const forUser = db.executeSync(
      'SELECT * FROM reminders WHERE user_id = ? AND deleted_at IS NULL',
      ['user_1']
    );
    const byId = db.executeSync('SELECT * FROM reminders WHERE id = ?', ['rem_2']);

    expect(active.rows.map((row: { id: string }) => row.id)).toEqual(['rem_1', 'rem_2']);
    expect(forUser.rows.map((row: { id: string }) => row.id)).toEqual(['rem_1']);
    expect(byId.rows.map((row: { id: string }) => row.id)).toEqual(['rem_2']);
  });

  it('sorts select results for calendars, tasks and notes', () => {
    const { db } = createFallbackDatabase();
    db.executeSync(
      'CREATE TABLE events (id TEXT, date TEXT, start_time TEXT, user_id TEXT, deleted_at TEXT)'
    );
    db.executeSync(
      'INSERT INTO events (id, date, start_time, user_id) VALUES (?, ?, ?, ?)',
      ['ev_2', '2026-03-02', '08:00', 'user_1']
    );
    db.executeSync(
      'INSERT INTO events (id, date, start_time, user_id) VALUES (?, ?, ?, ?)',
      ['ev_1', '2026-03-01', '09:00', 'user_1']
    );
    db.executeSync(
      'INSERT INTO events (id, date, start_time, user_id) VALUES (?, ?, ?, ?)',
      ['ev_3', '2026-03-01', '07:00', 'user_1']
    );
    db.executeSync(
      'CREATE TABLE tasks (id TEXT, is_completed INTEGER, due_date TEXT, due_time TEXT)'
    );
    db.executeSync(
      'INSERT INTO tasks (id, is_completed, due_date, due_time) VALUES (?, ?, ?, ?)',
      ['tsk_1', 0, '2026-03-05', '12:00']
    );
    db.executeSync(
      'INSERT INTO tasks (id, is_completed, due_date, due_time) VALUES (?, ?, ?, ?)',
      ['tsk_2', 1, '2026-03-04', '12:00']
    );
    db.executeSync(
      'CREATE TABLE notes (id TEXT, is_pinned INTEGER, updated_at TEXT)'
    );
    db.executeSync('INSERT INTO notes (id, is_pinned, updated_at) VALUES (?, ?, ?)', [
      'note_1',
      0,
      '2026-03-01T00:00:00.000Z',
    ]);
    db.executeSync('INSERT INTO notes (id, is_pinned, updated_at) VALUES (?, ?, ?)', [
      'note_2',
      1,
      '2026-02-01T00:00:00.000Z',
    ]);
    db.executeSync('INSERT INTO notes (id, is_pinned, updated_at) VALUES (?, ?, ?)', [
      'note_3',
      1,
      '2026-03-10T00:00:00.000Z',
    ]);

    const events = db.executeSync(
      'SELECT * FROM events WHERE user_id = ? ORDER BY date ASC, start_time ASC',
      ['user_1']
    );
    const tasks = db.executeSync(
      'SELECT * FROM tasks ORDER BY is_completed ASC, due_date ASC, due_time ASC'
    );
    const notes = db.executeSync(
      'SELECT * FROM notes ORDER BY is_pinned DESC, updated_at DESC'
    );

    expect(events.rows.map((row: { id: string }) => row.id)).toEqual(['ev_3', 'ev_1', 'ev_2']);
    expect(tasks.rows.map((row: { id: string }) => row.id)).toEqual(['tsk_1', 'tsk_2']);
    expect(notes.rows.map((row: { id: string }) => row.id)).toEqual(['note_3', 'note_2', 'note_1']);
  });

  it('updates rows by id and soft deletes them', () => {
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE reminders (id TEXT, status TEXT, updated_at TEXT, deleted_at TEXT)');
    db.executeSync('INSERT INTO reminders (id, status, updated_at) VALUES (?, ?, ?)', [
      'rem_1',
      'pending',
      '2026-01-01T00:00:00.000Z',
    ]);

    const updated = db.executeSync('UPDATE reminders SET status = ?, updated_at = ? WHERE id = ?', [
      'acknowledged',
      '2026-01-02T00:00:00.000Z',
      'rem_1',
    ]);
    const missing = db.executeSync('UPDATE reminders SET status = ? WHERE id = ?', [
      'missed',
      'rem_missing',
    ]);
    const softDeleted = db.executeSync(
      'UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?',
      ['2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'rem_1']
    );

    expect(updated).toEqual({ rows: [], rowsAffected: 1 });
    expect(missing).toEqual({ rows: [], rowsAffected: 0 });
    expect(softDeleted).toEqual({ rows: [], rowsAffected: 1 });
    expect(
      db.executeSync('SELECT * FROM reminders WHERE deleted_at IS NULL').rows
    ).toHaveLength(0);
  });

  it('clears a table on DELETE FROM', () => {
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE messages (id TEXT, session_id TEXT)');
    db.executeSync('INSERT INTO messages (id, session_id) VALUES (?, ?)', ['msg_1', 'session_1']);

    const deleted = db.executeSync('DELETE FROM messages WHERE session_id = ?', ['session_1']);

    expect(deleted).toEqual({ rows: [], rowsAffected: 1 });
    expect(db.executeSync('SELECT * FROM messages').rows).toHaveLength(0);
  });

  it('returns an empty result for statements it cannot parse', () => {
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE IF NOT EXISTS users (id TEXT)');

    expect(db.executeSync('PRAGMA journal_mode = WAL')).toEqual({ rows: [], rowsAffected: 0 });
    expect(db.executeSync('SELECT * FROM unknown_table')).toEqual({ rows: [] });
  });

  it('logs and returns an empty result when a statement blows up mid-flight', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE events (id TEXT, date TEXT, start_time TEXT, deleted_at TEXT)');
    db.executeSync('INSERT INTO events (id, date, start_time) VALUES (?, ?, ?)', [
      'ev_ok',
      '2026-03-01',
      '08:00',
    ]);
    // A non-string date cannot satisfy localeCompare, which throws inside the engine.
    db.executeSync('INSERT INTO events (id, date, start_time) VALUES (?, ?, ?)', [
      'ev_bad',
      { not: 'a string' },
      { also: 'not a string' },
    ]);

    const result = db.executeSync('SELECT * FROM events ORDER BY date ASC, start_time ASC');

    expect(result).toEqual({ rows: [], rowsAffected: 0 });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('runs transaction callbacks against the fallback engine without BEGIN/COMMIT', async () => {
    const { db } = createFallbackDatabase();
    db.executeSync('CREATE TABLE notes (id TEXT)');

    await db.transaction(async (tx) => {
      tx.executeSync('INSERT INTO notes (id) VALUES (?)', ['note_1']);
    });

    expect(db.executeSync('SELECT * FROM notes').rows).toEqual([{ id: 'note_1' }]);
  });
});
