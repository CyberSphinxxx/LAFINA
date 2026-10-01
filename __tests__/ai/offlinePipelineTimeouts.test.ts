/**
 * Chaos tests for wedged offline models.
 *
 * Whisper.cpp and SmolLM2 both run through JSI. If a native call never settles the
 * promise chain used to hang forever, leaving the voice sheet spinning with the
 * microphone still owned. Every stage now has a hard budget and always settles.
 */
import { NativeModules, PermissionsAndroid } from 'react-native';
import { runLocalLlmChat, runOfflineVoiceScheduling } from '../../src/ai/native/voicePipeline';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  const never = (): Promise<never> => new Promise(() => undefined);
  rn.NativeModules.LafinaSpeechToText = {
    startListening: jest.fn(never),
    stopListening: jest.fn().mockResolvedValue(true),
    cancelListening: jest.fn().mockResolvedValue(true),
  };
  rn.NativeModules.LafinaIntentExtractor = {
    extractIntentJson: jest.fn(never),
  };
  rn.PermissionsAndroid.request = jest.fn().mockResolvedValue('granted');
  return rn;
});

const startListeningMock = NativeModules.LafinaSpeechToText.startListening as jest.Mock;
const extractIntentMock = NativeModules.LafinaIntentExtractor.extractIntentJson as jest.Mock;

describe('offline pipeline hard timeouts', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM users');
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()],
    );
    startListeningMock.mockClear();
    extractIntentMock.mockClear();
    PermissionsAndroid.request = jest.fn().mockResolvedValue('granted');
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('gives up on a Whisper capture that never returns', async () => {
    startListeningMock.mockImplementation(() => new Promise(() => undefined));

    const pending = runOfflineVoiceScheduling('user1');
    await jest.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.errorCode).toBe('processing_failed');
    expect(result.didUpdate).toBe(false);
    expect(result.transcript).toBe('');
    expect(result.reply).toContain('could not process that speech command');
  });

  it('gives up on an intent extraction that never returns', async () => {
    startListeningMock.mockImplementation(
      (options: { captureId: string }) =>
        Promise.resolve({
          captureId: options.captureId,
          transcript: 'tell me about my week',
          speechDetected: true,
          cancelled: false,
          captureDurationMs: 1_500,
          inferenceDurationMs: 600,
        }),
    );
    extractIntentMock.mockImplementation(() => new Promise(() => undefined));

    const pending = runOfflineVoiceScheduling('user1');
    await jest.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.errorCode).toBe('processing_failed');
    expect(result.didUpdate).toBe(false);
    expect(result.nluResult).toBeNull();
  });

  it('falls back to the deterministic parser when the chat model hangs', async () => {
    extractIntentMock.mockImplementation(() => new Promise(() => undefined));

    const pending = runLocalLlmChat('tell me about my week', 'user1');
    await jest.advanceTimersByTimeAsync(15_000);
    const reply = await pending;

    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});
