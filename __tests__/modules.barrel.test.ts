import * as ai from '../src/ai';
import * as nluTypes from '../src/ai/nlu/types';
import * as scheduler from '../src/scheduler';
import * as storage from '../src/storage';

/**
 * The barrel modules are the public surface every screen imports. Loading them
 * here both documents that surface and keeps the module graph wired correctly.
 */
describe('public module barrels', () => {
  it('exposes the on-device AI entry points', () => {
    expect(typeof ai.parseNluJson).toBe('function');
    expect(typeof ai.buildNluPrompt).toBe('function');
    expect(typeof ai.createFallbackNluResult).toBe('function');
    expect(typeof ai.processCommand).toBe('function');
    expect(typeof ai.normalizeTranscript).toBe('function');
    expect(typeof ai.applyNluScheduleResult).toBe('function');
    expect(typeof ai.hasOfflineVoiceRuntime).toBe('function');
    expect(typeof ai.runLocalLlmChat).toBe('function');
    expect(typeof ai.runOfflineVoiceScheduling).toBe('function');
    expect(typeof ai.isTtsAvailable).toBe('function');
    expect(typeof ai.synthesizeSpeech).toBe('function');
    expect(typeof ai.playSpeechFile).toBe('function');
    expect(typeof ai.speakTextWithTts).toBe('function');
    expect(typeof ai.preCacheReminderAudio).toBe('function');
    // The NLU schema module is type-only, so it must still resolve at runtime.
    expect(nluTypes).toBeDefined();
  });

  it('exposes the local storage stores', () => {
    expect(storage.db).toBeDefined();
    expect(typeof storage.initDatabase).toBe('function');
    expect(typeof storage.hashPassword).toBe('function');
    expect(typeof storage.verifyPassword).toBe('function');
    expect(typeof storage.normalizeEmail).toBe('function');
    expect(typeof storage.validatePassword).toBe('function');
    expect(storage.MIN_PASSWORD_LENGTH).toBeGreaterThan(0);
    expect(storage.MAX_PASSWORD_LENGTH).toBeGreaterThan(
      storage.MIN_PASSWORD_LENGTH,
    );
    expect(storage.userStore).toBeDefined();
    expect(storage.tasksStore).toBeDefined();
    expect(storage.notesStore).toBeDefined();
    expect(storage.timeBlocksStore).toBeDefined();
    expect(storage.chatStore).toBeDefined();
    expect(storage.behaviorStore).toBeDefined();
    expect(storage.remindersStore).toBeDefined();
    expect(storage.preferencesStore).toBeDefined();
    expect(typeof storage.completeUserOnboarding).toBe('function');
    expect(typeof storage.getDefaultUserPreferences).toBe('function');
  });

  it('exposes the offline scheduler surface', () => {
    expect(typeof scheduler.startSchedulerDaemon).toBe('function');
    expect(typeof scheduler.stopSchedulerDaemon).toBe('function');
    expect(typeof scheduler.checkAndTriggerReminders).toBe('function');
    expect(typeof scheduler.getReminderPreferences).toBe('function');
    expect(typeof scheduler.answerCall).toBe('function');
    expect(typeof scheduler.declineCall).toBe('function');
    expect(typeof scheduler.disconnectCall).toBe('function');
    expect(typeof scheduler.speakText).toBe('function');
    expect(typeof scheduler.autoSnoozeCall).toBe('function');
    expect(typeof scheduler.manualSnoozeCall).toBe('function');
    expect(typeof scheduler.manualAcknowledgeCall).toBe('function');
    expect(typeof scheduler.prepareCallSpeech).toBe('function');
    expect(typeof scheduler.scheduleReminderAlarm).toBe('function');
    expect(typeof scheduler.cancelReminderAlarm).toBe('function');
    expect(typeof scheduler.consumePendingNativeCall).toBe('function');
    expect(typeof scheduler.finishNativeIncomingCall).toBe('function');
    expect(typeof scheduler.getReminderPermissionStatus).toBe('function');
    expect(typeof scheduler.openExactAlarmSettings).toBe('function');
    expect(typeof scheduler.openFullScreenIntentSettings).toBe('function');
    expect(typeof scheduler.reconcileReminderAlarms).toBe('function');
    expect(typeof scheduler.snoozeReminderAction).toBe('function');
    expect(typeof scheduler.acknowledgeReminderAction).toBe('function');
    expect(typeof scheduler.autoSnoozeReminderAction).toBe('function');
    expect(typeof scheduler.refreshPendingReminderLeadTimes).toBe('function');
    expect(typeof scheduler.defaultCallSpeechProvider.speakText).toBe(
      'function',
    );
  });
});
