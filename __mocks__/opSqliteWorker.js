const { DatabaseSync } = require('node:sqlite');
const { workerData } = require('node:worker_threads');

const database = new DatabaseSync(':memory:');
const port = workerData.port;

const toSafeNumber = (value) => (
  typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value
);

const execute = (query, params) => {
  const statement = database.prepare(query);
  const normalizedQuery = query.trim().toUpperCase();
  const returnsRows = normalizedQuery.startsWith('SELECT')
    || (normalizedQuery.startsWith('PRAGMA') && !query.includes('='));
  if (returnsRows) {
    return {
      rows: statement.all(...params),
      rowsAffected: 0,
    };
  }

  const result = statement.run(...params);
  return {
    rows: [],
    rowsAffected: Number(result.changes),
    insertId: toSafeNumber(result.lastInsertRowid),
  };
};

port.on('message', (message) => {
  const signal = new Int32Array(message.signal);
  let response;
  let shouldClose = false;

  try {
    if (message.action === 'execute') {
      response = { ok: true, result: execute(message.query, message.params) };
    } else if (message.action === 'close') {
      database.close();
      response = { ok: true, result: undefined };
      shouldClose = true;
    } else {
      throw new Error(`Unknown SQLite test action: ${message.action}`);
    }
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  port.postMessage(response);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
  if (shouldClose) {
    setImmediate(() => port.close());
  }
});
