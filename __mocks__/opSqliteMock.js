const path = require('node:path');
const {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
} = require('node:worker_threads');

const REQUEST_TIMEOUT_MS = 30_000;

const workerExecArgv = () => {
  const [major, minor] = process.versions.node
    .split('.')
    .slice(0, 2)
    .map(Number);
  return major === 22 && minor < 13 ? ['--experimental-sqlite'] : undefined;
};

/**
 * `node:sqlite` loaded in this process, when the running Node allows it
 * without a flag (22.13+). `process.getBuiltinModule` reaches it without going
 * through Jest's resolver, which does not know prefix-only built-ins.
 */
const inProcessSqlite = () => {
  if (typeof process.getBuiltinModule !== 'function') return null;
  try {
    return process.getBuiltinModule('node:sqlite') ?? null;
  } catch {
    return null;
  }
};

const toSafeNumber = (value) => (
  typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value
);

/** Same statement handling as `opSqliteWorker.js`. */
const executeOn = (database, query, params) => {
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

/**
 * Real SQLite on the test thread. Preferred: a worker thread still alive
 * when Jest tears a test environment down can abort Node 24 outright
 * (`RemoveEnvironmentCleanupHook ... (env) != nullptr`).
 */
const openInProcess = (sqlite) => {
  const database = new sqlite.DatabaseSync(':memory:');
  let isClosed = false;

  const close = () => {
    if (!isClosed) {
      database.close();
      isClosed = true;
    }
    return Promise.resolve();
  };

  if (typeof afterAll === 'function') {
    afterAll(close);
  }

  return {
    executeSync: (query, params = []) => executeOn(database, query, params),
    close,
  };
};

/** Real SQLite in a worker thread, for Node versions that need a flag for it. */
const openInWorker = () => {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(path.join(__dirname, 'opSqliteWorker.js'), {
    workerData: { port: port2 },
    transferList: [port2],
    execArgv: workerExecArgv(),
  });
  let isClosed = false;

  const request = (action, payload = {}) => {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    port1.postMessage({ action, ...payload, signal: signal.buffer });
    const waitResult = Atomics.wait(signal, 0, 0, REQUEST_TIMEOUT_MS);
    if (waitResult === 'timed-out') {
      throw new Error(`SQLite test worker timed out during ${action}.`);
    }

    const envelope = receiveMessageOnPort(port1);
    if (!envelope) {
      throw new Error(`SQLite test worker returned no result for ${action}.`);
    }
    if (!envelope.message.ok) {
      throw new Error(envelope.message.error);
    }
    return envelope.message.result;
  };

  const close = () => {
    if (isClosed) return Promise.resolve();
    request('close');
    port1.close();
    isClosed = true;
    return worker.terminate().then(() => undefined);
  };

  if (typeof afterAll === 'function') {
    afterAll(close);
  }

  return {
    executeSync: (query, params = []) => request('execute', { query, params }),
    close,
  };
};

const open = () => {
  const sqlite = inProcessSqlite();
  return sqlite ? openInProcess(sqlite) : openInWorker();
};

module.exports = { open };
