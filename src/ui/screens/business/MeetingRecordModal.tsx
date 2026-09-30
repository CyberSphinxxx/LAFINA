import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  Mic,
  Square,
  Pause,
  Play,
  X,
  HardDrive,
  CheckCircle,
} from 'lucide-react-native';
import { meetingRecorder } from '../../../ai/native/meetingRecorder';
import { transcribeMeetingChunks } from '../../../ai/meeting/meetingTranscriber';
import { extractActionCandidates } from '../../../ai/meeting/actionCandidateExtractor';
import { meetingStore } from '../../../storage';
import { generateId } from '../../../utils';
import { LocalBusinessMeetingRow } from '../../../storage/syncTypes';

interface MeetingRecordModalProps {
  visible: boolean;
  businessId: string;
  userId: string;
  roster?: Array<{ id: string; name: string; email: string }>;
  onClose: () => void;
  onMeetingRecorded?: (meetingId: string) => void;
}

export const MeetingRecordModal: React.FC<MeetingRecordModalProps> = ({
  visible,
  businessId,
  userId,
  roster = [],
  onClose,
  onMeetingRecorded,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [title, setTitle] = useState('Weekly Team Sync');
  const [meetingState, setMeetingState] = useState<'idle' | 'recording' | 'paused' | 'transcribing' | 'completed'>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [keepAudio, setKeepAudio] = useState(false);
  const [availableStorageMB, setAvailableStorageMB] = useState(1024);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeChunkInfo, setTranscribeChunkInfo] = useState({ current: 0, total: 0 });
  const [createdMeetingId, setCreatedMeetingId] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentMeetingIdRef = useRef<string>(generateId('meet'));

  useEffect(() => {
    if (visible) {
      currentMeetingIdRef.current = generateId('meet');
      setMeetingState('idle');
      setElapsedSeconds(0);
      setTranscribeProgress(0);
      checkStorage();
    } else {
      stopTimer();
    }
    return () => stopTimer();
  }, [visible]);

  const checkStorage = async () => {
    try {
      const mb = await meetingRecorder.getAvailableStorageMB();
      setAvailableStorageMB(Math.round(mb));
    } catch {}
  };

  const startTimer = () => {
    stopTimer();
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        if (prev >= 3600) {
          handleStop();
          return 3600;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleStart = async () => {
    try {
      if (!(await meetingRecorder.requestPermission())) {
        Alert.alert('Microphone needed', 'Allow microphone access to record the meeting.');
        return;
      }
      const meetingId = currentMeetingIdRef.current;
      await meetingRecorder.start(meetingId, title.trim() || 'Meeting');
      setMeetingState('recording');
      startTimer();
    } catch (err) {
      console.warn('[MeetingRecordModal] Start failed:', err);
      Alert.alert('Error', 'Failed to start meeting recording service.');
    }
  };

  const handlePause = async () => {
    try {
      await meetingRecorder.pause();
      setMeetingState('paused');
      stopTimer();
    } catch (err) {
      console.warn('[MeetingRecordModal] Pause failed:', err);
    }
  };

  const handleResume = async () => {
    try {
      await meetingRecorder.resume();
      setMeetingState('recording');
      startTimer();
    } catch (err) {
      console.warn('[MeetingRecordModal] Resume failed:', err);
    }
  };

  const handleStop = async () => {
    stopTimer();
    setMeetingState('transcribing');

    try {
      const session = await meetingRecorder.stop();
      const meetingId = currentMeetingIdRef.current;
      const finalTitle = title.trim() || 'Meeting';
      const now = new Date().toISOString();

      // 1. Run on-device chunked transcription with Whisper.cpp
      const transResult = await transcribeMeetingChunks({
        meetingId,
        chunkFiles: session.chunkFiles || [],
        keepAudio,
        onProgress: (prog, curr, tot) => {
          setTranscribeProgress(prog);
          setTranscribeChunkInfo({ current: curr, total: tot });
        },
      });

      // 2. Extract Action Candidates
      const candidates = extractActionCandidates(meetingId, transResult.segments, roster);

      // 3. Save meeting to local SQLite
      const meetingRow: LocalBusinessMeetingRow = {
        id: meetingId,
        business_id: businessId,
        created_by: userId,
        title: finalTitle,
        duration_seconds: session.durationSeconds || elapsedSeconds,
        full_transcript: transResult.fullTranscript,
        summary_json: null,
        summary_status: 'not_requested',
        keep_audio: keepAudio ? 1 : 0,
        created_at: now,
        updated_at: now,
      };

      const segmentRows = transResult.segments.map((s) => ({
        id: s.id,
        meeting_id: meetingId,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        text: s.text,
        speaker: s.speaker || null,
        created_at: now,
      }));

      const candidateRows = candidates.map((c) => ({
        id: c.id,
        meeting_id: meetingId,
        title: c.title,
        instructions: c.instructions,
        suggested_assignee_id: c.suggested_assignee_id,
        suggested_assignee_name: c.suggested_assignee_name,
        suggested_due_date: c.suggested_due_date,
        status: c.status,
        created_task_id: c.created_task_id,
        created_at: c.created_at,
      }));

      meetingStore.saveMeeting(meetingRow, segmentRows, candidateRows, []);

      setCreatedMeetingId(meetingId);
      setMeetingState('completed');

      if (onMeetingRecorded) {
        onMeetingRecorded(meetingId);
      }
    } catch (err) {
      console.warn('[MeetingRecordModal] Transcription failed:', err);
      Alert.alert('Transcription Error', 'Failed to process meeting audio.');
      setMeetingState('idle');
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, themed.container]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={[styles.title, themed.text]}>1-Hour Meeting Transcription</Text>
            {meetingState === 'idle' && (
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <X size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Idle Setup View */}
          {meetingState === 'idle' && (
            <View style={styles.contentSection}>
              <Text style={[styles.label, themed.mutedText]}>Meeting Title</Text>
              <TextInput
                style={[styles.input, themed.input]}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Firmware Design Review"
                placeholderTextColor={colors.textMuted}
              />

              <View style={styles.infoRow}>
                <View style={styles.infoItem}>
                  <HardDrive size={15} color={colors.blue} />
                  <Text style={[styles.infoText, themed.mutedText]}>
                    {availableStorageMB} MB available
                  </Text>
                </View>
              </View>

              <View style={[styles.toggleRow, themed.toggleRow]}>
                <View style={styles.toggleTextCol}>
                  <Text style={[styles.toggleTitle, themed.text]}>Keep Raw Audio Files</Text>
                  <Text style={[styles.toggleSubtitle, themed.mutedText]}>
                    Default: auto-deletes audio after transcription to save disk space.
                  </Text>
                </View>
                <Switch
                  value={keepAudio}
                  onValueChange={setKeepAudio}
                  trackColor={{ false: '#D1D5DB', true: colors.blue }}
                  thumbColor="#FFF"
                />
              </View>

              <TouchableOpacity
                style={[styles.startRecordBtn, { backgroundColor: colors.red }]}
                onPress={handleStart}
              >
                <Mic size={20} color="#FFF" />
                <Text style={styles.startRecordText}>Start Meeting Recording</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Active Recording / Paused View */}
          {(meetingState === 'recording' || meetingState === 'paused') && (
            <View style={styles.activeSection}>
              <View
                style={[
                  styles.pulseCircle,
                  meetingState === 'recording'
                    ? { borderColor: colors.red, backgroundColor: colors.red + '15' }
                    : { borderColor: colors.yellow, backgroundColor: colors.yellow + '15' },
                ]}
              >
                <Mic
                  size={36}
                  color={meetingState === 'recording' ? colors.red : colors.yellow}
                />
              </View>

              <Text style={[styles.timerText, themed.text]}>{formatTimer(elapsedSeconds)}</Text>
              <Text style={[styles.recordingTitle, themed.mutedText]}>{title}</Text>

              <Text style={[styles.foregroundNotice, themed.mutedText]}>
                Foreground Microphone Service active. Long recordings run in background up to 60m.
              </Text>

              {/* Controls */}
              <View style={styles.controlsRow}>
                {meetingState === 'recording' ? (
                  <TouchableOpacity
                    style={[styles.controlBtn, themed.outlineBtn]}
                    onPress={handlePause}
                  >
                    <Pause size={20} color={colors.textPrimary} />
                    <Text style={[styles.controlBtnText, themed.text]}>Pause</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.controlBtn, themed.outlineBtn]}
                    onPress={handleResume}
                  >
                    <Play size={20} color={colors.success} />
                    <Text style={[styles.controlBtnText, { color: colors.success }]}>Resume</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.stopBtn, { backgroundColor: colors.red }]}
                  onPress={handleStop}
                >
                  <Square size={20} color="#FFF" />
                  <Text style={styles.stopBtnText}>Stop & Transcribe</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Transcribing Progress View */}
          {meetingState === 'transcribing' && (
            <View style={styles.transcribingSection}>
              <ActivityIndicator size="large" color={colors.blue} />
              <Text style={[styles.transcribingTitle, themed.text]}>
                On-Device Transcription in Progress...
              </Text>
              <Text style={[styles.transcribingSubtitle, themed.mutedText]}>
                Running offline Whisper.cpp on recorded audio chunks.
              </Text>
              {transcribeChunkInfo.total > 0 && (
                <Text style={[styles.chunkProgressText, { color: colors.blue }]}>
                  Processing chunk {transcribeChunkInfo.current} of {transcribeChunkInfo.total} (
                  {Math.round(transcribeProgress * 100)}%)
                </Text>
              )}
            </View>
          )}

          {/* Completed View */}
          {meetingState === 'completed' && (
            <View style={styles.completedSection}>
              <CheckCircle size={44} color={colors.success} />
              <Text style={[styles.completedTitle, themed.text]}>
                Meeting Transcribed Successfully!
              </Text>
              <Text style={[styles.completedSubtitle, themed.mutedText]}>
                Action commands extracted with timestamps.
              </Text>
              <TouchableOpacity
                style={[styles.viewMeetingBtn, { backgroundColor: colors.blue }]}
                onPress={() => {
                  onClose();
                  if (createdMeetingId && onMeetingRecorded) {
                    onMeetingRecorded(createdMeetingId);
                  }
                }}
              >
                <Text style={styles.viewMeetingBtnText}>View Meeting Details</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  container: {
    backgroundColor: colors.cardBg,
  },
  input: {
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    borderColor: colors.border,
  },
  toggleRow: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  outlineBtn: {
    borderColor: colors.border,
  },
  text: {
    color: colors.textPrimary,
  },
  mutedText: {
    color: colors.textMuted,
  },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    ...Shadows.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 6,
  },
  contentSection: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: Fonts.body,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 4,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 4,
  },
  toggleTextCol: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  toggleSubtitle: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  startRecordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  startRecordText: {
    color: '#FFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  activeSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  pulseCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  timerText: {
    fontSize: 32,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  recordingTitle: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
    marginBottom: 8,
  },
  foregroundNotice: {
    fontSize: 11,
    fontFamily: Fonts.body,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  controlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  controlBtnText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  stopBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  stopBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  transcribingSection: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  transcribingTitle: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginTop: 8,
  },
  transcribingSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  chunkProgressText: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  completedSection: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  completedTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginTop: 8,
  },
  completedSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginBottom: 12,
  },
  viewMeetingBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  viewMeetingBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
});
