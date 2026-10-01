const Database = require('better-sqlite3');
const db = new Database(':memory:');

/**
 * Mirrors `executeSync` from @op-engineering/op-sqlite: statements that yield rows
 * (SELECT and read-only PRAGMAs such as `PRAGMA user_version` or
 * `PRAGMA journal_mode = WAL`) resolve to `{ rows }`, everything else resolves to
 * an affected-row summary.
 */
const executeSync = (query, params = []) => {
  const statement = db.prepare(query);

  if (statement.reader) {
    return { rows: statement.all(Array.isArray(params) ? params : [params]) };
  }

  const info = statement.run(Array.isArray(params) ? params : [params]);
  return { rowsAffected: info.changes, insertId: info.lastInsertRowid, rows: [] };
};

module.exports = {
  open: () => ({
    transaction: async (cb) => {
      executeSync('BEGIN TRANSACTION;');
      try {
        await cb({ executeSync });
        executeSync('COMMIT;');
      } catch (err) {
        executeSync('ROLLBACK;');
        throw err;
      }
    },
    executeSync,
  }),
};
