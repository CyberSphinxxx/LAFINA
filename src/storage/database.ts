/** Result of a sync SQL execution */
export interface QueryResult {
  rows: any[];
  rowsAffected?: number;
  insertId?: number;
}

/** Minimal transaction interface with executeSync */
export interface DatabaseTransaction {
  executeSync: (query: string, params?: any[]) => QueryResult;
}

let dbInstance: any;
let useFallback = false;

// 1. Try to initialize native OP-SQLite
try {
  const { open } = require('@op-engineering/op-sqlite');
  dbInstance = open({
    name: 'lafina.sqlite',
  });
  console.log('Successfully opened native OP-SQLite database.');
} catch (error) {
  console.warn('Native OP-SQLite not available or failed to load. Initializing JS Fallback Database Engine...', error);
  useFallback = true;
}

// 2. JS Fallback Database Engine (Mock SQL Parser)
//
// This engine is a development-only safety net for builds where the native
// @op-engineering/op-sqlite bridge failed to link. It is deliberately in-memory:
// the previous implementation tried to persist through
// `@react-native-async-storage/async-storage`, a package that is not part of the
// approved stack and is not installed, so every save and load silently no-opped
// while appearing to work. Persisting through an undeclared dependency is worse
// than not persisting at all, so the dead path was removed rather than papered over.
const fallbackTables: { [tableName: string]: any[] } = {};

const executeFallbackQuery = (query: string, params: any[] = []): QueryResult => {
  const q = query.trim();
  const upper = q.toUpperCase();

  try {
    // CREATE TABLE
    if (upper.startsWith('CREATE TABLE')) {
      const match = q.match(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        if (!fallbackTables[tableName]) {
          fallbackTables[tableName] = [];
        }
      }
      return { rows: [], rowsAffected: 0 };
    }

    // INSERT INTO
    if (upper.startsWith('INSERT')) {
      const match = q.match(/(?:INSERT|INSERT OR IGNORE)\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const cols = match[2].split(',').map(c => c.trim().toLowerCase());

        const row: any = {};
        cols.forEach((col, index) => {
          row[col] = params[index];
        });

        if (!fallbackTables[tableName]) {
          fallbackTables[tableName] = [];
        }

        // Insert or Ignore primary key check
        if (upper.includes('IGNORE') && row.id) {
          const exists = fallbackTables[tableName].some(r => r.id === row.id);
          if (exists) {
            return { rows: [], rowsAffected: 0 };
          }
        }

        fallbackTables[tableName].push(row);
        return { rows: [], rowsAffected: 1, insertId: 1 };
      }
    }

    // SELECT
    if (upper.startsWith('SELECT')) {
      if (upper.includes('SQLITE_MASTER')) {
        const rows = Object.keys(fallbackTables).map(name => ({ name }));
        return { rows };
      }

      const match = q.match(/SELECT\s+.*\s+FROM\s+(\w+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        let rows: any[] = [...(fallbackTables[tableName] || [])];

        // Filter: deleted_at IS NULL
        if (upper.includes('DELETED_AT IS NULL')) {
          rows = rows.filter(r => r.deleted_at === null || r.deleted_at === undefined);
        }

        // Filter: user_id = ?
        if (upper.includes('USER_ID = ?') || upper.includes('USER_ID=?')) {
          const userId = params[0];
          rows = rows.filter(r => r.user_id === userId);
        }

        // Filter: id = ?
        // Word-boundary match so `user_id = ?` / `session_id = ?` are not
        // mistaken for the primary key column, which would empty every
        // per-user read.
        if (/(?:^|[\s(])ID\s*=\s*\?/.test(upper)) {
          const idVal = params[params.length - 1];
          rows = rows.filter(r => r.id === idVal);
        }

        // Sorting: date ASC, start_time ASC
        if (upper.includes('DATE ASC, START_TIME ASC')) {
          rows.sort((a, b) => {
            const dateComp = (a.date || '').localeCompare(b.date || '');
            if (dateComp !== 0) return dateComp;
            return (a.start_time || '').localeCompare(b.start_time || '');
          });
        }
        // Sorting: is_completed ASC, due_date ASC, due_time ASC
        else if (upper.includes('IS_COMPLETED ASC, DUE_DATE ASC, DUE_TIME ASC')) {
          rows.sort((a, b) => {
            const compA = a.is_completed || 0;
            const compB = b.is_completed || 0;
            if (compA !== compB) return compA - compB;
            const dateComp = (a.due_date || '').localeCompare(b.due_date || '');
            if (dateComp !== 0) return dateComp;
            return (a.due_time || '').localeCompare(b.due_time || '');
          });
        }
        // Sorting: is_pinned DESC, updated_at DESC
        else if (upper.includes('IS_PINNED DESC, UPDATED_AT DESC')) {
          rows.sort((a, b) => {
            const pinA = a.is_pinned || 0;
            const pinB = b.is_pinned || 0;
            if (pinA !== pinB) return pinB - pinA;
            return (b.updated_at || '').localeCompare(a.updated_at || '');
          });
        }

        return { rows };
      }
    }

    // UPDATE
    if (upper.startsWith('UPDATE')) {
      const match = q.match(/UPDATE\s+(\w+)\s+SET\s+(.+)\s+WHERE\s+id\s*=\s*\?/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const setClause = match[2];
        const idVal = params[params.length - 1];

        const setCols = setClause.split(',').map(part => part.split('=')[0].trim().toLowerCase());
        const rows = fallbackTables[tableName] || [];
        const rowIndex = rows.findIndex(r => r.id === idVal);

        if (rowIndex !== -1) {
          setCols.forEach((col, index) => {
            rows[rowIndex][col] = params[index];
          });
          return { rows: [], rowsAffected: 1 };
        }
      }

      // Soft delete updates
      const softDeleteMatch = q.match(/UPDATE\s+(\w+)\s+SET\s+deleted_at\s*=\s*\?,\s*updated_at\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i);
      if (softDeleteMatch) {
        const tableName = softDeleteMatch[1].toLowerCase();
        const deletedAt = params[0];
        const updatedAt = params[1];
        const idVal = params[2];

        const rows = fallbackTables[tableName] || [];
        const rowIndex = rows.findIndex(r => r.id === idVal);
        if (rowIndex !== -1) {
          rows[rowIndex].deleted_at = deletedAt;
          rows[rowIndex].updated_at = updatedAt;
          return { rows: [], rowsAffected: 1 };
        }
      }
    }

    // DELETE FROM
    if (upper.startsWith('DELETE')) {
      const match = q.match(/DELETE\s+FROM\s+(\w+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        fallbackTables[tableName] = [];
        return { rows: [], rowsAffected: 1 };
      }
    }
  } catch (err) {
    console.error('JS Fallback database error executing query:', query, err);
  }

  return { rows: [], rowsAffected: 0 };
};

// 3. Export Database API
export const db = {
  executeSync: (query: string, params?: any[]): QueryResult => {
    if (useFallback) {
      return executeFallbackQuery(query, params);
    }
    return dbInstance.executeSync(query, params);
  },

  transaction: async (cb: (tx: DatabaseTransaction) => Promise<void>): Promise<void> => {
    if (useFallback) {
      const txFallback: DatabaseTransaction = {
        executeSync: (query: string, params?: any[]) => executeFallbackQuery(query, params),
      };
      await cb(txFallback);
      return;
    }

    // For native OP-SQLite, run manual transaction commands
    dbInstance.executeSync('BEGIN TRANSACTION;');
    try {
      const tx: DatabaseTransaction = {
        executeSync: (query: string, params?: any[]) => dbInstance.executeSync(query, params),
      };
      await cb(tx);
      dbInstance.executeSync('COMMIT;');
    } catch (err) {
      // A failing ROLLBACK (already-closed connection, disk gone) must never mask
      // the error that caused it: that is the one the caller has to see and log.
      try {
        dbInstance.executeSync('ROLLBACK;');
      } catch (rollbackError) {
        console.warn(
          '[Database] Could not roll back the failed transaction:',
          rollbackError
        );
      }
      throw err;
    }
  },
};
