/**
 * The study tools (Pomodoro, flashcards, study notes, meetings) in cloud sync:
 * what the stores queue, how the worker negotiates entity types with new and
 * old servers, and how incoming changes land locally. The same scenarios run
 * against LAFINA desktop in `tests/study-sync.test.mjs`.
 */
jest.mock('../../src/scheduler', () => ({
  reconcileReminderAlarms: jest.fn().mockResolvedValue(undefined),
}));

import { accountLinkService } from '../../src/cloud/accountLinkService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { flashcardStore, MAX_STORED_DECKS } from '../../src/storage/flashcardStore';
import { localDayKey, pomodoroStore } from '../../src/storage/pomodoroStore';
import { recordedMeetingStore } from '../../src/storage/recordedMeetingStore';
import { studyNoteStore } from '../../src/storage/studyNoteStore';
import { syncMetadataStore } from '../../src/storage/syncMetadataStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { syncStateStore } from '../../src/storage/syncStateStore';
import { userStore } from '../../src/storage/userStore';
import type { SyncEntityType } from '../../src/storage/syncTypes';
import {
  CLIENT_SYNC_ENTITY_TYPES,
  LEGACY_SYNC_ENTITY_TYPES,
} from '../../src/sync/syncEntityTypes';
import { createSyncScheduler } from '../../src/sync/syncScheduler';
import { syncWorker } from '../../src/sync/syncWorker';

type Payload = Record<string, unknown>;

interface Mutation {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  payload: Payload;
  baseVersion?: number;
}

interface RequestBody {
  mutations: Mutation[];
  cursor: number;
  entityTypes?: string[];
  snapshot?: Record<string, unknown>;
}

interface Change {
  changeId: number;
  entityType: SyncEntityType;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  version: number;
  payload: Payload;
  updatedAt: string;
  deletedAt: string | null;
}

const ALL_TYPES = [...CLIENT_SYNC_ENTITY_TYPES];
const SERVER_AUTHORITATIVE: SyncEntityType[] = [
  'task', 'event', 'time_block', 'reminder', 'note', 'custom_category',
  'pomodoro_session', 'flashcard_deck', 'study_summary', 'recorded_meeting',
];

const pendingOf = (userId: string, entityType?: SyncEntityType) =>
  syncOutboxStore
    .getPendingMutations(userId, 1000)
    .filter((item) => !entityType || item.entityType === entityType);

/**
 * A server that accepts every mutation, echoes it back as a change, and hands
 * out a scripted snapshot. `supported: null` plays a server from before
 * entity-type negotiation.
 */
const fakeServer = ({
  supported = ALL_TYPES as string[] | null,
  snapshotItems = [] as Change[],
  remote = [] as Change[],
} = {}) => {
  let head = 50;
  const versions = new Map<string, number>();
  const requests: RequestBody[] = [];
  const respond = (body: RequestBody) => {
    requests.push(body);
    const known = supported ?? [...LEGACY_SYNC_ENTITY_TYPES];
    const results = body.mutations.map((mutation) => {
      if (!known.includes(mutation.entityType)) {
        throw new Error(`server got ${mutation.entityType}`);
      }
      const key = `${mutation.entityType}:${mutation.entityId}`;
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      return { mutation, version };
    });
    const base = {
      accepted: results.map(({ mutation, version }) => ({
        mutationId: mutation.mutationId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        status: 'accepted' as const,
        serverVersion: version,
      })),
      rejected: [],
      resetRequired: false,
      serverTime: new Date().toISOString(),
      ...(supported ? { supportedEntityTypes: supported } : {}),
    };
    if (body.snapshot) {
      return {
        ...base,
        changes: [],
        nextCursor: body.cursor,
        hasMore: false,
        snapshot: {
          boundaryCursor: head,
          items: snapshotItems,
          nextAfter: null,
          hasMore: false,
          complete: true,
          authoritativeEntityTypes: SERVER_AUTHORITATIVE.filter((type) => known.includes(type)),
          prunePolicy: {
            preserveOutboxStatuses: ['pending', 'in_progress', 'failed'] as Array<
              'pending' | 'in_progress' | 'failed'
            >,
            requireExistingSyncMetadata: true,
          },
        },
      };
    }
    const changes: Change[] = [];
    for (const { mutation, version } of results) {
      head += 1;
      changes.push({
        changeId: head,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        operation: mutation.operation,
        version,
        payload: mutation.payload,
        updatedAt: new Date().toISOString(),
        deletedAt: mutation.operation === 'delete' ? new Date().toISOString() : null,
      });
    }
    for (const change of remote.splice(0)) {
      head += 1;
      changes.push({ ...change, changeId: head });
    }
    return {
      ...base,
      changes,
      nextCursor: changes.length > 0 ? head : body.cursor,
      hasMore: false,
    };
  };
  return { requests, respond };
};

const createActiveUser = (id: string): void => {
  const now = new Date().toISOString();
  db.executeSync(
    `INSERT OR IGNORE INTO users (
       id, username, email, role, is_new_user, time_format_24h,
       week_starts_monday, dark_mode, created_at, updated_at
     ) VALUES (?, ?, ?, 'student_pro', 0, 0, 0, 0, ?, ?)`,
    [id, `User ${id}`, `${id}@example.com`, now, now]
  );
  userStore.setCurrentUser(id);
  userStore.saveSessionTokens(id, 'access-token', 'encrypted-refresh-token');
};

const connect = (userId: string, server: ReturnType<typeof fakeServer>): void => {
  createActiveUser(userId);
  jest.spyOn(cloudClient, 'isOnline').mockResolvedValue(true);
  jest.spyOn(cloudClient, 'getAccessToken').mockReturnValue('access-token');
  jest
    .spyOn(accountLinkService, 'refreshCloudProfile')
    .mockImplementation(async (localUserId) => ({
      status: 'success',
      localUserId,
      role: 'student_pro',
      message: 'Profile refreshed.',
    }));
  jest.spyOn(cloudClient, 'request').mockImplementation(async (path, init) => {
    expect(path).toBe('/v1/sync/batch');
    const body = JSON.parse(String(init?.body)) as RequestBody;
    return { status: 'success', data: server.respond(body) as never };
  });
};

const snapshotItem = (
  entityType: SyncEntityType,
  entityId: string,
  payload: Payload,
  version = 1
): Change => ({
  changeId: 10,
  entityType,
  entityId,
  operation: 'update',
  version,
  payload,
  updatedAt: '2026-09-19T02:00:00.000Z',
  deletedAt: null,
});

const meetingPayload = (overrides: Payload = {}): Payload => ({
  title: 'Capstone sync',
  started_at: '2026-09-19T01:00:00.000Z',
  duration_seconds: 95,
  source: 'recording',
  language: 'en',
  status: 'completed',
  transcript: [{ start_ms: 0, end_ms: 4200, text: 'Review the sprint.' }],
  notes: {
    title: 'Capstone sync',
    summary: 'Reviewed the sprint.',
    key_topics: [],
    decisions: ['Ship Friday'],
    action_items: [],
    important_dates: [],
    issues: [],
    unresolved_questions: [],
    key_points: [],
  },
  notes_edited: false,
  ...overrides,
});

describe('study tools in cloud sync', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.executeSync('DELETE FROM active_session');
  });

  describe('stores', () => {
    it('queues flashcard deck creates, edits and soft deletes', () => {
      const user = 'queue-decks';
      flashcardStore.save({
        id: 'deck-q', userId: user, title: 'Biology', sourceName: 'bio.pdf',
        cards: [{ question: 'Q', answer: 'A' }], pageCount: 3, warnings: ['p2 scanned'],
      });
      let [create] = pendingOf(user, 'flashcard_deck');
      expect(create.operation).toBe('create');
      expect(create.payload.cards).toEqual([{ question: 'Q', answer: 'A' }]);

      // An unsent create absorbs later edits.
      flashcardStore.replaceCards('deck-q', [{ question: 'Q2', answer: 'A2' }]);
      [create] = pendingOf(user, 'flashcard_deck');
      expect(create.operation).toBe('create');
      expect((create.payload.cards as Payload[])[0].question).toBe('Q2');

      flashcardStore.remove('deck-q');
      expect(flashcardStore.getDecks(user)).toHaveLength(0);
      expect(pendingOf(user, 'flashcard_deck').map((item) => item.operation)).toEqual([
        'create',
        'delete',
      ]);
    });

    it('syncs pruning the oldest deck as a deletion', () => {
      const user = 'queue-prune';
      for (let index = 0; index <= MAX_STORED_DECKS; index += 1) {
        flashcardStore.save({ id: `prune-${index}`, userId: user, title: `Deck ${index}`, cards: [] });
      }
      expect(flashcardStore.getDecks(user)).toHaveLength(MAX_STORED_DECKS);
      const deletes = pendingOf(user, 'flashcard_deck').filter((item) => item.operation === 'delete');
      expect(deletes).toHaveLength(1);
    });

    it('queues study summaries with their structure', () => {
      const user = 'queue-summaries';
      studyNoteStore.save({
        id: 'sum-q', userId: user, title: 'Thermo', sourceKind: 'pptx', overview: 'Heat.',
        sections: [{ heading: 'Laws', points: ['Energy is conserved.'] }],
        keyTerms: [{ term: 'Entropy', meaning: 'Disorder.' }], markdown: '# Thermo',
      });
      const [create] = pendingOf(user, 'study_summary');
      expect(create.payload.source_kind).toBe('pptx');
      expect(create.payload.sections).toEqual([
        { heading: 'Laws', points: ['Energy is conserved.'] },
      ]);
      studyNoteStore.remove('sum-q');
      expect(studyNoteStore.getSummaries(user)).toHaveLength(0);
    });

    it('gives Pomodoro sessions text ids and syncs settings without the ring sound', () => {
      const user = 'queue-pomodoro';
      const now = Date.now();
      pomodoroStore.logSession(user, 'focus', 25 * 60_000, now, 'Essay');
      const [session] = pomodoroStore.listSessions(user);
      expect(typeof session.id).toBe('string');
      const [create] = pendingOf(user, 'pomodoro_session');
      expect(create.entityId).toBe(session.id);
      expect(create.payload).toEqual({
        phase: 'focus',
        task: 'Essay',
        duration_ms: 25 * 60_000,
        started_at: new Date(now - 25 * 60_000).toISOString(),
        finished_at: new Date(now).toISOString(),
      });

      pomodoroStore.saveSettings(user, {
        ...pomodoroStore.getSettings(user),
        focusMinutes: 50,
        ringSoundUri: 'file:///bell.mp3',
      });
      const [settings] = pendingOf(user, 'pomodoro_settings');
      expect(settings.entityId).toBe('pomodoro_settings');
      expect(settings.payload.focus_minutes).toBe(50);
      expect(settings.payload).not.toHaveProperty('ring_sound_uri');

      pomodoroStore.clearHistory(user);
      expect(pomodoroStore.listSessions(user)).toHaveLength(0);
      expect(pomodoroStore.countFocusToday(user)).toBe(0);
    });

    it('queues a meeting only once it has a transcript', () => {
      const user = 'queue-meetings';
      recordedMeetingStore.create({ id: 'meet-q', userId: user, title: 'Standup' });
      recordedMeetingStore.update('meet-q', { status: 'transcribing' });
      expect(pendingOf(user, 'recorded_meeting')).toHaveLength(0);

      recordedMeetingStore.update('meet-q', {
        status: 'transcription_complete',
        transcript: [{ startMs: 0, endMs: 1000, text: 'Hello team.' }],
      });
      const [update] = pendingOf(user, 'recorded_meeting');
      expect(update.payload.transcript).toEqual([{ start_ms: 0, end_ms: 1000, text: 'Hello team.' }]);

      recordedMeetingStore.remove('meet-q');
      expect(recordedMeetingStore.get('meet-q')).toBeNull();
      expect(pendingOf(user, 'recorded_meeting').at(-1)?.operation).toBe('delete');
    });
  });

  describe('sync passes', () => {
    it('declares its types, opens with a snapshot, then sends the study tools', async () => {
      const user = 'sync-new-server';
      const server = fakeServer();
      connect(user, server);
      flashcardStore.save({ id: 'deck-up', userId: user, title: 'Up', cards: [{ question: 'q', answer: 'a' }] });

      await syncWorker.performSync();

      const [first, second, third] = server.requests;
      expect(first.entityTypes).toEqual(ALL_TYPES);
      expect(first.snapshot).toEqual({});
      expect(first.cursor).toBe(0);
      expect(first.mutations).toEqual([]);
      expect(second.snapshot).toBeUndefined();
      expect(third.mutations.some((mutation) => mutation.entityId === 'deck-up')).toBe(true);
      expect(pendingOf(user)).toHaveLength(0);
      expect([...(syncStateStore.loadEntityTypes(user).snapshotEntityTypes ?? [])].sort()).toEqual(
        [...ALL_TYPES].sort()
      );

      server.requests.length = 0;
      await syncWorker.performSync();
      expect(server.requests[0].snapshot).toBeUndefined();
    });

    it('never sends an older server a study-tool mutation', async () => {
      const user = 'sync-old-server';
      const oldServer = fakeServer({ supported: null });
      connect(user, oldServer);
      flashcardStore.save({ id: 'deck-held', userId: user, title: 'Held', cards: [] });

      await syncWorker.performSync();
      expect(pendingOf(user, 'flashcard_deck')).toHaveLength(1);

      jest.restoreAllMocks();
      const upgraded = fakeServer();
      connect(user, upgraded);
      await syncWorker.performSync();
      expect(pendingOf(user, 'flashcard_deck')).toHaveLength(0);
      await syncWorker.performSync();
      expect(upgraded.requests.some((body) => body.snapshot)).toBe(true);
    });

    it('lands incoming study-tool changes in local tables', async () => {
      const user = 'sync-incoming';
      createActiveUser(user);
      pomodoroStore.saveSettings(user, {
        ...pomodoroStore.getSettings(user),
        ringSoundUri: 'file:///mine.mp3',
        ringSoundName: 'Mine',
      });
      db.executeSync('DELETE FROM sync_outbox WHERE user_id = ?', [user]);
      const server = fakeServer({
        snapshotItems: [
          snapshotItem('flashcard_deck', 'deck-in', {
            title: 'From the laptop', source_name: null, cards: [{ question: 'q', answer: 'a' }],
            page_count: 2, ocr_page_count: 0, warnings: [], created_at: '2026-09-19T00:00:00.000Z',
          }),
          snapshotItem('study_summary', 'sum-in', {
            title: 'Notes', source_name: 'x.pdf', source_kind: 'pdf', overview: 'o',
            sections: [{ heading: 'H', points: ['p'] }], key_terms: [], markdown: '# Notes',
            page_count: 1, warnings: [], created_at: '2026-09-19T00:00:00.000Z',
          }),
          snapshotItem('pomodoro_session', 'pomodoro_in', {
            phase: 'focus', task: 'Read', duration_ms: 1_500_000,
            started_at: '2026-09-19T01:00:00.000Z', finished_at: '2026-09-19T01:25:00.000Z',
          }),
          snapshotItem('pomodoro_settings', 'pomodoro_settings', {
            focus_minutes: 45, short_break_minutes: 10, long_break_minutes: 20,
            long_break_interval: 3, auto_start_breaks: false, auto_start_focus: true,
            sound_enabled: true, volume: 0.5, ring_seconds: 5, notifications_enabled: false,
          }),
          snapshotItem('recorded_meeting', 'meet-in', meetingPayload()),
        ],
      });
      connect(user, server);

      await syncWorker.performSync();

      expect(syncWorker.takeRemoteChangeCount()).toBeGreaterThanOrEqual(5);
      expect(flashcardStore.getDecks(user)[0].title).toBe('From the laptop');
      expect(studyNoteStore.getSummary('sum-in')?.sections[0].heading).toBe('H');
      const [session] = pomodoroStore.listSessions(user);
      expect(session.id).toBe('pomodoro_in');
      expect(session.dayKey).toBe(localDayKey(Date.parse('2026-09-19T01:25:00.000Z')));
      const settings = pomodoroStore.getSettings(user);
      expect(settings.focusMinutes).toBe(45);
      expect(settings.ringSoundUri).toBe('file:///mine.mp3');
      const meeting = recordedMeetingStore.get('meet-in');
      expect(meeting?.hasAudio).toBe(false);
      expect(meeting?.notes?.decisions).toEqual(['Ship Friday']);
      expect(pendingOf(user)).toHaveLength(0);
    });

    it('keeps a meeting this device is still processing', async () => {
      const user = 'sync-busy-meeting';
      recordedMeetingStore.create({ id: 'meet-busy', userId: user, title: 'Local title' });
      recordedMeetingStore.update('meet-busy', { status: 'generating_notes' });
      const server = fakeServer({
        snapshotItems: [
          snapshotItem('recorded_meeting', 'meet-busy', meetingPayload({ title: 'Older copy' })),
        ],
      });
      connect(user, server);

      await syncWorker.performSync();

      const meeting = recordedMeetingStore.get('meet-busy');
      expect(meeting?.status).toBe('generating_notes');
      expect(meeting?.title).toBe('Local title');
    });

    it('does not count its own echoes as remote changes', async () => {
      const user = 'sync-echoes';
      const remote: Change[] = [];
      const server = fakeServer({ remote });
      connect(user, server);
      await syncWorker.performSync();
      syncWorker.takeRemoteChangeCount();

      studyNoteStore.save({ id: 'sum-echo', userId: user, title: 'Mine', sections: [], keyTerms: [], markdown: '' });
      await syncWorker.performSync();
      expect(syncWorker.takeRemoteChangeCount()).toBe(0);

      remote.push(snapshotItem('flashcard_deck', 'deck-remote', {
        title: 'Theirs', cards: [], warnings: [], created_at: '2026-09-19T00:00:00.000Z',
      }));
      await syncWorker.performSync();
      expect(syncWorker.takeRemoteChangeCount()).toBe(1);
    });

    it('keeps requests under the size limit and parks an oversized mutation', async () => {
      const user = 'sync-sizes';
      const server = fakeServer();
      connect(user, server);
      await syncWorker.performSync();
      server.requests.length = 0;

      const bigCards = Array.from({ length: 200 }, (_, index) => ({
        question: `Q${index} ${'x'.repeat(480)}`,
        answer: 'y'.repeat(1990),
      }));
      for (let index = 0; index < 3; index += 1) {
        flashcardStore.save({ id: `big-${index}`, userId: user, title: `Big ${index}`, cards: bigCards });
      }
      syncOutboxStore.enqueueMutation(user, 'note', 'huge-note', 'create', {
        title: 'Huge',
        body: 'z'.repeat(900 * 1024),
      });

      await syncWorker.performSync();

      const sizes = server.requests.map((body) => JSON.stringify(body).length);
      expect(Math.max(...sizes)).toBeLessThan(1024 * 1024);
      expect(pendingOf(user, 'flashcard_deck')).toHaveLength(0);
      const parked = db.executeSync(
        "SELECT status FROM sync_outbox WHERE user_id = ? AND entity_id = 'huge-note'",
        [user]
      ).rows[0];
      expect(parked?.status).toBe('failed');
    });

    it('pushes Pomodoro settings last-write-wins', async () => {
      const user = 'sync-settings-lww';
      const server = fakeServer();
      connect(user, server);
      await syncWorker.performSync();
      syncMetadataStore.upsert(user, {
        entityType: 'pomodoro_settings',
        entityId: 'pomodoro_settings',
        version: 4,
        changeId: 1,
        updatedAt: new Date().toISOString(),
      });
      pomodoroStore.saveSettings(user, { ...pomodoroStore.getSettings(user), focusMinutes: 40 });

      await syncWorker.performSync();

      const sent = server.requests
        .flatMap((body) => body.mutations)
        .find((mutation) => mutation.entityType === 'pomodoro_settings');
      expect(sent).toBeDefined();
      expect(sent).not.toHaveProperty('baseVersion');
    });
  });

  describe('scheduler', () => {
    it('collapses bursts and reports only remote changes', async () => {
      let passes = 0;
      let remoteCalls = 0;
      let nextHasRemote = false;
      const scheduler = createSyncScheduler({
        runPass: async () => {
          passes += 1;
          return nextHasRemote;
        },
        onRemoteChanges: () => {
          remoteCalls += 1;
        },
        debounceMs: 10,
        intervalMs: 1_000_000,
      });
      scheduler.schedule();
      scheduler.schedule();
      scheduler.stop(); // leaving the app must not drop a queued push
      scheduler.schedule();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(passes).toBe(1);
      expect(remoteCalls).toBe(0);

      nextHasRemote = true;
      await scheduler.runNow();
      expect(remoteCalls).toBe(1);
      scheduler.dispose();
    });
  });
});
