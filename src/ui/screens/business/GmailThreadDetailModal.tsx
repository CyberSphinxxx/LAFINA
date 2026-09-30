import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Fonts } from '../../theme';
import { gmailService } from '../../../cloud/gmailService';
import type { GmailThreadDetailData, GmailMessageDetailData } from '../../../cloud/gmailService';
import { speakTextWithTts, stopSpeechPlayback, cleanEmailForReadAloud } from '../../../ai/tts/ttsService';
import { GmailComposeModal } from './GmailComposeModal';

interface GmailThreadDetailModalProps {
  visible: boolean;
  userId: string;
  threadId: string;
  initialSubject?: string;
  onClose: () => void;
}

export const GmailThreadDetailModal: React.FC<GmailThreadDetailModalProps> = ({
  visible,
  userId,
  threadId,
  initialSubject = 'Email Thread',
  onClose,
}) => {
  const { colors, isDarkMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [threadDetail, setThreadDetail] = useState<GmailThreadDetailData | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);

  // Reply state
  const [replyModalVisible, setReplyModalVisible] = useState(false);
  const [replyTo, setReplyTo] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyInitialBody, setReplyInitialBody] = useState('');

  const stopTts = useCallback(async () => {
    setIsPlayingTts(false);
    setTtsLoading(false);
    try {
      await stopSpeechPlayback();
    } catch {
      // Ignore stop errors
    }
  }, []);

  const loadThread = useCallback(async () => {
    setLoading(true);
    try {
      const res = await gmailService.fetchThreadDetail(userId, threadId);
      setThreadDetail(res.detail);
      setIsOffline(res.isOffline);
    } catch (e) {
      console.warn('Failed to load thread detail:', e);
    } finally {
      setLoading(false);
    }
  }, [userId, threadId]);

  useEffect(() => {
    if (visible && threadId) {
      loadThread();
    } else {
      stopTts();
    }
  }, [visible, threadId, loadThread, stopTts]);

  const handleReadAloud = async (message?: GmailMessageDetailData) => {
    if (isPlayingTts) {
      await stopTts();
      return;
    }

    const targetMsg = message || threadDetail?.messages[threadDetail.messages.length - 1];
    if (!targetMsg) {
      Alert.alert('No Content', 'No message content available to read aloud.');
      return;
    }

    setTtsLoading(true);
    setIsPlayingTts(true);
    try {
      const spokenText = cleanEmailForReadAloud(
        targetMsg.subject || threadDetail?.subject || 'Email',
        targetMsg.from_address,
        targetMsg.body_plain || targetMsg.snippet
      );
      setTtsLoading(false);
      await speakTextWithTts(spokenText);
    } catch (e: any) {
      Alert.alert('Read Aloud Notice', e.message || 'Kokoro TTS synthesis not available on this device.');
    } finally {
      setIsPlayingTts(false);
      setTtsLoading(false);
    }
  };

  const handleReply = (message: GmailMessageDetailData, replyAll: boolean = false) => {
    const subjectPrefix = message.subject.toLowerCase().startsWith('re:') ? '' : 'Re: ';
    setReplySubject(`${subjectPrefix}${message.subject}`);
    setReplyTo(message.from_address);
    if (replyAll) {
      setReplyCc(message.cc_address || '');
    } else {
      setReplyCc('');
    }
    const quoteHeader = `\n\n--- On ${message.date}, ${message.from_address} wrote:\n> `;
    const quoted = message.body_plain
      ? message.body_plain.split('\n').join('\n> ')
      : message.snippet;
    setReplyInitialBody(`${quoteHeader}${quoted}`);
    setReplyModalVisible(true);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        stopTts();
        onClose();
      }}
    >
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background },
        ]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.cardBg,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              stopTts();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to inbox"
          >
            <Text style={[styles.backButtonText, { color: colors.textPrimary }]}>
              ← Back
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.ttsButton,
              isPlayingTts ? styles.ttsButtonActive : null,
            ]}
            onPress={() => handleReadAloud()}
            accessibilityRole="button"
            accessibilityLabel={isPlayingTts ? 'Stop reading aloud' : 'Read email aloud with TTS'}
          >
            {ttsLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.ttsButtonText}>
                {isPlayingTts ? '■ Stop Voice' : '▶ Read Aloud'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Offline Notice */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>
              Offline Mode: Viewing cached email thread.
            </Text>
          </View>
        )}

        {/* Subject Bar */}
        <View
          style={[
            styles.subjectContainer,
            {
              backgroundColor: colors.cardBg,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.subjectText,
              { color: colors.textPrimary },
            ]}
            numberOfLines={2}
          >
            {threadDetail?.subject || initialSubject}
          </Text>
        </View>

        {/* Messages List */}
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={[styles.loaderText, { color: colors.textMuted }]}>
              Loading thread...
            </Text>
          </View>
        ) : !threadDetail || threadDetail.messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Message details could not be loaded.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
          >
            {threadDetail.messages.map((msg, index) => (
              <View
                key={msg.message_id || `msg_${index}`}
                style={[
                  styles.messageCard,
                  {
                    backgroundColor: colors.cardBg,
                    borderColor: colors.border,
                  },
                ]}
              >
                {/* Message Header */}
                <View style={styles.msgHeader}>
                  <View style={styles.senderInfo}>
                    <Text
                      style={[
                        styles.senderName,
                        { color: colors.textPrimary },
                      ]}
                      numberOfLines={1}
                    >
                      {msg.from_address}
                    </Text>
                    <Text
                      style={[
                        styles.recipientText,
                        { color: colors.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      To: {msg.to_address}
                      {msg.cc_address ? ` | Cc: ${msg.cc_address}` : ''}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.dateText,
                      { color: colors.textMuted },
                    ]}
                  >
                    {msg.date ? msg.date.substring(0, 16) : ''}
                  </Text>
                </View>

                {/* Attachments Section */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <View
                    style={[
                      styles.attachmentsContainer,
                      { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : '#F1F5F9' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.attachmentTitle,
                        { color: colors.textSecondary },
                      ]}
                    >
                      📎 Attachments ({msg.attachments.length}):
                    </Text>
                    <View style={styles.chipsRow}>
                      {msg.attachments.map((att, attIdx) => (
                        <View
                          key={att.id || `att_${attIdx}`}
                          style={[
                            styles.attachmentChip,
                            {
                              backgroundColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                              borderColor: colors.border,
                            },
                          ]}
                          accessible={true}
                          accessibilityLabel={`Attachment ${att.filename}, size ${formatFileSize(att.size)}`}
                        >
                          <Text
                            style={[
                              styles.attachmentFilename,
                              { color: colors.textPrimary },
                            ]}
                            numberOfLines={1}
                          >
                            {att.filename}
                          </Text>
                          <Text style={styles.attachmentSize}>
                            {formatFileSize(att.size)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Message Body */}
                <Text
                  style={[
                    styles.bodyText,
                    { color: colors.textPrimary },
                  ]}
                  selectable
                >
                  {msg.body_plain || msg.snippet}
                </Text>

                {/* Card Actions */}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={styles.cardActionBtn}
                    onPress={() => handleReadAloud(msg)}
                    accessibilityRole="button"
                    accessibilityLabel="Listen to this message"
                  >
                    <Text style={styles.cardActionText}>🔊 Speak</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.cardActionBtn}
                    onPress={() => handleReply(msg, false)}
                    accessibilityRole="button"
                    accessibilityLabel="Reply to this message"
                  >
                    <Text style={styles.cardActionText}>↩ Reply</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.cardActionBtn}
                    onPress={() => handleReply(msg, true)}
                    accessibilityRole="button"
                    accessibilityLabel="Reply all to this message"
                  >
                    <Text style={styles.cardActionText}>👥 Reply All</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Reply Compose Modal */}
        <GmailComposeModal
          visible={replyModalVisible}
          userId={userId}
          threadId={threadId}
          initialTo={replyTo}
          initialCc={replyCc}
          initialSubject={replySubject}
          initialBody={replyInitialBody}
          onClose={() => setReplyModalVisible(false)}
          onSent={() => {
            loadThread();
          }}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 12,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: '700',
  },
  ttsButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ttsButtonActive: {
    backgroundColor: '#DC2626',
  },
  ttsButtonText: {
    color: '#FFFFFF',
    fontFamily: Fonts.heading,
    fontSize: 13,
    fontWeight: '700',
  },
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#92400E',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  subjectContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  subjectText: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: '700',
    lineHeight: 24,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loaderText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: Fonts.body,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    gap: 16,
  },
  messageCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  msgHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  senderInfo: {
    flex: 1,
    marginRight: 8,
  },
  senderName: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: '700',
  },
  recipientText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  dateText: {
    fontSize: 11,
    fontFamily: Fonts.body,
  },
  attachmentsContainer: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  attachmentTitle: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  attachmentFilename: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
    maxWidth: 160,
  },
  attachmentSize: {
    fontSize: 10,
    color: '#64748B',
    marginLeft: 4,
  },
  bodyText: {
    fontSize: 14,
    fontFamily: Fonts.body,
    lineHeight: 22,
    marginBottom: 16,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
    gap: 12,
  },
  cardActionBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardActionText: {
    color: '#2563EB',
    fontFamily: Fonts.heading,
    fontSize: 13,
    fontWeight: '600',
  },
});
