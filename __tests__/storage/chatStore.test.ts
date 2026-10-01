/**
 * Unit tests for `src/storage/chatStore.ts`.
 *
 * Covers the default-session bootstrap, message mapping/ordering, history
 * clearing, and the error paths that must degrade instead of crashing the UI.
 */
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { chatStore } from '../../src/storage/chatStore';

const DEFAULT_SESSION_ID = 'default_chat_session';
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

describe('chatStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM messages');
    db.executeSync('DELETE FROM chat_sessions');
    db.executeSync('DELETE FROM users');
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user1', 'tester', iso(), iso()]
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates the default session exactly once per user', () => {
    expect(chatStore.ensureDefaultSession('user1')).toBe(DEFAULT_SESSION_ID);
    expect(chatStore.ensureDefaultSession('user1')).toBe(DEFAULT_SESSION_ID);

    const sessions = db.executeSync('SELECT * FROM chat_sessions WHERE user_id = ?', ['user1']);
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].title).toBe('Default Chat');
  });

  it('inserts messages and reads them back in chronological order', () => {
    const sessionId = chatStore.ensureDefaultSession('user1');

    chatStore.insertMessage({
      id: 'msg_late',
      sessionId,
      sender: 'assistant',
      content: 'See you at 3 PM.',
    });
    // Inserted directly with an earlier timestamp so the ORDER BY is observable.
    db.executeSync(
      `INSERT INTO messages (id, session_id, sender, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['msg_early', sessionId, 'user', 'Remind me to study.', iso(-60000), iso(-60000)]
    );

    const messages = chatStore.getMessages('user1');

    expect(messages.map((message) => message.id)).toEqual(['msg_early', 'msg_late']);
    expect(messages[1]).toEqual({
      id: 'msg_late',
      sessionId,
      sender: 'assistant',
      content: 'See you at 3 PM.',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('only returns messages that belong to the default session', () => {
    const sessionId = chatStore.ensureDefaultSession('user1');
    chatStore.insertMessage({
      id: 'msg_mine',
      sessionId,
      sender: 'user',
      content: 'My message',
    });
    // A different session owned by the same user must not leak into history.
    db.executeSync(
      `INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['other_session', 'user1', 'Other', iso(), iso()]
    );
    db.executeSync(
      `INSERT INTO messages (id, session_id, sender, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['msg_other', 'other_session', 'user', 'Other message', iso(), iso()]
    );

    expect(chatStore.getMessages('user1').map((message) => message.id)).toEqual(['msg_mine']);
  });

  it('clears only the default session history', () => {
    const sessionId = chatStore.ensureDefaultSession('user1');
    chatStore.insertMessage({
      id: 'msg_1',
      sessionId,
      sender: 'user',
      content: 'Hello',
    });

    chatStore.clearHistory('user1');

    expect(chatStore.getMessages('user1')).toEqual([]);
  });

  it('returns [] when reading messages fails', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(db, 'executeSync').mockImplementation(() => {
      throw new Error('database is locked');
    });

    expect(chatStore.getMessages('user1')).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('still returns the default session id when the session insert fails', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(db, 'executeSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(chatStore.ensureDefaultSession('user1')).toBe(DEFAULT_SESSION_ID);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs and rethrows when inserting a message fails', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(db, 'executeSync').mockImplementation(() => {
      throw new Error('unique constraint failed');
    });

    expect(() =>
      chatStore.insertMessage({
        id: 'msg_1',
        sessionId: DEFAULT_SESSION_ID,
        sender: 'user',
        content: 'Hello',
      })
    ).toThrow('unique constraint failed');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs and rethrows when clearing history fails', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(db, 'executeSync').mockImplementation(() => {
      throw new Error('delete failed');
    });

    expect(() => chatStore.clearHistory('user1')).toThrow('delete failed');
    expect(errorSpy).toHaveBeenCalled();
  });
});
