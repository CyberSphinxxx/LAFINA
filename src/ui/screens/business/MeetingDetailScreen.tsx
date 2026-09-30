import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  ArrowLeft,
  Sparkles,
  Users,
  Clock,
  Calendar,
  CheckCircle2,
  HelpCircle,
  ListTodo,
  Shield,
  Search,
  UserPlus,
  Trash2,
} from 'lucide-react-native';
import {
  meetingStore,
  businessStore,
} from '../../../storage';
import {
  LocalBusinessMeetingRow,
  LocalBusinessMeetingSegmentRow,
  LocalBusinessActionCandidateRow,
  LocalBusinessMeetingRecipientRow,
} from '../../../storage/syncTypes';
import {
  requestMeetingSummary,
  syncMeetingToCloud,
  revokeMeetingRecipient,
  MeetingSummaryData,
} from '../../../cloud/meetingService';
import { ActionCandidatesModal } from './ActionCandidatesModal';
import { RosterMember } from '../../../ai/meeting/actionCandidateExtractor';

interface MeetingDetailScreenProps {
  meetingId: string;
  businessId: string;
  userId: string;
  isManager?: boolean;
  onBack: () => void;
}

export const MeetingDetailScreen: React.FC<MeetingDetailScreenProps> = ({
  meetingId,
  businessId,
  userId,
  isManager = false,
  onBack,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [meeting, setMeeting] = useState<LocalBusinessMeetingRow | null>(null);
  const [segments, setSegments] = useState<LocalBusinessMeetingSegmentRow[]>([]);
  const [candidates, setCandidates] = useState<LocalBusinessActionCandidateRow[]>([]);
  const [recipients, setRecipients] = useState<LocalBusinessMeetingRecipientRow[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showCandidateModal, setShowCandidateModal] = useState(false);
  const [showRosterPicker, setShowRosterPicker] = useState(false);

  const loadMeetingData = useCallback(() => {
    const meet = meetingStore.getMeetingById(meetingId);
    if (meet) {
      setMeeting(meet);
    }
    const segs = meetingStore.getMeetingSegments(meetingId);
    setSegments(segs);

    const cands = meetingStore.getActionCandidates(meetingId);
    setCandidates(cands);

    const recs = meetingStore.getMeetingRecipients(meetingId);
    setRecipients(recs);

    // Load business roster for assignee matching and selective sharing
    const members = businessStore.getMembers(businessId);
    setRoster(
      members.map((m) => ({
        id: m.user_id,
        name: m.email.split('@')[0],
        email: m.email,
      }))
    );
  }, [meetingId, businessId]);

  useEffect(() => {
    loadMeetingData();
  }, [loadMeetingData]);

  const handleGenerateSummary = async () => {
    if (!meeting || !meeting.full_transcript) {
      Alert.alert('Empty Transcript', 'No speech content available to summarize.');
      return;
    }

    Alert.alert(
      'Generate AI Summary',
      'This will send only the text transcript to DeepSeek-V4 Flash. Zero audio is uploaded. Prompts are never stored. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            setIsSummarizing(true);
            try {
              const summary = await requestMeetingSummary(
                meeting.full_transcript,
                meeting.title,
                businessId
              );

              if (summary) {
                const summaryJsonStr = JSON.stringify(summary);
                meetingStore.updateMeetingSummary(meetingId, summaryJsonStr, 'completed');
                setMeeting((prev) =>
                  prev
                    ? {
                        ...prev,
                        summary_json: summaryJsonStr,
                        summary_status: 'completed',
                      }
                    : null
                );

                // Sync updated meeting to cloud
                await syncMeetingToCloud(
                  businessId,
                  { ...meeting, summary_json: summaryJsonStr, summary_status: 'completed' },
                  recipients.map((r) => r.user_id)
                );
              }
            } catch (err: unknown) {
              const e = err as Error;
              Alert.alert('Summarization Note', e.message || 'Offline: summary marked pending.');
              meetingStore.updateMeetingSummary(meetingId, '', 'summary_pending');
            } finally {
              setIsSummarizing(false);
            }
          },
        },
      ]
    );
  };

  const handleAddRecipient = async (member: RosterMember) => {
    if (recipients.some((r) => r.user_id === member.id)) return;
    const updatedIds = [...recipients.map((r) => r.user_id), member.id];

    if (meeting) {
      meetingStore.saveMeeting(meeting, segments, candidates, updatedIds);
      await syncMeetingToCloud(businessId, meeting, updatedIds);
    }
    const updatedRecs = meetingStore.getMeetingRecipients(meetingId);
    setRecipients(updatedRecs);
    setShowRosterPicker(false);
  };

  const handleRevokeRecipient = async (recipientUserId: string) => {
    Alert.alert(
      'Revoke Access',
      'Remove this member from meeting access? Their local transcript will be purged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            await revokeMeetingRecipient(businessId, meetingId, recipientUserId);
            const remaining = recipients.filter((r) => r.user_id !== recipientUserId);
            if (meeting) {
              meetingStore.saveMeeting(
                meeting,
                segments,
                candidates,
                remaining.map((r) => r.user_id)
              );
            }
            setRecipients(remaining);
          },
        },
      ]
    );
  };

  if (!meeting) {
    return (
      <View style={[styles.loadingContainer, themed.container]}>
        <ActivityIndicator size="large" color={colors.blue} />
      </View>
    );
  }

  let summaryData: MeetingSummaryData | null = null;
  if (meeting.summary_json) {
    try {
      summaryData = JSON.parse(meeting.summary_json);
    } catch {}
  }

  const filteredSegments = segments.filter((s) =>
    s.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatMsTimestamp = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isCreatorOrManager = isManager || meeting.created_by === userId;

  return (
    <View style={[styles.container, themed.container]}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <ArrowLeft size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, themed.text]} numberOfLines={1}>
          {meeting.title}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Meta Card */}
        <View style={[styles.metaCard, themed.card]}>
          <Text style={[styles.metaTitle, themed.text]}>{meeting.title}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaBadge}>
              <Calendar size={13} color={colors.textMuted} />
              <Text style={[styles.metaBadgeText, themed.mutedText]}>
                {new Date(meeting.created_at).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.metaBadge}>
              <Clock size={13} color={colors.textMuted} />
              <Text style={[styles.metaBadgeText, themed.mutedText]}>
                {formatDuration(meeting.duration_seconds)}
              </Text>
            </View>
            <View style={styles.metaBadge}>
              <Shield size={13} color={colors.success} />
              <Text style={[styles.metaBadgeText, { color: colors.success }]}>
                {meeting.keep_audio ? 'Audio Kept' : 'Zero Audio Retained'}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Candidates Banner */}
        {candidates.length > 0 && (
          <TouchableOpacity
            style={[styles.candidateBanner, { backgroundColor: colors.yellow + '20' }]}
            onPress={() => setShowCandidateModal(true)}
          >
            <View style={styles.candidateBannerLeft}>
              <Sparkles size={18} color={colors.yellow} />
              <View>
                <Text style={[styles.candidateBannerTitle, { color: colors.yellow }]}>
                  {candidates.filter((c) => c.status === 'pending_review').length} Action Candidate(s) Extracted
                </Text>
                <Text style={[styles.candidateBannerSub, themed.mutedText]}>
                  Spoken commands detected • Tap to review
                </Text>
              </View>
            </View>
            <Text style={[styles.reviewLink, { color: colors.blue }]}>Review</Text>
          </TouchableOpacity>
        )}

        {/* AI Summary Section */}
        <View style={[styles.sectionCard, themed.card]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleRow}>
              <Sparkles size={18} color={colors.blue} />
              <Text style={[styles.sectionTitle, themed.text]}>Executive AI Summary</Text>
            </View>
            {summaryData && (
              <TouchableOpacity onPress={handleGenerateSummary} disabled={isSummarizing}>
                <Text style={[styles.reGenLink, { color: colors.blue }]}>Regenerate</Text>
              </TouchableOpacity>
            )}
          </View>

          {isSummarizing ? (
            <View style={styles.summaryLoading}>
              <ActivityIndicator size="small" color={colors.blue} />
              <Text style={[styles.summaryLoadingText, themed.mutedText]}>
                Analyzing transcript with DeepSeek-V4 Flash...
              </Text>
            </View>
          ) : summaryData ? (
            <View style={styles.summaryContent}>
              {/* Key Points */}
              {summaryData.key_points?.length > 0 && (
                <View style={styles.summaryBlock}>
                  <Text style={[styles.blockHeading, themed.text]}>Key Points</Text>
                  {summaryData.key_points.map((pt, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={[styles.bulletDot, { color: colors.blue }]}>•</Text>
                      <Text style={[styles.bulletText, themed.text]}>{pt}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Decisions */}
              {summaryData.decisions?.length > 0 && (
                <View style={styles.summaryBlock}>
                  <Text style={[styles.blockHeading, themed.text]}>Decisions Made</Text>
                  {summaryData.decisions.map((dec, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <CheckCircle2 size={13} color={colors.success} style={{ marginTop: 2 }} />
                      <Text style={[styles.bulletText, themed.text]}>{dec}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Action Items */}
              {summaryData.action_items?.length > 0 && (
                <View style={styles.summaryBlock}>
                  <Text style={[styles.blockHeading, themed.text]}>Action Items</Text>
                  {summaryData.action_items.map((item, i) => (
                    <View key={i} style={[styles.actionItemCard, themed.subCard]}>
                      <Text style={[styles.actionItemTask, themed.text]}>{item.task}</Text>
                      <View style={styles.actionItemMeta}>
                        <Text style={[styles.actionItemAssignee, { color: colors.blue }]}>
                          @{item.assignee}
                        </Text>
                        {item.due && (
                          <Text style={[styles.actionItemDue, themed.mutedText]}>
                            Due: {new Date(item.due).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Open Questions */}
              {summaryData.open_questions?.length > 0 && (
                <View style={styles.summaryBlock}>
                  <Text style={[styles.blockHeading, themed.text]}>Open Questions</Text>
                  {summaryData.open_questions.map((q, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <HelpCircle size={13} color={colors.yellow} style={{ marginTop: 2 }} />
                      <Text style={[styles.bulletText, themed.text]}>{q}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.noSummaryBox}>
              <Text style={[styles.noSummaryText, themed.mutedText]}>
                Zero audio is sent to the cloud. Summaries use DeepSeek-V4 Flash strictly on transcript text with explicit consent.
              </Text>
              <TouchableOpacity
                style={[styles.generateBtn, { backgroundColor: colors.blue }]}
                onPress={handleGenerateSummary}
              >
                <Sparkles size={16} color="#FFF" />
                <Text style={styles.generateBtnText}>Generate DeepSeek Summary</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Selective Sharing Section */}
        <View style={[styles.sectionCard, themed.card]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleRow}>
              <Users size={18} color={colors.blue} />
              <Text style={[styles.sectionTitle, themed.text]}>Selective Sharing</Text>
            </View>
            {isCreatorOrManager && (
              <TouchableOpacity
                style={styles.addRecipientLink}
                onPress={() => setShowRosterPicker(!showRosterPicker)}
              >
                <UserPlus size={15} color={colors.blue} />
                <Text style={[styles.reGenLink, { color: colors.blue }]}>Add Member</Text>
              </TouchableOpacity>
            )}
          </View>

          {showRosterPicker && (
            <View style={[styles.rosterPickerBox, themed.subCard]}>
              <Text style={[styles.rosterPickerTitle, themed.mutedText]}>Select team member:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {roster
                  .filter((m) => !recipients.some((r) => r.user_id === m.id))
                  .map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.rosterPickChip, { backgroundColor: colors.blue + '20' }]}
                      onPress={() => handleAddRecipient(m)}
                    >
                      <Text style={[styles.rosterPickChipText, { color: colors.blue }]}>
                        +{m.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>
          )}

          {recipients.length === 0 ? (
            <Text style={[styles.privateNotice, themed.mutedText]}>
              Private to creator and business managers.
            </Text>
          ) : (
            <View style={styles.recipientList}>
              {recipients.map((rec) => {
                const member = roster.find((m) => m.id === rec.user_id);
                return (
                  <View key={rec.id} style={[styles.recipientChip, themed.subCard]}>
                    <Text style={[styles.recipientName, themed.text]}>
                      {member?.name || rec.user_id.slice(0, 8)}
                    </Text>
                    {isCreatorOrManager && (
                      <TouchableOpacity
                        onPress={() => handleRevokeRecipient(rec.user_id)}
                        style={styles.revokeBtn}
                      >
                        <Trash2 size={13} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Full Transcript View */}
        <View style={[styles.sectionCard, themed.card]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleRow}>
              <ListTodo size={18} color={colors.blue} />
              <Text style={[styles.sectionTitle, themed.text]}>
                Transcript ({segments.length} segments)
              </Text>
            </View>
          </View>

          {/* Search bar */}
          <View style={[styles.searchBox, themed.subCard]}>
            <Search size={14} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, themed.text]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search in transcript..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {filteredSegments.length === 0 ? (
            <Text style={[styles.emptyTranscript, themed.mutedText]}>
              No matching segments found.
            </Text>
          ) : (
            <View style={styles.segmentsList}>
              {filteredSegments.map((seg) => (
                <View key={seg.id} style={styles.segmentRow}>
                  <View style={[styles.timestampChip, { backgroundColor: colors.blue + '15' }]}>
                    <Text style={[styles.timestampText, { color: colors.blue }]}>
                      {formatMsTimestamp(seg.start_ms)}
                    </Text>
                  </View>
                  <Text style={[styles.segmentText, themed.text]}>{seg.text}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Action Candidate Modal */}
      <ActionCandidatesModal
        visible={showCandidateModal}
        meetingId={meetingId}
        candidates={candidates.map((c) => ({
          id: c.id,
          meeting_id: c.meeting_id,
          title: c.title,
          instructions: c.instructions,
          suggested_assignee_id: c.suggested_assignee_id,
          suggested_assignee_name: c.suggested_assignee_name,
          suggested_due_date: c.suggested_due_date,
          status: c.status,
          created_task_id: c.created_task_id,
          created_at: c.created_at,
        }))}
        roster={roster}
        isManager={isManager}
        businessId={businessId}
        userId={userId}
        onClose={() => setShowCandidateModal(false)}
        onCandidateProcessed={loadMeetingData}
      />
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  container: {
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.cardBg,
    borderColor: colors.border,
  },
  subCard: {
    backgroundColor: colors.inputBg,
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
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  metaCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    ...Shadows.card,
  },
  metaTitle: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  candidateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
  },
  candidateBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  candidateBannerTitle: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  candidateBannerSub: {
    fontSize: 11,
    fontFamily: Fonts.body,
  },
  reviewLink: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  sectionCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    ...Shadows.card,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  reGenLink: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  summaryLoading: {
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
  },
  summaryLoadingText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  summaryContent: {
    gap: 12,
  },
  summaryBlock: {
    gap: 4,
  },
  blockHeading: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bulletDot: {
    fontSize: 16,
    lineHeight: 18,
  },
  bulletText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    flex: 1,
    lineHeight: 18,
  },
  actionItemCard: {
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 4,
  },
  actionItemTask: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  actionItemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionItemAssignee: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  actionItemDue: {
    fontSize: 11,
    fontFamily: Fonts.body,
  },
  noSummaryBox: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  noSummaryText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    textAlign: 'center',
    lineHeight: 16,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  generateBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  addRecipientLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rosterPickerBox: {
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 8,
  },
  rosterPickerTitle: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: '500',
    marginBottom: 4,
  },
  rosterPickChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 6,
  },
  rosterPickChipText: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  privateNotice: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontStyle: 'italic',
  },
  recipientList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  recipientName: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  revokeBtn: {
    padding: 2,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    fontFamily: Fonts.body,
    paddingVertical: 6,
  },
  emptyTranscript: {
    fontSize: 12,
    fontFamily: Fonts.body,
    textAlign: 'center',
    paddingVertical: 12,
  },
  segmentsList: {
    gap: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  timestampChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  timestampText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  segmentText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    flex: 1,
    lineHeight: 18,
  },
});
