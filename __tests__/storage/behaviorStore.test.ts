/**
 * Unit tests for `src/storage/behaviorStore.ts`.
 *
 * The behavior log and feature snapshots feed the adaptive ML layer, so the
 * tests cover the happy paths, the optional event-type filter, latest-snapshot
 * selection, and the error paths that must degrade to an empty result.
 */
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { behaviorStore } from '../../src/storage/behaviorStore';

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

describe('behaviorStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM user_behavior_logs');
    db.executeSync('DELETE FROM ml_feature_snapshots');
    db.executeSync('DELETE FROM users');
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user1', 'tester', iso(), iso()]
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs and reads back a behavior event', () => {
    behaviorStore.logBehaviorEvent('user1', 'reminder', 'snoozed', '"15"');

    const logs = behaviorStore.getBehaviorLogs('user1');

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: 'user1',
      eventType: 'reminder',
      eventKey: 'snoozed',
      eventValue: '"15"',
    });
    expect(logs[0].id).toMatch(/^beh_/);
  });

  it('filters behavior events by type and user', () => {
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user2', 'other', iso(), iso()]
    );
    behaviorStore.logBehaviorEvent('user1', 'reminder', 'acknowledged', '"1"');
    behaviorStore.logBehaviorEvent('user1', 'task', 'completed', '"2"');
    behaviorStore.logBehaviorEvent('user2', 'reminder', 'missed', '"3"');

    const reminders = behaviorStore.getBehaviorLogs('user1', 'reminder');

    expect(reminders).toHaveLength(1);
    expect(reminders[0].eventKey).toBe('acknowledged');
    expect(behaviorStore.getBehaviorLogs('user1')).toHaveLength(2);
    expect(behaviorStore.getBehaviorLogs('nobody')).toEqual([]);
  });

  it('stores a feature snapshot and returns the most recent one', () => {
    behaviorStore.saveFeatureSnapshot('user1', 'focus', '{"morning":0.8}');
    db.executeSync(
      `INSERT INTO ml_feature_snapshots
         (id, user_id, feature_type, feature_vector, computed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['fs_newer', 'user1', 'focus', '{"morning":0.9}', iso(60000), iso(60000), iso(60000)]
    );

    const latest = behaviorStore.getLatestFeatureSnapshot('user1', 'focus');

    expect(latest?.id).toBe('fs_newer');
    expect(latest?.featureVector).toBe('{"morning":0.9}');
  });

  it('returns null when no snapshot matches the user and type', () => {
    behaviorStore.saveFeatureSnapshot('user1', 'focus', '{"morning":0.8}');

    expect(behaviorStore.getLatestFeatureSnapshot('user1', 'procrastination')).toBeNull();
    expect(behaviorStore.getLatestFeatureSnapshot('someone-else', 'focus')).toBeNull();
  });

  describe('failure handling', () => {
    const breakDatabase = () => {
      jest.spyOn(db, 'executeSync').mockImplementation(() => {
        throw new Error('database is locked');
      });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    };

    it('returns empty results when reads fail', () => {
      breakDatabase();

      expect(behaviorStore.getBehaviorLogs('user1')).toEqual([]);
      expect(behaviorStore.getLatestFeatureSnapshot('user1', 'focus')).toBeNull();
      expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('rethrows when a behavior log write fails', () => {
      breakDatabase();

      expect(() => behaviorStore.logBehaviorEvent('user1', 'reminder', 'snoozed', '1')).toThrow(
        'database is locked'
      );
    });

    it('rethrows when a snapshot write fails', () => {
      breakDatabase();

      expect(() => behaviorStore.saveFeatureSnapshot('user1', 'focus', '{}')).toThrow(
        'database is locked'
      );
    });
  });
});
