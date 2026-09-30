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
import { X, CheckSquare, Clock, AlertCircle, Users } from 'lucide-react-native';
import type { BusinessMemberData } from '../../../cloud/businessService';
import type { TaskPriority } from '../../../storage/syncTypes';

interface CreateTaskModalProps {
  visible: boolean;
  onClose: () => void;
  teamMembers: BusinessMemberData[];
  onCreateTask: (params: {
    title: string;
    instructions: string;
    priority: TaskPriority;
    dueDate: string | null;
    reminderLeadMinutes: number;
    assigneeUserIds: string[];
  }) => Promise<void>;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  visible,
  onClose,
  teamMembers,
  onCreateTask,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [reminderLeadMinutes, setReminderLeadMinutes] = useState(15);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleAssignee = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSelectAll = () => {
    if (selectedUserIds.length === teamMembers.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(teamMembers.map((m) => m.user_id));
    }
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('Please enter a task title.');
      return;
    }

    if (selectedUserIds.length === 0) {
      setErrorMessage('Please select at least one assignee for this task.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onCreateTask({
        title: trimmedTitle,
        instructions: instructions.trim(),
        priority,
        dueDate: dueDate.trim() || null,
        reminderLeadMinutes,
        assigneeUserIds: selectedUserIds,
      });

      // Reset form
      setTitle('');
      setInstructions('');
      setPriority('medium');
      setDueDate('');
      setSelectedUserIds([]);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create task.');
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
            <View style={styles.headerLeft}>
              <CheckSquare size={22} color={colors.blue} />
              <Text style={[styles.modalTitle, themed.text]}>Assign Business Task</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
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

            {/* Task Title */}
            <Text style={[styles.inputLabel, themed.text]}>Task Title *</Text>
            <TextInput
              style={[styles.input, themed.input, themed.text]}
              placeholder="e.g. Conduct Laboratory Equipment Audit"
              placeholderTextColor={colors.placeholder}
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Task Title input"
            />

            {/* Instructions */}
            <Text style={[styles.inputLabel, themed.text]}>Instructions & Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea, themed.input, themed.text]}
              placeholder="Detailed instructions, requirements, or links..."
              placeholderTextColor={colors.placeholder}
              value={instructions}
              onChangeText={setInstructions}
              multiline={true}
              numberOfLines={3}
              accessibilityLabel="Instructions input"
            />

            {/* Priority Selector */}
            <Text style={[styles.inputLabel, themed.text]}>Priority</Text>
            <View style={styles.priorityRow}>
              {(['low', 'medium', 'high'] as TaskPriority[]).map((p) => {
                const isSelected = priority === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityChip,
                      isSelected && {
                        backgroundColor:
                          p === 'high' ? colors.red : p === 'medium' ? colors.yellow : colors.blue,
                        borderColor: 'transparent',
                      },
                    ]}
                    onPress={() => setPriority(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Priority ${p}`}
                  >
                    <Text
                      style={[
                        styles.priorityChipText,
                        themed.text,
                        isSelected && { color: '#FFFFFF', fontWeight: 'bold' },
                      ]}
                    >
                      {p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Due Date */}
            <Text style={[styles.inputLabel, themed.text]}>Due Date / Time (Optional)</Text>
            <TextInput
              style={[styles.input, themed.input, themed.text]}
              placeholder="e.g. 2026-08-30T17:00:00Z"
              placeholderTextColor={colors.placeholder}
              value={dueDate}
              onChangeText={setDueDate}
              accessibilityLabel="Due Date input"
            />

            {/* Reminder Lead Minutes */}
            <Text style={[styles.inputLabel, themed.text]}>Employee Reminder Call</Text>
            <View style={styles.leadTimeRow}>
              {[
                { label: '5 min', value: 5 },
                { label: '15 min', value: 15 },
                { label: '30 min', value: 30 },
                { label: '1 hour', value: 60 },
              ].map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.leadChip,
                    reminderLeadMinutes === item.value && {
                      backgroundColor: colors.blue,
                      borderColor: colors.blue,
                    },
                  ]}
                  onPress={() => setReminderLeadMinutes(item.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`Lead time ${item.label}`}
                >
                  <Clock size={12} color={reminderLeadMinutes === item.value ? '#FFF' : colors.textSecondary} />
                  <Text
                    style={[
                      styles.leadChipText,
                      themed.textSecondary,
                      reminderLeadMinutes === item.value && { color: '#FFF', fontWeight: 'bold' },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Team Assignees Checklist */}
            <View style={styles.assigneeHeader}>
              <View style={styles.assigneeTitleRow}>
                <Users size={16} color={colors.textPrimary} />
                <Text style={[styles.inputLabel, themed.text, { marginBottom: 0 }]}>
                  Assign Team Members *
                </Text>
              </View>
              <TouchableOpacity onPress={handleSelectAll} accessibilityRole="button">
                <Text style={[styles.selectAllText, { color: colors.blue }]}>
                  {selectedUserIds.length === teamMembers.length ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.memberList, themed.border]}>
              {teamMembers.length === 0 ? (
                <Text style={[styles.emptyMembersText, themed.textSecondary]}>
                  No active team members available to assign.
                </Text>
              ) : (
                teamMembers.map((member) => {
                  const isChecked = selectedUserIds.includes(member.user_id);
                  return (
                    <TouchableOpacity
                      key={member.user_id}
                      style={[styles.memberItem, themed.borderBottom]}
                      onPress={() => toggleAssignee(member.user_id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isChecked }}
                      accessibilityLabel={`Assign ${member.email}`}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          isChecked && { backgroundColor: colors.blue, borderColor: colors.blue },
                        ]}
                      >
                        {isChecked && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <View style={styles.memberInfo}>
                        <Text style={[styles.memberEmail, themed.text]}>{member.email}</Text>
                        <Text style={[styles.memberRoleBadge, themed.textSecondary]}>
                          {member.member_role.toUpperCase()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, themed.borderTop]}>
            <TouchableOpacity
              style={[styles.cancelBtn, themed.buttonSecondary]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel task creation"
            >
              <Text style={[styles.cancelBtnText, themed.buttonSecondaryText]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.blue }]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Submit task assignment"
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Assign Task</Text>
              )}
            </TouchableOpacity>
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
    maxHeight: '90%',
    minHeight: '60%',
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
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
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDDDDD',
    alignItems: 'center',
  },
  priorityChipText: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  leadTimeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  leadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDDDDD',
  },
  leadChipText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  assigneeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  assigneeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectAllText: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  memberList: {
    borderWidth: 1,
    borderRadius: 8,
    maxHeight: 160,
  },
  emptyMembersText: {
    padding: 16,
    fontSize: 13,
    fontFamily: Fonts.body,
    textAlign: 'center',
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#AAAAAA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  memberInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberEmail: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  memberRoleBadge: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    borderTopWidth: 1,
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
  submitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
});
