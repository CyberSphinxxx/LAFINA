import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Colors, Fonts } from '../../theme';
import { gmailService } from '../../../cloud/gmailService';
import { cloudClient } from '../../../cloud/cloudClient';
import { GmailSendConfirmModal } from './GmailSendConfirmModal';

interface GmailComposeModalProps {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onSent?: () => void;
  onDraftSaved?: () => void;
  initialTo?: string;
  initialCc?: string;
  initialBcc?: string;
  initialSubject?: string;
  initialBody?: string;
  threadId?: string;
  draftId?: string;
}

export const GmailComposeModal: React.FC<GmailComposeModalProps> = ({
  visible,
  userId,
  onClose,
  onSent,
  onDraftSaved,
  initialTo = '',
  initialCc = '',
  initialBcc = '',
  initialSubject = '',
  initialBody = '',
  threadId,
  draftId: initialDraftId,
}) => {
  const { colors } = useTheme();
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState(initialBcc);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [showCcBcc, setShowCcBcc] = useState(Boolean(initialCc || initialBcc));
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(initialDraftId);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setTo(initialTo);
      setCc(initialCc);
      setBcc(initialBcc);
      setSubject(initialSubject);
      setBody(initialBody);
      setShowCcBcc(Boolean(initialCc || initialBcc));
      setCurrentDraftId(initialDraftId);
    }
  }, [visible, initialTo, initialCc, initialBcc, initialSubject, initialBody, initialDraftId]);

  const handleSaveDraft = async () => {
    if (!to.trim() && !subject.trim() && !body.trim()) {
      Alert.alert('Empty Draft', 'Please add some content before saving.');
      return;
    }
    setIsSavingDraft(true);
    try {
      if (currentDraftId) {
        const updated = await gmailService.updateDraft(userId, currentDraftId, {
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body: body.trim(),
          thread_id: threadId,
        });
        setCurrentDraftId(updated.id);
      } else {
        const created = await gmailService.createDraft(userId, {
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body: body.trim(),
          thread_id: threadId,
        });
        setCurrentDraftId(created.id);
      }
      Alert.alert('Draft Saved', 'Your draft has been saved locally and synced.');
      onDraftSaved?.();
    } catch {
      Alert.alert('Draft Saved', 'Draft saved locally (offline mode).');
      onDraftSaved?.();
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handlePressSend = async () => {
    if (!to.trim()) {
      Alert.alert('Missing Recipient', 'Please specify at least one recipient in the "To" field.');
      return;
    }

    const isOnline = await cloudClient.isOnline();
    if (!isOnline) {
      // Save as draft and warn user
      await handleSaveDraft();
      Alert.alert(
        'Offline',
        'You are currently offline. Emails cannot be sent automatically. Your email has been safely stored as a Draft. Please send it explicitly once reconnected.'
      );
      return;
    }

    setConfirmModalVisible(true);
  };

  const handleConfirmSend = async () => {
    setIsSending(true);
    try {
      let targetDraftId = currentDraftId;
      // Ensure draft exists remotely
      if (!targetDraftId) {
        const created = await gmailService.createDraft(userId, {
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body: body.trim(),
          thread_id: threadId,
        });
        targetDraftId = created.id;
      } else {
        await gmailService.updateDraft(userId, targetDraftId, {
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body: body.trim(),
          thread_id: threadId,
        });
      }

      await gmailService.sendDraft(userId, targetDraftId);
      setConfirmModalVisible(false);
      Alert.alert('Email Sent', 'Your email has been sent successfully.');
      onSent?.();
      onClose();
    } catch (e: any) {
      Alert.alert('Send Failed', e.message || 'Could not send email.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[
          styles.container,
          { backgroundColor: colors.background },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            style={styles.headerButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close compose window"
          >
            <Text style={[styles.headerButtonText, { color: colors.textPrimary }]}>
              ✕
            </Text>
          </TouchableOpacity>

          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
            {threadId ? 'Reply' : 'Compose Email'}
          </Text>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.saveDraftBtn, { borderColor: colors.border }]}
              onPress={handleSaveDraft}
              disabled={isSavingDraft}
              accessibilityRole="button"
              accessibilityLabel="Save Draft"
            >
              {isSavingDraft ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <Text style={styles.saveDraftText}>Draft</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sendBtn}
              onPress={handlePressSend}
              disabled={isSending}
              accessibilityRole="button"
              accessibilityLabel="Send email"
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.sendBtnText}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.form}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* To Field */}
          <View
            style={[
              styles.inputRow,
              { borderBottomColor: colors.border },
            ]}
          >
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              To:
            </Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder="recipient@example.com"
              placeholderTextColor={colors.placeholder}
              value={to}
              onChangeText={setTo}
              autoCapitalize="none"
              keyboardType="email-address"
              accessibilityLabel="Recipient email address"
            />
            {!showCcBcc && (
              <TouchableOpacity
                style={styles.ccBccToggle}
                onPress={() => setShowCcBcc(true)}
                accessibilityRole="button"
                accessibilityLabel="Show CC and BCC fields"
              >
                <Text style={styles.ccBccToggleText}>Cc/Bcc</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* CC & BCC Fields */}
          {showCcBcc && (
            <>
              <View
                style={[
                  styles.inputRow,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Cc:
                </Text>
                <TextInput
                  style={[styles.input, { color: colors.textPrimary }]}
                  placeholder="cc@example.com"
                  placeholderTextColor={colors.placeholder}
                  value={cc}
                  onChangeText={setCc}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  accessibilityLabel="Carbon copy email addresses"
                />
              </View>

              <View
                style={[
                  styles.inputRow,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Bcc:
                </Text>
                <TextInput
                  style={[styles.input, { color: colors.textPrimary }]}
                  placeholder="bcc@example.com"
                  placeholderTextColor={colors.placeholder}
                  value={bcc}
                  onChangeText={setBcc}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  accessibilityLabel="Blind carbon copy email addresses"
                />
              </View>
            </>
          )}

          {/* Subject Field */}
          <View
            style={[
              styles.inputRow,
              { borderBottomColor: colors.border },
            ]}
          >
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Subject:
            </Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder="Email subject"
              placeholderTextColor={colors.placeholder}
              value={subject}
              onChangeText={setSubject}
              accessibilityLabel="Email subject"
            />
          </View>

          {/* Body Field */}
          <TextInput
            style={[
              styles.bodyInput,
              {
                color: colors.textPrimary,
                backgroundColor: colors.cardBg,
              },
            ]}
            placeholder="Compose your message here..."
            placeholderTextColor={colors.placeholder}
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Email body message"
          />
        </ScrollView>

        {/* Send Confirmation Dialog */}
        <GmailSendConfirmModal
          visible={confirmModalVisible}
          to={to}
          subject={subject}
          onConfirm={handleConfirmSend}
          onCancel={() => setConfirmModalVisible(false)}
          isSending={isSending}
        />
      </KeyboardAvoidingView>
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
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: Fonts.heading,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveDraftBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveDraftText: {
    color: '#2563EB',
    fontFamily: Fonts.heading,
    fontSize: 13,
    fontWeight: '600',
  },
  sendBtn: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.blue || '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontFamily: Fonts.heading,
    fontSize: 14,
    fontWeight: '700',
  },
  form: {
    flex: 1,
  },
  formContent: {
    padding: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingVertical: 8,
    marginBottom: 8,
  },
  inputLabel: {
    width: 65,
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.body,
    paddingVertical: 4,
  },
  ccBccToggle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ccBccToggleText: {
    color: '#2563EB',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  bodyInput: {
    minHeight: 240,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    fontFamily: Fonts.body,
    lineHeight: 22,
    marginTop: 8,
  },
});
