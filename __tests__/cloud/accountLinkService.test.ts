import { accountLinkService } from '../../src/cloud/accountLinkService';
import { authService, AuthResponseData, UserProfileData } from '../../src/cloud/authService';
import { cloudClient, setMockOnlineState } from '../../src/cloud/cloudClient';
import { chatStore } from '../../src/storage/chatStore';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { notesStore } from '../../src/storage/notesStore';
import { remindersStore } from '../../src/storage/remindersStore';
import { userStore } from '../../src/storage/userStore';

const cloudAuth = (
  role: string = 'student_pro',
  email: string = 'student@ustp.edu.ph'
): AuthResponseData => ({
  access_token: 'cloud-access-token',
  refresh_token: 'cloud-refresh-token',
  token_type: 'bearer',
  expires_in: 900,
  user_id: 'cloud-account-uuid',
  email,
  role,
});

const cloudProfile = (
  role: string = 'student_pro',
  email: string = 'student@ustp.edu.ph'
): UserProfileData => ({
  id: 'cloud-account-uuid',
  email,
  role,
  is_active: true,
  created_at: '2026-07-23T00:00:00+00:00',
});

describe('accountLinkService', () => {
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
    db.executeSync('DELETE FROM messages');
    db.executeSync('DELETE FROM chat_sessions');
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM active_session');
    db.executeSync('DELETE FROM users');
  });

  it('registers with FastAPI first, then creates and links a normalized local account', async () => {
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'success',
      data: cloudAuth('student_pro'),
    });
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: cloudProfile('student_pro'),
    });

    const result = await accountLinkService.registerCloudFirst({
      username: 'Student',
      email: '  Student@USTP.EDU.PH ',
      password: 'local-cloud-password',
    });

    expect(result.status).toBe('success');
    expect(result.localUserId).toBeDefined();
    expect(result.localUserId).not.toBe('cloud-account-uuid');
    const localUser = userStore.getUserById(result.localUserId!);
    expect(localUser?.email).toBe('student@ustp.edu.ph');
    expect(localUser?.role).toBe('student_pro');
    expect(localUser?.cloudAccountId).toBe('cloud-account-uuid');
    expect(localUser?.isCloudLinked).toBe(true);

    const session = userStore.getActiveSessionToken();
    expect(session.userId).toBe(result.localUserId);
    expect(session.accessToken).toBe('cloud-access-token');
    expect(session.refreshToken).toMatch(/^mock_enc_/);
    expect(session.refreshToken).not.toBe('cloud-refresh-token');
  });

  it('does not create a local account when FastAPI registration fails', async () => {
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'server_error',
      error: 'FastAPI registration failed.',
    });

    const result = await accountLinkService.registerCloudFirst({
      username: 'Student',
      email: 'student@ustp.edu.ph',
      password: 'valid-password',
    });

    expect(result.status).toBe('server_unavailable');
    expect(userStore.getUserByEmail('student@ustp.edu.ph')).toBeNull();
  });

  it('creates an offline-only account only through the explicit offline path', async () => {
    setMockOnlineState(false);
    const cloudAttempt = await accountLinkService.registerCloudFirst({
      username: 'Offline Student',
      email: 'offline@ustp.edu.ph',
      password: 'offline-password',
    });
    expect(cloudAttempt.status).toBe('offline');
    expect(userStore.getUserByEmail('offline@ustp.edu.ph')).toBeNull();

    const offlineResult = await accountLinkService.registerOfflineOnly({
      username: 'Offline Student',
      email: 'offline@ustp.edu.ph',
      password: 'offline-password',
    });
    expect(offlineResult.status).toBe('offline_only');
    expect(userStore.getUserById(offlineResult.localUserId!)?.isCloudLinked).toBe(false);
    const offlineSession = userStore.getActiveSessionToken();
    expect(offlineSession.accessToken).toBeNull();
    expect(offlineSession.pendingCloudCredential).toMatch(/^mock_enc_/);
    expect(offlineSession.pendingCloudCredential).not.toContain('offline-password');
  });

  it('automatically completes a queued FastAPI link when internet returns', async () => {
    setMockOnlineState(false);
    const offlineResult = await accountLinkService.registerOfflineOnly({
      username: 'Reconnect Student',
      email: 'reconnect@ustp.edu.ph',
      password: 'offline-password',
    });
    const localUserId = offlineResult.localUserId!;

    setMockOnlineState(true);
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'success',
      data: cloudAuth('student_pro', 'reconnect@ustp.edu.ph'),
    });
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: cloudProfile('student_pro', 'reconnect@ustp.edu.ph'),
    });

    const result = await accountLinkService.completeDeferredCloudLink(localUserId);

    expect(result.status).toBe('success');
    expect(authService.register).toHaveBeenCalledWith(
      'reconnect@ustp.edu.ph',
      'offline-password'
    );
    expect(userStore.getUserById(localUserId)).toMatchObject({
      isCloudLinked: true,
      role: 'student_pro',
    });
    const linkedSession = userStore.getActiveSessionToken();
    expect(linkedSession.accessToken).toBe('cloud-access-token');
    expect(linkedSession.pendingCloudCredential).toBeNull();
  });

  it('authenticates and links an existing FastAPI email with the entered password', async () => {
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'conflict',
      error: 'Account with this email already exists.',
    });
    jest.spyOn(authService, 'login').mockResolvedValue({
      status: 'success',
      data: cloudAuth('admin'),
    });
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: cloudProfile('admin'),
    });

    const result = await accountLinkService.registerCloudFirst({
      username: 'Existing Admin',
      email: 'STUDENT@USTP.EDU.PH',
      password: 'existing-cloud-password',
    });

    expect(result.status).toBe('success');
    expect(userStore.getUserById(result.localUserId!)?.role).toBe('admin');
    expect(authService.login).toHaveBeenCalledWith(
      'student@ustp.edu.ph',
      'existing-cloud-password'
    );
  });

  it('does not create or link a local user when an existing cloud password is incorrect', async () => {
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'conflict',
      error: 'Account with this email already exists.',
    });
    jest.spyOn(authService, 'login').mockResolvedValue({
      status: 'auth_required',
      error: 'Invalid email or password.',
    });

    const result = await accountLinkService.registerCloudFirst({
      username: 'Student',
      email: 'student@ustp.edu.ph',
      password: 'wrong-cloud-password',
    });

    expect(result.status).toBe('incorrect_cloud_password');
    expect(result.message).toContain('password does not match');
    expect(userStore.getUserByEmail('student@ustp.edu.ph')).toBeNull();
  });

  it('keeps offline access when automatic linking finds a disabled cloud account', async () => {
    const localUserId = await userStore.register(
      'Local Student', 'student@ustp.edu.ph', 'local-password'
    );
    userStore.setCurrentUser(localUserId);
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'conflict',
      error: 'Account with this email already exists.',
    });
    jest.spyOn(authService, 'login').mockResolvedValue({
      status: 'account_disabled',
      error: 'Account is disabled.',
    });

    const result = await accountLinkService.login(
      'student@ustp.edu.ph',
      'local-password'
    );

    expect(result.status).toBe('local_only');
    expect(result.cloudStatus).toBe('account_disabled');
    expect(result.message).toContain('disabled');
    expect(userStore.getUserById(localUserId)).toMatchObject({
      id: localUserId,
      isCloudLinked: false,
      role: 'student',
    });
    expect(userStore.getActiveSessionToken().accessToken).toBeNull();
  });

  it('keeps local access and local data when cloud login fails', async () => {
    const localUserId = await userStore.register(
      'Local Student', 'student@ustp.edu.ph', 'local-password'
    );
    remindersStore.insertReminder({
      id: 'saved-reminder',
      userId: localUserId,
      task: 'Keep reminder',
      description: null,
      scheduledAt: '2026-07-24T08:00:00.000Z',
      triggerAt: '2026-07-24T07:45:00.000Z',
      status: 'pending',
      preCastAudioPath: null,
    });
    notesStore.insert({
      id: 'saved-note',
      userId: localUserId,
      title: 'Keep note',
      body: 'Preserved',
      isPinned: false,
      tags: [],
      category: 'General',
      isVoiceTranscribed: false,
    });
    const sessionId = chatStore.ensureDefaultSession(localUserId);
    chatStore.insertMessage({
      id: 'saved-message',
      sessionId,
      sender: 'user',
      content: 'Preserve chat',
    });
    jest.spyOn(authService, 'login').mockResolvedValue({
      status: 'auth_required',
      error: 'Invalid email or password.',
    });
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'conflict',
      error: 'Account with this email already exists.',
    });

    const result = await accountLinkService.login(
      'STUDENT@USTP.EDU.PH',
      'local-password'
    );

    expect(result.status).toBe('local_only');
    expect(result.localUserId).toBe(localUserId);
    expect(userStore.getCurrentUser()?.id).toBe(localUserId);
    expect(remindersStore.getReminderById('saved-reminder')?.userId).toBe(localUserId);
    expect(notesStore.getAll(localUserId).map(note => note.id)).toContain('saved-note');
    expect(chatStore.getMessages(localUserId).map(message => message.id)).toContain('saved-message');
  });

  it('automatically creates and links FastAPI on the next online local sign-in', async () => {
    const localUserId = await userStore.register(
      'Local Student', 'student@ustp.edu.ph', 'local-password'
    );
    userStore.setCurrentUser(localUserId);
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO tasks (id, user_id, title, is_completed, priority, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['saved-task', localUserId, 'Keep task', 0, 'high', 'Academics', now, now]
    );
    db.executeSync(
      `INSERT INTO time_blocks
       (id, user_id, title, date, start_time, end_time, color, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'saved-block', localUserId, 'Keep block', '2026-07-24', '09:00', '10:00',
        '#3366FF', 'Academics', now, now,
      ]
    );
    jest.spyOn(authService, 'register').mockResolvedValue({
      status: 'success',
      data: cloudAuth('student_pro'),
    });
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: cloudProfile('student_pro'),
    });

    const result = await accountLinkService.login(
      'student@ustp.edu.ph',
      'local-password'
    );

    expect(result.status).toBe('success');
    expect(result.localUserId).toBe(localUserId);
    expect(authService.register).toHaveBeenCalledWith(
      'student@ustp.edu.ph',
      'local-password'
    );
    expect(await userStore.login('student@ustp.edu.ph', 'local-password')).not.toBeNull();
    expect(userStore.getUserById('cloud-account-uuid')).toBeNull();
    expect(db.executeSync('SELECT * FROM tasks WHERE id = ?', ['saved-task']).rows[0].user_id)
      .toBe(localUserId);
    expect(
      db.executeSync('SELECT * FROM time_blocks WHERE id = ?', ['saved-block'])
        .rows[0].user_id
    ).toBe(localUserId);
  });

  it('synchronizes both SQLAdmin role upgrades and downgrades to the local user ID', async () => {
    const localUserId = await userStore.register(
      'Role Student', 'student@ustp.edu.ph', 'local-password'
    );
    userStore.setCurrentUser(localUserId);
    userStore.saveSessionTokens(localUserId, 'access-token', 'encrypted-refresh-token');
    jest.spyOn(authService, 'getMe')
      .mockResolvedValueOnce({ status: 'success', data: cloudProfile('student_pro') })
      .mockResolvedValueOnce({ status: 'success', data: cloudProfile('student') });

    await accountLinkService.refreshCloudProfile(localUserId);
    expect(userStore.getUserById(localUserId)?.role).toBe('student_pro');
    await accountLinkService.refreshCloudProfile(localUserId);
    expect(userStore.getUserById(localUserId)?.role).toBe('student');
    expect(userStore.getUserById('cloud-account-uuid')).toBeNull();
  });

  it.each(['student_pro', 'admin', 'business'])('allows Online Chat for a live %s role', async (role) => {
    const localUserId = await userStore.register(
      `Role ${role}`, `${role}@ustp.edu.ph`, 'local-password'
    );
    userStore.setCurrentUser(localUserId);
    userStore.saveSessionTokens(localUserId, 'access-token', 'encrypted-refresh-token');
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: cloudProfile(role, `${role}@ustp.edu.ph`),
    });

    const result = await accountLinkService.authorizeOnlineMode(localUserId);
    expect(result.status).toBe('success');
  });

  it('allows Online Chat for an employee with an active business session', async () => {
    const localUserId = await userStore.register(
      'Role Employee', 'employee@ustp.edu.ph', 'local-password'
    );
    userStore.setCurrentUser(localUserId);
    userStore.saveSessionTokens(localUserId, 'access-token', 'encrypted-refresh-token');
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: {
        id: 'cloud-uuid-emp',
        email: 'employee@ustp.edu.ph',
        role: 'student',
        subscription_plan: 'student',
        effective_subscription_plan: 'business',
        business_session: {
          business_id: 'biz-123',
          business_name: 'Tech Corp',
          member_role: 'employee',
          membership_status: 'active',
          lease_expires_at: '2099-01-01T00:00:00Z',
          capabilities: ['business_chat'],
        },
        is_active: true,
        created_at: new Date().toISOString(),
      },
    });

    const result = await accountLinkService.authorizeOnlineMode(localUserId);
    expect(result.status).toBe('success');
  });

  it('denies Online Chat without cloud authentication and for a live student role', async () => {
    const localUserId = await userStore.register(
      'Role Student', 'student@ustp.edu.ph', 'local-password'
    );
    userStore.setCurrentUser(localUserId);

    const unauthenticated = await accountLinkService.authorizeOnlineMode(localUserId);
    expect(unauthenticated.status).toBe('auth_required');

    userStore.saveSessionTokens(localUserId, 'access-token', 'encrypted-refresh-token');
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: cloudProfile('student'),
    });
    const student = await accountLinkService.authorizeOnlineMode(localUserId);
    expect(student.status).toBe('student_pro_required');
  });

  it('clears cloud tokens on logout while retaining the local account', async () => {
    const localUserId = await userStore.register(
      'Logout Student', 'student@ustp.edu.ph', 'local-password'
    );
    userStore.setCurrentUser(localUserId);
    userStore.saveSessionTokens(localUserId, 'access-token', 'encrypted-refresh-token');
    jest.spyOn(cloudClient, 'request').mockResolvedValue({ status: 'success', data: null });

    await authService.logout();

    expect(userStore.getActiveSessionToken()).toEqual({
      userId: localUserId,
      accessToken: null,
      refreshToken: null,
      pendingCloudCredential: null,
    });
    expect(userStore.getUserById(localUserId)).not.toBeNull();
  });
});
