/**
 * Unit tests for `src/storage/userStore.ts`.
 *
 * Covers the offline guest account, registration/login, active-session token
 * persistence, per-user display preferences, Remember Me, cloud linking, and the
 * error paths that must degrade instead of crashing the UI.
 */
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { userStore } from '../../src/storage/userStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { GUEST_USER_ID, GUEST_USERNAME } from '../../src/constants';

const iso = () => new Date().toISOString();

const insertRawUser = (id: string, username: string, email: string | null = null): void => {
  db.executeSync(
    `INSERT INTO users (id, username, email, role, is_new_user, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, username, email, 'student', 1, iso(), iso()]
  );
};

describe('userStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM active_session');
    db.executeSync('DELETE FROM remember_me');
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM users');
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

  describe('guest account', () => {
    it('creates and then reuses the persistent guest row', () => {
      const created = userStore.createGuestUser();
      const reused = userStore.createGuestUser();

      expect(created.id).toBe(GUEST_USER_ID);
      expect(created.username).toBe(GUEST_USERNAME);
      expect(created.role).toBe('guest');
      expect(created.isNewUser).toBe(true);
      expect(reused.id).toBe(GUEST_USER_ID);
      expect(
        db.executeSync('SELECT COUNT(*) as count FROM users').rows[0].count
      ).toBe(1);
    });

    it('falls back to an in-memory guest when the database is unavailable', () => {
      breakDatabase();

      const guest = userStore.createGuestUser();

      expect(guest.id).toBe(GUEST_USER_ID);
      expect(guest.email).toBeNull();
      expect(guest.isCloudLinked).toBe(false);
    });

    it('identifies only the guest id as a guest session', () => {
      expect(userStore.isGuest(GUEST_USER_ID)).toBe(true);
      expect(userStore.isGuest('user_123')).toBe(false);
    });

    it('returns the virtual guest from getUserById even when unpersisted', () => {
      expect(userStore.getUserById(GUEST_USER_ID)?.id).toBe(GUEST_USER_ID);
    });
  });

  describe('registration and login', () => {
    it('registers a user, normalises the email and queues a sync mutation', async () => {
      const enqueueSpy = jest.spyOn(syncOutboxStore, 'enqueueMutation');

      const id = await userStore.register('Maria', '  Maria@USTP.edu.ph ', 'secret123');

      expect(id).toMatch(/^user_/);
      const row = db.executeSync('SELECT * FROM users WHERE id = ?', [id]).rows[0];
      expect(row.email).toBe('maria@ustp.edu.ph');
      expect(row.password_hash).not.toBe('secret123');
      expect(row.is_new_user).toBe(1);
      expect(enqueueSpy).toHaveBeenCalledWith(
        id,
        'profile',
        'profile',
        'create',
        expect.objectContaining({
          username: 'Maria',
          time_format_24h: false,
          week_starts_monday: false,
          dark_mode: false,
        }),
        'account',
        id,
        expect.anything(),
      );
    });

    it('rejects passwords that fail the shared policy', async () => {
      await expect(userStore.register('Maria', 'maria@ustp.edu.ph', '123')).rejects.toThrow(
        'Passwords must contain at least 6 characters.'
      );
    });

    it('rejects an email that is already registered, ignoring case', async () => {
      await userStore.register('Maria', 'maria@ustp.edu.ph', 'secret123');

      await expect(userStore.register('Other', 'MARIA@USTP.EDU.PH', 'secret123')).rejects.toThrow(
        'Email already registered'
      );
    });

    it('still registers when the sync outbox is unavailable', async () => {
      jest.spyOn(syncOutboxStore, 'enqueueMutation').mockImplementation(() => {
        throw new Error('outbox unavailable');
      });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const id = await userStore.register('Maria', 'maria@ustp.edu.ph', 'secret123');

      expect(id).toMatch(/^user_/);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rethrows when the registration insert fails', async () => {
      await userStore.register('Maria', 'maria@ustp.edu.ph', 'secret123');
      breakDatabase();

      await expect(userStore.register('Other', 'other@ustp.edu.ph', 'secret123')).rejects.toThrow(
        'database is locked'
      );
    });

    it('logs in with the correct password and rejects the wrong one', async () => {
      const id = await userStore.register('Maria', 'maria@ustp.edu.ph', 'secret123');

      const signedIn = await userStore.login('MARIA@ustp.edu.ph', 'secret123');
      const wrongPassword = await userStore.login('maria@ustp.edu.ph', 'not-my-password');
      const unknownEmail = await userStore.login('nobody@ustp.edu.ph', 'secret123');

      expect(signedIn?.id).toBe(id);
      expect(wrongPassword).toBeNull();
      expect(unknownEmail).toBeNull();
    });

    it('returns null and logs when the login lookup fails', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      breakDatabase();

      await expect(userStore.login('maria@ustp.edu.ph', 'secret123')).resolves.toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('finds a user by normalised email without authenticating', async () => {
      const id = await userStore.register('Maria', 'maria@ustp.edu.ph', 'secret123');

      expect(userStore.getUserByEmail('  MARIA@ustp.edu.ph')?.id).toBe(id);
      expect(userStore.getUserByEmail('nobody@ustp.edu.ph')).toBeNull();
    });

    it('degrades user-by-email lookups to null on failure', () => {
      breakDatabase();

      expect(userStore.getUserByEmail('maria@ustp.edu.ph')).toBeNull();
    });
  });

  describe('active session', () => {
    it('sets, reads and clears the current user session', () => {
      insertRawUser('user_a', 'Maria');
      expect(userStore.getCurrentUser()).toBeNull();

      userStore.setCurrentUser('user_a');
      expect(userStore.getCurrentUser()?.id).toBe('user_a');

      insertRawUser('user_b', 'Jose');
      userStore.setCurrentUser('user_b');
      expect(userStore.getCurrentUser()?.id).toBe('user_b');

      userStore.logout();
      expect(userStore.getCurrentUser()).toBeNull();
    });

    it('persists access tokens and keeps the refresh token when omitted', () => {
      insertRawUser('user_a', 'Maria');
      userStore.setCurrentUser('user_a');

      userStore.saveSessionTokens('user_a', 'access-1', 'refresh-1');
      expect(userStore.getActiveSessionToken()).toEqual({
        userId: 'user_a',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        pendingCloudCredential: null,
      });

      userStore.saveSessionTokens('user_a', 'access-2');
      expect(userStore.getActiveSessionToken()).toEqual({
        userId: 'user_a',
        accessToken: 'access-2',
        refreshToken: 'refresh-1',
        pendingCloudCredential: null,
      });
    });

    it('clears cloud tokens without dropping the local session', () => {
      insertRawUser('user_a', 'Maria');
      userStore.setCurrentUser('user_a');
      userStore.saveSessionTokens('user_a', 'access-1', 'refresh-1');

      userStore.clearSessionTokens('user_a');

      expect(userStore.getActiveSessionToken()).toEqual({
        userId: 'user_a',
        accessToken: null,
        refreshToken: null,
        pendingCloudCredential: null,
      });
      expect(userStore.getCurrentUser()?.id).toBe('user_a');
    });

    it('returns empty tokens when no session exists', () => {
      expect(userStore.getActiveSessionToken()).toEqual({
        userId: null,
        accessToken: null,
        refreshToken: null,
        pendingCloudCredential: null,
      });
    });

    it('degrades session reads to empty values on failure', () => {
      breakDatabase();

      expect(userStore.getCurrentUser()).toBeNull();
      expect(userStore.getActiveSessionToken()).toEqual({
        userId: null,
        accessToken: null,
        refreshToken: null,
        pendingCloudCredential: null,
      });
    });

    it('rethrows failed session writes', () => {
      breakDatabase();

      expect(() => userStore.setCurrentUser('user_a')).toThrow('database is locked');
      expect(() => userStore.logout()).toThrow('database is locked');
      expect(() => userStore.saveSessionTokens('user_a', 'token')).toThrow('database is locked');
      expect(() => userStore.clearSessionTokens('user_a')).toThrow('database is locked');
    });
  });

  describe('onboarding state', () => {
    it('marks onboarding complete and reports it', () => {
      insertRawUser('user_a', 'Maria');

      expect(userStore.isOnboardingComplete('user_a')).toBe(false);

      userStore.markOnboardingComplete('user_a');

      expect(userStore.isOnboardingComplete('user_a')).toBe(true);
      expect(userStore.getUserById('user_a')?.isNewUser).toBe(false);
    });

    it('treats a missing user as not onboarded', () => {
      expect(userStore.isOnboardingComplete('ghost')).toBe(false);
    });

    it('degrades onboarding lookups to false and rethrows failed writes', () => {
      breakDatabase();

      expect(userStore.isOnboardingComplete('user_a')).toBe(false);
      expect(() => userStore.markOnboardingComplete('user_a')).toThrow('database is locked');
    });
  });

  describe('display preferences', () => {
    it('round-trips the 24-hour clock preference', () => {
      insertRawUser('user_a', 'Maria');
      expect(userStore.get24HourFormat('user_a')).toBe(false);

      userStore.set24HourFormat('user_a', true);
      expect(userStore.get24HourFormat('user_a')).toBe(true);

      userStore.set24HourFormat('user_a', false);
      expect(userStore.get24HourFormat('user_a')).toBe(false);
    });

    it('round-trips the week-start preference', () => {
      insertRawUser('user_a', 'Maria');
      expect(userStore.getWeekStartsMonday('user_a')).toBe(false);

      userStore.setWeekStartsMonday('user_a', true);
      expect(userStore.getWeekStartsMonday('user_a')).toBe(true);
    });

    it('round-trips the dark mode preference', () => {
      insertRawUser('user_a', 'Maria');
      expect(userStore.getDarkModeEnabled('user_a')).toBe(false);

      userStore.setDarkModeEnabled('user_a', true);
      expect(userStore.getDarkModeEnabled('user_a')).toBe(true);
    });

    it('defaults to false for users that do not exist', () => {
      expect(userStore.get24HourFormat('ghost')).toBe(false);
      expect(userStore.getWeekStartsMonday('ghost')).toBe(false);
      expect(userStore.getDarkModeEnabled('ghost')).toBe(false);
    });

    it('degrades preference reads to false and rethrows failed writes', () => {
      breakDatabase();

      expect(userStore.get24HourFormat('user_a')).toBe(false);
      expect(userStore.getWeekStartsMonday('user_a')).toBe(false);
      expect(userStore.getDarkModeEnabled('user_a')).toBe(false);
      expect(() => userStore.set24HourFormat('user_a', true)).toThrow('database is locked');
      expect(() => userStore.setWeekStartsMonday('user_a', true)).toThrow('database is locked');
      expect(() => userStore.setDarkModeEnabled('user_a', true)).toThrow('database is locked');
    });
  });

  describe('remember me', () => {
    it('round-trips the remember me configuration', () => {
      expect(userStore.getRememberMe()).toEqual({ enabled: false, email: null });

      userStore.setRememberMe(true, 'maria@ustp.edu.ph');
      expect(userStore.getRememberMe()).toEqual({ enabled: true, email: 'maria@ustp.edu.ph' });

      userStore.setRememberMe(false, null);
      expect(userStore.getRememberMe()).toEqual({ enabled: false, email: null });
    });

    it('degrades reads to disabled and rethrows failed writes', () => {
      breakDatabase();

      expect(userStore.getRememberMe()).toEqual({ enabled: false, email: null });
      expect(() => userStore.setRememberMe(true, 'maria@ustp.edu.ph')).toThrow(
        'database is locked'
      );
    });
  });

  describe('cloud identity', () => {
    it('links a cloud account without changing the local primary key', () => {
      insertRawUser('user_a', 'Maria');

      userStore.linkCloudAccount('user_a', 'cloud-42', 'student');

      const user = userStore.getUserById('user_a');
      expect(user?.id).toBe('user_a');
      expect(user?.cloudAccountId).toBe('cloud-42');
      expect(user?.isCloudLinked).toBe(true);
      expect(user?.cloudLinkedAt).not.toBeNull();
      expect(user?.role).toBe('student');
    });

    it('updates the user role when the cloud reports a different one', () => {
      insertRawUser('user_a', 'Maria');

      userStore.updateUserRole('user_a', 'teacher');

      expect(userStore.getUserById('user_a')?.role).toBe('teacher');
    });

    it('rethrows failed cloud links but only logs a failed role update', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      breakDatabase();

      expect(() => userStore.linkCloudAccount('user_a', 'cloud-42', 'student')).toThrow(
        'database is locked'
      );
      expect(() => userStore.updateUserRole('user_a', 'teacher')).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('getUserById', () => {
    it('returns null for an unknown id and degrades to null on failure', () => {
      expect(userStore.getUserById('ghost')).toBeNull();

      breakDatabase();
      expect(userStore.getUserById('user_a')).toBeNull();
    });
  });
});
