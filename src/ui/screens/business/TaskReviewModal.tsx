import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { X, CheckCircle, RotateCcw, AlertCircle } from 'lucide-react-native';
import type { BusinessTaskWithAssignments, BusinessTaskAssignmentRow } from '../../../storage/syncTypes';
import { TaskCommentsThread } from '../../components/business/TaskCommentsThread';

interface TaskReviewModalProps {
  visible: boolean;
  onClose: () => void;
  task: BusinessTaskWithAssignments | null;
  assignment: BusinessTaskAssignmentRow | null;
  employeeEmail?: string;
  onApprove: (assignmentId: string) => Promise<void>;
  onReopen: (assignmentId: string, reason: string) => Promise<void>;
}

export const TaskReviewModal: React.FC<TaskReviewModalProps> = ({
  visible,
  onClose,
  task,
  assignment,
  employeeEmail,
  onApprove,
  onReopen,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [feedbackReason, setFeedbackReason] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!task || !assignment) return null;

  const handleApprove = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onApprove(assignment.id);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to approve task completion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!feedbackReason.trim()) {
      setErrorMessage('Please provide feedback explaining why the task is reopened.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onReopen(assignment.id, feedbackReason.trim());
      setFeedbackReason('');
      setShowFeedbackInput(false);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to reopen task.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={[styles.modalOverlay, themed.overlay]}>
        <View style={[styles.modalCard, themed.card, Shadows.card]}>
          {/* Header */}
          <View style={[styles.modalHeader, themed.borderBottom]}>
            <Text style={[styles.modalTitle, themed.text]}>Review Task Completion</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close review modal"
            >
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {errorMessage ? (
              <View style={[styles.errorBanner, { backgroundColor: '#FEE2E2', borderColor: '#DC2626' }]}>
                <AlertCircle size={18} color="#DC2626" />
                <Text style={[styles.errorBannerText, { color: '#991B1B' }]}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Task Info */}
            <Text style={[styles.sectionLabel, themed.textSecondary]}>TASK</Text>
            <Text style={[styles.taskTitle, themed.text]}>{task.title}</Text>
            {task.instructions ? (
              <Text style={[styles.taskInstructions, themed.textSecondary]}>
                {task.instructions}
              </Text>
            ) : null}

            {/* Submitter Info */}
            <View style={[styles.infoCard, themed.border, { backgroundColor: colors.inputBg }]}>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, themed.textSecondary]}>Submitted by:</Text>
                <Text style={[styles.infoValue, themed.text]}>
                  {employeeEmail || assignment.user_id}
                </Text>
              </View>
              {assignment.submitted_at ? (
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, themed.textSecondary]}>Submitted at:</Text>
                  <Text style={[styles.infoValue, themed.text]}>
                    {new Date(assignment.submitted_at).toLocaleString()}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Task Comments & Real-time Collaboration Thread */}
            <TaskCommentsThread
              taskId={task.id}
              businessId={task.business_id}
              currentUserId={assignment.user_id}
            />

            {/* Reopen Feedback Area */}
            {showFeedbackInput ? (
              <View style={styles.feedbackSection}>
                <Text style={[styles.inputLabel, themed.text]}>
                  Feedback / Reason for Reopening *
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea, themed.input, themed.text]}
                  placeholder="Explain what changes are needed before completion..."
                  placeholderTextColor={colors.placeholder}
                  value={feedbackReason}
                  onChangeText={setFeedbackReason}
                  multiline={true}
                  numberOfLines={3}
                  accessibilityLabel="Reopen feedback input"
                />
              </View>
            ) : null}
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, themed.borderTop]}>
            {!showFeedbackInput ? (
              <>
                <TouchableOpacity
                  style={[styles.reopenBtn, { borderColor: '#F59E0B' }]}
                  onPress={() => setShowFeedbackInput(true)}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Reopen task with feedback"
                >
                  <RotateCcw size={16} color="#D97706" />
                  <Text style={[styles.reopenBtnText, { color: '#D97706' }]}>Reopen...</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.approveBtn, { backgroundColor: colors.success }]}
                  onPress={handleApprove}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Approve task completion"
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <CheckCircle size={16} color="#FFFFFF" />
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.cancelBtn, themed.buttonSecondary]}
                  onPress={() => setShowFeedbackInput(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel reopening"
                >
                  <Text style={[styles.cancelBtnText, themed.buttonSecondaryText]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.confirmReopenBtn, { backgroundColor: '#DC2626' }]}
                  onPress={handleReopen}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm reopening task"
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.confirmReopenBtnText}>Send Feedback & Reopen</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: { backgroundColor: colors.cardBg },
    overlay: { backgroundColor: 'rgba(0,0,0,0.6)' },
    text: { color: colors.textPrimary },
    textSecondary: { color: colors.textSecondary },
    input: {
      backgroundColor: colors.inputBg,
      borderColor: colors.border,
    },
    border: { borderColor: colors.border },
    borderBottom: { borderBottomColor: colors.border },
    borderTop: { borderTopColor: colors.border },
    buttonSecondary: {
      backgroundColor: colors.inputBg,
      borderColor: colors.border,
    },
    buttonSecondaryText: { color: colors.textPrimary },
  });

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  scrollContent: {
    padding: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorBannerText: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
    flex: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  taskTitle: {
    fontSize: 17,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  taskInstructions: {
    fontSize: 14,
    fontFamily: Fonts.body,
    lineHeight: 20,
    marginBottom: 16,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  feedbackSection: {
    marginTop: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    borderTopWidth: 1,
  },
  reopenBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  reopenBtnText: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  approveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  confirmReopenBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmReopenBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
});
