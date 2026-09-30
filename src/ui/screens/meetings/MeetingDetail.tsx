import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AudioLines, FileText, NotebookPen, RefreshCw, Share2, Sparkles, Trash2 } from 'lucide-react-native';
import { notesStore } from '../../../storage';
import type { RecordedMeeting } from '../../../storage';
import { generateId } from '../../../utils';
import { STATUS_LABELS, isBusy, notesToMarkdown, transcriptToText } from '../../../meetings';
import { formatWhen, shareTextFile } from '../../components/tools';
import { useMeetings } from '../../contexts/MeetingsContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Spacing } from '../../theme';
import { describeMeetingProblem, formatBytes, formatDuration, meetingFileName } from './meetingCopy';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';
import { NotesView } from './NotesView';
import { ProcessingCard } from './ProcessingCard';
import { TranscriptList } from './TranscriptList';

type Tab = 'notes' | 'transcript';

interface ActionButton {
  key: string;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
  primary?: boolean;
  destructive?: boolean;
}

/**
 * One meeting: its notes, its transcript, and what can be done next.
 *
 * The actions offered follow from what exists: a recording can be
 * transcribed, a transcript can be turned into notes, notes can be written
 * again. There is never a button for a step that cannot run.
 */
export const MeetingDetail: React.FC<{ meeting: RecordedMeeting; onNotesSaved?: () => void }> = ({
  meeting,
  onNotesSaved,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const {
    transcribeMeeting,
    generateNotes,
    renameMeeting,
    saveNotes,
    deleteAudio,
    entitled,
    processing,
    cancelProcessing,
  } = useMeetings();
  const [tab, setTab] = useState<Tab>(meeting.notes ? 'notes' : 'transcript');
  const [title, setTitle] = useState(meeting.title);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setTitle(meeting.title);
  }, [meeting.id, meeting.title]);

  const hasNotes = Boolean(meeting.notes);
  useEffect(() => {
    setTab(hasNotes ? 'notes' : 'transcript');
    setStatus(null);
  }, [meeting.id, hasNotes]);

  const busy = isBusy(meeting.status) || processing !== null;
  // A meeting that arrived by sync has its audio on the device that recorded it.
  const hasAudio = meeting.hasAudio && meeting.audioBytes > 0 && meeting.errorCode !== 'recording_lost';
  const hasTranscript = Boolean(meeting.transcript?.length);
  const error = meeting.errorCode ? describeMeetingProblem(meeting.errorCode, meeting.errorDetail ?? undefined) : null;
  // Waiting on a plan is not something having gone wrong.
  const isNotice = meeting.errorCode === 'plan_required';
  const meta = { title: meeting.title, recordedAt: meeting.startedAt, durationSeconds: meeting.durationSeconds };

  const confirmThen = (heading: string, message: string, label: string, action: () => void): void => {
    Alert.alert(heading, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, onPress: action },
    ]);
  };

  const handleRecovery = (): void => {
    if (!error) return;
    switch (error.recovery) {
      case 'retry_transcription':
        void transcribeMeeting(meeting.id);
        break;
      case 'retry_notes':
        void generateNotes(meeting.id);
        break;
      case 'view_transcript':
        setTab('transcript');
        break;
      case 'open_privacy_settings':
        void Linking.openSettings();
        break;
      default:
        break;
    }
  };

  const share = async (kind: 'notes' | 'transcript'): Promise<void> => {
    const outcome =
      kind === 'notes' && meeting.notes
        ? await shareTextFile({
            fileName: meetingFileName(meeting.title, 'md'),
            contents: notesToMarkdown(meeting.notes, meta),
            title: 'Share meeting notes',
            mimeType: 'text/markdown',
          })
        : await shareTextFile({
            fileName: meetingFileName(`${meeting.title} transcript`, 'txt'),
            contents: `${meeting.title}\n${formatWhen(meeting.startedAt)}\n\n${transcriptToText(meeting.transcript ?? [], {
              timestamps: true,
            })}\n`,
            title: 'Share transcript',
          });
    if (outcome === 'failed') setStatus('That could not be shared.');
  };

  const saveToNotes = (): void => {
    if (!meeting.notes) return;
    try {
      notesStore.insert({
        id: generateId('note'),
        userId: meeting.userId,
        title: meeting.title.slice(0, 120) || 'Meeting notes',
        // Mobile notes are the light markdown dialect; the desktop turns this
        // into rich text when it opens the note.
        body: notesToMarkdown(meeting.notes, meta),
        category: 'Work',
        isPinned: false,
        tags: ['Meeting'],
        isVoiceTranscribed: false,
      });
      setStatus('Added to your notes, under Work.');
      onNotesSaved?.();
    } catch (saveError) {
      console.error('[Meetings] Could not save to Notes:', saveError);
      setStatus('These notes could not be saved to Notes.');
    }
  };

  const actions: ActionButton[] = [];
  if (hasAudio && !hasTranscript) {
    actions.push({ key: 'transcribe', label: 'Transcribe', icon: AudioLines, primary: true, onPress: () => void transcribeMeeting(meeting.id) });
  }
  if (hasTranscript && !hasNotes && entitled) {
    actions.push({ key: 'notes', label: 'Generate notes', icon: Sparkles, primary: true, onPress: () => void generateNotes(meeting.id) });
  }
  if (hasNotes && entitled) {
    actions.push({
      key: 'regenerate',
      label: 'Regenerate notes',
      icon: Sparkles,
      onPress: () =>
        meeting.notesEdited
          ? confirmThen('Regenerate notes?', 'New notes will replace your edited ones.', 'Regenerate', () => void generateNotes(meeting.id))
          : void generateNotes(meeting.id),
    });
  }
  if (hasAudio && hasTranscript) {
    actions.push({
      key: 'retranscribe',
      label: 'Transcribe again',
      icon: RefreshCw,
      onPress: () =>
        confirmThen(
          'Transcribe again?',
          'The new transcript replaces this one, and the notes are written again to match it.',
          'Transcribe again',
          () => void transcribeMeeting(meeting.id),
        ),
    });
  }
  if (hasNotes) {
    actions.push({ key: 'save', label: 'Save to Notes', icon: NotebookPen, onPress: saveToNotes });
    actions.push({ key: 'share-notes', label: 'Share notes', icon: Share2, onPress: () => void share('notes') });
  }
  if (hasTranscript) {
    actions.push({ key: 'share-transcript', label: 'Share transcript', icon: FileText, onPress: () => void share('transcript') });
  }
  if (hasAudio) {
    actions.push({
      key: 'delete-audio',
      label: `Delete audio (${formatBytes(meeting.audioBytes)})`,
      icon: Trash2,
      destructive: true,
      onPress: () =>
        Alert.alert(
          'Delete the audio?',
          hasTranscript
            ? 'The recording is removed from this phone to free space. The transcript and notes stay, but the meeting cannot be transcribed again.'
            : 'The recording is removed from this phone. It has not been transcribed yet, so nothing of this meeting will be left but its title.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete audio', style: 'destructive', onPress: () => void deleteAudio(meeting.id) },
          ],
        ),
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextInput
        style={[styles.title, themed.textPrimary]}
        value={title}
        onChangeText={setTitle}
        onEndEditing={() => (title.trim() && title !== meeting.title ? renameMeeting(meeting.id, title) : setTitle(meeting.title))}
        maxLength={160}
        accessibilityLabel="Meeting title"
        editable={!isBusy(meeting.status)}
      />
      <View style={[meetingStyles.buttonRow, styles.meta]}>
        <Text style={[meetingStyles.small, themed.textSecondary]}>
          {formatWhen(meeting.startedAt)} · {formatDuration(meeting.durationSeconds)}
        </Text>
        <View style={[meetingStyles.chip, meeting.status === 'error' ? themed.chipError : themed.chip]}>
          <Text style={[meetingStyles.chipLabel, themed.textPrimary]}>{STATUS_LABELS[meeting.status]}</Text>
        </View>
        {meeting.recovered && (
          <View style={[meetingStyles.chip, themed.chip]}>
            <Text style={[meetingStyles.chipLabel, themed.textPrimary]}>Recovered after close</Text>
          </View>
        )}
        {!meeting.hasAudio && (
          <View style={[meetingStyles.chip, themed.chip]}>
            <Text style={[meetingStyles.chipLabel, themed.textPrimary]}>Recorded on another device</Text>
          </View>
        )}
      </View>

      {processing?.meetingId === meeting.id && <ProcessingCard processing={processing} onCancel={cancelProcessing} />}

      {error && meeting.errorCode !== 'cancelled' && processing?.meetingId !== meeting.id && (
        <View
          style={[meetingStyles.banner, isNotice ? themed.banner : themed.bannerError]}
          accessibilityRole={isNotice ? 'text' : 'alert'}
        >
          <Text style={[meetingStyles.bannerTitle, themed.textPrimary]}>{error.title}</Text>
          <Text style={[meetingStyles.small, themed.textPrimary]}>{error.message}</Text>
          {error.recovery !== 'none' &&
            error.recovery !== 'sign_in' &&
            error.recoveryLabel &&
            !(error.recovery === 'view_transcript' && tab === 'transcript') &&
            !(error.recovery === 'retry_transcription' && !hasAudio) && (
              <TouchableOpacity
                style={[meetingStyles.secondaryButton, themed.secondaryButton, styles.recovery, busy && meetingStyles.disabled]}
                onPress={handleRecovery}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>{error.recoveryLabel}</Text>
              </TouchableOpacity>
            )}
        </View>
      )}

      {meeting.status === 'cancelled' && !meeting.errorCode && processing?.meetingId !== meeting.id && (
        <View style={[meetingStyles.banner, themed.banner]}>
          <Text style={[meetingStyles.bannerTitle, themed.textPrimary]}>Processing was cancelled</Text>
          <Text style={[meetingStyles.small, themed.textPrimary]}>Nothing finished so far was thrown away.</Text>
        </View>
      )}

      {actions.length > 0 && (
        <View style={[meetingStyles.buttonRow, styles.actions]}>
          {actions.map(({ key, label, icon: Icon, onPress, primary, destructive }) => {
            const disabled = busy && key !== 'save' && !key.startsWith('share');
            const tint = primary ? colors.white : destructive ? colors.error : colors.textPrimary;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  primary ? meetingStyles.primaryButton : meetingStyles.secondaryButton,
                  primary ? themed.primaryButton : themed.secondaryButton,
                  destructive && themed.dangerButton,
                  primary && styles.primaryAction,
                  disabled && meetingStyles.disabled,
                ]}
                onPress={onPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
              >
                <Icon size={16} color={tint} />
                <Text
                  style={[
                    primary ? meetingStyles.primaryLabel : meetingStyles.secondaryLabel,
                    primary ? themed.onAccent : destructive ? themed.errorText : themed.textPrimary,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {status ? <Text style={[meetingStyles.small, styles.status, themed.textSecondary]}>{status}</Text> : null}

      <View style={[styles.tabs, themed.divider]} accessibilityRole="tablist">
        {(['notes', 'transcript'] as const).map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && [styles.tabActive, themed.tabActive]]}
            onPress={() => setTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.tabLabel, tab === key ? themed.textPrimary : themed.textMuted]}>
              {key === 'notes' ? 'Notes' : 'Transcript'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'notes' ? (
        meeting.notes ? (
          <NotesView notes={meeting.notes} edited={meeting.notesEdited} onSave={(notes) => saveNotes(meeting.id, notes)} />
        ) : (
          <Text style={[meetingStyles.body, styles.empty, themed.textSecondary]}>
            {!hasTranscript
              ? 'Notes are written once the meeting has been transcribed.'
              : entitled
                ? 'No notes yet. Generate them from the transcript.'
                : 'AI notes are part of Student Pro. The full transcript is in the Transcript tab.'}
          </Text>
        )
      ) : (
        <TranscriptList segments={meeting.transcript ?? []} language={meeting.language} model={meeting.whisperModel} />
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingBottom: 140,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.title,
    fontWeight: 'bold',
    paddingVertical: Spacing.xs,
    paddingHorizontal: 0,
  },
  meta: {
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  recovery: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
  },
  actions: {
    marginBottom: Spacing.md,
  },
  primaryAction: {
    paddingVertical: Spacing.sm,
  },
  status: {
    marginBottom: Spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.md,
  },
  tab: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomWidth: 2,
  },
  tabLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    fontWeight: 'bold',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
