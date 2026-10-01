import { db, DatabaseTransaction } from './database';

/**
 * Read-only integrity probe run on every cold boot.
 */
const DATABASE_INTEGRITY_PRAGMA = 'PRAGMA quick_check(1)';

/**
 * Connection-scoped SQLite settings that must be applied outside any transaction.
 *
 * `journal_mode` cannot be switched while a transaction is open, and `foreign_keys`
 * is silently ignored inside one, so these are applied before the schema transaction.
 */
const CONNECTION_PRAGMAS: readonly string[] = [
  // Write-Ahead Logging lets the sync worker read while the UI writes, and keeps
  // crashes from leaving a half-written main database file.
  'PRAGMA journal_mode = WAL',
  // SQLite does not enforce declared FOREIGN KEY constraints unless asked to.
  'PRAGMA foreign_keys = ON',
  // Wait for a competing writer instead of failing immediately with SQLITE_BUSY.
  'PRAGMA busy_timeout = 5000',
];

/**
 * Bounded structural check used before the schema is touched.
 *
 * `quick_check(1)` answers "is this file still a usable SQLite database?" and stops
 * at the first problem, unlike `integrity_check`, which cross-checks every page and
 * index entry. Only a synchronous execute path exists in this bridge, so the full
 * scan would block the JS thread during startup on a large or damaged file. A
 * negative verdict is reported but never thrown: the stores already degrade to empty
 * reads, and refusing to boot would take the whole app down with the file.
 *
 * @returns True when the file is usable or the verdict cannot be determined.
 */
const verifyDatabaseIntegrity = (): boolean => {
  try {
    const result = db.executeSync(DATABASE_INTEGRITY_PRAGMA);
    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    const verdict = row ? String(Object.values(row)[0] ?? '') : '';
    if (!verdict || verdict.toLowerCase() === 'ok') return true;
    console.error(`[dbInit] SQLite integrity check reported: ${verdict}`);
    return false;
  } catch (error) {
    console.warn('[dbInit] Could not run the SQLite integrity check:', error);
    return true;
  }
};

/**
 * True when a migration step failed only because the column already exists.
 */
const isDuplicateColumnError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name/i.test(message);
};

/**
 * Applies one additive migration step inside the schema transaction.
 *
 * Re-running a step whose column is already declared by CREATE TABLE is expected and
 * ignored. Any other failure propagates, which rolls the surrounding transaction back
 * and leaves `user_version` untouched, so the migration is retried on the next launch
 * instead of being recorded as complete over a half-migrated schema.
 */
const applyMigrationStep = (
  tx: DatabaseTransaction,
  statement: string,
): void => {
  try {
    tx.executeSync(statement);
  } catch (error) {
    if (isDuplicateColumnError(error)) return;
    throw error;
  }
};

/**
 * Applies the required connection-scoped PRAGMAs.
 *
 * A device whose storage volume rejects WAL must still reach the app, so a failure
 * is logged rather than thrown.
 */
const applyConnectionPragmas = (): void => {
  for (const pragma of CONNECTION_PRAGMAS) {
    try {
      db.executeSync(pragma);
    } catch (error) {
      console.warn(`[dbInit] Could not apply "${pragma}":`, error);
    }
  }
};

/**
 * Indexes covering the hot read paths used by the stores, scheduler, and ML layer.
 * Each index mirrors a real ORDER BY / WHERE shape so the planner can satisfy the
 * query without scanning the whole table on a low-end Android device.
 */
const SCHEMA_INDEXES: readonly string[] = [
  // remindersStore: WHERE user_id = ? AND status IN (...) [AND trigger_at <= ?] ORDER BY trigger_at
  'CREATE INDEX IF NOT EXISTS idx_reminders_user_status_trigger ON reminders (user_id, status, trigger_at)',
  // tasksStore: WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_completed, due_date, due_time
  'CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due ON tasks (user_id, is_completed, due_date, due_time)',
  // eventsStore: WHERE user_id = ? AND deleted_at IS NULL ORDER BY date, start_time
  'CREATE INDEX IF NOT EXISTS idx_events_user_date_start ON events (user_id, date, start_time)',
  // timeBlocksStore: WHERE user_id = ? AND deleted_at IS NULL ORDER BY date, start_time
  'CREATE INDEX IF NOT EXISTS idx_time_blocks_user_date_start ON time_blocks (user_id, date, start_time)',
  // notesStore: WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_pinned DESC, updated_at DESC
  'CREATE INDEX IF NOT EXISTS idx_notes_user_pinned_updated ON notes (user_id, is_pinned, updated_at)',
  // Background job drain: WHERE status = ? ORDER BY created_at
  'CREATE INDEX IF NOT EXISTS idx_job_queue_items_status_created ON job_queue_items (status, created_at)',
  // Chat history: WHERE session_id = ? ORDER BY created_at
  'CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages (session_id, created_at)',
  // ML training data: WHERE user_id = ? AND created_at >= ?
  'CREATE INDEX IF NOT EXISTS idx_user_behavior_logs_user_created ON user_behavior_logs (user_id, created_at)',
  // ML feature vectors: WHERE user_id = ? AND feature_type = ?
  'CREATE INDEX IF NOT EXISTS idx_ml_feature_snapshots_user_type ON ml_feature_snapshots (user_id, feature_type)',
  // Sync outbox drain: WHERE status = 'pending' ORDER BY created_at
  'CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created ON sync_outbox (status, created_at)',
  // Pull-cursor bookkeeping: WHERE change_id > ?
  'CREATE INDEX IF NOT EXISTS idx_sync_metadata_change_id ON sync_metadata (change_id)',
  // Custom category lookups: WHERE user_id = ? AND deleted_at IS NULL
  'CREATE INDEX IF NOT EXISTS idx_custom_categories_user_deleted ON custom_categories (user_id, deleted_at)',
];

/**
 * Initializes the SQLite database schema using non-destructive migrations.
 * Core operational tables and sync outbox structures are set up atomically inside a transaction.
 */
export const initDatabase = async (): Promise<void> => {
  try {
    applyConnectionPragmas();
    const integrityOk = verifyDatabaseIntegrity();
    if (!integrityOk) {
      console.warn(
        '[dbInit] Continuing with a database that failed its integrity check; reads degrade and writes may fail.',
      );
    }

    await db.transaction(async (tx: DatabaseTransaction) => {
      // Create users table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          email TEXT,
          password_hash TEXT,
          role TEXT NOT NULL DEFAULT 'student',
          is_new_user INTEGER NOT NULL DEFAULT 1,
          time_format_24h INTEGER NOT NULL DEFAULT 0,
          week_starts_monday INTEGER NOT NULL DEFAULT 0,
          dark_mode INTEGER NOT NULL DEFAULT 0,
          cloud_account_id TEXT,
          cloud_linked INTEGER NOT NULL DEFAULT 0,
          cloud_linked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // Create editable onboarding and reminder preferences table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          wake_time TEXT NOT NULL,
          sleep_time TEXT NOT NULL,
          study_peak_hours TEXT NOT NULL,
          busiest_day TEXT NOT NULL,
          reminder_lead_minutes INTEGER NOT NULL,
          snooze_tendency TEXT NOT NULL,
          weekly_class_count TEXT NOT NULL,
          longest_class_gap TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create remember_me table (timestamp compliant)
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS remember_me (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          email TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL
        )
      `);

      // Create active_session table (timestamp compliant)
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS active_session (
          user_id TEXT PRIMARY KEY,
          access_token TEXT,
          refresh_token TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create reminders table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS reminders (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task TEXT NOT NULL,
          description TEXT,
          scheduled_at TEXT NOT NULL,
          trigger_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          precast_audio_path TEXT,
          snooze_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create job_queue_items table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS job_queue_items (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          reminder_id TEXT,
          job_type TEXT NOT NULL,
          payload TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (reminder_id) REFERENCES reminders (id) ON DELETE SET NULL
        )
      `);

      // Create time_blocks table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS time_blocks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          color TEXT NOT NULL,
          category TEXT NOT NULL,
          notes TEXT,
          recurrence_rule TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create tasks table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          due_date TEXT,
          due_time TEXT,
          is_completed INTEGER NOT NULL DEFAULT 0,
          priority TEXT NOT NULL,
          category TEXT NOT NULL,
          notes TEXT,
          recurrence_rule TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create events table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          location TEXT,
          linked_calendar_block TEXT,
          recurrence_rule TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create notes table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL,
          category TEXT NOT NULL,
          is_voice_transcribed INTEGER NOT NULL DEFAULT 0,
          image_uri TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create chat_sessions table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create messages table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
        )
      `);

      // Create user_behavior_logs table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS user_behavior_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_key TEXT NOT NULL,
          event_value TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create ml_feature_snapshots table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS ml_feature_snapshots (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          feature_type TEXT NOT NULL,
          feature_vector TEXT NOT NULL,
          computed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create custom_categories table (timestamp compliant + soft delete)
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS custom_categories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create sync outbox & infrastructure tables
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          change_id INTEGER,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (entity_type, entity_id)
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          cursor INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          error_message TEXT
        )
      `);
      tx.executeSync(`INSERT OR IGNORE INTO sync_state (id, cursor, status) VALUES (1, 0, 'idle')`);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_control (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          suppress INTEGER NOT NULL DEFAULT 0
        )
      `);
      tx.executeSync(`INSERT OR IGNORE INTO sync_control (id, suppress) VALUES (1, 0)`);

      // Indexes are created after the tables so an existing database that predates
      // them picks them up on the next launch.
      for (const indexStatement of SCHEMA_INDEXES) {
        try {
          tx.executeSync(indexStatement);
        } catch (error) {
          console.warn(`[dbInit] Could not create index: ${indexStatement}`, error);
        }
      }

      // Versioned schema migrations
      const versionResult = tx.executeSync('PRAGMA user_version');
      const currentVersion = versionResult.rows?.[0]?.user_version ?? 0;
      const TARGET_VERSION = 7;

      if (currentVersion < TARGET_VERSION) {
        if (currentVersion < 1) {
          applyMigrationStep(tx, 'ALTER TABLE users ADD COLUMN time_format_24h INTEGER NOT NULL DEFAULT 0');
        }
        if (currentVersion < 2) {
          applyMigrationStep(tx, 'ALTER TABLE users ADD COLUMN week_starts_monday INTEGER NOT NULL DEFAULT 0');
          applyMigrationStep(tx, 'ALTER TABLE users ADD COLUMN dark_mode INTEGER NOT NULL DEFAULT 0');
        }
        if (currentVersion < 3) {
          applyMigrationStep(tx, 'ALTER TABLE time_blocks ADD COLUMN recurrence_rule TEXT');
          applyMigrationStep(tx, 'ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT');
          applyMigrationStep(tx, 'ALTER TABLE events ADD COLUMN recurrence_rule TEXT');
        }
        if (currentVersion < 4) {
          applyMigrationStep(tx, 'ALTER TABLE reminders ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0');
        }
        if (currentVersion < 5) {
          applyMigrationStep(tx, 'ALTER TABLE custom_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
          applyMigrationStep(tx, 'ALTER TABLE custom_categories ADD COLUMN deleted_at TEXT');
        }
        if (currentVersion < 6) {
          applyMigrationStep(tx, 'ALTER TABLE active_session ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
          applyMigrationStep(tx, 'ALTER TABLE active_session ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
        }
        if (currentVersion < 7) {
          applyMigrationStep(tx, 'ALTER TABLE users ADD COLUMN cloud_account_id TEXT');
          applyMigrationStep(tx, 'ALTER TABLE users ADD COLUMN cloud_linked INTEGER NOT NULL DEFAULT 0');
          applyMigrationStep(tx, 'ALTER TABLE users ADD COLUMN cloud_linked_at TEXT');
          applyMigrationStep(tx, 'ALTER TABLE active_session ADD COLUMN access_token TEXT');
          applyMigrationStep(tx, 'ALTER TABLE active_session ADD COLUMN refresh_token TEXT');
        }

        tx.executeSync(`PRAGMA user_version = ${TARGET_VERSION}`);
      }
    });
    console.log(
      `Database schema initialized successfully (version 7, ${SCHEMA_INDEXES.length} indexes ensured).`,
    );
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    throw error;
  }
};
