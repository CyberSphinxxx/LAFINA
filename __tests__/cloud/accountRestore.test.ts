import { accountLinkService } from '../../src/cloud/accountLinkService';
import { authService, AuthResponseData, UserProfileData } from '../../src/cloud/authService';
import {
  CLOUD_API_BASE_URL,
  LOCAL_API_BASE_URL,
  apiBaseUrlsFor,
  cloudClient,
  setMockOnlineState,
} from '../../src/cloud/cloudClient';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { userStore } from '../../src/storage/userStore';

const EMAIL = 'desktop.student@ustp.edu.ph';
const PASSWORD = 'made-on-the-desktop';

const cloudAuth = (overrides: Partial<AuthResponseData> = {}): AuthResponseData => ({
  access_token: 'cloud-access-token',
  refresh_token: 'cloud-refresh-token',
  token_type: 'bearer',
  expires_in: 900,
  user_id: 'desktop-cloud-account',
  email: EMAIL,
  role: 'student_pro',
  ...overrides,
});

const cloudProfile = (): UserProfileData => ({
  id: 'desktop-cloud-account',
  email: EMAIL,
  role: 'student_pro',
  is_active: true,
  created_at: '2026-09-01T00:00:00+00:00',
});

const userCount = (): number => Number(db.executeSync('SELECT COUNT(*) AS n FROM users').rows?.[0]?.n ?? 0);

describe('signing in on a phone with an account made on another device', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    setMockOnlineState(true);
    cloudClient.resetSessionCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    cloudClient.resetSessionCache();
    setMockOnlineState(null);
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM active_session');
    db.executeSync('DELETE FROM users');
  });

  it('restores the account from the cloud once the server accepts the password', async () => {
    const register = jest.spyOn(authService, 'register');
    const login = jest.spyOn(authService, 'login').mockResolvedValue({ status: 'success', data: cloudAuth() });
    jest.spyOn(authService, 'getMe').mockResolvedValue({ status: 'success', data: cloudProfile() });

    const result = await accountLinkService.login('  Desktop.Student@USTP.edu.ph ', PASSWORD);

    expect(result).toMatchObject({ status: 'success', restoredFromCloud: true, role: 'student_pro' });
    expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    // Sign-in never creates a cloud account.
    expect(register).not.toHaveBeenCalled();

    const local = userStore.getUserById(result.localUserId!)!;
    expect(local).toMatchObject({
      email: EMAIL,
      cloudAccountId: 'desktop-cloud-account',
      isCloudLinked: true,
      isNewUser: false,
      role: 'student_pro',
    });
    expect(userStore.getActiveSessionToken()).toMatchObject({
      userId: local.id,
      accessToken: 'cloud-access-token',
    });
    // The password now works on this phone offline too.
    expect((await userStore.login(EMAIL, PASSWORD))?.id).toBe(local.id);
    // The real profile comes down with the first sync; a placeholder is never sent up over it.
    const queuedProfiles = db.executeSync(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type = 'profile'",
    ).rows?.[0]?.n;
    expect(Number(queuedProfiles)).toBe(0);
  });

  it('does nothing offline, and says the same thing as for a wrong password', async () => {
    setMockOnlineState(false);
    const login = jest.spyOn(authService, 'login');

    const unknown = await accountLinkService.login(EMAIL, PASSWORD);

    expect(login).not.toHaveBeenCalled();
    expect(userCount()).toBe(0);

    await userStore.register('Local', 'local@ustp.edu.ph', 'the-real-password');
    const wrong = await accountLinkService.login('local@ustp.edu.ph', 'not-the-password');
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.message).toBe(wrong.message);
  });

  it('gives an unknown email and a wrong password the same answer online', async () => {
    jest.spyOn(authService, 'login').mockResolvedValue({ status: 'auth_required', error: 'Invalid email or password.' });

    const unknown = await accountLinkService.login(EMAIL, 'not-the-password');
    expect(userCount()).toBe(0);

    await userStore.register('Local', 'local@ustp.edu.ph', 'the-real-password');
    const wrong = await accountLinkService.login('local@ustp.edu.ph', 'not-the-password');

    expect(unknown).toEqual({ status: 'incorrect_local_password', message: 'Incorrect email or password.' });
    expect(wrong).toEqual(unknown);
  });

  it('creates nothing when the server vouches for a different address', async () => {
    jest.spyOn(authService, 'login').mockResolvedValue({
      status: 'success',
      data: cloudAuth({ email: 'someone.else@ustp.edu.ph' }),
    });

    const result = await accountLinkService.login(EMAIL, PASSWORD);

    expect(result.status).toBe('profile_failed');
    expect(userCount()).toBe(0);
  });

  it('passes on the server refusing too many attempts, and creates nothing', async () => {
    jest.spyOn(authService, 'login').mockResolvedValue({
      status: 'rate_limited',
      error: 'Too many sign-in attempts for this email. Try again in 12 minutes.',
    });

    const result = await accountLinkService.login(EMAIL, PASSWORD);

    expect(result).toEqual({
      status: 'rate_limited',
      message: 'Too many sign-in attempts for this email. Try again in 12 minutes.',
    });
    expect(userCount()).toBe(0);
  });

  it('never takes over a local account already tied to that cloud account', async () => {
    const existing = await userStore.register('Old email', 'old.address@ustp.edu.ph', 'another-password');
    userStore.linkCloudAccount(existing, 'desktop-cloud-account', 'student');
    jest.spyOn(authService, 'login').mockResolvedValue({ status: 'success', data: cloudAuth() });

    const result = await accountLinkService.login(EMAIL, PASSWORD);

    expect(result.status).toBe('registration_failed');
    expect(userStore.getUserByEmail(EMAIL)).toBeNull();
    expect(userStore.getActiveSessionToken().userId).not.toBe(existing);
  });

  it('keeps the new account usable when the profile check fails afterwards', async () => {
    jest.spyOn(authService, 'login').mockResolvedValue({ status: 'success', data: cloudAuth() });
    jest.spyOn(authService, 'getMe').mockResolvedValue({ status: 'server_error', error: 'Boom' });

    const result = await accountLinkService.login(EMAIL, PASSWORD);

    expect(result).toMatchObject({ status: 'local_only', restoredFromCloud: true });
    expect(userStore.getUserByEmail(EMAIL)?.cloudAccountId).toBe('desktop-cloud-account');
  });

  it('joins a second tap on Sign In to the restore already running', async () => {
    let finish: (value: { status: 'success'; data: AuthResponseData }) => void = () => undefined;
    const login = jest.spyOn(authService, 'login').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    jest.spyOn(authService, 'getMe').mockResolvedValue({ status: 'success', data: cloudProfile() });

    const first = accountLinkService.login(EMAIL, PASSWORD);
    const second = accountLinkService.login(EMAIL, PASSWORD);
    await Promise.resolve();
    finish({ status: 'success', data: cloudAuth() });

    const [a, b] = await Promise.all([first, second]);
    expect(login).toHaveBeenCalledTimes(1);
    expect(a.localUserId).toBe(b.localUserId);
    expect(userCount()).toBe(1);
  });
});

describe('where the phone sends requests', () => {
  it('never tries the plain-HTTP local server in a release build', () => {
    expect(apiBaseUrlsFor(false)).toEqual([CLOUD_API_BASE_URL]);
    expect(apiBaseUrlsFor(true)).toEqual([CLOUD_API_BASE_URL, LOCAL_API_BASE_URL]);
    expect(CLOUD_API_BASE_URL.startsWith('https://')).toBe(true);
  });
});
