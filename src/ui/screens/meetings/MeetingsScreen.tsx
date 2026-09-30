import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Info, Trash2, Users } from 'lucide-react-native';
import { STATUS_LABELS, isBusy } from '../../../meetings';
import type { RecordedMeeting } from '../../../storage';
import { formatWhen, ProFeaturePanel, ToolScreenHeader, ToolSheet, useToolBack } from '../../components/tools';
import type { RegisterToolBack } from '../../components/tools';
import { useMeetings } from '../../contexts/MeetingsContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Spacing } from '../../theme';
import { formatDuration } from './meetingCopy';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';
import { MeetingDetail } from './MeetingDetail';
import { PrivacyNotice } from './PrivacyNotice';
import { RecorderCard } from './RecorderCard';

interface MeetingsScreenProps {
  onBack: () => void;
  registerBack?: RegisterToolBack;
  /** Called after a meeting's notes were added to the Notes screen. */
  onNotesSaved?: () => void;
}

/**
 * Record a meeting, and come back to it.
 *
 * The recorder sits above the history. Opening a meeting shows its notes and
 * transcript; when processing starts, the screen follows it there.
 */
export const MeetingsScreen: React.FC<MeetingsScreenProps> = ({ onBack, registerBack, onNotesSaved }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const { meetings, recorder, processing, deleteMeeting, entitled, available } = useMeetings();
  const [openId, setOpenId] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Follow the work: when a meeting starts processing, show it.
  const processingId = processing?.meetingId;
  useEffect(() => {
    if (processingId) setOpenId(processingId);
  }, [processingId]);

  const open = useMemo(() => meetings.find((meeting) => meeting.id === openId) ?? null, [meetings, openId]);
  // A meeting deleted here or on another device falls back to the list.
  useEffect(() => {
    if (openId && !open) setOpenId(null);
  }, [openId, open]);

  const closeMeeting = useCallback((): boolean => {
    setOpenId(null);
    return true;
  }, []);
  useToolBack(registerBack, openId ? closeMeeting : null);

  const confirmDelete = (meeting: RecordedMeeting): void => {
    Alert.alert(
      'Delete this meeting?',
      `“${meeting.title}”, its recording, transcript and notes, is deleted. A transcript that synced is removed from your other devices too. Anything saved into Notes or shared is kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete meeting',
          style: 'destructive',
          onPress: () => {
            void deleteMeeting(meeting.id);
            setOpenId(null);
          },
        },
      ],
    );
  };

  const privacySheet = (
    <ToolSheet visible={privacyOpen} title="Where your meeting data goes" onClose={() => setPrivacyOpen(false)}>
      <PrivacyNotice />
      <Text style={[meetingStyles.small, themed.textMuted]}>
        Nothing leaves this phone until notes are written. Recording and transcription work without a connection;
        only the notes need one.
      </Text>
    </ToolSheet>
  );
  const privacyAction = { key: 'privacy', label: 'Where your audio goes', icon: Info, onPress: () => setPrivacyOpen(true) };

  if (!entitled) {
    return (
      <View style={styles.container}>
        <ToolScreenHeader title="Meetings" subtitle="Record, transcribe and take notes" onBack={onBack} />
        <ProFeaturePanel
          feature="Meetings"
          description="Record a meeting and LAFINA transcribes it on this phone, then writes the notes: the summary, decisions, action items and deadlines. Meetings recorded on the desktop app appear here too."
        />
      </View>
    );
  }

  if (open) {
    return (
      <View style={styles.container}>
        <ToolScreenHeader
          title="Meeting"
          subtitle={STATUS_LABELS[open.status]}
          onBack={closeMeeting}
          actions={
            isBusy(open.status)
              ? [privacyAction]
              : [privacyAction, { key: 'delete', label: 'Delete meeting', icon: Trash2, onPress: () => confirmDelete(open) }]
          }
        />
        <MeetingDetail meeting={open} onNotesSaved={onNotesSaved} />
        {privacySheet}
      </View>
    );
  }

  const history = meetings.filter((meeting) => meeting.id !== recorder?.meetingId);

  return (
    <View style={styles.container}>
      <ToolScreenHeader
        title="Meetings"
        subtitle="Recorded and transcribed on this phone"
        onBack={onBack}
        actions={[privacyAction]}
      />
      <FlatList
        data={history}
        keyExtractor={(meeting) => meeting.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          available ? (
            <RecorderCard />
          ) : (
            <View style={[meetingStyles.card, themed.card]}>
              <Text style={[meetingStyles.body, themed.textSecondary]}>
                Recording is not available in this build of LAFINA. Meetings recorded on your other devices still
                appear below.
              </Text>
            </View>
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Users size={40} color={colors.red} />
            <Text style={[styles.emptyTitle, themed.textPrimary]}>No meetings yet</Text>
            <Text style={[meetingStyles.body, styles.emptyText, themed.textSecondary]}>
              Meetings you record appear here, with their transcript and notes. Meetings transcribed on the desktop
              app appear here too.
            </Text>
          </View>
        }
        renderItem={({ item: meeting }) => {
          const running = processing?.meetingId === meeting.id;
          return (
            <TouchableOpacity
              style={[styles.row, themed.card]}
              onPress={() => setOpenId(meeting.id)}
              onLongPress={() => (isBusy(meeting.status) ? undefined : confirmDelete(meeting))}
              accessibilityRole="button"
              accessibilityHint="Double tap to open. Double tap and hold to delete."
            >
              <Users size={20} color={colors.red} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, themed.textPrimary]} numberOfLines={1}>
                  {meeting.title}
                </Text>
                <Text style={[meetingStyles.small, themed.textSecondary]}>
                  {formatWhen(meeting.startedAt)}
                  {meeting.durationSeconds > 0 ? ` · ${formatDuration(meeting.durationSeconds)}` : ''}
                  {meeting.hasAudio ? '' : ' · from another device'}
                </Text>
              </View>
              <View style={[meetingStyles.chip, meeting.status === 'error' ? themed.chipError : themed.chip]}>
                <Text style={[meetingStyles.chipLabel, themed.textPrimary]}>
                  {running ? `${processing.percent}%` : STATUS_LABELS[meeting.status]}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      {privacySheet}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  listContent: {
    paddingBottom: 140,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  emptyTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.subtitle,
    fontWeight: 'bold',
    marginTop: Spacing.md,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  rowText: {
    flex: 1,
    marginHorizontal: Spacing.md,
  },
  rowTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
  },
});
