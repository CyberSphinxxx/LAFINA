export { db } from './database';
export type { QueryResult, DatabaseTransaction } from './database';
export { initDatabase } from './dbInit';
export {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from './authUtils';
export type { PasswordValidationResult } from './authUtils';
export { userStore } from './userStore';
export type { User } from './userStore';
export { tasksStore } from './tasksStore';
export type { Task, Event } from './tasksStore';
export { notesStore } from './notesStore';
export type { Note } from './notesStore';
export { timeBlocksStore } from './timeBlocksStore';
export type { TimeBlock } from './timeBlocksStore';
export { chatStore } from './chatStore';
export type { ChatAttachment, ChatMessage, ChatSession } from './chatStore';
export { behaviorStore } from './behaviorStore';
export type { BehaviorLog, FeatureSnapshot } from './behaviorStore';
export { completeUserOnboarding } from './onboardingStore';
export {
  getDefaultUserPreferences,
  preferencesStore,
} from './preferencesStore';
export type {
  LongestClassGap,
  SnoozeTendency,
  StoredUserPreferences,
  StudyPeakHour,
  UserPreferences,
  WeeklyClassCount,
} from './preferencesStore';
export { remindersStore } from './remindersStore';
export type { Reminder, ReminderStatus } from './remindersStore';
export { syncOutboxStore } from './syncOutboxStore';
export type { OutboxItem } from './syncOutboxStore';
export { syncMetadataStore } from './syncMetadataStore';
export type { SyncMetadataInput } from './syncMetadataStore';
export { syncConflictStore } from './syncConflictStore';
export type { SyncConflict, SyncConflictInput } from './syncConflictStore';
export { syncStateStore } from './syncStateStore';
export type { PersistedSyncState, SyncStateUpdate } from './syncStateStore';
export { businessStore } from './businessStore';
export type {
  LocalBusiness,
  LocalBusinessMembership,
  LocalBusinessInvitation,
  CachedCapabilities,
} from './businessStore';
export { businessTasksStore } from './businessTasksStore';
export type { CreateBusinessTaskParams } from './businessTasksStore';
export { businessWorkBlocksStore } from './businessWorkBlocksStore';
export type { CreateBusinessWorkBlockParams } from './businessWorkBlocksStore';
export { businessChatStore } from './businessChatStore';
export type {
  PersistedSyncStatus,
  SyncEntityType,
  SyncOperation,
  SyncPayload,
  SyncScopeType,
  SystemRole,
  SubscriptionPlan,
  BusinessMemberRole,
  MembershipStatus,
  BusinessSession,
  TaskPriority,
  TaskAssignmentStatus,
  ManagerReviewStatus,
  BusinessTaskRow,
  BusinessTaskAssignmentRow,
  BusinessWorkBlockRow,
  BusinessTaskWithAssignments,
  DeliveryStatus,
  BusinessChatChannelRow,
  BusinessChatMessageRow,
  BusinessTaskCommentRow,
  LocalBusinessMeetingRow,
  LocalBusinessMeetingSegmentRow,
  LocalBusinessActionCandidateRow,
  LocalBusinessMeetingRecipientRow,
  LocalGmailConnectionRow,
  LocalGmailThreadCacheRow,
  LocalGmailMessageCacheRow,
  LocalGmailDraftRow,
  GmailAttachmentInfo,
} from './syncTypes';
export { meetingStore } from './meetingStore';
export { gmailStore } from './gmailStore';
export type { CacheThreadInput, CacheMessageInput, SaveDraftInput } from './gmailStore';
export {
  seedLocalDemoAccounts,
  DEMO_IDS,
  DEMO_CREDENTIALS,
} from './demoSeed';


// Study tools (schema 16), shared with LAFINA desktop.
export { pomodoroStore } from './pomodoroStore';
export type { PomodoroSessionRow } from './pomodoroStore';
export {
  applySettingsToRuntime,
  clampSettings,
  completePhase,
  DEFAULT_POMODORO_SETTINGS,
  DIAL_SWEEP_MINUTES,
  formatDuration,
  idleRuntime,
  minutesToAngle,
  pointToMinutes,
  nextPhaseAfter,
  pauseRuntime,
  phaseDurationMs,
  PHASE_LABELS,
  remainingMs,
  resetCycle,
  resetRuntime,
  restoreRuntime,
  startRuntime,
  switchPhase,
  AWAY_THRESHOLD_MS,
  MAX_INTERVAL,
  MAX_MINUTES,
  MAX_RING_SECONDS,
  MIN_INTERVAL,
  MIN_MINUTES,
  MIN_RING_SECONDS,
} from './pomodoroEngine';
export type {
  PhaseCompletion,
  PomodoroPhase,
  PomodoroRuntime,
  PomodoroSettings,
  RestoredRuntime,
} from './pomodoroEngine';
export { flashcardStore, MAX_STORED_DECKS } from './flashcardStore';
export { studyNoteStore, MAX_STORED_SUMMARIES } from './studyNoteStore';
export { recordedMeetingStore } from './recordedMeetingStore';
export type { RecordedMeeting, MeetingPatch } from './recordedMeetingStore';
export type { StudySummaryRecord, SaveSummaryInput } from './studyNoteStore';
export type { FlashcardDeck, SaveDeckInput } from './flashcardStore';
export { localSettingsStore } from './localSettingsStore';
export { productTourStore, PRODUCT_TOUR_VERSION } from './productTourStore';
